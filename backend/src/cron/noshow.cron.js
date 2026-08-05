const cron = require('node-cron')
const pool = require('../config/database')
const logger = require('../utils/logger')
const { sendTemplateMessage } = require('../modules/channel/whatsapp/whatsapp.adapter')

function startNoShowCron() {
  // Runs every day at 11:59 PM IST — marks uncompleted bookings as no-show
  cron.schedule('59 23 * * *', async () => {
    logger.info('Running auto no-show cron...')
    try {
      const result = await pool.query(`
        UPDATE bookings
        SET status = 'noshow', updated_at = NOW()
        WHERE status IN ('pending', 'confirmed')
        AND booking_date < CURRENT_DATE
        RETURNING id, tenant_id, customer_id
      `)
      // Also update corresponding clinic_tokens
      await pool.query(`
        UPDATE clinic_tokens ct
        SET status = 'cancelled'
        FROM bookings b
        WHERE ct.booking_id = b.id
        AND b.status = 'noshow'
        AND b.updated_at > NOW() - INTERVAL '1 minute'
      `)
      logger.info(`Auto no-show: marked ${result.rowCount} bookings as no-show`)

      // Send noshow_followup WhatsApp message to each no-show patient
      if (result.rows.length > 0) {
        const bookingIds = result.rows.map(r => r.id)
        const customerRes = await pool.query(`
          SELECT b.id AS booking_id, b.tenant_id, c.phone, c.id AS customer_id
          FROM bookings b
          JOIN customers c ON c.id = b.customer_id
          WHERE b.id = ANY($1)
          AND c.phone IS NOT NULL
        `, [bookingIds])

        for (const row of customerRes.rows) {
          try {
            await sendTemplateMessage(row.phone, 'noshow_followup', 'en', [])
            await pool.query(`
              INSERT INTO notifications (tenant_id, booking_id, customer_id, type, channel, status, scheduled_at, sent_at)
              VALUES ($1, $2, $3, 'noshow_followup', 'whatsapp', 'sent', NOW(), NOW())
              ON CONFLICT DO NOTHING
            `, [row.tenant_id, row.booking_id, row.customer_id])
          } catch (msgErr) {
            logger.warn(`noshow_followup failed for booking ${row.booking_id}: ${msgErr.message}`)
          }
        }
        logger.info(`noshow_followup sent to ${customerRes.rows.length} customers`)
      }
    } catch (err) {
      logger.error('Auto no-show cron failed:', err.message)
    }
  }, { timezone: 'Asia/Kolkata' })
  logger.info('No-show cron started (runs daily at 11:59 PM IST)')
}

module.exports = { startNoShowCron }
