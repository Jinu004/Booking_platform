const cron = require('node-cron')
const pool = require('../config/database')
const logger = require('../utils/logger')

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
    } catch (err) {
      logger.error('Auto no-show cron failed:', err.message)
    }
  }, { timezone: 'Asia/Kolkata' })
  logger.info('No-show cron started (runs daily at 11:59 PM IST)')
}

module.exports = { startNoShowCron }
