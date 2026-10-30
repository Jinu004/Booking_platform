// Recorded full clinic offboarding ("delete my clinic": its data leaves the live systems within 30 days of the request).
//
// A request is recorded in platform_deletions (no foreign key, no personal data), so the record survives the deletion.
// fullDelete then removes, in this order, and can safely be run again after a failure at any step:
//   a. collect   conversation ids, campaign ids and the WhatsApp number (needed for the Redis keys), and the per-table row counts
//   b. caches    the in-process token cache and the live-event (SSE) connections of the clinic
//   c. database  DELETE FROM tenants (one transaction; every tenant table cascades). Skipped when the row is already gone.
//   d. files     the poster files under the bucket prefix "<tenant id>/" (only that exact prefix, only a strict UUID)
//   e. redis     keys of exactly this clinic, found with SCAN and removed with UNLINK in batches (never KEYS)
//   f. finish    counts, files and keys deleted, completed_at, status completed (and the collected ids are erased from the record)
// Nothing here talks to Meta (Meta-side cleanup and a data export are separate work).
//
// Everything outside (database pool, bucket, Redis, clock, logger) is injected, so the tests run against a scratch database,
// a test bucket prefix and dummy Redis keys. createOffboardingService() with no arguments uses the real ones.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET_NAME = process.env.POSTER_BUCKET_NAME || 'receptionai-posters-prod';
const DELETION_DAYS = 30;
const OPEN_STATUSES = ['requested', 'in_progress', 'failed'];
const REDIS_BATCH = 200;

// What only the clinic can do (the platform has no way to do it)
const MANUAL_STEPS = [
  'The clinic disconnects ReceptionAI from its WhatsApp Business app (WhatsApp Business app, Settings, Account, Business platform).',
  'The clinic removes the ReceptionAI integration and app access in Meta Business Manager (Business settings, Integrations).',
  'The clinic deletes its own WhatsApp account data at Meta if it wants that removed too: ReceptionAI cannot do this for the clinic.'
];

class OffboardingError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'OffboardingError';
    this.statusCode = statusCode;
  }
}

const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const globToRegExp = (pattern) => new RegExp('^' + pattern.split('*').map(escapeRegExp).join('.*') + '$');
const safeError = (err) => String((err && err.message) || err || 'Unknown error').replace(/\s+/g, ' ').slice(0, 400);

// The bucket prefix of a clinic. Throws unless it is exactly "<strict UUID>/": a short, empty or odd prefix can never reach the bucket.
function bucketPrefixFor(tenantId) {
  if (!isUuid(tenantId)) throw new OffboardingError('Invalid clinic id', 400);
  const prefix = `${tenantId}/`;
  assertSafePrefix(prefix);
  return prefix;
}
function assertSafePrefix(prefix) {
  if (typeof prefix !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/$/i.test(prefix)) {
    throw new OffboardingError('Refusing to touch the bucket: the prefix is not "<clinic id>/"', 400);
  }
}

// The Redis keys of one clinic. scanPatterns are matched with SCAN; exactKeys are single keys. Both are anchored to the clinic's id
// (a strict UUID has no glob characters), the collected conversation and campaign ids, or the clinic's WhatsApp number.
function redisKeySets(tenantId, collected, normalizeNumber) {
  const t = tenantId;
  const scanPatterns = [
    `session:${t}:*`,
    `doctor_schedules:${t}:*`,
    `waba_sync:${t}:*`,
    `wa_disc_alert:${t}:*`,
    `lock:${t}:*`,
    `media_reply:${t}:*`,
    `codebooking:lock:${t}:*`,
    `codebooking:done:${t}:*`,
    `codebooking:done:tomorrow:${t}:*`,
    `codebooking:done:future:${t}:*`
  ];
  const exactKeys = [`tenant_configs:${t}`, `tenant_settings:${t}`, `doctor_profiles:${t}`, `readiness:${t}`];
  const number = collected && collected.whatsappNumber ? String(collected.whatsappNumber) : '';
  if (number) {
    exactKeys.push(`tenant_wa:${number}`);
    try {
      const normalized = normalizeNumber(number);
      if (normalized && normalized !== number) exactKeys.push(`tenant_wa:${normalized}`);
    } catch (e) { /* the stored form above is still removed */ }
  }
  for (const id of (collected && collected.conversationIds) || []) {
    if (!isUuid(id)) continue;
    exactKeys.push(`tomorrow_booking:${id}`, `anotherday_days:${id}`, `attn_alert:${id}`);
  }
  for (const id of (collected && collected.campaignIds) || []) {
    if (!isUuid(id)) continue;
    exactKeys.push(`campaign:send:lock:${id}`);
  }
  return { scanPatterns, exactKeys };
}

