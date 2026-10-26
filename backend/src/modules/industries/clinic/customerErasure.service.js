// Patient erasure: removes ONE customer of ONE clinic with all their data, in one transaction, after a read-only preview.
//
// Both functions take a database client (a dedicated connection from the pool, or a client of any other database for tests).
// The tenant id always comes from the authenticated user, never from the request body, and every statement is limited to it.
//
// Order of deletion (children before parents, because bookings, conversations and notifications reference the customer with NO ACTION):
//   1. visit_notes of the customer / their patients / their bookings  (or, with keepMedicalNotes, they are detached instead)
//   2. clinic_tokens of the customer's bookings
//   3. notifications of the customer / their bookings
//   4. bookings
//   5. campaign_recipients of the customer
//   6. unanswered_questions of the customer's conversations (they have only a plain conversation id column, no foreign key)
//   7. queued WhatsApp retries to the customer's phone number (no foreign key either; their payload holds message text)
//   8. patient_conditions
//   9. conversations (messages cascade)
//  10. the customer (patients and patient_profiles cascade)
// An audit_logs entry with ids and counts only is written in the same transaction. After COMMIT the Redis keys of the customer are
// removed (a Redis failure is logged and never fails the erasure).
const logger = require('../../../utils/logger');

class ErasureError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'ErasureError';
    this.statusCode = statusCode;
  }
}

// The last 10 digits of a phone number, to match numbers stored with or without "+91" and spaces
const phoneTail = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);

// The customer of this clinic (404 for an unknown id and for an id of another clinic: the same answer)
async function loadCustomer(client, tenantId, customerId) {
  const res = await client.query('SELECT id, name, phone FROM customers WHERE id = $1 AND tenant_id = $2', [customerId, tenantId]);
  if (!res.rows.length) throw new ErasureError('Not found', 404);
  return res.rows[0];
}

// The ids that tie the customer's rows together
async function collectIds(client, tenantId, customerId) {
  const ids = (sql) => client.query(sql, [customerId, tenantId]).then((r) => r.rows.map((row) => row.id));
  const [patientIds, conversationIds, bookingIds] = await Promise.all([
    ids('SELECT id FROM patients WHERE customer_id = $1 AND tenant_id = $2'),
    ids('SELECT id FROM conversations WHERE customer_id = $1 AND tenant_id = $2'),
    ids('SELECT id FROM bookings WHERE customer_id = $1 AND tenant_id = $2')
  ]);
  return { patientIds, conversationIds, bookingIds };
}

// Counts of every group of rows that belongs to the customer (used by the preview and recorded by the erasure)
async function countRows(client, tenantId, customerId, phone, ids) {
  const one = async (sql, params) => Number((await client.query(sql, params)).rows[0].n);
  const { patientIds, conversationIds, bookingIds } = ids;
  return {
    patients: patientIds.length,
    bookings: bookingIds.length,
    tokens: await one('SELECT count(*) AS n FROM clinic_tokens WHERE tenant_id = $1 AND booking_id = ANY($2::uuid[])', [tenantId, bookingIds]),
    notifications: await one('SELECT count(*) AS n FROM notifications WHERE tenant_id = $1 AND (customer_id = $2 OR booking_id = ANY($3::uuid[]))', [tenantId, customerId, bookingIds]),
    conversations: conversationIds.length,
    messages: await one('SELECT count(*) AS n FROM messages WHERE conversation_id = ANY($1::uuid[])', [conversationIds]),
    visitNotes: await one('SELECT count(*) AS n FROM visit_notes WHERE tenant_id = $1 AND (customer_id = $2 OR patient_id = ANY($3::uuid[]) OR booking_id = ANY($4::uuid[]))', [tenantId, customerId, patientIds, bookingIds]),
    conditions: await one('SELECT count(*) AS n FROM patient_conditions WHERE tenant_id = $1 AND (customer_id = $2 OR patient_id = ANY($3::uuid[]))', [tenantId, customerId, patientIds]),
    profiles: await one('SELECT count(*) AS n FROM patient_profiles WHERE tenant_id = $1 AND customer_id = $2', [tenantId, customerId]),
    campaignRecipients: await one('SELECT count(*) AS n FROM campaign_recipients WHERE tenant_id = $1 AND customer_id = $2', [tenantId, customerId]),
    unansweredQuestions: await one('SELECT count(*) AS n FROM unanswered_questions WHERE tenant_id = $1 AND conversation_id = ANY($2::uuid[])', [tenantId, conversationIds]),
    queuedRetries: phoneTail(phone).length >= 8
      ? await one(`SELECT count(*) AS n FROM whatsapp_retry_queue WHERE tenant_id = $1 AND right(regexp_replace(to_number, '\\D', '', 'g'), 10) = $2`, [tenantId, phoneTail(phone)])
      : 0
  };
}

