const cron = require('node-cron')
const pool = require('../config/database')
const logger = require('../utils/logger')

function startRetentionCron() {
  // Runs every day at 3 AM IST (after 2AM DB backup; timezone-pinned)
  cron.schedule('0 3 * * *', async () => {
    logger.info('Running message retention cleanup...')
    try {
      const result = await pool.query(`
        DELETE FROM conversations
        WHERE status IN ('resolved', 'inactive')
        AND started_at < NOW() - INTERVAL '90 days'
      `)
      logger.info(`Retention cleanup: deleted ${result.rowCount} old conversations`)
    } catch (err) {
      logger.error('Retention cleanup failed:', err.message)
    }
  }, { timezone: 'Asia/Kolkata' })
  logger.info('Retention cron started (runs daily at 3AM IST)')
}

module.exports = { startRetentionCron }
