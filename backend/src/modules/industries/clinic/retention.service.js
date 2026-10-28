// Automatic retention: erases customers (patients) of active clinics whose last activity is older than `years` (default 5).
//
// Last activity of a customer = the latest of customers.created_at, customers.last_seen, conversations.last_message_at,
// bookings.booking_date and visit_notes.visit_date. A booking with a future date therefore protects the customer.
// Only customers of clinics with status 'active' are touched, and never a clinic with an open row in platform_deletions
// (the recorded offboarding delete owns those).
//
// Each customer is erased by eraseCustomer in its own transaction (audit action customer_erased_auto). One run at a time:
// a Postgres advisory lock is held on a dedicated connection for the whole run. Logs hold counts and ids only, never personal data.
const customerErasure = require('./customerErasure.service');

const LOCK_NAME = 'retention:auto';
const MIN_YEARS = 1;

// Customers of active clinics (without an open platform_deletions row) whose last activity is older than $1 years
const ELIGIBLE_FROM = `
  FROM customers c
  JOIN tenants t ON t.id = c.tenant_id AND t.status = 'active'
  CROSS JOIN LATERAL (
    SELECT GREATEST(
      c.created_at::timestamptz,
      c.last_seen::timestamptz,
      (SELECT max(v.last_message_at) FROM conversations v WHERE v.customer_id = c.id)::timestamptz,
      (SELECT max(b.booking_date) FROM bookings b WHERE b.customer_id = c.id)::timestamptz,
      (SELECT max(n.visit_date) FROM visit_notes n WHERE n.customer_id = c.id)::timestamptz
    ) AS last_activity
  ) a
  WHERE a.last_activity < now() - ($1::int * interval '1 year')
    AND NOT EXISTS (SELECT 1 FROM platform_deletions pd WHERE pd.tenant_id = c.tenant_id AND pd.completed_at IS NULL)`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Plain-text id for logs (ids only; a message from the database can hold anything, so it is cut and stripped)
const safeError = (err) => String((err && err.message) || err).replace(/[^\w .:,'-]/g, '').slice(0, 120);

/**
 * @param {{ pool: object, years?: number, dryRun?: boolean, cap?: number, pauseMs?: number, log?: object, erase?: Function }} options
 * @returns {Promise<{ ran: boolean, dryRun?: boolean, eligible: number, erased: number, skipped: number, failed: number }>}
 */
async function runRetention({ pool, years = 5, dryRun = true, cap = 50, pauseMs = 200, log = console, erase = customerErasure.eraseCustomer } = {}) {
  const result = { ran: false, eligible: 0, erased: 0, skipped: 0, failed: 0 };
  const say = (level, message) => { try { (log[level] || log.info || (() => {})).call(log, message); } catch (e) { /* logging must never break the run */ } };

  if (typeof years !== 'number' || !Number.isFinite(years) || !Number.isInteger(years) || years < MIN_YEARS) {
    say('error', `RETENTION_REFUSED reason=invalid_years years=${String(years).slice(0, 20)}`);
    return result;
  }
  if (!Number.isInteger(cap) || cap < 1) {
    say('error', `RETENTION_REFUSED reason=invalid_cap cap=${String(cap).slice(0, 20)}`);
    return result;
  }

  const lockClient = await pool.connect();
  let locked = false;
  try {
    locked = (await lockClient.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS ok', [LOCK_NAME])).rows[0].ok;
    if (!locked) {
      say('info', 'RETENTION_SKIPPED reason=another_run_in_progress');
      return result;
    }
    result.ran = true;
    result.dryRun = dryRun === true;

    if (dryRun !== false) {
      // Dry run (anything but an explicit false): count only, delete nothing
      const client = await pool.connect();
      try {
        const rows = (await client.query(`SELECT c.tenant_id AS tenant_id, count(*)::int AS n ${ELIGIBLE_FROM} GROUP BY c.tenant_id ORDER BY c.tenant_id`, [years])).rows;
        result.eligible = rows.reduce((sum, row) => sum + row.n, 0);
        for (const row of rows) say('info', `RETENTION_DRY_RUN_TENANT tenant=${row.tenant_id} eligible=${row.n}`);
      } finally {
        client.release();
      }
      say('info', `RETENTION_RUN dry=true years=${years} eligible=${result.eligible} erased=0 skipped=0 failed=0`);
      return result;
    }

    const selector = await pool.connect();
    let candidates;
    try {
      candidates = (await selector.query(
        `SELECT c.id AS customer_id, c.tenant_id AS tenant_id ${ELIGIBLE_FROM} ORDER BY a.last_activity ASC, c.id ASC LIMIT $2`, [years, cap]
      )).rows;
    } finally {
      selector.release();
    }
    result.eligible = candidates.length;

    for (let i = 0; i < candidates.length; i += 1) {
      const { customer_id: customerId, tenant_id: tenantId } = candidates[i];
      try {
        // The customer may have written or booked since the selection: the same rule is checked again for this one customer
        const checker = await pool.connect();
        let stillEligible;
        try {
          stillEligible = (await checker.query(`SELECT 1 ${ELIGIBLE_FROM} AND c.id = $2 AND c.tenant_id = $3`, [years, customerId, tenantId])).rows.length === 1;
        } finally {
          checker.release();
        }
        if (!stillEligible) {
          result.skipped += 1;
          continue;
        }
        const client = await pool.connect();
        try {
          await erase(client, { tenantId, customerId, staffId: null, keepMedicalNotes: false, source: 'retention' });
          result.erased += 1;
        } finally {
          client.release();
        }
      } catch (err) {
        if (err && err.name === 'ErasureError' && err.statusCode === 404) {
          result.skipped += 1; // already gone (a clinic admin erased the patient meanwhile)
        } else {
          result.failed += 1;
          say('error', `RETENTION_FAILED tenant=${tenantId} customer=${customerId} error=${safeError(err)}`);
        }
      }
      if (pauseMs > 0 && i < candidates.length - 1) await sleep(pauseMs);
    }
    say('info', `RETENTION_RUN dry=false years=${years} eligible=${result.eligible} erased=${result.erased} skipped=${result.skipped} failed=${result.failed}`);
    return result;
  } finally {
    let destroy = false;
    if (locked) {
      // If the unlock fails, the connection is destroyed instead of going back to the pool, which frees the lock
      try { await lockClient.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [LOCK_NAME]); } catch (e) { destroy = true; }
    }
    lockClient.release(destroy ? true : undefined);
  }
}

module.exports = { runRetention, LOCK_NAME };
