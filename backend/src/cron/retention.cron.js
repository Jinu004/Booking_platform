const cron = require('node-cron')
const pool = require('../config/database')
const logger = require('../utils/logger')

function startRetentionCron() {
  // Runs every day at 2 AM IST (20:30 UTC)
  cron.schedule('30 20 * * *', async () => {
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
  })
  logger.info('Retention cron started (runs daily at 2AM IST)')
}

module.exports = { startRetentionCron }