function createOffboardingService(overrides = {}) {
  // Each dependency is looked up when it is used: an override wins, otherwise the real one is loaded then (a test never loads the app's own)
  const defaults = buildDefaultDeps();
  const deps = new Proxy({}, { get: (_target, key) => (overrides[key] !== undefined ? overrides[key] : defaults[key]) });
  const logger = { info: (m) => deps.logger.info(m), warn: (m) => deps.logger.warn(m), error: (m) => deps.logger.error(m) };
  const info = (step, tenantId, extra = '') => logger.info(`OFFBOARDING step=${step} tenant=${tenantId}${extra ? ' ' + extra : ''}`);

  // ------------------------------------------------------------------ database helpers
  async function getTenant(tenantId) {
    const res = await deps.pool.query('SELECT id, name, status, plan, industry, whatsapp_number, whatsapp_waba_id, whatsapp_phone_number_id, updated_at FROM tenants WHERE id = $1', [tenantId]);
    return res.rows[0] || null;
  }

  async function getOpenRequest(tenantId) {
    const res = await deps.pool.query('SELECT * FROM platform_deletions WHERE tenant_id = $1 AND completed_at IS NULL', [tenantId]);
    return res.rows[0] || null;
  }

  // A super admin of the clinic's own staff can never be deleted with it (the platform would lose its administrator)
  async function assertNoSuperAdmin(tenantId) {
    const res = await deps.pool.query("SELECT 1 FROM staff WHERE tenant_id = $1 AND role = 'super_admin' LIMIT 1", [tenantId]);
    if (res.rows.length) throw new OffboardingError('This clinic holds a super admin account and cannot be deleted', 400);
  }

  // Row counts of every table that holds the clinic's data: each table with a tenant_id column (except the tenants table and the
  // deletion records themselves) plus the child tables reached through a cascade (messages through conversations, password resets
  // through staff). Zero tables are left out.
  async function countTenantRows(tenantId) {
    const tables = (await deps.pool.query(
      `SELECT DISTINCT c.table_name FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
       WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND c.table_name NOT IN ('tenants', 'platform_deletions')
       ORDER BY c.table_name`
    )).rows.map((row) => row.table_name);
    const result = {};
    let total = 0;
    for (const name of tables) {
      if (!/^[a-z0-9_]+$/.test(name)) continue;
      const n = Number((await deps.pool.query(`SELECT count(*) AS n FROM "${name}" WHERE tenant_id = $1`, [tenantId])).rows[0].n);
      if (n > 0) { result[name] = n; total += n; }
    }
    const messages = Number((await deps.pool.query('SELECT count(*) AS n FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE tenant_id = $1)', [tenantId])).rows[0].n);
    if (messages > 0) { result.messages = messages; total += messages; }
    const resets = Number((await deps.pool.query('SELECT count(*) AS n FROM auth_password_resets WHERE staff_id IN (SELECT id FROM staff WHERE tenant_id = $1)', [tenantId])).rows[0].n);
    if (resets > 0) { result.auth_password_resets = resets; total += resets; }
    return { tables: result, totalRows: total };
  }

  async function collectIds(tenantId, tenant) {
    const conversations = await deps.pool.query('SELECT id FROM conversations WHERE tenant_id = $1', [tenantId]);
    const campaigns = await deps.pool.query('SELECT id FROM campaigns WHERE tenant_id = $1', [tenantId]);
    return {
      conversationIds: conversations.rows.map((r) => r.id),
      campaignIds: campaigns.rows.map((r) => r.id),
      whatsappNumber: tenant && tenant.whatsapp_number ? tenant.whatsapp_number : null
    };
  }

  // ------------------------------------------------------------------ files
  async function bucketUsage(tenantId) {
    const prefix = bucketPrefixFor(tenantId);
    const objects = await deps.bucket.list(prefix);
    return { prefix: 'the clinic folder', objects: objects.length, bytes: objects.reduce((sum, o) => sum + (Number(o.size) || 0), 0) };
  }

  async function deleteBucketFiles(tenantId) {
    const prefix = bucketPrefixFor(tenantId); // throws unless exactly "<strict UUID>/"
    const before = await deps.bucket.list(prefix);
    let deleted = 0;
    for (const object of before) {
      // Belt and braces: an object outside the prefix is never deleted, whatever the listing returned
      if (typeof object.name !== 'string' || !object.name.startsWith(prefix)) continue;
      await deps.bucket.remove(object.name);
      deleted += 1;
    }
    const after = await deps.bucket.list(prefix);
    if (after.length > 0) throw new Error(`${after.length} files are still listed under the clinic folder after the delete`);
    return { before: before.length, after: after.length, deleted };
  }

  // ------------------------------------------------------------------ redis
  async function countRedisKeys(tenantId, collected) {
    const { scanPatterns, exactKeys } = redisKeySets(tenantId, collected, deps.normalizeNumber);
    const perPattern = {};
    const seen = new Set();
    for (const pattern of scanPatterns) {
      let n = 0;
      for await (const key of deps.redis.scan(pattern)) { n += 1; seen.add(key); }
      perPattern[pattern.replace(tenantId, '<clinic>')] = n;
    }
    let exact = 0;
    for (let i = 0; i < exactKeys.length; i += REDIS_BATCH) {
      exact += await deps.redis.existsCount(exactKeys.slice(i, i + REDIS_BATCH));
    }
    perPattern['exact keys (caches, locks per conversation and campaign, tenant_wa)'] = exact;
    return { perPattern, total: seen.size + exact };
  }

  async function deleteRedisKeys(tenantId, collected) {
    const { scanPatterns, exactKeys } = redisKeySets(tenantId, collected, deps.normalizeNumber);
    const allowed = [...scanPatterns.map(globToRegExp)];
    const exactSet = new Set(exactKeys);
    const isAllowed = (key) => exactSet.has(key) || allowed.some((re) => re.test(key));
    let removed = 0;
    const flush = async (batch) => {
      if (!batch.length) return;
      removed += await deps.redis.unlink(batch);
      batch.length = 0;
    };
    for (const pattern of scanPatterns) {
      const batch = [];
      for await (const key of deps.redis.scan(pattern)) {
        if (!isAllowed(key)) continue; // never touch a key that is not one of this clinic's exact patterns
        batch.push(key);
        if (batch.length >= REDIS_BATCH) await flush(batch);
      }
      await flush(batch);
    }
    for (let i = 0; i < exactKeys.length; i += REDIS_BATCH) {
      removed += await deps.redis.unlink(exactKeys.slice(i, i + REDIS_BATCH).filter(isAllowed));
    }
    return removed;
  }

  // ------------------------------------------------------------------ requests
  async function createDeletionRequest(tenantId, requestedBy, notes) {
    if (!isUuid(tenantId)) throw new OffboardingError('Invalid clinic id', 400);
    const tenant = await getTenant(tenantId);
    if (!tenant) throw new OffboardingError('Clinic not found', 404);
    if (tenant.status !== 'suspended') throw new OffboardingError('The clinic must be suspended before a deletion request is recorded', 400);
    await assertNoSuperAdmin(tenantId);
    if (await getOpenRequest(tenantId)) throw new OffboardingError('This clinic already has an open deletion request', 409);
    try {
      const res = await deps.pool.query(
        `INSERT INTO platform_deletions (tenant_id, tenant_name, plan, industry, requested_by, suspended_at, due_at, notes)
         VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 || ' days')::interval, $8)
         RETURNING id, tenant_id, tenant_name, plan, industry, requested_at, requested_by, suspended_at, due_at, status, notes`,
        [tenantId, tenant.name, tenant.plan, tenant.industry, isUuid(requestedBy) ? requestedBy : null, tenant.updated_at, String(DELETION_DAYS),
          typeof notes === 'string' && notes.trim() ? notes.trim().slice(0, 500) : null]
      );
      info('request', tenantId, `request=${res.rows[0].id}`);
      return res.rows[0];
    } catch (err) {
      if (err && err.code === '23505') throw new OffboardingError('This clinic already has an open deletion request', 409);
      throw err;
    }
  }

  // days_left: whole days until due_at, rounded up (negative when overdue); only for requests that are not completed
  async function listDeletionRequests() {
    const res = await deps.pool.query(
      `SELECT id, tenant_id, tenant_name, plan, industry, requested_at, requested_by, suspended_at, due_at, started_at, completed_at,
              status, counts, files_deleted, redis_keys_deleted, last_error, notes,
              CASE WHEN completed_at IS NULL THEN CEIL(EXTRACT(EPOCH FROM (due_at - now())) / 86400)::int END AS days_left
       FROM platform_deletions
       ORDER BY due_at ASC, requested_at ASC`
    );
    return res.rows;
  }

  // ------------------------------------------------------------------ preview (read only)
  async function previewDeletion(tenantId) {
    if (!isUuid(tenantId)) throw new OffboardingError('Invalid clinic id', 400);
    const tenant = await getTenant(tenantId);
    if (!tenant) throw new OffboardingError('Clinic not found', 404);
    const request = await getOpenRequest(tenantId);
    const counts = await countTenantRows(tenantId);
    const collected = await collectIds(tenantId, tenant);
    return {
      tenant: { id: tenant.id, name: tenant.name, status: tenant.status, plan: tenant.plan, industry: tenant.industry },
      request: request ? { id: request.id, status: request.status, requested_at: request.requested_at, due_at: request.due_at } : null,
      database: counts,
      files: await bucketUsage(tenantId),
      redis: await countRedisKeys(tenantId, collected),
      meta: { wabaIdPresent: !!tenant.whatsapp_waba_id, phoneNumberIdPresent: !!tenant.whatsapp_phone_number_id, templates: counts.tables.tenant_templates || 0 },
      manualSteps: MANUAL_STEPS
    };
  }

  // ------------------------------------------------------------------ the delete
  async function fullDelete(tenantId, { confirmName, requestedBy } = {}) {
    if (!isUuid(tenantId)) throw new OffboardingError('Invalid clinic id', 400);

    // The tenant must exist and be suspended, OR (retry) be gone with an unfinished record
    let tenant = await getTenant(tenantId);
    let open = await getOpenRequest(tenantId);
    if (tenant) {
      if (tenant.status !== 'suspended') throw new OffboardingError('The clinic must be suspended before it is deleted', 400);
    } else if (!open || !['in_progress', 'failed'].includes(open.status)) {
      throw new OffboardingError('Clinic not found', 404);
    }
    if (!open) throw new OffboardingError('Record a deletion request for this clinic first', 400);
    const expectedName = tenant ? tenant.name : open.tenant_name;
    if (typeof confirmName !== 'string' || confirmName !== expectedName) {
      throw new OffboardingError('The confirmation name does not match the clinic name', 400);
    }
    if (tenant) {
      await assertNoSuperAdmin(tenantId);
      if (isUuid(requestedBy)) {
        const own = await deps.pool.query('SELECT tenant_id FROM staff WHERE id = $1', [requestedBy]);
        if (own.rows[0] && own.rows[0].tenant_id === tenantId) throw new OffboardingError('You cannot delete the clinic you are logged in to', 400);
      }
    }

    // One delete at a time per clinic: a second call while one is running is turned away
    const lockClient = await deps.pool.connect();
    let locked = false;
    try {
      locked = (await lockClient.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS ok', [`offboarding:${tenantId}`])).rows[0].ok;
      if (!locked) throw new OffboardingError('A deletion for this clinic is already running', 409);

      // The state may have changed while this call waited: read it again now that this call holds the lock
      tenant = await getTenant(tenantId);
      open = await getOpenRequest(tenantId);
      if (!open) throw new OffboardingError('This deletion has already been completed', 409);
      if (tenant && tenant.status !== 'suspended') throw new OffboardingError('The clinic must be suspended before it is deleted', 400);
      if (!tenant && !['in_progress', 'failed'].includes(open.status)) throw new OffboardingError('Clinic not found', 404);

      let step = 'collect';
      try {
        // a. collect
        let counts;
        let collected;
        if (tenant) {
          counts = await countTenantRows(tenantId);
          collected = await collectIds(tenantId, tenant);
        } else {
          counts = open.counts || { tables: {}, totalRows: 0 };
          collected = open.collected || { conversationIds: [], campaignIds: [], whatsappNumber: null };
        }
        await deps.pool.query(
          `UPDATE platform_deletions SET status = 'in_progress', started_at = COALESCE(started_at, now()), counts = $2, collected = $3, last_error = NULL WHERE id = $1 AND completed_at IS NULL`,
          [open.id, JSON.stringify(counts), JSON.stringify(collected)]
        );
        info('collect', tenantId, `rows=${counts.totalRows} conversations=${collected.conversationIds.length} campaigns=${collected.campaignIds.length}`);

        // b. caches in this process
        step = 'caches';
        if (tenant) {
          deps.clearTenantTokenCache(tenantId);
          const closed = deps.closeTenantSseClients(tenantId);
          info('caches', tenantId, `sse_closed=${closed}`);
        }

        // c. database
        step = 'database';
        if (tenant) {
          const client = await deps.pool.connect();
          try {
            await client.query('BEGIN');
            const removed = await client.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
            if (removed.rowCount !== 1) throw new Error('The clinic row could not be deleted');
            await client.query('COMMIT');
          } catch (err) {
            try { await client.query('ROLLBACK'); } catch (e) { /* connection gone */ }
            throw err;
          } finally {
            client.release();
          }
          info('database', tenantId, 'deleted=yes');
        } else {
          info('database', tenantId, 'deleted=already_gone');
        }

        // d. files
        step = 'files';
        const files = await deleteBucketFiles(tenantId);
        info('files', tenantId, `before=${files.before} after=${files.after}`);

        // e. redis
        step = 'redis';
        const redisKeys = await deleteRedisKeys(tenantId, collected);
        info('redis', tenantId, `removed=${redisKeys}`);

        // f. finish: the collected ids and the clinic's number are erased from the record
        step = 'finish';
        await deps.pool.query(
          `UPDATE platform_deletions SET status = 'completed', completed_at = now(), counts = $2, files_deleted = $3, redis_keys_deleted = $4, collected = NULL, last_error = NULL WHERE id = $1`,
          [open.id, JSON.stringify(counts), files.deleted, redisKeys]
        );
        info('finish', tenantId, 'status=completed');
        return { status: 'completed', counts, filesDeleted: files.deleted, redisKeysDeleted: redisKeys };
      } catch (err) {
        const text = `${step}: ${safeError(err)}`;
        logger.error(`OFFBOARDING_FAILED tenant=${tenantId} step=${step} error=${safeError(err)}`);
        try {
          await deps.pool.query(`UPDATE platform_deletions SET status = 'failed', last_error = $2 WHERE id = $1 AND completed_at IS NULL`, [open.id, text.slice(0, 500)]);
        } catch (recordErr) {
          logger.error(`OFFBOARDING_RECORD_FAILED tenant=${tenantId} error=${safeError(recordErr)}`);
        }
        throw new OffboardingError(`Deletion failed at step ${text}. It is safe to run it again.`, 500);
      }
    } finally {
      if (locked) {
        try { await lockClient.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [`offboarding:${tenantId}`]); } catch (e) { /* released with the connection */ }
      }
      lockClient.release();
    }
  }

  return { createDeletionRequest, listDeletionRequests, previewDeletion, fullDelete, MANUAL_STEPS };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The real pool, bucket, Redis and helpers. Loaded only when no override is given for them, so a test never opens the app's connections.
// ---------------------------------------------------------------------------------------------------------------------------------
const lazyValue = (fn) => { let value; return () => (value === undefined ? (value = fn()) : value); };

// The poster bucket. list() refuses any prefix that is not "<strict UUID>/"; remove() deletes one object by name.
function createBucketAdapter(getBucket = lazyValue(() => new (require('@google-cloud/storage').Storage)().bucket(BUCKET_NAME))) {
  return {
    async list(prefix) {
      assertSafePrefix(prefix);
      const [files] = await getBucket().getFiles({ prefix });
      return files.map((f) => ({ name: f.name, size: Number(f.metadata && f.metadata.size) || 0 }));
    },
    async remove(name) {
      await getBucket().file(name).delete({ ignoreNotFound: true });
    }
  };
}

// A Redis client (node-redis v4) as the three operations the service needs
function createRedisAdapter(getClient) {
  return {
    async *scan(pattern) {
      for await (const key of getClient().scanIterator({ MATCH: pattern, COUNT: REDIS_BATCH })) yield key;
    },
    async unlink(keys) { return keys.length ? Number(await getClient().unlink(keys)) : 0; },
    async existsCount(keys) { return keys.length ? Number(await getClient().exists(keys)) : 0; }
  };
}

function buildDefaultDeps() {
  const realPool = lazyValue(() => require('../../config/database'));
  const realRedis = lazyValue(() => require('../../config/redis'));
  return {
    get pool() { return realPool(); },
    get logger() { return require('../../utils/logger'); },
    normalizeNumber: (n) => require('../tenant/tenant.service').normalizeNumber(n),
    clearTenantTokenCache: (id) => require('../channel/whatsapp/senderContext').clearTenantTokenCache(id),
    closeTenantSseClients: (id) => require('../hitl/sse').closeTenantSseClients(id),
    bucket: createBucketAdapter(),
    redis: createRedisAdapter(realRedis)
  };
}

let defaultService = null;
const getOffboardingService = () => defaultService || (defaultService = createOffboardingService());

module.exports = {
  createOffboardingService, getOffboardingService, OffboardingError, createBucketAdapter, createRedisAdapter,
  bucketPrefixFor, assertSafePrefix, redisKeySets, isUuid, MANUAL_STEPS, DELETION_DAYS, BUCKET_NAME
};
