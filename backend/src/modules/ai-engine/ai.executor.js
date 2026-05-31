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
          return `🩺 ${doc.name} (${doc.specialization})`
        }).join('\n')
        return `Which doctor would you like to see?\n\n${doctorList}\n\nReply with the doctor's name.`

      }

      case 'get_available_doctors_tomorrow': {
        // Compute tomorrow in IST to avoid UTC date boundary issues
        const nowIST_td = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
        const tomorrowDt = new Date(nowIST_td)
        tomorrowDt.setDate(tomorrowDt.getDate() + 1)
        const tomorrowDateTd = `${tomorrowDt.getFullYear()}-${String(tomorrowDt.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDt.getDate()).padStart(2, '0')}`
        const tomorrowDowTd = tomorrowDt.getDay()
        const dayNamesTd = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

        // Join schedules for tomorrow's day_of_week, exclude doctors on leave
        const doctorsResult = await pool.query(
          `SELECT cd.id, cd.name, cd.specialization, cd.max_tokens_daily,
                  ds.start_time, ds.end_time,
                  COUNT(b.id) AS booked_count
           FROM clinic_doctors cd
           JOIN doctor_schedules ds
             ON ds.doctor_id = cd.id
             AND ds.tenant_id = cd.tenant_id
             AND ds.day_of_week = $2
             AND ds.is_available = true
           LEFT JOIN bookings b
             ON b.doctor_id = cd.id
             AND b.booking_date = $3
             AND b.status != 'cancelled'
           LEFT JOIN doctor_leaves dl
             ON dl.doctor_id = cd.id
             AND dl.leave_date = $3
           WHERE cd.tenant_id = $1
             AND dl.id IS NULL
           GROUP BY cd.id, cd.name, cd.specialization, cd.max_tokens_daily,
                    ds.start_time, ds.end_time
           ORDER BY cd.name ASC`,
          [tenant.id, tomorrowDowTd, tomorrowDateTd]
        )

        if (!doctorsResult.rows.length) {
          return `No doctors are available tomorrow (${dayNamesTd[tomorrowDowTd]}). Please call us directly or try booking for another day.`
        }

        const fmtTd = (t) => {
          const [h, m] = t.split(':')
          const hour = parseInt(h)
          const ampm = hour >= 12 ? 'PM' : 'AM'
          const h12 = hour % 12 || 12
          return `${h12}:${m} ${ampm}`
        }

        const doctorList = doctorsResult.rows.map(doc => {
          const remaining = doc.max_tokens_daily - parseInt(doc.booked_count || 0)
          const sessionTime = `${fmtTd(doc.start_time)} - ${fmtTd(doc.end_time)}`
          return `🩺 ${doc.name} (${doc.specialization})\n   🕘 ${sessionTime} — ${remaining} tokens available`
        }).join('\n\n')

        return `Doctors available tomorrow (${dayNamesTd[tomorrowDowTd]}):\n\n${doctorList}\n\nReply with the doctor's name to book.`
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
          return { available: false, message: `${doctor.name} is not available today.` }
        }
        const remaining = doctor.max_tokens_daily - parseInt(doctor.booked_count || 0)
        if (remaining <= 0) {
          return { available: false, message: `${doctor.name} is fully booked for today.` }
        }

        // Get today's day of week (0=Sunday, 1=Monday, etc.)
        const todayDow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getDay()
        const scheduleRes = await pool.query(
          `SELECT start_time, end_time FROM doctor_schedules
           WHERE tenant_id = $1 AND doctor_id = $2 AND day_of_week = $3 AND is_available = true
           LIMIT 1`,
          [tenant.id, doctor.id, todayDow]
        )

        if (scheduleRes.rows.length === 0) {
          // Find next working day
          const nextScheduleRes = await pool.query(
            `SELECT day_of_week, start_time, end_time FROM doctor_schedules
             WHERE tenant_id = $1 AND doctor_id = $2 AND is_available = true
             AND day_of_week > $3
             ORDER BY day_of_week ASC
             LIMIT 1`,
            [tenant.id, doctor.id, todayDow]
          )
          // If no day found after today, wrap around to next week
          const wrapRes = nextScheduleRes.rows.length === 0 ? await pool.query(
            `SELECT day_of_week, start_time, end_time FROM doctor_schedules
             WHERE tenant_id = $1 AND doctor_id = $2 AND is_available = true
             ORDER BY day_of_week ASC
             LIMIT 1`,
            [tenant.id, doctor.id]
          ) : null
          const nextDay = nextScheduleRes.rows[0] || wrapRes?.rows[0]
          const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
          if (nextDay) {
            const fmt = (t) => {
              const [h, m] = t.split(':')
              const hour = parseInt(h)
              const ampm = hour >= 12 ? 'PM' : 'AM'
              const h12 = hour % 12 || 12
              return `${h12}:${m} ${ampm}`
            }
            const nextTime = `${fmt(nextDay.start_time)} - ${fmt(nextDay.end_time)}`
            return { available: false, message: `${doctor.name} is not available today.\nNext available: ${dayNames[nextDay.day_of_week]}, ${nextTime}\n\nType *Hi* to go back to the main menu and try booking again on or before the next available day.` }
          }
          return { available: false, message: `${doctor.name} is not available today.` }
        }
        const { start_time, end_time } = scheduleRes.rows[0]
        const fmt = (t) => {
          const [h, m] = t.split(':')
          const hour = parseInt(h)
          const ampm = hour >= 12 ? 'PM' : 'AM'
          const h12 = hour % 12 || 12
          return `${h12}:${m} ${ampm}`
        }
        // Check if current IST time is within doctor's session
        const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
        const [startH, startM] = start_time.split(':').map(Number)
        const [endH, endM] = end_time.split(':').map(Number)
        const currentMinutes = nowIST.getHours() * 60 + nowIST.getMinutes()
        const startMinutes = startH * 60 + startM
        const endMinutes = endH * 60 + endM
        if (currentMinutes > endMinutes) {
          // Session is over for today, find next available day
          const nextScheduleRes2 = await pool.query(
            `SELECT day_of_week, start_time, end_time FROM doctor_schedules
             WHERE tenant_id = $1 AND doctor_id = $2 AND is_available = true
             AND day_of_week > $3
             ORDER BY day_of_week ASC LIMIT 1`,
            [tenant.id, doctor.id, todayDow]
          )
          const wrapRes2 = nextScheduleRes2.rows.length === 0 ? await pool.query(
            `SELECT day_of_week, start_time, end_time FROM doctor_schedules
             WHERE tenant_id = $1 AND doctor_id = $2 AND is_available = true
             ORDER BY day_of_week ASC LIMIT 1`,
            [tenant.id, doctor.id]
          ) : null
          const nextDay2 = nextScheduleRes2.rows[0] || wrapRes2?.rows[0]
          const dayNames2 = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
          if (nextDay2) {
            const nextTime2 = `${fmt(nextDay2.start_time)} - ${fmt(nextDay2.end_time)}`
            return { available: false, message: `${doctor.name}'s session has ended for today.\nNext available: ${dayNames2[nextDay2.day_of_week]}, ${nextTime2}\n\nType *Hi* to go back to the main menu and try booking again on or before the next available day.` }
          }
          return { available: false, message: `${doctor.name}'s session has ended for today.` }
        }
        if (currentMinutes < startMinutes) {
          return { available: false, message: `${doctor.name}'s session starts at ${fmt(start_time)}. Please book after the session begins.` }
        }
        const sessionTime = `${fmt(start_time)} - ${fmt(end_time)}`

        return `${doctor.name} (${doctor.specialization})
Session: ${sessionTime}
${remaining} tokens remaining.

Please reply with your name to confirm booking.`
      }

      case 'create_token_booking': {
  const { doctor_name, patient_name } = args
  const formattedName = (patient_name || '')
    .replace(/[^a-zA-Z\sഀ-ൿ-]/g, '')  // allow Latin, Malayalam, spaces, hyphens
    .trim()
    .slice(0, 100)
    .replace(/\b\w/g, c => c.toUpperCase())
  
  // Check working hours
  const HITLService = require('../hitl/hitl.service')
  const HITLModel = require('../hitl/hitl.model')
  const settings = await HITLModel.getTenantSettings(tenant.id)
  const withinHours = settings ? HITLService.isWithinWorkingHours(settings.working_hours) : true

  // Find doctor
  const doctorRes = await pool.query(
    `SELECT id, name, specialization, max_tokens_daily FROM clinic_doctors
     WHERE tenant_id = $1 AND LOWER(name) LIKE LOWER($2) AND available_today = true
     LIMIT 1`,
    [tenant.id, `%${doctor_name}%`]
  )
  if (!doctorRes.rows.length) {
    return { success: false, message: `Dr. ${doctor_name} is not available today.` }
  }
  const doctor = doctorRes.rows[0]

  // Check duplicate booking for today
  if (customer?.id) {
    const activeBookingRes = await pool.query(
      `SELECT id FROM bookings WHERE customer_id = $1 AND doctor_id = $2 AND booking_date = CURRENT_DATE AND status NOT IN ('cancelled', 'completed') LIMIT 1`,
      [customer.id, doctor.id]
    )
    if (activeBookingRes.rows.length > 0) {
      return { success: false, message: `You already have an active booking with ${doctor.name} today. If you need to see a different doctor, please choose another doctor from the list.` }
    }
  }

  // Check today's token count
  const tokenRes = await pool.query(
    `SELECT COUNT(*) AS count FROM bookings
     WHERE doctor_id = $1 AND booking_date = CURRENT_DATE AND status != 'cancelled'`,
    [doctor.id]
  )
  const currentCount = parseInt(tokenRes.rows[0].count || 0)
  if (currentCount >= doctor.max_tokens_daily) {
    // Today fully booked — store pending intent and offer tomorrow
    try {
      const redisClient = require('../../../config/redis')
      if (redisClient && conversation?.id) {
        await redisClient.set(
          `tomorrow_booking:${conversation.id}`,
          JSON.stringify({ doctor_id: doctor.id, doctor_name: doctor.name, doctor_specialization: doctor.specialization, patient_name: formattedName }),
          { EX: 3600 }
        )
      }
    } catch (redisErr) {
      logger.warn('Redis write failed for tomorrow booking intent:', redisErr.message)
    }
    return `${doctor.name} is fully booked for today. Would you like to book for tomorrow instead?\n\nReply *TOMORROW* to confirm tomorrow's booking or ignore to cancel.`
  }

  // Create today's booking inside a transaction.
  // A FOR UPDATE lock on the doctor row serialises concurrent
  // WhatsApp bookings so the subquery token count is race-free.
  const bookingClient = await pool.connect()
  let tokenNumber, booking
  try {
    await bookingClient.query('BEGIN')
    await bookingClient.query(
      'SELECT id FROM clinic_doctors WHERE id = $1 FOR UPDATE',
      [doctor.id]
    )
    const bookingRes = await bookingClient.query(
      `INSERT INTO bookings
         (tenant_id, customer_id, conversation_id, doctor_id,
          source, status, booking_date, token_number, notes, patient_name)
       VALUES ($1, $2, $3, $4, 'whatsapp', 'pending', CURRENT_DATE,
         (SELECT COUNT(*) + 1 FROM bookings WHERE doctor_id = $4 AND booking_date = CURRENT_DATE AND status != 'cancelled'),
         $5, $6)
       RETURNING id, token_number`,
      [tenant.id, customer?.id || null, conversation?.id || null, doctor.id,
       `Booked via WhatsApp for ${formattedName}`, formattedName]
    )
    tokenNumber = bookingRes.rows[0].token_number
    booking = bookingRes.rows[0]
    await bookingClient.query(
      `INSERT INTO clinic_tokens (tenant_id, booking_id, doctor_id, token_number, status)
       VALUES ($1, $2, $3, $4, 'waiting')`,
      [tenant.id, booking.id, doctor.id, tokenNumber]
    )
    await bookingClient.query('COMMIT')
  } catch (txErr) {
    await bookingClient.query('ROLLBACK')
    throw txErr
  } finally {
    bookingClient.release()
  }

  // Fetch doctor's actual session start time for today (IST day-of-week)
  const todayDow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getDay()
  const sessionRes = await pool.query(
    `SELECT start_time FROM doctor_schedules
     WHERE tenant_id = $1 AND doctor_id = $2 AND day_of_week = $3 AND is_available = true
     LIMIT 1`,
    [tenant.id, doctor.id, todayDow]
  )
  const fmtTime = (t) => {
    const [h, m] = t.split(':')
    const hour = parseInt(h)
    const ampm = hour >= 12 ? 'PM' : 'AM'
    const h12 = hour % 12 || 12
    return `${h12}:${m} ${ampm}`
  }
  const sessionStart = sessionRes.rows[0]?.start_time
    ? fmtTime(sessionRes.rows[0].start_time)
    : '9:00 AM'

  // If outside working hours, store tomorrow option — non-critical, isolated from booking success
  if (!withinHours) {
    try {
      const redisClient = require('../../../config/redis')
      if (redisClient && conversation?.id) {
        await redisClient.set(
          `tomorrow_booking:${conversation.id}`,
          JSON.stringify({ doctor_id: doctor.id, doctor_name: doctor.name, doctor_specialization: doctor.specialization, patient_name: formattedName }),
          { EX: 3600 }
        )
      }
    } catch (redisErr) {
      logger.warn('Redis write failed for outside-hours tomorrow offer:', redisErr.message)
    }
  }

  return `Booking confirmed! 🏥
Token Number: ${tokenNumber}
Doctor: ${doctor.name}
${doctor.specialization}
🕘 Consultation starts at ${sessionStart}
Please arrive before session begins.
Reply CANCEL to cancel your booking.${!withinHours ? '\n\nReply *TOMORROW* if you would like to also book for tomorrow.' : ''}`
}

      case 'create_tomorrow_booking': {
        const { doctor_name, patient_name } = args
        const formattedName = (patient_name || '')
          .replace(/[^a-zA-Z\sഀ-ൿ-]/g, '')  // allow Latin, Malayalam, spaces, hyphens
          .trim()
          .slice(0, 100)
          .replace(/\b\w/g, c => c.toUpperCase())

        // Compute tomorrow in IST to avoid UTC/IST date boundary errors
        // (server runs UTC; between 12 AM–5:30 AM IST, UTC is still on the previous date)
        const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
        const tomorrow = new Date(nowIST)
        tomorrow.setDate(tomorrow.getDate() + 1)
        const tomorrowDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
        const tomorrowDow = tomorrow.getDay()

        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

        // Find doctor
        const doctorRes = await pool.query(
          `SELECT id, name, specialization, max_tokens_daily FROM clinic_doctors
           WHERE tenant_id = $1 AND LOWER(name) LIKE LOWER($2)
           LIMIT 1`,
          [tenant.id, `%${doctor_name}%`]
        )
        if (!doctorRes.rows.length) {
          return { success: false, message: `No doctor found matching "${doctor_name}"` }
        }
        const doctor = doctorRes.rows[0]

        // Check doctor leave for tomorrow
        const leaveCheck = await pool.query(
          `SELECT id FROM doctor_leaves WHERE doctor_id = $1 AND leave_date = $2 LIMIT 1`,
          [doctor.id, tomorrowDate]
        )
        if (leaveCheck.rows.length > 0) {
          return { success: false, message: `${doctor.name} is on leave tomorrow (${dayNames[tomorrowDow]}). Please choose another doctor.` }
        }

        // Check doctor schedule for tomorrow
        const scheduleRes = await pool.query(
          `SELECT start_time, end_time FROM doctor_schedules
           WHERE tenant_id = $1 AND doctor_id = $2 AND day_of_week = $3 AND is_available = true
           LIMIT 1`,
          [tenant.id, doctor.id, tomorrowDow]
        )
        if (!scheduleRes.rows.length) {
          return { success: false, message: `${doctor.name} is not available tomorrow (${dayNames[tomorrowDow]}). Please choose another doctor or a different day.` }
        }

        const { start_time, end_time } = scheduleRes.rows[0]
        const fmt = (t) => {
          const [h, m] = t.split(':')
          const hour = parseInt(h)
          const ampm = hour >= 12 ? 'PM' : 'AM'
          const h12 = hour % 12 || 12
          return `${h12}:${m} ${ampm}`
        }
        const sessionTime = `${fmt(start_time)} - ${fmt(end_time)}`

        // Check tomorrow token count
        const tokenRes = await pool.query(
          `SELECT COUNT(*) AS count FROM bookings
           WHERE doctor_id = $1 AND booking_date = $2 AND status != 'cancelled'`,
          [doctor.id, tomorrowDate]
        )
        const currentCount = parseInt(tokenRes.rows[0].count || 0)
        if (currentCount >= doctor.max_tokens_daily) {
          return { success: false, message: `${doctor.name} is fully booked for tomorrow. Please choose another doctor.` }
        }

        // Check duplicate booking for tomorrow
        if (customer?.id) {
          const activeBookingRes = await pool.query(
            `SELECT id FROM bookings WHERE customer_id = $1 AND doctor_id = $2 AND booking_date = $3 AND status NOT IN ('cancelled', 'completed') LIMIT 1`,
            [customer.id, doctor.id, tomorrowDate]
          )
          if (activeBookingRes.rows.length > 0) {
            return { success: false, message: `You already have a booking with ${doctor.name} tomorrow.` }
          }
        }

        // Create tomorrow booking inside a transaction with a FOR UPDATE
        // lock on the doctor row to prevent duplicate token numbers.
        const tomorrowClient = await pool.connect()
        let tokenNumber, booking
        try {
          await tomorrowClient.query('BEGIN')
          await tomorrowClient.query(
            'SELECT id FROM clinic_doctors WHERE id = $1 FOR UPDATE',
            [doctor.id]
          )
          const bookingRes = await tomorrowClient.query(
            `INSERT INTO bookings
               (tenant_id, customer_id, conversation_id, doctor_id,
                source, status, booking_date, token_number, notes, patient_name)
             VALUES ($1, $2, $3, $4, 'whatsapp', 'pending', $5,
               (SELECT COUNT(*) + 1 FROM bookings WHERE doctor_id = $4 AND booking_date = $5 AND status != 'cancelled'),
               $6, $7)
             RETURNING id, token_number`,
            [tenant.id, customer?.id || null, conversation?.id || null, doctor.id,
             tomorrowDate, `Booked via WhatsApp for ${formattedName}`, formattedName]
          )
          tokenNumber = bookingRes.rows[0].token_number
          booking = bookingRes.rows[0]
          await tomorrowClient.query(
            `INSERT INTO clinic_tokens (tenant_id, booking_id, doctor_id, token_number, status)
             VALUES ($1, $2, $3, $4, 'waiting')`,
            [tenant.id, booking.id, doctor.id, tokenNumber]
          )
          await tomorrowClient.query('COMMIT')
        } catch (txErr) {
          await tomorrowClient.query('ROLLBACK')
          throw txErr
        } finally {
          tomorrowClient.release()
        }

        return `Booking confirmed for tomorrow! 🏥
Token Number: ${tokenNumber}
Doctor: ${doctor.name}
${doctor.specialization}
📅 ${dayNames[tomorrowDow]}, ${new Date(tomorrowDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}
🕘 Session: ${sessionTime}
Please arrive before session begins.
Reply CANCEL to cancel your booking.`
      }

      case 'cancel_booking': {
        const { booking_id } = args
        // customer_id check prevents one patient from cancelling another's booking
        const result = await pool.query(
          `UPDATE bookings
           SET status = 'cancelled', updated_at = NOW()
           WHERE id = $1 AND tenant_id = $2 AND customer_id = $3
           RETURNING id, token_number`,
          [booking_id, tenant.id, customer?.id || null]
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
          `• Token #${b.token_number} with ${b.doctor_name} on ${new Date(b.booking_date).toLocaleDateString('en-IN')} (${b.status})`
        )
        return {
          bookings: result.rows,
          message: `Your upcoming bookings:\n${bookings.join('\n')}`
        }
      }

      case 'escalate_to_human': {
        const reason = args.reason || 'Patient requested human assistance'
        logger.info(`Escalation requested for conversation ${conversation?.id}: ${reason}`)
        // Signal to the calling code that escalation is needed
        return `ESCALATE:${reason}`
      }


      case 'get_catalogue': {
        const result = await pool.query(
          'SELECT product_id, name, description, price, in_stock FROM catalogue_items WHERE tenant_id = $1 ORDER BY name',
          [tenant.id]
        )
        if (!result.rows.length) {
          return 'No products in catalogue yet.'
        }
        const lines = result.rows.map(p =>
          `${p.in_stock ? '✅' : '❌'} [${p.product_id}] ${p.name} — ₹${parseFloat(p.price).toFixed(2)}\n   ${p.description || 'No description'}`
        )
        return 'Our products:\n\n' + lines.join('\n\n')
      }

      case 'get_product': {
        const { query } = args
        const result = await pool.query(
          'SELECT product_id, name, description, price, in_stock FROM catalogue_items WHERE tenant_id = $1 AND (LOWER(name) LIKE LOWER($2) OR LOWER(product_id) LIKE LOWER($2) OR LOWER(REPLACE(name, \' \', \'\')) LIKE LOWER(REPLACE($2, \' \', \'\'))) LIMIT 1',
          [tenant.id, `%${query}%`]
        )
        if (!result.rows.length) {
          return `Sorry, I could not find a product matching "${query}". Type "catalogue" to see all available products.`
        }
        const p = result.rows[0]
        return `*${p.name}* [${p.product_id}]
💰 Price: ₹${parseFloat(p.price).toFixed(2)}
📦 Status: ${p.in_stock ? 'In Stock ✅' : 'Out of Stock ❌'}
📝 ${p.description || 'No description available'}`
      }

      case 'capture_lead': {
        const { customer_name, product_id, product_name, quantity, delivery_address, alt_phone, notes } = args
        let unitPrice = 0
        let orderTotal = 0
        if (product_id) {
          try {
            const priceResult = await pool.query(
              'SELECT price FROM catalogue_items WHERE tenant_id = $1 AND product_id = $2',
              [tenant.id, product_id]
            )
            if (priceResult.rows.length) {
              unitPrice = parseFloat(priceResult.rows[0].price) || 0
              orderTotal = unitPrice * (quantity || 1)
            }
          } catch (e) {}
        }
        await pool.query(
          'INSERT INTO leads (tenant_id, customer_phone, customer_name, product_id, product_name, quantity, delivery_address, alt_phone, notes, status, unit_price, order_total) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, \'new\', $10, $11)',
          [
            tenant.id,
            customer.phone || customer.id,
            customer_name,
            product_id,
            product_name,
            quantity || 1,
            delivery_address,
            alt_phone || '',
            notes || '',
            unitPrice,
            orderTotal
          ]
        )
        return `✅ Order confirmed!

*Order Summary:*
📦 Product: ${product_name} [${product_id}]
🔢 Quantity: ${quantity}
💰 Unit Price: ₹${unitPrice}
💵 Order Total: ₹${orderTotal}
👤 Name: ${customer_name}
📍 Delivery to: ${delivery_address}
${alt_phone ? `📞 Contact: ${alt_phone}` : ''}

Our team will contact you soon to confirm payment and delivery details. Thank you for your order! 🙏`
      }

      default: {
        logger.warn('Unknown function called by Gemini:', name);
        return 'Function not available. Please respond with text only.';
      }
    }
  } catch (err) {
    logger.error(`AI function "${name}" failed:`, err.message)
    return { error: `Could not complete "${name}": ${err.message}` }
  }
}

module.exports = { executeFunction }
