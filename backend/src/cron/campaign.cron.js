const cron = require('node-cron')
const logger = require('../utils/logger')
const { runCampaignTick } = require('../modules/campaign/campaign.sender')

// Every minute: one batch for each running campaign. The sender decides about the daytime window, limits and safety stops.
function startCampaignCron() {
  cron.schedule('* * * * *', async () => {
    try {
      await runCampaignTick()
    } catch (err) {
      logger.error(`Campaign cron failed: ${String(err.message || '').slice(0, 160)}`)
    }
  }, { timezone: 'Asia/Kolkata' })
  logger.info('Campaign sender cron started (every minute, sends 10:00-19:00 IST)')
}

module.exports = { startCampaignCron }
