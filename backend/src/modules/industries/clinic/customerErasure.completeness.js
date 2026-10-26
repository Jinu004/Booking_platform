// Completeness guard for the patient erasure (customerErasure.service.js). Read-only: it only reads information_schema.
//
// It fails when a table refers to customers, patients, conversations or bookings and the erasure does not deal with it:
//   - every foreign key that points at one of these four tables must come from a table listed in HANDLED_TABLES;
//   - a foreign key without a cascade (NO ACTION / RESTRICT) must come from a table the erasure deletes explicitly
//     (otherwise the final DELETE of the customer would fail);
//   - a column named customer_id / patient_id / conversation_id / booking_id WITHOUT a foreign key (a plain id column, like
//     unanswered_questions.conversation_id) must also be in HANDLED_TABLES.
// Run it after adding a table:   node src/modules/industries/clinic/customerErasure.completeness.js
const { HANDLED_TABLES } = require('./customerErasure.service');

const TARGETS = ['customers', 'patients', 'conversations', 'bookings'];
const PLAIN_ID_COLUMNS = ['customer_id', 'patient_id', 'conversation_id', 'booking_id'];
const RULES = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };

// Column names that look like a person's contact details or name
const PERSONAL_COLUMNS = ['phone', 'email', 'name', 'customer_name', 'customer_phone'];

// Tables with a tenant_id and such a column that are intentionally NOT patient data (table: why it is not erased with a patient)
const NOT_PATIENT_DATA = {
  customers: 'the erased row itself: deleted by the helper (its patients and profiles cascade)',
  staff: "clinic staff accounts, not patients",
  clinic_doctors: "the clinic's doctors (staff), not patients",
  clinic_profiles: "the clinic's own contact details",
  clinic_services: 'service names of the clinic',
  clinic_treatments: 'treatment names and prices of the clinic',
  procedures: "procedure names of the clinic's doctors",
  catalogue_items: 'product names of the clinic (enquiry shop)',
  tenant_templates: 'WhatsApp template names of the clinic'
};

/**
 * @param {{ query: Function }} client a database client or pool (only SELECTs are run)
 * @returns {Promise<{ ok: boolean, problems: string[], checked: number }>}
 */
async function checkErasureCompleteness(client) {
  const problems = [];

  const fks = await client.query(
    `SELECT con.conrelid::regclass::text AS table_name, con.confrelid::regclass::text AS target, con.confdeltype AS rule
     FROM pg_constraint con
     WHERE con.contype = 'f' AND con.connamespace = 'public'::regnamespace
       AND con.confrelid::regclass::text = ANY($1::text[])`,
    [TARGETS]
  );
  for (const fk of fks.rows) {
    const handling = HANDLED_TABLES[fk.table_name];
    const rule = RULES[fk.rule] || fk.rule;
    if (!handling) {
      problems.push(`${fk.table_name} refers to ${fk.target} (${rule}) but the erasure does not handle it`);
    } else if ((fk.rule === 'a' || fk.rule === 'r') && handling !== 'explicit') {
      problems.push(`${fk.table_name} refers to ${fk.target} with ${rule}: it must be deleted explicitly before the customer, but it is marked '${handling}'`);
    }
  }

  const fkTables = new Set(fks.rows.map((fk) => fk.table_name));
  const plain = await client.query(
    `SELECT c.table_name, c.column_name
     FROM information_schema.columns c
     JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.column_name = ANY($1::text[]) AND c.table_name <> ALL($2::text[])`,
    [PLAIN_ID_COLUMNS, TARGETS]
  );
  for (const col of plain.rows) {
    if (!fkTables.has(col.table_name) && !HANDLED_TABLES[col.table_name]) {
      problems.push(`${col.table_name}.${col.column_name} looks like a reference to a customer, patient, conversation or booking (no foreign key) and the erasure does not handle it`);
    }
  }

  // Tables of a clinic that hold a person's name, phone or email WITHOUT a foreign key to a customer, patient, conversation or booking
  // (like leads): the foreign-key check cannot see them. Each must be handled by the erasure or be on the allowlist above.
  const personal = await client.query(
    `SELECT c.table_name, string_agg(DISTINCT p.column_name, ', ' ORDER BY p.column_name) AS columns
     FROM information_schema.columns c
     JOIN information_schema.columns p ON p.table_schema = c.table_schema AND p.table_name = c.table_name
          AND p.column_name = ANY($1::text[])
     JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
     GROUP BY c.table_name`,
    [PERSONAL_COLUMNS]
  );
  for (const row of personal.rows) {
    if (fkTables.has(row.table_name) || HANDLED_TABLES[row.table_name] || NOT_PATIENT_DATA[row.table_name]) continue;
    problems.push(`${row.table_name} has tenant_id and personal columns (${row.columns}) but no foreign key to a customer, and is neither handled by the erasure nor on the not-patient-data allowlist`);
  }

  // A listed table that no longer exists points at a rename: the erasure would silently skip the new name
  const existing = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
  const names = new Set(existing.rows.map((row) => row.table_name));
  for (const table of Object.keys(HANDLED_TABLES)) {
    if (!names.has(table)) problems.push(`${table} is listed as handled but does not exist`);
  }

  return { ok: problems.length === 0, problems, checked: fks.rows.length + plain.rows.length };
}

module.exports = { checkErasureCompleteness, NOT_PATIENT_DATA };

if (require.main === module) {
  const pool = require('../../../config/database');
  checkErasureCompleteness(pool)
    .then((result) => {
      console.log(result.ok ? `OK: ${result.checked} references checked` : `PROBLEMS:\n- ${result.problems.join('\n- ')}`);
      return pool.end().then(() => process.exit(result.ok ? 0 : 1));
    })
    .catch((err) => { console.error(err.message); process.exit(2); });
}