// The patients an erasure of this customer would remove (one phone number can have several, e.g. a family): id and name only,
// ordered by name, at most PREVIEW_PATIENT_LIMIT entries (counts.patients always holds the full number)
const PREVIEW_PATIENT_LIMIT = 50;

/**
 * Read-only: what an erasure would remove. Returns { customer: { id, name, phone }, counts, patients: [{ id, name }] }.
 * Throws ErasureError(404) when the customer is not in this clinic.
 */
async function previewCustomerErasure(client, tenantId, customerId) {
  const customer = await loadCustomer(client, tenantId, customerId);
  const ids = await collectIds(client, tenantId, customerId);
  const counts = await countRows(client, tenantId, customerId, customer.phone, ids);
  const patientRows = await client.query(
    'SELECT id, name FROM patients WHERE customer_id = $1 AND tenant_id = $2 ORDER BY name ASC, id ASC LIMIT $3',
    [customerId, tenantId, PREVIEW_PATIENT_LIMIT]
  );
  return { customer, counts, patients: patientRows.rows.map((row) => ({ id: row.id, name: row.name })) };
}

// Removes the Redis keys of the customer. Never throws.
async function clearRedisKeys(tenantId, phone, conversationIds) {
  try {
    const redis = require('../../../config/redis');
    const { clearSession } = require('../../conversation/conversation.session');
    await clearSession(tenantId, phone);
    const digits = String(phone || '').replace(/\D/g, '');
    const keys = [];
    if (digits) keys.push(`session:${tenantId}:${digits}`, `session:${tenantId}:+${digits}`);
    for (const conversationId of conversationIds) {
      keys.push(`tomorrow_booking:${conversationId}`, `anotherday_days:${conversationId}`, `attn_alert:${conversationId}`);
    }
    let failures = 0;
    for (const key of keys) {
      try { await redis.del(key); } catch (keyErr) { failures += 1; }
    }
    if (failures > 0) logger.warn(`CUSTOMER_ERASURE redis_cleanup_failed keys=${failures}`);
  } catch (redisErr) {
    logger.warn(`CUSTOMER_ERASURE redis_cleanup_failed class=${String((redisErr && (redisErr.name || redisErr.code)) || 'Error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40)}`);
  }
}

/**
 * Erases the customer. Runs BEGIN ... COMMIT on the given client (ROLLBACK on any error, the error is thrown again).
 * @param {object} client a dedicated database client (not a pool)
 * @param {{ tenantId: string, customerId: string, staffId?: string|null, keepMedicalNotes?: boolean, ipAddress?: string|null }} input
 * @returns {Promise<{ counts: object, keepMedicalNotes: boolean }>}
 */
