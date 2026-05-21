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
cron.schedule('30 2 * * *', async () => {
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
         AND b.status IN ('pending', 'confirmed')
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
          `Reminder: You have an appointment today ` +
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
 * Resets doctor availability daily at midnight
 * Sets available_today based on doctor_schedules for the current day
 */
function resetDoctorAvailability() {
  cron.schedule('30 18 * * *', async () => {
    logger.info('Resetting doctor availability based on schedules');
    try {
      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const today = nowIST.getDay();
      await pool.query('UPDATE clinic_doctors SET available_today = false WHERE leave_days != 999');
      await pool.query(
        `UPDATE clinic_doctors cd
        SET available_today = true
        FROM doctor_schedules ds
        WHERE ds.doctor_id = cd.id
        AND ds.day_of_week = $1
        AND ds.is_available = true
        AND cd.leave_days != 999`,
        [today]
      );
      logger.info('Doctor availability reset based on today schedule');
    } catch (err) {
      logger.error('Doctor availability reset failed:', err.message);
    }
  });
}

/**
 * Initializes all scheduled jobs
 * Called from index.js on startup
 */
function initializeSchedulers() {
  schedule24HourReminders();
  resetDoctorAvailability();
  logger.info('Notification schedulers initialized');
}

module.exports = { initializeSchedulers };
