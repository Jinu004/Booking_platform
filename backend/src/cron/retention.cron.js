const cron = require('node-cron')
const pool = require('../config/database')
const logger = require('../utils/logger')

async function runRetentionCleanup() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const msgResult = await client.query(`
      DELETE FROM messages
      WHERE conversation_id IN (
        SELECT id FROM conversations
        WHERE status IN ('resolved', 'inactive')
        AND started_at < NOW() - INTERVAL '24 months'
      )
    `)
    logger.info(`Retention: deleted ${msgResult.rowCount} messages`)

    const convResult = await client.query(`
      DELETE FROM conversations
      WHERE status IN ('resolved', 'inactive')
      AND started_at < NOW() - INTERVAL '24 months'
    `)
    logger.info(`Retention: deleted ${convResult.rowCount} conversations`)

    const bookingResult = await client.query(`
      DELETE FROM bookings
      WHERE customer_id IN (
        SELECT id FROM customers
        WHERE updated_at < NOW() - INTERVAL '24 months'
      )
      AND booking_date < NOW() - INTERVAL '24 months'
    `)
    logger.info(`Retention: deleted ${bookingResult.rowCount} old bookings`)

    const patientResult = await client.query(`
      DELETE FROM patients
      WHERE customer_id IN (
        SELECT id FROM customers
        WHERE updated_at < NOW() - INTERVAL '24 months'
        AND id NOT IN (
          SELECT DISTINCT customer_id FROM bookings
          WHERE booking_date > NOW() - INTERVAL '24 months'
        )
      )
    `)
    logger.info(`Retention: deleted ${patientResult.rowCount} patient records`)

    const customerResult = await client.query(`
      DELETE FROM customers
      WHERE updated_at < NOW() - INTERVAL '24 months'
      AND id NOT IN (
        SELECT DISTINCT customer_id FROM bookings
        WHERE booking_date > NOW() - INTERVAL '24 months'
      )
    `)
    logger.info(`Retention: deleted ${customerResult.rowCount} inactive customers`)

    await client.query('COMMIT')
    logger.info('Retention cleanup completed successfully')
  } catch (err) {
    await client.query('ROLLBACK')
    logger.error('Retention cleanup failed, rolled back:', err.message)
  } finally {
    client.release()
  }
}

function startRetentionCron() {
  cron.schedule('0 3 1 * *', runRetentionCleanup, { timezone: 'Asia/Kolkata' })
  logger.info('Retention cron started (1st of each month, 3AM IST)')
}

module.exports = { startRetentionCron }
