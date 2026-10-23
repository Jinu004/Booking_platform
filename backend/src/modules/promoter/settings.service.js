const pool = require('../../config/database');
const schema = require('./settings.schema');
const { logPromoterAudit } = require('./promoter.audit');

const CACHE_MS = 30 * 1000;
let cache = null; // { at, row }

class SettingsError extends Error {
  constructor(message, status = 400, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function rowToCurrent(row) {
  return {
    id: row.id,
    version: row.version,
    settings: schema.withDefaults(row.settings),
    reason: row.reason,
    created_by: row.created_by,
    created_at: row.created_at
  };
}

/**
 * Current settings version: { id, version, settings, ... }.
 * Pass a transaction client to read inside a transaction (no cache).
 */
async function getCurrent(db = null) {
  if (!db && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const q = await (db || pool).query(
    `SELECT * FROM promoter_program_settings ORDER BY version DESC LIMIT 1`
  );
  if (!q.rows.length) throw new Error('Promoter program settings are missing (run migrations)');
  const value = rowToCurrent(q.rows[0]);
  if (!db) cache = { at: Date.now(), value };
  return value;
}

function clearCache() {
  cache = null;
}

async function getHistory(limit = 50) {
  const q = await pool.query(
    `SELECT p.id, p.version, p.settings, p.reason, p.created_at, s.name AS created_by_name
     FROM promoter_program_settings p LEFT JOIN staff s ON s.id = p.created_by
     ORDER BY p.version DESC LIMIT $1`, [Math.min(Math.max(Number(limit) || 50, 1), 200)]
  );
  return q.rows.map(r => ({ ...r, settings: schema.withDefaults(r.settings) }));
}

function diff(before, after) {
  const changes = {};
  for (const f of schema.FIELDS) {
    if (JSON.stringify(before[f.key]) !== JSON.stringify(after[f.key])) {
      changes[f.key] = { from: before[f.key], to: after[f.key] };
    }
  }
  return changes;
}

/**
 * Validates and saves a new settings version.
 * @param {object} p
 * @param {object} p.changes  keys to change (others keep their current value)
 * @param {number} p.baseVersion version the admin edited; rejected with 409 if it is no longer current
 * @param {string} p.reason
 * @param {object} actor { actorType, actorId, ip }
 */
async function saveSettings({ changes, baseVersion, reason }, actor) {
  if (!reason || !String(reason).trim()) throw new SettingsError('A reason is required');
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new SettingsError('changes must be an object');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialise concurrent saves
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['promoter_settings_save']);
    const current = await getCurrent(client);
    if (Number(baseVersion) !== current.version) {
      throw new SettingsError(`Settings were changed by someone else (now version ${current.version}). Reload and try again.`, 409);
    }
    const merged = { ...current.settings, ...changes };
    const { value, errors } = schema.validate(merged);
    if (Object.keys(errors).length) throw new SettingsError('Some settings are invalid', 400, errors);

    if (value.default_scheme_id !== current.settings.default_scheme_id || changes.default_scheme_id) {
      const s = await client.query('SELECT id, is_active FROM commission_schemes WHERE id = $1', [value.default_scheme_id]);
      if (!s.rows.length || !s.rows[0].is_active) {
        throw new SettingsError('Some settings are invalid', 400, { default_scheme_id: 'Choose an active scheme' });
      }
    }

    const changed = diff(current.settings, value);
    if (!Object.keys(changed).length) throw new SettingsError('Nothing changed');

    const ins = await client.query(
      `INSERT INTO promoter_program_settings (version, settings, reason, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [current.version + 1, JSON.stringify(value), String(reason).trim(), actor?.actorType === 'staff' ? actor.actorId : null]
    );
    await logPromoterAudit(client, {
      ...actor, action: 'settings.update', entityType: 'promoter_program_settings', entityId: ins.rows[0].id,
      before: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.from])),
      after: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.to])),
      reason: String(reason).trim()
    });
    await client.query('COMMIT');
    clearCache();
    return { ...rowToCurrent(ins.rows[0]), changed };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Impact preview for a set of changes without saving */
async function previewSettings(changes) {
  const current = await getCurrent();
  const merged = { ...current.settings, ...(changes || {}) };
  const { errors, value } = schema.validate(merged);
  const changed = Object.keys(errors).length ? {} : diff(current.settings, value);
  const notes = [];
  const counts = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM promoters WHERE status = 'active')::int AS active_promoters,
      (SELECT COUNT(*) FROM tenant_referrals WHERE status <> 'revoked')::int AS referrals,
      (SELECT COUNT(*) FROM promoter_commissions WHERE status = 'pending')::int AS pending_entries,
      (SELECT COALESCE(SUM(amount_paise), 0) FROM promoter_commissions WHERE status IN ('pending', 'available'))::bigint AS unpaid_paise
  `);
  const c = counts.rows[0];
  for (const [key, ch] of Object.entries(changed)) {
    const f = schema.FIELD_MAP[key];
    notes.push(`${f.label}: ${JSON.stringify(ch.from)} → ${JSON.stringify(ch.to)}. Takes effect: ${f.effect}.`);
  }
  if (changed.program_enabled && ch(changed.program_enabled) === false) {
    notes.push(`${c.active_promoters} active promoters will no longer be able to bring new clinics. Existing referrals keep earning.`);
  }
  if (changed.freeze_accruals && ch(changed.freeze_accruals) === true) {
    notes.push('New payments will not create commission until accruals are unfrozen.');
  }
  if (changed.hold_days) {
    notes.push(`${c.pending_entries} commissions already on hold keep their current release date.`);
  }
  return {
    errors,
    changed,
    notes,
    counts: { ...c, unpaid_paise: Number(c.unpaid_paise) }
  };
}

function ch(change) {
  return change.to;
}

module.exports = { getCurrent, getHistory, saveSettings, previewSettings, clearCache, SettingsError };
