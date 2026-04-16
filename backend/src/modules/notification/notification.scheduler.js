const cron = require('node-cron');
const pool = require('../../config/database');
const { sendMessage } = require('../channel/whatsapp/whatsapp.adapter');
const logger = require('../../utils/logger');

/**
 * Sends 24 hour appointment reminders
 * Runs every day at 8:00 AM
 * Finds all bookings for tomorrow
 * Sends reminder to each patient
 */
function schedule24HourReminders() {
  cron.schedule('0 8 * * *', async () => {
    logger.info('Running 24hr reminder job');
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      const bookings = await pool.query(
        `SELECT b.*, c.phone, c.name as patient_name,
         cd.name as doctor_name, t.name as clinic_name
         FROM bookings b
         JOIN customers c ON c.id = b.customer_id
         JOIN clinic_doctors cd ON cd.id = b.doctor_id
         JOIN tenants t ON t.id = b.tenant_id
         WHERE b.booking_date = $1
         AND b.status = 'confirmed'
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.booking_id = b.id
           AND n.type = 'reminder_24h'
           AND n.status = 'sent'
         )`,
        [tomorrowStr]
      );

      for (const booking of bookings.rows) {
        const message =
          `Hi ${booking.patient_name}! 🏥\n\n` +
          `Reminder: You have an appointment tomorrow ` +
          `with ${booking.doctor_name} at ` +
          `${booking.clinic_name}.\n\n` +
          `Token number: ${booking.token_number}\n\n` +
          `Reply CANCEL to cancel your appointment.`;

        await sendMessage(booking.phone, message);

        await pool.query(
          `INSERT INTO notifications
           (tenant_id, booking_id, customer_id,
            type, channel, status, scheduled_at, sent_at)
           VALUES ($1, $2, $3, 'reminder_24h',
            'whatsapp', 'sent', NOW(), NOW())`,
          [
            booking.tenant_id,
            booking.id,
            booking.customer_id
          ]
        );

        logger.info(`24hr reminder sent to ${booking.phone}`);
      }

      logger.info(`24hr reminders sent: ${bookings.rows.length}`);
    } catch (err) {
      logger.error(`24hr reminder job failed: ${err.message}`);
    }
  });
}

/**
 * Resets doctor availability daily at 6:00 AM
 * Sets all doctors available_today = true
 * Clears leave_days counter where leave_days = 0
 */
function scheduleDailyReset() {
  cron.schedule('0 6 * * *', async () => {
    logger.info('Running daily doctor availability reset');
    try {
      await pool.query(
        `UPDATE clinic_doctors
         SET available_today = true
         WHERE leave_days = 0`
      );

      await pool.query(
        `UPDATE clinic_doctors
         SET leave_days = leave_days - 1
         WHERE leave_days > 0`
      );

      await pool.query(
        `UPDATE clinic_doctors
         SET available_today = false
         WHERE leave_days > 0`
      );

      logger.info('Daily doctor reset complete');
    } catch (err) {
      logger.error(`Daily reset failed: ${err.message}`);
    }
  });
}

/**
 * Initializes all scheduled jobs
 * Called from index.js on startup
 */
function initializeSchedulers() {
  schedule24HourReminders();
  scheduleDailyReset();
  logger.info('Notification schedulers initialized');
}

module.exports = { initializeSchedulers };
