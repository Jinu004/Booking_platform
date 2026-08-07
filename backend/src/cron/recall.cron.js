const cron = require('node-cron')
const pool = require('../config/database')
const logger = require('../utils/logger')
const { sendTemplateMessage } = require('../modules/channel/whatsapp/whatsapp.adapter')

function startRecallCron() {
  // Runs every Monday at 10:00 AM IST
  cron.schedule('0 10 * * 1', async () => {
    logger.info('Running recall checkup cron...')
    try {
      const result = await pool.query(`
        SELECT
          p.id AS patient_id,
          p.name AS patient_name,
          c.phone,
          c.id AS customer_id,
          t.id AS tenant_id,
          t.name AS clinic_name,
          GREATEST(1, EXTRACT(MONTH FROM AGE(NOW(), c.last_seen))::int) AS months_since_visit
        FROM patients p
        JOIN customers c ON c.id = p.customer_id
        JOIN tenants t ON t.id = p.tenant_id
        WHERE c.last_seen < NOW() - INTERVAL '90 days'
          AND t.status = 'active'
          AND c.phone IS NOT NULL
          AND p.name IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM notifications n
            WHERE n.customer_id = c.id
              AND n.type = 'recall_checkup'
              AND n.sent_at > NOW() - INTERVAL '90 days'
          )
      `)

      logger.info(`Recall cron: found ${result.rows.length} patients to recall`)

      for (const row of result.rows) {
        try {
          await sendTemplateMessage(row.phone, 'recall_checkup', 'en', [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: row.patient_name },
                { type: 'text', text: String(row.months_since_visit) },
                { type: 'text', text: row.clinic_name }
              ]
            }
          ])
          await pool.query(`
            INSERT INTO notifications (tenant_id, customer_id, type, channel, status, scheduled_at, sent_at)
            VALUES ($1, $2, 'recall_checkup', 'whatsapp', 'sent', NOW(), NOW())
            ON CONFLICT DO NOTHING
          `, [row.tenant_id, row.customer_id])
          logger.info(`Recall sent to ${row.patient_name} (${row.phone}) for ${row.clinic_name}`)
        } catch (msgErr) {
          logger.warn(`Recall failed for patient ${row.patient_id}: ${msgErr.message}`)
        }
      }

      logger.info(`Recall cron complete: sent to ${result.rows.length} patients`)
    } catch (err) {
      logger.error('Recall cron failed:', err.message)
    }
  }, { timezone: 'Asia/Kolkata' })
  logger.info('Recall cron started (runs every Monday at 10:00 AM IST)')
}

module.exports = { startRecallCron }