async function eraseCustomer(client, input) {
  const { tenantId, customerId, staffId = null, ipAddress = null } = input;
  const keepMedicalNotes = input.keepMedicalNotes === true;
  let phone = null;
  let conversationIds = [];
  let counts;
  try {
    await client.query('BEGIN');
    const customer = await loadCustomer(client, tenantId, customerId);
    phone = customer.phone;
    const ids = await collectIds(client, tenantId, customerId);
    conversationIds = ids.conversationIds;
    const { patientIds, bookingIds } = ids;
    counts = await countRows(client, tenantId, customerId, phone, ids);

    // 1. Medical notes: deleted, or (keepMedicalNotes) detached from the customer, the patient and the booking so they no longer name them
    const notesWhere = 'tenant_id = $1 AND (customer_id = $2 OR patient_id = ANY($3::uuid[]) OR booking_id = ANY($4::uuid[]))';
    const notesParams = [tenantId, customerId, patientIds, bookingIds];
    if (keepMedicalNotes) {
      // customer_id must be cleared first: a visit note with a customer id would be removed by the customer's cascade
      await client.query(`UPDATE visit_notes SET customer_id = NULL, patient_id = NULL, booking_id = NULL WHERE ${notesWhere}`, notesParams);
    } else {
      await client.query(`DELETE FROM visit_notes WHERE ${notesWhere}`, notesParams);
    }

    // 2-4. Tokens, notifications, bookings
    await client.query('DELETE FROM clinic_tokens WHERE tenant_id = $1 AND booking_id = ANY($2::uuid[])', [tenantId, bookingIds]);
    await client.query('DELETE FROM notifications WHERE tenant_id = $1 AND (customer_id = $2 OR booking_id = ANY($3::uuid[]))', [tenantId, customerId, bookingIds]);
    await client.query('DELETE FROM bookings WHERE tenant_id = $1 AND customer_id = $2', [tenantId, customerId]);

    // 5-7. Rows that point at the customer without a cascading foreign key
    await client.query('DELETE FROM campaign_recipients WHERE tenant_id = $1 AND customer_id = $2', [tenantId, customerId]);
    await client.query('DELETE FROM unanswered_questions WHERE tenant_id = $1 AND conversation_id = ANY($2::uuid[])', [tenantId, conversationIds]);
    if (phoneTail(phone).length >= 8) {
      await client.query(`DELETE FROM whatsapp_retry_queue WHERE tenant_id = $1 AND right(regexp_replace(to_number, '\\D', '', 'g'), 10) = $2`, [tenantId, phoneTail(phone)]);
    }

    // 8. Conditions (some rows link by patient id only), 9. conversations (messages cascade)
    await client.query('DELETE FROM patient_conditions WHERE tenant_id = $1 AND (customer_id = $2 OR patient_id = ANY($3::uuid[]))', [tenantId, customerId, patientIds]);
    await client.query('DELETE FROM conversations WHERE tenant_id = $1 AND customer_id = $2', [tenantId, customerId]);

    // 10. The customer (patients and patient_profiles cascade)
    const removed = await client.query('DELETE FROM customers WHERE id = $1 AND tenant_id = $2', [customerId, tenantId]);
    if (removed.rowCount !== 1) throw new ErasureError('Not found', 404);

    // Audit entry: ids and counts only, never a name, a phone number or message text
    await client.query(
      `INSERT INTO audit_logs (tenant_id, staff_id, action, entity_type, entity_id, metadata, ip_address)
       VALUES ($1, $2, 'customer_erased', 'customer', $3, $4, $5)`,
      [tenantId, staffId && /^[0-9a-f-]{36}$/i.test(String(staffId)) ? staffId : null, customerId, JSON.stringify({ keepMedicalNotes, counts }), ipAddress]
    );
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rollbackErr) { /* the connection is gone: nothing more to do */ }
    throw err;
  }

  logger.info(`CUSTOMER_ERASED tenant=${tenantId} customer=${customerId} keepMedicalNotes=${keepMedicalNotes} counts=${JSON.stringify(counts)}`);
  await clearRedisKeys(tenantId, phone, conversationIds);
  return { counts, keepMedicalNotes };
}

// Every table that refers to a customer, a patient, a conversation or a booking, and how the erasure above deals with it:
// 'explicit' = deleted (or detached) by a statement in eraseCustomer, 'cascade' = removed by ON DELETE CASCADE of a parent that is deleted.
// customerErasure.completeness.js reads the foreign keys of the database and fails when a table is missing here (a new table added later).
const HANDLED_TABLES = {
  clinic_tokens: 'explicit',
  notifications: 'explicit',
  bookings: 'explicit',
  conversations: 'explicit',
  visit_notes: 'explicit',
  patient_conditions: 'explicit',
  campaign_recipients: 'explicit',
  unanswered_questions: 'explicit',
  whatsapp_retry_queue: 'explicit',
  messages: 'cascade',
  patients: 'cascade',
  patient_profiles: 'cascade'
};

module.exports = { eraseCustomer, previewCustomerErasure, ErasureError, phoneTail, HANDLED_TABLES };
