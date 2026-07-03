const cron = require('node-cron');
const pool = require('../../config/database');
const { sendTemplateMessage } = require('../channel/whatsapp/whatsapp.adapter');
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
      const bookings = await pool.query(
        `SELECT b.*, c.phone, c.name as patient_name,
         cd.name as doctor_name, t.name as clinic_name
         FROM bookings b
         JOIN customers c ON c.id = b.customer_id
         JOIN clinic_doctors cd ON cd.id = b.doctor_id
         JOIN tenants t ON t.id = b.tenant_id
         WHERE b.booking_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
         AND b.status IN ('pending', 'confirmed')
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.booking_id = b.id
           AND n.type = 'reminder_24h'
           AND n.status = 'sent'
         )`
      );

      for (const booking of bookings.rows) {
        try {
          const appointmentTime = booking.slot_time
            ? `${booking.slot_time} session, Token #${booking.token_number}`
            : `Token #${booking.token_number}`
          await sendTemplateMessage(booking.phone, 'appointment_reminder_v2', 'en', [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: booking.clinic_name },
                { type: 'text', text: appointmentTime }
              ]
            }
          ])
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
          )
          logger.info(`Appointment reminder sent to ${booking.phone} for booking ${booking.id}`)
        } catch (err) {
          logger.error(`Appointment reminder failed for booking ${booking.id}:`, err.response?.data || err.message)
        }
      }

      logger.info(`24hr reminders sent: ${bookings.rows.length}`);
    } catch (err) {
      logger.error(`24hr reminder job failed: ${err.message}`);
    }
  }, { timezone: 'Asia/Kolkata' });
}

/**
 * Resets doctor availability daily at midnight
 * Sets available_today based on doctor_schedules for the current day
 */
function resetDoctorAvailability() {
  cron.schedule('0 0 * * *', async () => {
    logger.info('Resetting doctor availability based on schedules');
    try {
      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const today = nowIST.getDay();
      // Decrement leave days for doctors currently on leave
      await pool.query(`
        UPDATE clinic_doctors
        SET leave_days = leave_days - 1
        WHERE leave_days > 0 AND leave_days != 999
      `);

      // Clear leave flag for doctors whose leave has ended
      await pool.query(`
        UPDATE clinic_doctors
        SET leave_days = 0
        WHERE leave_days < 0
      `);
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
  }, { timezone: 'Asia/Kolkata' });
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
