const cron = require('node-cron');
const pool = require('../config/database');
const whatsapp = require('../modules/channel/whatsapp/whatsapp.adapter');
const logger = require('../utils/logger');

async function processRetryQueue() {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM whatsapp_retry_queue
       WHERE status = 'pending'
         AND next_retry_at <= NOW()
         AND attempts < max_attempts
       ORDER BY next_retry_at ASC
       LIMIT 20`
    );
    for (const job of rows) {
      try {
        await pool.query(
          `UPDATE whatsapp_retry_queue
           SET attempts = attempts + 1, last_attempted_at = NOW(), status = 'processing'
           WHERE id = $1`,
          [job.id]
        );
        const p = job.payload;
        if (job.message_type === 'text') {
          await whatsapp.sendMessage(job.to_number, p.message);
        } else if (job.message_type === 'template') {
          await whatsapp.sendTemplateMessage(job.to_number, p.templateName, p.languageCode, p.components);
        }
        await pool.query(
          `UPDATE whatsapp_retry_queue SET status = 'sent' WHERE id = $1`,
          [job.id]
        );
        logger.info(`Retry queue: sent job ${job.id} to ${job.to_number}`);
      } catch (err) {
        const nextAttempt = job.attempts + 1;
        const delayMinutes = Math.pow(2, nextAttempt) * 5;
        const newStatus = nextAttempt >= job.max_attempts ? 'failed' : 'pending';
        await pool.query(
          `UPDATE whatsapp_retry_queue
           SET status = $1, error_message = $2,
               next_retry_at = NOW() + ($3 || ' minutes')::interval
           WHERE id = $4`,
          [newStatus, err.message, String(delayMinutes), job.id]
        );
        logger.warn(`Retry queue: job ${job.id} failed (attempt ${nextAttempt}): ${err.message}`);
      }
    }
  } catch (err) {
    logger.error('Retry queue cron error:', err.message);
  }
}

function startRetryCron() {
  cron.schedule('*/3 * * * *', processRetryQueue, { timezone: 'Asia/Kolkata' });
  logger.info('Retry queue cron started (every 3 minutes)');
}

module.exports = { startRetryCron, processRetryQueue };
