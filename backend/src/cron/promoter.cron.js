const cron = require('node-cron');
const pool = require('../config/database');
const logger = require('../utils/logger');
const commission = require('../modules/promoter/commission.service');
const payouts = require('../modules/promoter/payout.service');
const settingsService = require('../modules/promoter/settings.service');
const { todayIST, addMonths, monthStart } = require('../utils/money');

// Constant keys for pg advisory locks so overlapping runs (or a second process) never double-process
const LOCK_DAILY = 72310001;

/** Releases commissions whose hold period is over, then accrues any payment that was missed */
async function runDailyJob() {
  const client = await pool.connect();
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_DAILY]);
    if (!lock.rows[0].ok) return { skipped: 'another run is in progress' };
    try {
      await client.query('BEGIN');
      const reconciled = await commission.reconcile(client);
      const released = await commission.releaseDue(client);
      await client.query('COMMIT');
      if (released || reconciled) logger.info(`Promoter daily job: released ${released}, reconciled ${reconciled}`);
      return { released, reconciled };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_DAILY]).catch(() => {});
    }
  } finally {
    client.release();
  }
}

/** On the configured run day, creates payout drafts for last month (if enabled in settings) */
async function runMonthlyPayoutsIfDue(today = todayIST()) {
  const settings = (await settingsService.getCurrent()).settings;
  if (settings.payout_frequency !== 'monthly' || !settings.auto_create_drafts) return { skipped: 'disabled in settings' };
  if (Number(today.slice(8, 10)) !== settings.payout_run_day) return { skipped: 'not the run day' };
  const period = addMonths(monthStart(today), -1);
  const res = await payouts.runPayouts({ periodMonth: period });
  logger.info(`Promoter payouts for ${period}: ${res.created.length} drafts, ${res.skipped.length} skipped`);
  return res;
}

function startPromoterCron() {
  // 02:15 IST daily: release + reconcile
  cron.schedule('15 2 * * *', async () => {
    try {
      await runDailyJob();
    } catch (err) {
      logger.error(`Promoter daily job failed: ${String(err.message || '').slice(0, 200)}`);
    }
  }, { timezone: 'Asia/Kolkata' });
  // 03:30 IST daily: payout drafts on the configured run day (after the release above)
  cron.schedule('30 3 * * *', async () => {
    try {
      await runMonthlyPayoutsIfDue();
    } catch (err) {
      logger.error(`Promoter payout run failed: ${String(err.message || '').slice(0, 200)}`);
    }
  }, { timezone: 'Asia/Kolkata' });
  logger.info('Promoter cron started (release 02:15 IST, payouts 03:30 IST on the run day)');
}

module.exports = { startPromoterCron, runDailyJob, runMonthlyPayoutsIfDue };
