const pool = require('../../config/database')
const logger = require('../../utils/logger')

/**
 * Executes a named AI function with given arguments.
 * All functions query PostgreSQL and return plain text results
 * that Gemini will use to compose a natural language response.
 *
 * @param {string} name - Function name
 * @param {object} args - Function arguments from Gemini
 * @param {object} ctx  - Context: { tenant, customer, conversation }
 * @returns {Promise<string|object>} Result string or object
 */
async function executeFunction(name, args, ctx) {
  const { tenant, customer, conversation } = ctx

  try {
    switch (name) {

      case 'get_clinic_info': {
        const result = await pool.query(
          `SELECT cp.clinic_name as name, cp.address, cp.working_hours,
                  cp.weekly_off, cp.phone as whatsapp_number
           FROM clinic_profiles cp
           WHERE cp.tenant_id = $1
           LIMIT 1`,
          [tenant.id]
        )
        const info = result.rows[0] || { name: tenant.name, whatsapp_number: 'Not set' }

        const configResult = await pool.query(
          `SELECT key, value FROM tenant_configs
           WHERE tenant_id = $1
           AND key IN ('opening_time', 'closing_time',
                       'weekly_off')`,
          [tenant.id]
        )
        const configs = {}
        configResult.rows.forEach(r => {
          configs[r.key] = r.value
        })

        return `${info.name}
📍 WhatsApp: ${info.whatsapp_number}
🕘 Opening: ${configs.opening_time || '9:00 AM'}
🕔 Closing: ${configs.closing_time || '5:00 PM'}
📅 Weekly off: ${configs.weekly_off || 'Sunday'}`
      }

      case 'get_available_doctors': {
        const doctorsResult = await pool.query(
          `SELECT cd.id, cd.name, cd.specialization,
                  cd.available_today, cd.max_tokens_daily,
                  COUNT(b.id) AS booked_count
           FROM clinic_doctors cd
           LEFT JOIN bookings b
             ON b.doctor_id = cd.id
             AND b.booking_date = CURRENT_DATE
             AND b.status != 'cancelled'
           WHERE cd.tenant_id = $1
             AND cd.available_today = true
           GROUP BY cd.id
           ORDER BY cd.name ASC`,
          [tenant.id]
        )

        if (!doctorsResult.rows.length) {
          return 'No doctors are available today. Please visit us tomorrow or call us directly.'
        }

        const configResult = await pool.query(
          `SELECT value FROM tenant_configs
           WHERE tenant_id = $1
           AND key = 'opening_time'`,
          [tenant.id]
        )
        const openingTime = configResult.rows[0]?.value || '9:00 AM'

        const doctorList = doctorsResult.rows.map(doc => {
          const remaining = doc.max_tokens_daily - parseInt(doc.booked_count || 0)
          return `🩺 ${doc.name} (${doc.specialization})\n   Session: ${openingTime} | ${remaining} tokens left`
        }).join('\n\n')

        return `Which doctor would you like to see?\n\n${doctorList}\n\nReply with doctor name`
      }

      case 'check_doctor_availability': {
        const { doctor_name } = args
        const result = await pool.query(
          `SELECT cd.id, cd.name, cd.specialization,
                  cd.available_today, cd.max_tokens_daily,
                  COUNT(b.id) AS booked_count
           FROM clinic_doctors cd
           LEFT JOIN bookings b
             ON b.doctor_id = cd.id
             AND b.booking_date = CURRENT_DATE
             AND b.status != 'cancelled'
           WHERE cd.tenant_id = $1
             AND LOWER(cd.name) LIKE LOWER($2)
           GROUP BY cd.id`,
          [tenant.id, `%${doctor_name}%`]
        )
        if (!result.rows.length) {
          return { available: false, message: `No doctor found matching "${doctor_name}"` }
        }
        const doctor = result.rows[0]
        if (!doctor.available_today) {
          return { available: false, message: `Dr. ${doctor.name} is not available today.` }
        }
        const remaining = doctor.max_tokens_daily - parseInt(doctor.booked_count || 0)
        if (remaining <= 0) {
          return { available: false, message: `Dr. ${doctor.name} is fully booked for today.` }
        }
        const configResult = await pool.query(
          `SELECT value FROM tenant_configs
           WHERE tenant_id = $1
           AND key = 'opening_time'`,
          [tenant.id]
        )
        const openingTime = configResult.rows[0]?.value || '9:00 AM'

        return `Dr. ${doctor.name} (${doctor.specialization})
is available today.
Session starts: ${openingTime}
${remaining} tokens remaining.`
      }

      case 'create_token_booking': {
        const { doctor_name, patient_name } = args

        // Find doctor
        const doctorRes = await pool.query(
          `SELECT id, name, max_tokens_daily FROM clinic_doctors
           WHERE tenant_id = $1 AND LOWER(name) LIKE LOWER($2) AND available_today = true
           LIMIT 1`,
          [tenant.id, `%${doctor_name}%`]
        )
        if (!doctorRes.rows.length) {
          return { success: false, message: `Dr. ${doctor_name} is not available today.` }
        }
        const doctor = doctorRes.rows[0]

        // Get current token count for today
        const tokenRes = await pool.query(
          `SELECT COUNT(*) AS count FROM bookings
           WHERE doctor_id = $1
             AND booking_date = CURRENT_DATE
             AND status != 'cancelled'`,
          [doctor.id]
        )
        const currentCount = parseInt(tokenRes.rows[0].count || 0)
        if (currentCount >= doctor.max_tokens_daily) {
          return { success: false, message: `Dr. ${doctor.name} is fully booked for today.` }
        }
        const tokenNumber = currentCount + 1

        // Create booking
        const bookingRes = await pool.query(
          `INSERT INTO bookings
             (tenant_id, customer_id, conversation_id, doctor_id,
              source, status, booking_date, token_number, notes)
           VALUES ($1, $2, $3, $4, 'whatsapp', 'pending', CURRENT_DATE, $5, $6)
           RETURNING id, token_number`,
          [
            tenant.id,
            customer?.id || null,
            conversation?.id || null,
            doctor.id,
            tokenNumber,
            `Booked via WhatsApp for ${patient_name}`
          ]
        )
        const booking = bookingRes.rows[0]
        const configResult = await pool.query(
          `SELECT value FROM tenant_configs
           WHERE tenant_id = $1
           AND key = 'opening_time'`,
          [tenant.id]
        )
        const openingTime = configResult.rows[0]?.value || '9:00 AM'

        return `Booking confirmed! 🏥

Token Number: ${tokenNumber}
Doctor: ${doctor.name}
${doctor.specialization}

🕘 Consultation starts at ${openingTime}
Please arrive before session begins.

Reply CANCEL to cancel your booking.`
      }

      case 'cancel_booking': {
        const { booking_id } = args
        const result = await pool.query(
          `UPDATE bookings
           SET status = 'cancelled', updated_at = NOW()
           WHERE id = $1 AND tenant_id = $2
           RETURNING id, token_number`,
          [booking_id, tenant.id]
        )
        if (!result.rows.length) {
          return { success: false, message: 'Booking not found or already cancelled.' }
        }
        return {
          success: true,
          message: `Token #${result.rows[0].token_number} has been cancelled successfully.`
        }
      }

      case 'get_patient_bookings': {
        if (!customer?.id) {
          return { bookings: [], message: 'No bookings found for this number.' }
        }
        const result = await pool.query(
          `SELECT b.id, b.token_number, b.booking_date, b.status,
                  cd.name AS doctor_name, cd.specialization
           FROM bookings b
           LEFT JOIN clinic_doctors cd ON cd.id = b.doctor_id
           WHERE b.customer_id = $1
             AND b.booking_date >= CURRENT_DATE
             AND b.status != 'cancelled'
           ORDER BY b.booking_date ASC, b.token_number ASC
           LIMIT 5`,
          [customer.id]
        )
        if (!result.rows.length) {
          return { bookings: [], message: 'No upcoming bookings found.' }
        }
        const bookings = result.rows.map(b =>
          `• Token #${b.token_number} with Dr. ${b.doctor_name} on ${new Date(b.booking_date).toLocaleDateString()} (${b.status})`
        )
        return {
          bookings: result.rows,
          message: `Your upcoming bookings:\n${bookings.join('\n')}`
        }
      }

      case 'escalate_to_human': {
        const { reason } = args
        logger.info(`Escalation requested for conversation ${conversation?.id}: ${reason}`)
        // Signal to the calling code that escalation is needed
        return `ESCALATE:${reason}`
      }

      default:
        logger.warn(`Unknown function called by AI: ${name}`)
        return { error: `Function "${name}" is not implemented.` }
    }
  } catch (err) {
    logger.error(`AI function "${name}" failed:`, err.message)
    return { error: `Could not complete "${name}": ${err.message}` }
  }
}

module.exports = { executeFunction }
