const cron = require('node-cron')
const pool = require('../config/database')
const logger = require('../utils/logger')

// Deletes recorded failed sends older than 90 days
async function runSendFailuresCleanup() {
  try {
    const result = await pool.query(
      `DELETE FROM send_failures WHERE created_at < NOW() - INTERVAL '90 days'`
    )
    logger.info(`SEND_FAILURES_CLEANUP deleted=${result.rowCount}`)
  } catch (err) {
    logger.error(`Send failures cleanup failed: ${err.message}`)
  }
}

function startSendFailuresCleanupCron() {
  cron.schedule('10 3 * * *', runSendFailuresCleanup, { timezone: 'Asia/Kolkata' })
  logger.info('Send failures cleanup cron started (daily, 3:10 AM IST)')
}

module.exports = { startSendFailuresCleanupCron, runSendFailuresCleanup }
