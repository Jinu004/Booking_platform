const cron = require('node-cron')
const pool = require('../config/database')
const logger = require('../utils/logger')
const { runRetention } = require('../modules/industries/clinic/retention.service')

// Automatic delete of patient data with no activity for RETENTION_YEARS years (see retention.service.js).
// dryRun stays true until real candidates are checked; flip to false around the end of 2030
const RETENTION_YEARS = 5
const RETENTION_DRY_RUN = true
const RETENTION_CAP = 50

async function runRetentionCleanup() {
  try {
    await runRetention({ pool, years: RETENTION_YEARS, dryRun: RETENTION_DRY_RUN, cap: RETENTION_CAP, log: logger })
  } catch (err) {
    logger.error(`Retention run failed: ${err.message}\n${err.stack}`)
  }
}

function startRetentionCron() {
  cron.schedule('30 3 * * *', runRetentionCleanup, { timezone: 'Asia/Kolkata' })
  logger.info(`Retention cron started (daily, 3:30 AM IST, dryRun=${RETENTION_DRY_RUN})`)
}

module.exports = { startRetentionCron, runRetentionCleanup }
