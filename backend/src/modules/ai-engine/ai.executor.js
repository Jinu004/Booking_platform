const pool = require('../../config/database')
const logger = require('../../utils/logger')
const { formatPatientName } = require('../../utils/patientName')

// Escape special LIKE pattern characters to prevent unexpected query behavior
// "Sat 25 Oct, 5:00 PM" for a booking date (a Date from the database or YYYY-MM-DD text) and an optional HH:MM time
function formatBookingWhen(bookingDate, slotTime) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  let y, m, d
  if (bookingDate instanceof Date) {
    y = bookingDate.getFullYear(); m = bookingDate.getMonth() + 1; d = bookingDate.getDate()
  } else {
    ;[y, m, d] = String(bookingDate || '').slice(0, 10).split('-').map(Number)
  }
  const dt = new Date(y, (m || 1) - 1, d || 1)
  const dayText = isNaN(dt.getTime()) ? String(bookingDate) : `${days[dt.getDay()]} ${dt.getDate()} ${months[dt.getMonth()]}`
  if (!slotTime) return dayText
  const [h, min] = String(slotTime).split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(min)) return dayText
  return `${dayText}, ${h % 12 || 12}:${String(min).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

function escapeLike(str) {
  return str.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// Records the pending "Who is this booking for?" step. Never throws.
async function recordPatientChoiceFlow(ctx, { kind, doctorId, doctorName, date, sessionStart }) {
  try {
    const { setFlow } = require('../conversation/conversation.flow')
    const phone = ctx.customer?.phone
    if (!phone) return
    await setFlow(ctx.tenant.id, phone, {
      state: 'choose_patient',
      kind: kind || null,
      doctorId: doctorId || null,
      doctorName: doctorName || null,
      date: date || null,
      sessionStart: sessionStart || null
    })
    logger.info(`CODE_BOOKING_FLOW step=choose_patient tenant=${ctx.tenant.id} conversation=${ctx.conversation?.id || null} doctor=${doctorId || null} date=${date || null} session=${sessionStart || null}`)
  } catch (err) {
    logger.warn('recordPatientChoiceFlow failed:', err.message)
  }
}

// Internal-only: returns the patient row if it belongs to this customer and tenant, else null.
async function findOwnedPatient(tenantId, customerId, patientId) {
  if (!customerId) return null
  const res = await pool.query(
    `SELECT id, name FROM patients WHERE id = $1 AND tenant_id = $2 AND customer_id = $3 LIMIT 1`,
    [patientId, tenantId, customerId]
  )
  return res.rows[0] || null
}

// get_clinic_info, as it always answered (clinic_profiles + three tenant_configs keys, with fixed default hours). Only used when the new answer fails.
async function getClinicInfoLegacy(tenant) {
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
🕘 Opening: ${configs.opening_time || '9:00 AM'}
🕔 Closing: ${configs.closing_time || '5:00 PM'}
📅 Weekly off: ${configs.weekly_off || 'Sunday'}`
}

const CLINIC_INFO_DAYS = [
  ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'],
  ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']
]

// "09:00" -> "9:00 AM", "18:30" -> "6:30 PM"; null when it is not a time
function clock12(value) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value || '').trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = match[2]
  if (hour > 23 || Number(minute) > 59) return null
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`
}

// One line per day, Monday to Sunday, from tenant_settings.working_hours. Null when no day is configured at all.
function workingHoursLines(workingHours) {
  if (!workingHours || typeof workingHours !== 'object' || Array.isArray(workingHours)) return null
  if (!CLINIC_INFO_DAYS.some(([key]) => workingHours[key] && typeof workingHours[key] === 'object')) return null
  return CLINIC_INFO_DAYS.map(([key, label]) => {
    const day = workingHours[key]
    if (!day || typeof day !== 'object' || !day.enabled) return `${label} closed`
    const open = clock12(day.open)
    const close = clock12(day.close)
    return open && close ? `${label} ${open} - ${close}` : `${label} open (hours not set)`
  })
}

// get_clinic_info with the clinic's real details. Hours: the weekly hours the clinic saved in Settings; else the opening and closing times
// in its config when BOTH exist; else "not set" (never a made-up time). Phone and address are printed only when they exist.
async function getClinicInfoText(tenant) {
  const { cleanProfileValue } = require('./clinicInfo')
  const [profileRes, settingsRes, configs] = await Promise.all([
    pool.query('SELECT clinic_name FROM clinic_profiles WHERE tenant_id = $1 LIMIT 1', [tenant.id]),
    pool.query('SELECT working_hours, business_phone FROM tenant_settings WHERE tenant_id = $1', [tenant.id]),
    require('../tenant/tenant.service').getAllConfigs(tenant.id) // the 60 s cached helper
  ])
  const name = (profileRes.rows[0] && profileRes.rows[0].clinic_name) || tenant.name
  const settings = settingsRes.rows[0] || {}

  const phone = cleanProfileValue(settings.business_phone, 20)
  const address = cleanProfileValue(configs.clinic_address, 300)

  // Only the clinic's saved Business Phone is given to the model (never the WhatsApp number); no phone saved means no phone line
  const lines = [name]
  if (phone) lines.push(`📞 Phone: ${phone}`)
  if (address) lines.push(`🏠 Address: ${address}`)

  const hourLines = workingHoursLines(settings.working_hours)
  const openTime = cleanProfileValue(configs.opening_time, 40)
  const closeTime = cleanProfileValue(configs.closing_time, 40)
  if (hourLines) {
    lines.push('🕘 Opening hours:', ...hourLines)
  } else if (openTime && closeTime) {
    lines.push(`🕘 Opening: ${openTime}`, `🕔 Closing: ${closeTime}`)
  } else {
    lines.push('🕘 Opening hours: not set')
  }
  // The weekly off line only when the per-day hours are not used (they already say which days are closed)
  const weeklyOff = cleanProfileValue(configs.weekly_off, 40)
  if (!hourLines && weeklyOff) lines.push(`📅 Weekly off: ${weeklyOff}`)
  return lines.join('\n')
}

// The ONLY writer of unanswered_questions: the log_unanswered_question tool (offered only while the CLINIC INFORMATION block is in the prompt).
// Skips an identical question already logged for this clinic in the last 24 hours, and more than 3 per conversation per hour.
// Never throws and always answers success to the model, so a failure here can never change the patient's reply.
async function logUnansweredQuestion(ctx, args) {
  const ok = { success: true }
  try {
    const { tenant, conversation } = ctx
    if (!tenant || !tenant.id) return ok
    // Defence in depth: the tool is only declared when the guided block is on, but this checks the same switch again
    const configs = await require('../tenant/tenant.service').getAllConfigs(tenant.id)
    if (configs.ai_guided_kb !== 'true' || !['growth', 'pro'].includes(tenant.plan) || tenant.industry !== 'clinic') return ok

    const { sanitizeKnowledgeBase } = require('../settings/settings.controller')
    let question = typeof args?.question === 'string' ? args.question.trim().slice(0, 300) : ''
    // Long digit runs look like phone numbers: never stored
    question = question.replace(/\+?\d[\d\s-]{6,}\d/g, '[number]')
    question = question ? sanitizeKnowledgeBase(question, 'pro').trim().slice(0, 300) : ''
    if (!question) return ok

    const duplicate = await pool.query(
      `SELECT 1 FROM unanswered_questions
       WHERE tenant_id = $1 AND LOWER(question) = LOWER($2) AND created_at > NOW() - INTERVAL '24 hours' LIMIT 1`,
      [tenant.id, question]
    )
    if (duplicate.rows.length) return ok

    const conversationId = conversation?.id || null
    if (conversationId) {
      const recent = await pool.query(
        `SELECT COUNT(*)::int AS n FROM unanswered_questions
         WHERE tenant_id = $1 AND conversation_id = $2 AND created_at > NOW() - INTERVAL '1 hour'`,
        [tenant.id, conversationId]
      )
      if (recent.rows[0].n >= 3) return ok
    }

    await pool.query(
      'INSERT INTO unanswered_questions (tenant_id, question, conversation_id) VALUES ($1, $2, $3)',
      [tenant.id, question, conversationId]
    )
    logger.info(`UNANSWERED_QUESTION_LOGGED tenant=${tenant.id} conversation=${conversationId}`)
  } catch (err) {
    logger.warn(`UNANSWERED_QUESTION_LOG_FAILED ${String(err && err.message).slice(0, 120)}`)
  }
  return ok
}

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

      case 'start_appointment_booking': {
        // Only offered to clinics with booking_mode 'appointment' AND ai_appointment_booking (see ai.functions.js); checked again here
        const TenantServiceApt = require('../tenant/tenant.service')
        const { isAppointmentBookingOn } = require('../../utils/appointmentFlag')
        let aptOn = false
        try { aptOn = isAppointmentBookingOn(await TenantServiceApt.getAllConfigs(tenant.id)) } catch { aptOn = false }
        if (!aptOn) return { success: false, message: 'Appointment booking by time is not available.' }
        return require('../channel/whatsapp/appointment.flow').startFromTool(ctx, args)
      }

      case 'log_unanswered_question': {
        return await logUnansweredQuestion(ctx, args)
      }

      case 'get_clinic_info': {
        // The clinic's real hours, phone and address. If anything goes wrong the answer this tool always gave is returned instead.
        try {
          return await getClinicInfoText(tenant)
        } catch (infoErr) {
          logger.warn(`GET_CLINIC_INFO_FALLBACK tenant=${tenant.id} ${String(infoErr && infoErr.message).slice(0, 120)}`)
          return await getClinicInfoLegacy(tenant)
        }
      }

      case 'show_welcome': {
      // Only for clinic industry
      if (tenant.industry !== 'clinic') break

      const { sendDoctorList, sendButtons } = require('../channel/whatsapp/whatsapp.adapter')
      const nowISTW = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
      const todayDowW = nowISTW.getDay()
      const nowTimeW = nowISTW.getHours() * 60 + nowISTW.getMinutes()
      const fmtW = t => { if (!t) return ''; const [h, m] = t.split(':'); const hr = parseInt(h); return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}` }

      const welcomeRes = await pool.query(`
        SELECT cd.id, cd.name, cd.specialization, cd.max_tokens_daily,
               MIN(ds.start_time) AS start_time, MAX(ds.end_time) AS end_time,
               COUNT(DISTINCT ds.id) AS session_count,
               COUNT(b.id) FILTER (WHERE b.status != 'cancelled' AND (b.booking_type IS NULL OR b.booking_type != 'procedure')) AS booked_count
        FROM clinic_doctors cd
        JOIN doctor_schedules ds ON ds.doctor_id = cd.id AND ds.day_of_week = $2 AND ds.is_available = true
        LEFT JOIN bookings b ON b.doctor_id = cd.id AND b.booking_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date AND b.tenant_id = $1
        WHERE cd.tenant_id = $1 AND cd.available_today = true AND cd.is_active = true
          AND (EXTRACT(HOUR FROM ds.end_time) * 60 + EXTRACT(MINUTE FROM ds.end_time)) > $3
        GROUP BY cd.id, cd.name, cd.specialization, cd.max_tokens_daily
        ORDER BY cd.name ASC
      `, [tenant.id, todayDowW, nowTimeW])

      const customerPhone = ctx.customer?.phone
      const hasDoctors = welcomeRes.rows.length > 0

      const textList = hasDoctors
        ? welcomeRes.rows.map(doc => {
            const remaining = doc.max_tokens_daily - parseInt(doc.booked_count || 0)
            const sessionLabel = parseInt(doc.session_count) > 1
              ? `${doc.session_count} sessions today`
              : `${fmtW(doc.start_time)} - ${fmtW(doc.end_time)}`
            return `🩺 ${doc.name} (${doc.specialization})\n   🕘 ${sessionLabel}`
          }).join('\n\n')
        : 'No doctors available today.'

      const contextText = `Hello! Welcome to ${tenant.name} 👋\n\n${textList}\n\nOptions: Book Another Day | Talk to Staff | Check My Booking`

      if (customerPhone && hasDoctors) {
        const listItems = welcomeRes.rows.map(doc => {
          const remaining = doc.max_tokens_daily - parseInt(doc.booked_count || 0)
          const sessionLabel = parseInt(doc.session_count) > 1
            ? `${doc.session_count} sessions today`
            : `${fmtW(doc.start_time)} - ${fmtW(doc.end_time)}`
          return {
            id: 'booktoday_' + doc.id,
            title: doc.name.slice(0, 24),
            description: `${doc.specialization || 'General'} — ${sessionLabel}`.slice(0, 72)
          }
        })

        try {
          await sendDoctorList(customerPhone, `Hello! Welcome to ${tenant.name} 👋\nHere are today's available doctors:`, listItems, 'Book Today')
          await sendButtons(customerPhone, 'Need something else?', [
            { id: 'book_other_day', title: 'Book Another Day' },
            { id: 'talk_to_staff', title: 'Talk to Staff' },
            { id: 'check_booking', title: 'Check My Booking' }
          ])
          return `DIRECT:__INTERACTIVE_SENT__::${contextText}`
        } catch (err) {
          logger.warn('show_welcome interactive failed, falling back to text:', err.message)
        }
      }

      if (!hasDoctors) {
        if (customerPhone) {
          try {
            await sendButtons(customerPhone, `Hello! Welcome to ${tenant.name} 👋\n\nNo doctors are available today.`, [
              { id: 'book_other_day', title: 'Book Another Day' },
              { id: 'talk_to_staff', title: 'Talk to Staff' },
              { id: 'check_booking', title: 'Check My Booking' }
            ])
            return `DIRECT:__INTERACTIVE_SENT__::Hello! Welcome to ${tenant.name} 👋\n\nNo doctors are available today.\n\nOptions: Book Another Day | Talk to Staff | Check My Booking`
          } catch (err) {
            logger.warn('show_welcome no-doctors interactive failed, falling back to text:', err.message)
          }
        }
        return `DIRECT:Hello! Welcome to ${tenant.name} 👋\n\nNo doctors are available today.\n\nPlease choose an option:\n1️⃣ Book Another Day\n2️⃣ Talk to Staff\n3️⃣ Check My Booking`
      }
      return `DIRECT:Hello! Welcome to ${tenant.name} 👋\n\nPlease choose an option:\n1️⃣ Book Appointment — Today\n2️⃣ Book Tomorrow\n3️⃣ Talk to Staff\n4️⃣ Check My Booking`
    }

    case 'get_available_doctors': {
        const todayDowAD = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getDay()
        const doctorsResult = await pool.query(
          `SELECT cd.id, cd.name, cd.specialization, cd.max_tokens_daily,
                  MIN(ds.start_time) AS start_time, MAX(ds.end_time) AS end_time,
                  COUNT(DISTINCT ds.id) AS session_count,
                  COUNT(b.id) AS booked_count
           FROM clinic_doctors cd
           JOIN doctor_schedules ds
             ON ds.doctor_id = cd.id
             AND ds.tenant_id = cd.tenant_id
             AND ds.day_of_week = $2
             AND ds.is_available = true
             AND ds.end_time > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::time
           LEFT JOIN bookings b
             ON b.doctor_id = cd.id
             AND b.booking_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
             AND b.status != 'cancelled'
             AND (b.booking_type IS NULL OR b.booking_type != 'procedure')
           WHERE cd.tenant_id = $1
             AND cd.available_today = true AND cd.is_active = true
           GROUP BY cd.id, cd.name, cd.specialization, cd.max_tokens_daily
           ORDER BY cd.name ASC`,
          [tenant.id, todayDowAD]
        )
        if (!doctorsResult.rows.length) {
          return 'No doctors are available today. Please visit us tomorrow or call us directly.'
        }
        const fmtAD = (t) => {
          const [h, m] = t.split(':')
          const hour = parseInt(h)
          const ampm = hour >= 12 ? 'PM' : 'AM'
          const h12 = hour % 12 || 12
          return `${h12}:${m} ${ampm}`
        }
        const doctorList = doctorsResult.rows.map(doc => {
          const remaining = doc.max_tokens_daily - parseInt(doc.booked_count || 0)
          const sessionLabel = parseInt(doc.session_count) > 1
            ? `${doc.session_count} sessions today`
            : `${fmtAD(doc.start_time)} - ${fmtAD(doc.end_time)}`
          return `🩺 ${doc.name} (${doc.specialization})\n   🕘 ${sessionLabel}`
        }).join('\n\n')
        // Pro plan — send interactive list message directly, bypass Gemini
        if (tenant.plan === 'pro') {
          const { sendDoctorList } = require('../channel/whatsapp/whatsapp.adapter')
          const listItems = doctorsResult.rows.map(doc => {
            const remaining = doc.max_tokens_daily - parseInt(doc.booked_count || 0)
            const sessionLabel = parseInt(doc.session_count) > 1
              ? `${doc.session_count} sessions today`
              : `${fmtAD(doc.start_time)} - ${fmtAD(doc.end_time)}`
            return {
              id: doc.id,
              title: doc.name.slice(0, 24),
              description: `${doc.specialization || 'General'} — ${sessionLabel}`.slice(0, 72)
            }
          })
          const customerPhone = ctx.customer?.phone
          if (customerPhone) {
            try {
              await sendDoctorList(customerPhone, 'Please select a doctor to book your appointment', listItems)
              return `DIRECT:__INTERACTIVE_SENT__::Let me show you our available doctors 😊\n\n${doctorList}\n\nReply with the doctor's name to book.`
            } catch (err) {
              logger.warn('sendDoctorList failed, falling back to text list:', err.message)
              return `DIRECT:Let me show you our available doctors 😊\n\n${doctorList}\n\nReply with the doctor's name to book.`
            }
          }
        }
        return `DIRECT:Let me show you our available doctors 😊\n\n${doctorList}\n\nReply with the doctor's name to book.`

      }

      case 'show_all_doctors': {
      const { sendDoctorList } = require('../channel/whatsapp/whatsapp.adapter')
      const nowISTAD = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
      const todayDowAD2 = nowISTAD.getDay()
      const dayNamesAD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

      // Get all active doctors with their next available day after today
      const allDoctorsRes = await pool.query(`
        SELECT cd.id, cd.name, cd.specialization,
               ds.day_of_week, ds.start_time, ds.end_time
        FROM clinic_doctors cd
        JOIN doctor_schedules ds ON ds.doctor_id = cd.id
          AND ds.is_available = true
          AND ds.day_of_week != $2
        WHERE cd.tenant_id = $1 AND cd.is_active = true AND cd.leave_days != 999
        ORDER BY cd.name ASC,
          CASE WHEN ds.day_of_week > $2 THEN ds.day_of_week - $2
               ELSE ds.day_of_week + 7 - $2
          END ASC
      `, [tenant.id, todayDowAD2])

      if (!allDoctorsRes.rows.length) {
        return `DIRECT:No doctors are available in the coming days. Please contact the clinic directly.`
      }

      // Pick earliest next available day per doctor
      const doctorMap = new Map()
      for (const row of allDoctorsRes.rows) {
        if (!doctorMap.has(row.id)) {
          doctorMap.set(row.id, row)
        }
      }
      const doctors = Array.from(doctorMap.values())

      const fmtAD2 = t => { if (!t) return ''; const [h, m] = t.split(':'); const hr = parseInt(h); return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}` }
      const daysFromToday = d => d > todayDowAD2 ? d - todayDowAD2 : d + 7 - todayDowAD2

      // Count available days per doctor this week
      const doctorDaysCount = new Map()
      for (const row of allDoctorsRes.rows) {
        doctorDaysCount.set(row.id, (doctorDaysCount.get(row.id) || 0) + 1)
      }

      const listItems = doctors.map(doc => {
        const daysCount = doctorDaysCount.get(doc.id) || 1
        return {
          id: doc.id,
          title: doc.name.slice(0, 24),
          description: `${doc.specialization || 'General'} — ${daysCount} session${daysCount > 1 ? 's' : ''} this week`.slice(0, 72)
        }
      })

      const textList = doctors.map(doc => {
        const daysCount = doctorDaysCount.get(doc.id) || 1
        return `🩺 ${doc.name} (${doc.specialization}) — ${daysCount} session${daysCount > 1 ? 's' : ''} this week`
      }).join('\n')

      const customerPhone = ctx.customer?.phone
      if (customerPhone) {
        try {
          await sendDoctorList(customerPhone, 'Select a doctor to see their available days:', listItems)
          return `DIRECT:__INTERACTIVE_SENT__::Select a doctor to see their available days:\n\n${textList}`
        } catch (err) {
          logger.warn('show_all_doctors interactive failed:', err.message)
        }
      }
      return `DIRECT:Here are our doctors and their next available day:\n\n${textList}\n\nReply with the doctor name to see their schedule.`
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
             AND (b.booking_type IS NULL OR b.booking_type != 'procedure')
           LEFT JOIN doctor_leaves dl
             ON dl.doctor_id = cd.id
             AND dl.leave_date = $3
           WHERE cd.tenant_id = $1
             AND cd.is_active = true AND dl.id IS NULL
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
          return `🩺 ${doc.name} (${doc.specialization})\n   🕘 ${sessionTime}`
        }).join('\n\n')

        return `DIRECT:Doctors available tomorrow (${dayNamesTd[tomorrowDowTd]}):\n\n${doctorList}\n\nReply with the doctor's name to book.`
      }

      case 'get_doctor_schedule': {
      const { sendButtons } = require('../channel/whatsapp/whatsapp.adapter')
      const doctorNameGDS = (args.doctor_name || '').trim()
      const nowISTGDS = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
      const todayDowGDS = nowISTGDS.getDay()
      const dayNamesGDS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      const fmtGDS = t => { if (!t) return ''; const [h, m] = t.split(':'); const hr = parseInt(h); return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}` }

      // Find doctor by id (from interactiveId) or name
      let doctorIdGDS = ctx.interactiveId || null
      if (!doctorIdGDS) {
        const docSearch = await pool.query(
          `SELECT id FROM clinic_doctors WHERE tenant_id = $1 AND is_active = true AND LOWER(name) LIKE LOWER($2) LIMIT 1`,
          [tenant.id, `%${doctorNameGDS}%`]
        )
        doctorIdGDS = docSearch.rows[0]?.id
      }
      if (!doctorIdGDS) return `DIRECT:Sorry, I couldn't find that doctor. Please try again.`

      // Get doctor details
      const docResGDS = await pool.query(
        `SELECT name, specialization FROM clinic_doctors WHERE id = $1 AND tenant_id = $2`,
        [doctorIdGDS, tenant.id]
      )
      if (!docResGDS.rows.length) return `DIRECT:Sorry, I couldn't find that doctor. Please try again.`
      const doctorGDS = docResGDS.rows[0]

      // Get all sessions this week for this doctor (excluding today)
      const schedRes = await pool.query(`
        SELECT day_of_week, start_time, end_time
        FROM doctor_schedules
        WHERE tenant_id = $1 AND doctor_id = $2 AND is_available = true
          AND day_of_week != $3
        ORDER BY
          CASE WHEN day_of_week > $3 THEN day_of_week - $3
               ELSE day_of_week + 7 - $3
          END ASC,
          start_time ASC
      `, [tenant.id, doctorIdGDS, todayDowGDS])

      if (!schedRes.rows.length) {
        return `DIRECT:${doctorGDS.name} has no upcoming sessions scheduled this week. Please contact the clinic for more information.`
      }

      // Group sessions by day
      const dayMap = new Map()
      for (const row of schedRes.rows) {
        const daysAway = row.day_of_week > todayDowGDS
          ? row.day_of_week - todayDowGDS
          : row.day_of_week + 7 - todayDowGDS
        const dayLabel = daysAway === 1 ? 'Tomorrow' : dayNamesGDS[row.day_of_week]
        const key = row.day_of_week
        if (!dayMap.has(key)) dayMap.set(key, { dayLabel, daysAway, sessions: [], dayOfWeek: row.day_of_week })
        dayMap.get(key).sessions.push({ start: row.start_time, end: row.end_time })
      }

      // Limit to next 3 days only
      const days = Array.from(dayMap.values()).sort((a, b) => a.daysAway - b.daysAway).slice(0, 3)
      const customerPhone = ctx.customer?.phone

      // Compute actual booking dates for each day
      const nowISTDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
      const getBookingDate = (dayOfWeek) => {
        const d = new Date(nowISTDate)
        const daysAway = dayOfWeek > todayDowGDS ? dayOfWeek - todayDowGDS : dayOfWeek + 7 - todayDowGDS
        d.setDate(d.getDate() + daysAway)
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      }

      // If only one day available — skip day selection, show sessions directly
      if (days.length === 1) {
        const day = days[0]
        const bookingDate = getBookingDate(day.dayOfWeek)
        if (day.sessions.length === 1) {
          const s = day.sessions[0]
          const { sendDoctorList: sendDLGDS } = require('../channel/whatsapp/whatsapp.adapter')
          const custPhoneGDS = ctx.customer?.phone
          const custIdGDS = ctx.customer?.id
          if (custIdGDS && custPhoneGDS) {
            try {
              const patResGDS = await pool.query(
                `SELECT id, name FROM patients WHERE tenant_id = $1 AND customer_id = $2 ORDER BY name ASC LIMIT 9`,
                [tenant.id, custIdGDS]
              )
              if (patResGDS.rows.length > 0) {
                const listItemsGDS = [
                  ...patResGDS.rows.map(p => ({ id: `patient_${p.id}`, title: p.name.slice(0, 24), description: 'Existing profile' })),
                  { id: 'patient_new', title: 'Book for someone else', description: 'Add a new patient' }
                ]
                const nameListGDS = patResGDS.rows.map(p => `• ${p.name}`).join('\n')
                const ctxGDS = `${doctorGDS.name} (${doctorGDS.specialization}) available on ${day.dayLabel}.\nSession: ${fmtGDS(s.start)} - ${fmtGDS(s.end)}\n\nWho is this booking for?\n${nameListGDS}\n• Book for someone else [date:${bookingDate}]`
                const bodyTextGDS = `${doctorGDS.name} available on ${day.dayLabel}.\nWho is this booking for?`
                await recordPatientChoiceFlow(ctx, { kind: 'future', doctorId: doctorIdGDS, doctorName: doctorGDS.name, date: bookingDate, sessionStart: s.start })
                let sentGDS = false
                try {
                  await sendDLGDS(custPhoneGDS, bodyTextGDS, listItemsGDS, 'Select Patient')
                  sentGDS = true
                } catch (sendErr1) {
                  logger.warn('Patient profiles send attempt 1 failed (GDS), retrying:', sendErr1.message)
                  await new Promise(r => setTimeout(r, 500))
                  try {
                    await sendDLGDS(custPhoneGDS, bodyTextGDS, listItemsGDS, 'Select Patient')
                    sentGDS = true
                  } catch (sendErr2) {
                    logger.warn('Patient profiles send attempt 2 failed (GDS), falling back to text:', sendErr2.message)
                  }
                }
                if (sentGDS) return `DIRECT:__INTERACTIVE_SENT__::${ctxGDS}`
                // Text fallback with patient list
                return `DIRECT:${doctorGDS.name} available on ${day.dayLabel}.\n\nWho is this booking for?\n${nameListGDS}\n• Book for someone else\n\nReply with the name to confirm. [date:${bookingDate}]`
              }
            } catch (dbErr) {
              logger.warn('Patient profiles DB query failed in get_doctor_schedule:', dbErr.message)
            }
          }
          return `DIRECT:${doctorGDS.name} (${doctorGDS.specialization}) is available on ${day.dayLabel}.\nSession: ${fmtGDS(s.start)} - ${fmtGDS(s.end)}\n\nPlease reply with your name to confirm booking on ${day.dayLabel} [date:${bookingDate}]`
        }
        // One day, multiple sessions — show session buttons
        if (customerPhone) {
          const sessionButtons = day.sessions.slice(0, 3).map((s, i) => ({
            id: `session_${day.dayOfWeek}_${i}`,
            title: `${fmtGDS(s.start)} - ${fmtGDS(s.end)}`.slice(0, 20)
          }))
          const sessionCtx = `${doctorGDS.name} sessions on ${day.dayLabel} [date:${bookingDate}]: ${day.sessions.map(s => `${fmtGDS(s.start)}-${fmtGDS(s.end)}`).join(', ')}`
          try {
            await sendButtons(customerPhone, `${doctorGDS.name} is available on ${day.dayLabel}. Select a session:`, sessionButtons)
            return `DIRECT:__INTERACTIVE_SENT__::${sessionCtx}`
          } catch (err) {
            logger.warn('get_doctor_schedule sendButtons attempt 1 failed, retrying:', err.message)
            await new Promise(r => setTimeout(r, 500))
            try {
              await sendButtons(customerPhone, `${doctorGDS.name} is available on ${day.dayLabel}. Select a session:`, sessionButtons)
              return `DIRECT:__INTERACTIVE_SENT__::${sessionCtx}`
            } catch (err2) {
              logger.warn('get_doctor_schedule sendButtons attempt 2 failed, using text fallback:', err2.message)
              const sessionText = day.sessions.map((s, i) => `${i + 1}. ${fmtGDS(s.start)} - ${fmtGDS(s.end)}`).join('\n')
              return `DIRECT:${doctorGDS.name} is available on ${day.dayLabel}.\n\nSelect a session:\n${sessionText}\n\nReply with the session number. [date:${bookingDate}]`
            }
          }
        }
      }

      // Multiple days — show as interactive list (supports more than 3)
      if (customerPhone) {
        try {
          const { sendDoctorList } = require('../channel/whatsapp/whatsapp.adapter')
          const dayListItems = days.map(d => {
            const bookingDate = getBookingDate(d.dayOfWeek)
            const sessionInfo = d.sessions.length > 1
              ? `${d.sessions.length} sessions available`
              : `${fmtGDS(d.sessions[0].start)} - ${fmtGDS(d.sessions[0].end)}`
            return {
              id: `${d.dayOfWeek}::${bookingDate}`,
              title: d.dayLabel.slice(0, 24),
              description: sessionInfo.slice(0, 72)
            }
          })
          // Code flow only: remember the doctor and each offered date's session starts so a day tap can resolve a single session
          try {
            const codeFlowConfigsGDS = await require('../tenant/tenant.service').getAllConfigs(tenant.id)
            if (codeFlowConfigsGDS?.code_booking_flow === 'true' && conversation?.id) {
              const daysByDateGDS = {}
              for (const d of days) {
                daysByDateGDS[getBookingDate(d.dayOfWeek)] = d.sessions.map(s => {
                  const startStr = String(s.start)
                  return startStr.length === 5 ? `${startStr}:00` : startStr
                })
              }
              await require('../../config/redis').set(
                `anotherday_days:${conversation.id}`,
                JSON.stringify({ doctor_id: doctorIdGDS, doctor_name: doctorGDS.name, days: daysByDateGDS }),
                { EX: 1800 }
              )
            }
          } catch (anotherDayKeyErr) {
            logger.warn('Redis write failed for another-day day list:', anotherDayKeyErr.message)
          }
          await sendDoctorList(customerPhone, `When would you like to see ${doctorGDS.name}?`, dayListItems, 'Select Day')
          const contextText = days.map(d => {
            const bookingDate = getBookingDate(d.dayOfWeek)
            return `${d.dayLabel} [date:${bookingDate}]: ${d.sessions.map(s => `${fmtGDS(s.start)}-${fmtGDS(s.end)}`).join(', ')}`
          }).join('\n')
          return `DIRECT:__INTERACTIVE_SENT__::${doctorGDS.name} (${doctorGDS.specialization}) available on:\n${contextText}\n\nReply with your preferred day.`
        } catch (err) {
          logger.warn('get_doctor_schedule sendDoctorList failed:', err.message)
        }
      }

      // Fallback text
      const textSchedule = days.map(d => {
        const bookingDate = getBookingDate(d.dayOfWeek)
        return `${d.dayLabel} [date:${bookingDate}]: ${d.sessions.map(s => `${fmtGDS(s.start)}-${fmtGDS(s.end)}`).join(' | ')}`
      }).join('\n')
      return `DIRECT:${doctorGDS.name} (${doctorGDS.specialization}) is available on:\n\n${textSchedule}\n\nReply with your preferred day to book.`
    }

      case 'check_doctor_availability': {
        const { doctor_name } = args
        const result = await pool.query(
          `SELECT cd.id, cd.name, cd.specialization,
                  cd.available_today, cd.max_tokens_daily, cd.avg_consultation_minutes
           FROM clinic_doctors cd
           WHERE cd.tenant_id = $1
             AND LOWER(cd.name) LIKE LOWER($2) AND cd.is_active = true`,
          [tenant.id, `%${escapeLike(doctor_name)}%`]
        )
        if (!result.rows.length) {
          return { available: false, message: `No doctor found matching "${doctor_name}"` }
        }
        const doctor = result.rows[0]
        if (!doctor.available_today) {
          return { available: false, message: `${doctor.name} is not available today.` }
        }
        // Get today's day of week (0=Sunday, 1=Monday, etc.)
        const todayDow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getDay()
        // Check schedule_overrides first (procedure carve-outs), fall back to doctor_schedules
        const overrideResCDA = await pool.query(
          `SELECT sessions FROM schedule_overrides WHERE tenant_id = $1 AND doctor_id = $2 AND override_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date`,
          [tenant.id, doctor.id]
        )
        let scheduleRes
        if (overrideResCDA.rows.length > 0) {
          const overrideSessions = overrideResCDA.rows[0].sessions
          scheduleRes = { rows: overrideSessions.map(s => ({ start_time: s.start_time, end_time: s.end_time })) }
        } else {
          scheduleRes = await pool.query(
            `SELECT start_time, end_time FROM doctor_schedules
             WHERE tenant_id = $1 AND doctor_id = $2 AND day_of_week = $3 AND is_available = true
             ORDER BY start_time ASC`,
            [tenant.id, doctor.id, todayDow]
          )
        }

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
        const fmt = (t) => {
          const [h, m] = t.split(':')
          const hour = parseInt(h)
          const ampm = hour >= 12 ? 'PM' : 'AM'
          const h12 = hour % 12 || 12
          return `${h12}:${m} ${ampm}`
        }
        const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
        const currentMinutes = nowIST.getHours() * 60 + nowIST.getMinutes()

        const liveSessions = scheduleRes.rows.filter(sess => {
          const [eH, eM] = sess.end_time.split(':').map(Number)
          return (eH * 60 + eM) >= currentMinutes
        })

        if (liveSessions.length === 0) {
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

        const toMinsCDA = (t) => { const [h, m] = t.toString().split(':').map(Number); return h * 60 + m; }
        const toTimeStrCDA = (mins) => { const h = Math.floor(mins / 60).toString().padStart(2, '0'); const m = (mins % 60).toString().padStart(2, '0'); return `${h}:${m}`; }
        const avgMinsCDA = doctor.avg_consultation_minutes || 10;
        const availableSessions = [];
        for (const sess of liveSessions) {
          const effectiveStart = Math.max(toMinsCDA(sess.start_time), currentMinutes);
          const totalMins = Math.max(0, toMinsCDA(sess.end_time) - effectiveStart);
          const dynamicMax = totalMins > 0 ? Math.floor(totalMins / avgMinsCDA) : 0;
          const maxCap = doctor.max_tokens_daily ? Math.min(dynamicMax, doctor.max_tokens_daily) : dynamicMax;
          const sessStart = toTimeStrCDA(toMinsCDA(sess.start_time));
          const sessEnd = toTimeStrCDA(toMinsCDA(sess.end_time));
          const countRes = await pool.query(
            `SELECT COUNT(*) AS count FROM bookings
             WHERE tenant_id = $1 AND doctor_id = $2
             AND booking_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date AND status != 'cancelled'
             AND (booking_type IS NULL OR booking_type != 'procedure')
             AND (
               (slot_time IS NOT NULL AND slot_time >= $3 AND slot_time < $4)
               OR (slot_time IS NULL AND
                   ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::time >= $3::time
                   AND ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::time < $4::time)
             )`,
            [tenant.id, doctor.id, sessStart, sessEnd]
          );
          const sessCount = parseInt(countRes.rows[0].count || 0);
          if (sessCount < maxCap) availableSessions.push(sess);
        }
        if (availableSessions.length === 0) {
          // Code flow only: remember the doctor so a TOMORROW reply can show the tomorrow patient list
          try {
            const codeFlowConfigsCDA = await require('../tenant/tenant.service').getAllConfigs(tenant.id)
            if (codeFlowConfigsCDA?.code_booking_flow === 'true' && conversation?.id) {
              await require('../../config/redis').set(
                `tomorrow_booking:${conversation.id}`,
                JSON.stringify({ doctor_id: doctor.id, doctor_name: doctor.name, doctor_specialization: doctor.specialization }),
                { EX: 3600 }
              )
            }
          } catch (tomorrowKeyErr) {
            logger.warn('Redis write failed for tomorrow offer (all sessions full):', tomorrowKeyErr.message)
          }
          return { available: false, message: `${doctor.name} is fully booked for today. Would you like to book for tomorrow instead?\n\nReply TOMORROW to confirm tomorrow's booking or ignore to cancel.` }
        }

        var sessionTime, selectedSessionStart

        {
          const { sendButtons: sendBtnsCDA } = require('../channel/whatsapp/whatsapp.adapter')
          const custPhoneSel = ctx.customer?.phone
          if (custPhoneSel) {
            const sessionButtonsCDA = availableSessions.slice(0, 3).map(sess => ({
              id: `session_${doctor.id}_${sess.start_time.replace(/:/g, '-')}`,
              title: `${fmt(sess.start_time)} - ${fmt(sess.end_time)}`.slice(0, 20)
            }))
            const sessionListText = availableSessions.map(sess => `${fmt(sess.start_time)} - ${fmt(sess.end_time)}`).join(' or ')
            try {
              await sendBtnsCDA(custPhoneSel, `${doctor.name} has session(s) available today. Select one:`, sessionButtonsCDA)
              return `DIRECT:__INTERACTIVE_SENT__::${doctor.name} (${doctor.specialization}) has sessions: ${sessionListText}\n\nPlease select a session above.`
            } catch (sendErrSel) {
              logger.warn('Session selection sendButtons failed:', sendErrSel.message)
            }
          }
          // Fallback — use earliest available session if send failed
          const { start_time, end_time } = availableSessions[0]
          sessionTime = `${fmt(start_time)} - ${fmt(end_time)}`
          selectedSessionStart = start_time
        }

      const { sendDoctorList: sendDLCDA } = require('../channel/whatsapp/whatsapp.adapter')
      const custPhoneCDA = ctx.customer?.phone
      const custIdCDA = ctx.customer?.id
      if (custIdCDA && custPhoneCDA) {
        try {
          const patResCDA = await pool.query(
            `SELECT id, name FROM patients WHERE tenant_id = $1 AND customer_id = $2 ORDER BY name ASC LIMIT 9`,
            [tenant.id, custIdCDA]
          )
          if (patResCDA.rows.length > 0) {
            const listItemsCDA = [
              ...patResCDA.rows.map(p => ({ id: `patient_${p.id}`, title: p.name.slice(0, 24), description: 'Existing profile' })),
              { id: 'patient_new', title: 'Book for someone else', description: 'Add a new patient' }
            ]
            const nameListCDA = patResCDA.rows.map(p => `• ${p.name}`).join('\n')
            const ctxCDA = `${doctor.name} (${doctor.specialization})\nSession: ${sessionTime} [session_start:${selectedSessionStart}]\n\nWho is this booking for?\n${nameListCDA}\n• Book for someone else`
            const bodyTextCDA = `${doctor.name} is available.\nWho is this booking for?`
            await recordPatientChoiceFlow(ctx, { kind: 'today', doctorId: doctor.id, doctorName: doctor.name, date: null, sessionStart: selectedSessionStart })
            let sentCDA = false
            try {
              await sendDLCDA(custPhoneCDA, bodyTextCDA, listItemsCDA, 'Select Patient')
              sentCDA = true
            } catch (sendErr1) {
              logger.warn('Patient profiles send attempt 1 failed, retrying:', sendErr1.message)
              await new Promise(r => setTimeout(r, 500))
              try {
                await sendDLCDA(custPhoneCDA, bodyTextCDA, listItemsCDA, 'Select Patient')
                sentCDA = true
              } catch (sendErr2) {
                logger.warn('Patient profiles send attempt 2 failed, falling back to text:', sendErr2.message)
              }
            }
            if (sentCDA) return `DIRECT:__INTERACTIVE_SENT__::${ctxCDA}`
            // Text fallback with patient list
            return `DIRECT:${doctor.name} is available.\n\nWho is this booking for?\n${nameListCDA}\n• Book for someone else\n\nReply with the name to confirm.`
          }
        } catch (dbErr) {
          logger.warn('Patient profiles DB query failed in check_doctor_availability:', dbErr.message)
        }
      }
      return `DIRECT:${doctor.name} (${doctor.specialization})
Session: ${sessionTime}
${remaining} tokens remaining.

Please reply with your name to confirm booking.`
      }

      case 'create_token_booking': {
  const { doctor_name, patient_name: patientNameArgCTB, session_start_time, patient_id: patientIdArgCTB, doctor_id: doctorIdArgCTB } = args
  // Internal-only patient_id: use the stored name of a patient owned by this customer
  let patient_name = patientNameArgCTB
  if (patientIdArgCTB) {
    const ownedPatientCTB = await findOwnedPatient(tenant.id, customer?.id, patientIdArgCTB)
    if (!ownedPatientCTB) return { success: false, message: 'Patient not found' }
    patient_name = ownedPatientCTB.name
  }
  const formattedName = formatPatientName(patient_name) // letters of any script, spaces, hyphens, dots, apostrophes (utils/patientName.js)
  // Refuse before any lookup, capacity check or booking insert when there is no usable patient name
  if (!formattedName) {
    return { success: false, message: 'Please provide a valid patient name.' }
  }

  // Check working hours
  const HITLService = require('../hitl/hitl.service')
  const HITLModel = require('../hitl/hitl.model')
  const settings = await HITLModel.getTenantSettings(tenant.id)
  const withinHours = settings ? HITLService.isWithinWorkingHours(settings.working_hours) : true
  let contactPhone = tenant.whatsapp_number
  try {
    const bpRes = await pool.query(`SELECT business_phone FROM tenant_settings WHERE tenant_id = $1`, [tenant.id])
    contactPhone = bpRes.rows[0]?.business_phone || tenant.whatsapp_number
  } catch {}

  // Find doctor
  const doctorRes = doctorIdArgCTB
    ? await pool.query(
        `SELECT id, name, specialization, max_tokens_daily, avg_consultation_minutes FROM clinic_doctors
         WHERE tenant_id = $1 AND id = $2 AND available_today = true AND is_active = true
         LIMIT 1`,
        [tenant.id, doctorIdArgCTB]
      )
    : await pool.query(
        `SELECT id, name, specialization, max_tokens_daily, avg_consultation_minutes FROM clinic_doctors
         WHERE tenant_id = $1 AND LOWER(name) LIKE LOWER($2) AND available_today = true AND is_active = true
         LIMIT 1`,
        [tenant.id, `%${escapeLike(doctor_name)}%`]
      )
  if (!doctorRes.rows.length) {
    return { success: false, message: `Dr. ${doctor_name || 'that doctor'} is not available today.` }
  }
  const doctor = doctorRes.rows[0]

  // Check duplicate booking for today — scoped to patient name so family members sharing a number can each book
  if (customer?.id) {
    const activeBookingRes = await pool.query(
      `SELECT id FROM bookings WHERE customer_id = $1 AND doctor_id = $2 AND booking_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date AND LOWER(patient_name) = LOWER($3) AND status NOT IN ('cancelled', 'completed') LIMIT 1`,
      [customer.id, doctor.id, formattedName]
    )
    if (activeBookingRes.rows.length > 0) {
      return { success: false, message: `${formattedName} already has an active booking with ${doctor.name} today.` }
    }
  }

  // Session-scoped dynamic capacity check using session_start_time from args
  const nowISTCTB = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const currentMinsCTB = nowISTCTB.getHours() * 60 + nowISTCTB.getMinutes();
  const toMinsCTB = (t) => { const [h, m] = t.toString().split(':').map(Number); return h * 60 + m; };
  const toTimeStrCTB = (mins) => { const h = Math.floor(mins/60).toString().padStart(2,'0'); const m = (mins%60).toString().padStart(2,'0'); return `${h}:${m}`; };
  const avgMinsCTB = doctor.avg_consultation_minutes || 10;

  let sessionStartCTB = null;
  let sessionEndCTB = null;
  let totalMinutesCTB = 0;
  try {
    const overResCTB = await pool.query(
      `SELECT sessions FROM schedule_overrides WHERE tenant_id = $1 AND doctor_id = $2 AND override_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date`,
      [tenant.id, doctor.id]
    );
    let sessionsCTB = [];
    if (overResCTB.rows.length > 0) {
      sessionsCTB = overResCTB.rows[0].sessions;
    } else {
      const dowCTB = nowISTCTB.getDay();
      const schedResCTB = await pool.query(
        `SELECT start_time, end_time FROM doctor_schedules WHERE tenant_id = $1 AND doctor_id = $2 AND day_of_week = $3 AND is_available = true`,
        [tenant.id, doctor.id, dowCTB]
      );
      sessionsCTB = schedResCTB.rows;
    }
    const slotAnchorMins = session_start_time ? toMinsCTB(session_start_time) : currentMinsCTB;
    const targetSess = sessionsCTB.find(s => slotAnchorMins >= toMinsCTB(s.start_time) && slotAnchorMins < toMinsCTB(s.end_time))
      || (session_start_time ? sessionsCTB.find(s => currentMinsCTB >= toMinsCTB(s.start_time) && currentMinsCTB < toMinsCTB(s.end_time)) : null);

    if (targetSess) {
      sessionStartCTB = toTimeStrCTB(toMinsCTB(targetSess.start_time));
      sessionEndCTB = toTimeStrCTB(toMinsCTB(targetSess.end_time));
      const effectiveStart = Math.max(toMinsCTB(targetSess.start_time), currentMinsCTB);
      totalMinutesCTB = Math.max(0, toMinsCTB(targetSess.end_time) - effectiveStart);
    }
  } catch (sessErr) {
    logger.warn('Session lookup failed in create_token_booking capacity check — falling back to zero capacity:', sessErr.message)
  }

  const dynamicMaxCTB = totalMinutesCTB > 0
    ? Math.floor(totalMinutesCTB / avgMinsCTB)
    : (doctor.max_tokens_daily || 30);
  const maxTokensCTB = doctor.max_tokens_daily ? Math.min(dynamicMaxCTB, doctor.max_tokens_daily) : dynamicMaxCTB;

  let countSqlCTB = `SELECT COUNT(*) AS count FROM bookings
     WHERE tenant_id = $1 AND doctor_id = $2 AND booking_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
     AND status != 'cancelled' AND (booking_type IS NULL OR booking_type != 'procedure')`;
  const countParamsCTB = [tenant.id, doctor.id];
  if (sessionStartCTB && sessionEndCTB) {
    countSqlCTB += ` AND (
      (slot_time IS NOT NULL AND slot_time >= $3 AND slot_time < $4)
      OR
      (slot_time IS NULL AND ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::time >= $3::time AND ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::time < $4::time)
    )`;
    countParamsCTB.push(sessionStartCTB, sessionEndCTB);
  }
  const tokenRes = await pool.query(countSqlCTB, countParamsCTB);
  const currentCount = parseInt(tokenRes.rows[0].count || 0)
  if (currentCount >= maxTokensCTB) {
    // Today fully booked — store pending intent and offer tomorrow
    try {
      const redisClient = require('../../config/redis')
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
  // Find or create patient record
  let patientId = null;
  try {
    if (customer?.id && formattedName) {
      const existingPatient = await pool.query(
        `SELECT id FROM patients WHERE tenant_id = $1 AND customer_id = $2 AND LOWER(name) = LOWER($3)`,
        [tenant.id, customer.id, formattedName]
      );
      if (existingPatient.rows.length > 0) {
        patientId = existingPatient.rows[0].id;
      } else {
        const newPatient = await pool.query(
          `INSERT INTO patients (tenant_id, customer_id, name, phone)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, customer_id, LOWER(name)) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [tenant.id, customer.id, formattedName, customer.phone]
        );
        patientId = newPatient.rows[0].id;
      }
    }
  } catch (patientErr) {
    logger.warn('Patient find-or-create failed (non-fatal), booking will proceed without patient_id:', patientErr.message);
    patientId = null;
  }
  const slotTimeValue = session_start_time && /^\d{2}:\d{2}(:\d{2})?$/.test(session_start_time)
    ? session_start_time
    : null
  const bookingClient = await pool.connect()
  let tokenNumber, booking
  try {
    await bookingClient.query('BEGIN')
    await bookingClient.query(
      'SELECT id FROM clinic_doctors WHERE id = $1 FOR UPDATE',
      [doctor.id]
    )
    // Authoritative capacity re-check under the doctor-row lock (the count above runs before the lock)
    const lockedCountRes = await bookingClient.query(countSqlCTB, countParamsCTB)
    if (parseInt(lockedCountRes.rows[0].count || 0) >= maxTokensCTB) {
      await bookingClient.query('ROLLBACK')
      try {
        const redisClient = require('../../config/redis')
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
    const bookingRes = await bookingClient.query(
      `INSERT INTO bookings
         (tenant_id, customer_id, conversation_id, doctor_id,
          source, status, booking_date, token_number, notes, patient_name, patient_id, slot_time)
       VALUES ($1, $2, $3, $4, 'whatsapp', 'pending', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date,
         0,
         $5, $6, $7, $8)
       RETURNING id`,
      [tenant.id, customer?.id || null, conversation?.id || null, doctor.id,
       `Booked via WhatsApp for ${formattedName}`, formattedName, patientId, slotTimeValue]
    )
    booking = bookingRes.rows[0]
    let sessionStart = null;
    let sessionEnd = null;
    try {
      const toMins = (t) => { const [h, m] = t.toString().split(':').map(Number); return h * 60 + m; };
      const overRes = await bookingClient.query(
        `SELECT sessions FROM schedule_overrides WHERE tenant_id = $1 AND doctor_id = $2 AND override_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date`,
        [tenant.id, doctor.id]
      );
      let sess = [];
      if (overRes.rows.length > 0) {
        sess = overRes.rows[0].sessions;
      } else {
        const dow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getDay();
        const schRes = await bookingClient.query(
          `SELECT start_time, end_time FROM doctor_schedules WHERE tenant_id = $1 AND doctor_id = $2 AND day_of_week = $3 AND is_available = true`,
          [tenant.id, doctor.id, dow]
        );
        sess = schRes.rows;
      }
      const slotMins = slotTimeValue
        ? toMins(slotTimeValue)
        : (() => { const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })); return now.getHours() * 60 + now.getMinutes(); })();
      const matched = sess.find(s => { const ss = toMins(s.start_time); const se = toMins(s.end_time); return slotMins >= ss && slotMins < se; });
      if (matched) { sessionStart = matched.start_time.toString().slice(0, 5); sessionEnd = matched.end_time.toString().slice(0, 5); }
    } catch (err) {
      logger.error(`Session scope lookup failed in create_token_booking: ${err.message}`)
    }

    let tokenQuery, tokenParams;
    if (sessionStart && sessionEnd) {
      tokenQuery = `UPDATE bookings SET token_number = (
         SELECT COALESCE(MAX(token_number), 0) + 1 FROM bookings
         WHERE tenant_id = $1 AND doctor_id = $2 AND booking_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
         AND status != 'cancelled'
         AND (
           (slot_time IS NOT NULL AND slot_time >= $3 AND slot_time < $4)
           OR
           (slot_time IS NULL AND ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::time >= $3::time AND ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::time < $4::time)
         )
       ) WHERE id = $5 RETURNING token_number`;
      tokenParams = [tenant.id, doctor.id, sessionStart, sessionEnd, booking.id];
    } else {
      tokenQuery = `UPDATE bookings SET token_number = (
         SELECT COALESCE(MAX(token_number), 0) + 1 FROM bookings
         WHERE tenant_id = $1 AND doctor_id = $2 AND booking_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
         AND status != 'cancelled'
       ) WHERE id = $3 RETURNING token_number`;
      tokenParams = [tenant.id, doctor.id, booking.id];
    }
    const tokenRes = await bookingClient.query(tokenQuery, tokenParams)
    tokenNumber = tokenRes.rows[0].token_number
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

  const fmtTime = (t) => {
    const [h, m] = t.split(':')
    const hour = parseInt(h)
    const ampm = hour >= 12 ? 'PM' : 'AM'
    const h12 = hour % 12 || 12
    return `${h12}:${m} ${ampm}`
  }
  let sessionStart
  if (slotTimeValue) {
    sessionStart = fmtTime(slotTimeValue)
  } else {
    // No session chosen (single-session doctor) — fall back to today's session lookup
    const todayDow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getDay()
    const sessionRes = await pool.query(
      `SELECT start_time FROM doctor_schedules
       WHERE tenant_id = $1 AND doctor_id = $2 AND day_of_week = $3 AND is_available = true
       ORDER BY start_time ASC LIMIT 1`,
      [tenant.id, doctor.id, todayDow]
    )
    const resolvedStart = sessionRes.rows[0]?.start_time || null
    if (resolvedStart) {
      try {
        await pool.query(`UPDATE bookings SET slot_time = $1, updated_at = NOW() WHERE id = $2`, [resolvedStart, booking.id])
      } catch (updateErr) {
        logger.warn('Failed to backfill slot_time for single-session booking:', updateErr.message)
      }
      sessionStart = fmtTime(resolvedStart)
    } else {
      sessionStart = '9:00 AM'
    }
  }

  const avgMinsCTB2 = doctor.avg_consultation_minutes || 20
  let ctbEstTime
  try {
    const waitResParams = [tenant.id, doctor.id, tokenNumber]
    let waitQuery = `
      SELECT COUNT(*) AS waiting_ahead
      FROM clinic_tokens ct
      JOIN bookings b ON b.id = ct.booking_id
      WHERE ct.tenant_id = $1
        AND ct.doctor_id = $2
        AND b.booking_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
        AND ct.status IN ('waiting', 'in_consult')
        AND ct.token_number < $3`
    const rawSessionStart = slotTimeValue || null
    const rawSessionEnd = sessionEndCTB || null
    if (rawSessionStart && rawSessionEnd) {
      waitQuery += ` AND (b.slot_time IS NULL OR (b.slot_time >= $4 AND b.slot_time < $5))`
      waitResParams.push(rawSessionStart, rawSessionEnd)
    }
    const waitRes = await pool.query(waitQuery, waitResParams)
    const waitingAhead = parseInt(waitRes.rows[0]?.waiting_ahead || 0)
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    const nowMins = nowIST.getHours() * 60 + nowIST.getMinutes()
    const [ctbH, ctbM] = (slotTimeValue || '09:00').split(':').map(Number)
    const sessionMins = ctbH * 60 + ctbM
    const ctbEstMins = Math.max(nowMins, sessionMins) + waitingAhead * avgMinsCTB2
    const ctbEstH = Math.floor(ctbEstMins / 60) % 24
    const ctbEstM = ctbEstMins % 60
    const ctbEstAmPm = ctbEstH >= 12 ? 'PM' : 'AM'
    const ctbEstH12 = ctbEstH % 12 || 12
    ctbEstTime = `${ctbEstH12}:${String(ctbEstM).padStart(2, '0')} ${ctbEstAmPm}`
  } catch {
    const [ctbH, ctbM] = (slotTimeValue || '09:00').split(':').map(Number)
    const ctbEstMins = ctbH * 60 + ctbM + (tokenNumber - 1) * avgMinsCTB2
    const ctbEstH = Math.floor(ctbEstMins / 60) % 24
    const ctbEstM = ctbEstMins % 60
    const ctbEstAmPm = ctbEstH >= 12 ? 'PM' : 'AM'
    const ctbEstH12 = ctbEstH % 12 || 12
    ctbEstTime = `${ctbEstH12}:${String(ctbEstM).padStart(2, '0')} ${ctbEstAmPm}`
  }
  return `DIRECT:Booking confirmed! 🏥
Token Number: ${tokenNumber}
Doctor: ${doctor.name}
${doctor.specialization}
🕘 Session: ${sessionStart}
📍 Please arrive at the clinic and show your token number to reception.
Your turn will be called after you check in.
For queries, contact us: ${contactPhone}`
}

      case 'create_tomorrow_booking': {
        const { doctor_name, patient_name: patientNameArgTMR, patient_id: patientIdArgTMR, doctor_id: doctorIdArgTMR } = args
        // Internal-only patient_id: use the stored name of a patient owned by this customer
        let patient_name = patientNameArgTMR
        if (patientIdArgTMR) {
          const ownedPatientTMR = await findOwnedPatient(tenant.id, customer?.id, patientIdArgTMR)
          if (!ownedPatientTMR) return { success: false, message: 'Patient not found' }
          patient_name = ownedPatientTMR.name
        }
        const formattedName = formatPatientName(patient_name) // letters of any script, spaces, hyphens, dots, apostrophes (utils/patientName.js)
        // Refuse before any lookup or insert when there is no usable patient name
        if (!formattedName) {
          return { success: false, message: 'Please provide a valid patient name.' }
        }

        // Compute tomorrow in IST to avoid UTC/IST date boundary errors
        // (server runs UTC; between 12 AM–5:30 AM IST, UTC is still on the previous date)
        const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
        const tomorrow = new Date(nowIST)
        tomorrow.setDate(tomorrow.getDate() + 1)
        const tomorrowDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
        const tomorrowDow = tomorrow.getDay()

        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

        // Find doctor
        const doctorRes = doctorIdArgTMR
          ? await pool.query(
              `SELECT id, name, specialization, max_tokens_daily, avg_consultation_minutes FROM clinic_doctors
               WHERE tenant_id = $1 AND id = $2 AND is_active = true
               LIMIT 1`,
              [tenant.id, doctorIdArgTMR]
            )
          : await pool.query(
              `SELECT id, name, specialization, max_tokens_daily, avg_consultation_minutes FROM clinic_doctors
               WHERE tenant_id = $1 AND LOWER(name) LIKE LOWER($2) AND is_active = true
               LIMIT 1`,
              [tenant.id, `%${escapeLike(doctor_name)}%`]
            )
        if (!doctorRes.rows.length) {
          return { success: false, message: `No doctor found matching "${doctor_name || 'that doctor'}"` }
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

        // Tomorrow's sessions: schedule_overrides first (procedure carve-outs), then doctor_schedules; earliest session wins
        let tomorrowSessions = []
        const overrideResTmr = await pool.query(
          `SELECT sessions FROM schedule_overrides WHERE tenant_id = $1 AND doctor_id = $2 AND override_date = $3`,
          [tenant.id, doctor.id, tomorrowDate]
        )
        if (overrideResTmr.rows.length > 0) {
          tomorrowSessions = (overrideResTmr.rows[0].sessions || []).map(s => ({ start_time: s.start_time, end_time: s.end_time }))
        } else {
          const scheduleRes = await pool.query(
            `SELECT start_time, end_time FROM doctor_schedules
             WHERE tenant_id = $1 AND doctor_id = $2 AND day_of_week = $3 AND is_available = true
             ORDER BY start_time ASC`,
            [tenant.id, doctor.id, tomorrowDow]
          )
          tomorrowSessions = scheduleRes.rows
        }
        tomorrowSessions.sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))
        if (!tomorrowSessions.length) {
          return { success: false, message: `${doctor.name} is not available tomorrow (${dayNames[tomorrowDow]}). Please choose another doctor or a different day.` }
        }

        const { start_time, end_time } = tomorrowSessions[0]
        // slot_time is stored as HH:MM:SS text, like the other booking flows
        const slotTimeTomorrow = start_time.toString().length === 5 ? `${start_time}:00` : start_time.toString()
        const fmt = (t) => {
          const [h, m] = t.split(':')
          const hour = parseInt(h)
          const ampm = hour >= 12 ? 'PM' : 'AM'
          const h12 = hour % 12 || 12
          return `${h12}:${m} ${ampm}`
        }
        const sessionTime = `${fmt(start_time)} - ${fmt(end_time)}`

        // Tomorrow token count: same bookings create_token_booking counts (tenant, not cancelled, no procedures).
        // A null max_tokens_daily means no limit; 0 means no bookings.
        const tomorrowCountSql = `SELECT COUNT(*) AS count FROM bookings
           WHERE tenant_id = $1 AND doctor_id = $2 AND booking_date = $3
           AND status != 'cancelled' AND (booking_type IS NULL OR booking_type != 'procedure')`
        const tomorrowIsFull = (count) => doctor.max_tokens_daily !== null && doctor.max_tokens_daily !== undefined && count >= doctor.max_tokens_daily
        const fullTomorrowMessage = { success: false, message: `${doctor.name} is fully booked for tomorrow. Please choose another doctor.` }
        // Quick check before creating anything; the authoritative check runs again under the doctor-row lock below
        const tokenRes = await pool.query(tomorrowCountSql, [tenant.id, doctor.id, tomorrowDate])
        if (tomorrowIsFull(parseInt(tokenRes.rows[0].count || 0))) {
          return fullTomorrowMessage
        }

        // Check duplicate booking for tomorrow — scoped to patient name so family members sharing a number can each book
        if (customer?.id) {
          const activeBookingRes = await pool.query(
            `SELECT id FROM bookings WHERE customer_id = $1 AND doctor_id = $2 AND booking_date = $3 AND LOWER(patient_name) = LOWER($4) AND status NOT IN ('cancelled', 'completed') LIMIT 1`,
            [customer.id, doctor.id, tomorrowDate, formattedName]
          )
          if (activeBookingRes.rows.length > 0) {
            return { success: false, message: `${formattedName} already has a booking with ${doctor.name} tomorrow.` }
          }
        }

        // Create tomorrow booking inside a transaction with a FOR UPDATE
        // lock on the doctor row to prevent duplicate token numbers.
        // Find or create patient record
        let patientId = null;
        try {
          if (customer?.id && formattedName) {
            const existingPatient = await pool.query(
              `SELECT id FROM patients WHERE tenant_id = $1 AND customer_id = $2 AND LOWER(name) = LOWER($3)`,
              [tenant.id, customer.id, formattedName]
            );
            if (existingPatient.rows.length > 0) {
              patientId = existingPatient.rows[0].id;
            } else {
              const newPatient = await pool.query(
                `INSERT INTO patients (tenant_id, customer_id, name, phone)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (tenant_id, customer_id, LOWER(name)) DO UPDATE SET name = EXCLUDED.name
                 RETURNING id`,
                [tenant.id, customer.id, formattedName, customer.phone]
              );
              patientId = newPatient.rows[0].id;
            }
          }
        } catch (patientErr) {
          logger.warn('Patient find-or-create failed (non-fatal), booking will proceed without patient_id:', patientErr.message);
          patientId = null;
        }
        const tomorrowClient = await pool.connect()
        let tokenNumber, booking
        try {
          await tomorrowClient.query('BEGIN')
          await tomorrowClient.query(
            'SELECT id FROM clinic_doctors WHERE id = $1 FOR UPDATE',
            [doctor.id]
          )
          // Authoritative capacity check under the doctor-row lock
          const lockedTomorrowRes = await tomorrowClient.query(tomorrowCountSql, [tenant.id, doctor.id, tomorrowDate])
          if (tomorrowIsFull(parseInt(lockedTomorrowRes.rows[0].count || 0))) {
            await tomorrowClient.query('ROLLBACK')
            return fullTomorrowMessage
          }
          const bookingRes = await tomorrowClient.query(
            `INSERT INTO bookings
               (tenant_id, customer_id, conversation_id, doctor_id,
                source, status, booking_date, token_number, notes, patient_name, patient_id, slot_time)
             VALUES ($1, $2, $3, $4, 'whatsapp', 'pending', $5,
               (SELECT COALESCE(MAX(token_number), 0) + 1 FROM bookings WHERE tenant_id = $1 AND doctor_id = $4 AND booking_date = $5 AND status != 'cancelled'),
               $6, $7, $8, $9)
             RETURNING id, token_number`,
            [tenant.id, customer?.id || null, conversation?.id || null, doctor.id,
             tomorrowDate, `Booked via WhatsApp for ${formattedName}`, formattedName, patientId, slotTimeTomorrow]
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

        let contactPhoneTmr = tenant.whatsapp_number
      try {
        const bpResTmr = await pool.query(`SELECT business_phone FROM tenant_settings WHERE tenant_id = $1`, [tenant.id])
        contactPhoneTmr = bpResTmr.rows[0]?.business_phone || tenant.whatsapp_number
      } catch {}
      const avgMinsCTmB = doctor.avg_consultation_minutes || 20
      const ctmbSlot = (start_time || '09:00:00').toString().slice(0, 5)
      const [ctmbH, ctmbM] = ctmbSlot.split(':').map(Number)
      const ctmbEstMins = ctmbH * 60 + ctmbM + (tokenNumber - 1) * avgMinsCTmB
      const ctmbEstH = Math.floor(ctmbEstMins / 60) % 24
      const ctmbEstM = ctmbEstMins % 60
      const ctmbEstAmPm = ctmbEstH >= 12 ? 'PM' : 'AM'
      const ctmbEstH12 = ctmbEstH % 12 || 12
      const ctmbEstTime = `${ctmbEstH12}:${String(ctmbEstM).padStart(2, '0')} ${ctmbEstAmPm}`
      return `DIRECT:Booking confirmed for tomorrow! 🏥
Token Number: ${tokenNumber}
Doctor: ${doctor.name}
${doctor.specialization}
📅 ${dayNames[tomorrowDow]}, ${new Date(tomorrowDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}
🕘 Session: ${sessionTime}
📍 Please arrive at the clinic and show your token number to reception.
Your turn will be called after you check in.
For queries, contact us: ${contactPhoneTmr}`
      }

      case 'get_patient_profiles': {
      const { sendDoctorList } = require('../channel/whatsapp/whatsapp.adapter')
      const customerPhone = ctx.customer?.phone
      const customerId = ctx.customer?.id

      // Parse session info if this was triggered by a session button tap
      let sessionSuffix = ''
      const sessionMatch = (ctx.interactiveId || '').match(/^session_([0-9a-f-]{36})_(\d{2})-(\d{2})-(\d{2})$/)
      if (sessionMatch) {
        const sessHH = sessionMatch[2]
        const sessMM = sessionMatch[3]
        const sessHour = parseInt(sessHH)
        const sessAmpm = sessHour >= 12 ? 'PM' : 'AM'
        const sessH12 = sessHour % 12 || 12
        sessionSuffix = ` [session:${sessHH}:${sessMM}:${sessionMatch[4]}] (${sessH12}:${sessMM} ${sessAmpm})`
      }

      if (!customerId) {
        return `DIRECT:NEW_PATIENT::No existing profiles found${sessionSuffix}`
      }
      const patientRes = await pool.query(
        `SELECT id, name FROM patients WHERE tenant_id = $1 AND customer_id = $2 ORDER BY name ASC LIMIT 9`,
        [tenant.id, customerId]
      )
      if (!patientRes.rows.length) {
        return `DIRECT:NEW_PATIENT::No existing profiles found${sessionSuffix}`
      }
      const listItems = [
        ...patientRes.rows.map(p => ({
          id: `patient_${p.id}`,
          title: p.name.slice(0, 24),
          description: 'Existing profile'
        })),
        {
          id: 'patient_new',
          title: 'Book for someone else',
          description: 'Add a new patient'
        }
      ]
      const nameList = patientRes.rows.map(p => `• ${p.name}`).join('\n')
      const sessionLabel = sessionMatch ? `\nSelected session: ${sessionMatch[2]}:${sessionMatch[3]}` : ''
      const contextText = `Who is this booking for?${sessionLabel}\n${nameList}\n• Book for someone else${sessionSuffix}`
      const patientVisibleText = `Who is this booking for?${sessionLabel}\n${nameList}\n• Book for someone else`
      const dayMatchGPP = (ctx.interactiveId || '').match(/^\d::(\d{4}-\d{2}-\d{2})$/)
      // Internal-only (never from Gemini): tomorrow list for a known doctor
      const isInternalTomorrowGPP = args?.internal_kind === 'tomorrow' && !!args.doctor_id && /^\d{4}-\d{2}-\d{2}$/.test(args.internal_date || '')
      // Internal-only (never from Gemini): future date with a single known session for a known doctor
      const isInternalFutureGPP = args?.internal_kind === 'future' && !!args.doctor_id && /^\d{4}-\d{2}-\d{2}$/.test(args.internal_date || '') && /^\d{2}:\d{2}:\d{2}$/.test(args.internal_session || '')
      await recordPatientChoiceFlow(ctx, isInternalTomorrowGPP
        ? { kind: 'tomorrow', doctorId: args.doctor_id, doctorName: null, date: args.internal_date, sessionStart: null }
        : isInternalFutureGPP
        ? { kind: 'future', doctorId: args.doctor_id, doctorName: null, date: args.internal_date, sessionStart: args.internal_session }
        : {
            kind: dayMatchGPP ? 'future' : (sessionMatch ? 'today' : null),
            doctorId: sessionMatch ? sessionMatch[1] : null,
            doctorName: null,
            date: dayMatchGPP ? dayMatchGPP[1] : null,
            sessionStart: sessionMatch ? `${sessionMatch[2]}:${sessionMatch[3]}:${sessionMatch[4]}` : null
          })
      if (customerPhone) {
        let sentGPP = false
        try {
          await sendDoctorList(customerPhone, 'Who is this booking for?', listItems, 'Select Patient')
          sentGPP = true
        } catch (sendErr1) {
          const code1 = sendErr1.response?.data?.error?.code;
          logger.warn(`get_patient_profiles send attempt 1 failed (Meta code: ${code1 || 'unknown'}), retrying:`, sendErr1.message)
          await new Promise(r => setTimeout(r, 1000))
          try {
            await sendDoctorList(customerPhone, 'Who is this booking for?', listItems, 'Select Patient')
            sentGPP = true
          } catch (sendErr2) {
            const code2 = sendErr2.response?.data?.error?.code;
            logger.warn(`get_patient_profiles send attempt 2 failed (Meta code: ${code2 || 'unknown'}), falling back to text:`, sendErr2.message)
          }
        }
        if (sentGPP) return `DIRECT:__INTERACTIVE_SENT__::${contextText}`
      }
      return `DIRECT:${patientVisibleText}\n\nPlease reply with the name to book for, or type a new name.`
    }

    case 'create_future_booking': {
      const { doctor_name: doctorNameFB, patient_name: patientNameArgFB, booking_date: bookingDateFB, session_start_time: sessionStartFB, patient_id: patientIdArgFB, doctor_id: doctorIdArgFB } = args
      // Internal-only patient_id: use the stored name of a patient owned by this customer
      let patientNameFB = patientNameArgFB
      if (patientIdArgFB) {
        const ownedPatientFB = await findOwnedPatient(tenant.id, customer?.id, patientIdArgFB)
        if (!ownedPatientFB) return { success: false, message: 'Patient not found' }
        patientNameFB = ownedPatientFB.name
      }
      if ((!doctorNameFB && !doctorIdArgFB) || !patientNameFB || !bookingDateFB) {
        return `DIRECT:Sorry, I need the doctor name, your name, and booking date to complete this booking.`
      }
      const targetDate = new Date(bookingDateFB)
      if (isNaN(targetDate.getTime())) {
        return `DIRECT:Sorry, I couldn't process that date. Please try again.`
      }
      // The date must be YYYY-MM-DD, after today (IST) and within the 6 days ahead that get_doctor_schedule can offer
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(bookingDateFB))) {
        return `DIRECT:Sorry, I couldn't process that date. Please try again.`
      }
      const istTodayFB = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
      const istDateStrFB = (daysAhead) => {
        const d = new Date(istTodayFB)
        d.setDate(d.getDate() + daysAhead)
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      }
      if (bookingDateFB < istDateStrFB(1) || bookingDateFB > istDateStrFB(6)) {
        return `DIRECT:That date is no longer available. Please choose another day.`
      }
      const targetDow = targetDate.getDay()
      const formattedNameFB = formatPatientName(patientNameFB)
      if (!formattedNameFB) return `DIRECT:Please provide a valid name to confirm booking.`

      const fmtFB = t => { if (!t) return ''; const [h, m] = t.split(':'); const hr = parseInt(h); return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}` }

      // Find doctor (outside transaction — read-only)
      const sessionFilterFB = sessionStartFB && /^\d{2}:\d{2}(:\d{2})?$/.test(sessionStartFB)
      // Internal-only doctor_id replaces the name LIKE match; $2 is the id or the name pattern
      const doctorCondFB = doctorIdArgFB ? `cd.id = $2` : `LOWER(cd.name) LIKE LOWER($2)`
      const doctorParamFB = doctorIdArgFB || `%${doctorNameFB}%`
      const docRowResFB = await pool.query(
        `SELECT cd.id, cd.name, cd.specialization, cd.max_tokens_daily, cd.avg_consultation_minutes
         FROM clinic_doctors cd
         WHERE cd.tenant_id = $1 AND cd.is_active = true AND ${doctorCondFB}
         LIMIT 1`,
        [tenant.id, doctorParamFB]
      )
      if (!docRowResFB.rows.length) {
        return `DIRECT:Sorry, ${doctorNameFB || 'that doctor'} is not available on that day. Please choose another day.`
      }
      const doctorRowFB = docRowResFB.rows[0]

      // That date's sessions, same lookup as create_tomorrow_booking: schedule_overrides first, then doctor_schedules
      let sessionsFB = []
      const overrideResFB = await pool.query(
        `SELECT sessions FROM schedule_overrides WHERE tenant_id = $1 AND doctor_id = $2 AND override_date = $3`,
        [tenant.id, doctorRowFB.id, bookingDateFB]
      )
      if (overrideResFB.rows.length > 0) {
        sessionsFB = (overrideResFB.rows[0].sessions || []).map(s => ({ start_time: s.start_time, end_time: s.end_time }))
      } else {
        const scheduleResFB = await pool.query(
          `SELECT start_time, end_time FROM doctor_schedules
           WHERE tenant_id = $1 AND doctor_id = $2 AND day_of_week = $3 AND is_available = true
           ORDER BY start_time ASC`,
          [tenant.id, doctorRowFB.id, targetDow]
        )
        sessionsFB = scheduleResFB.rows
      }
      sessionsFB.sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))
      // The given session when there is one, otherwise the earliest
      const pickedSessionFB = sessionFilterFB
        ? sessionsFB.find(s => String(s.start_time).slice(0, 5) === String(sessionStartFB).slice(0, 5))
        : sessionsFB[0]
      if (!pickedSessionFB) {
        return `DIRECT:Sorry, ${doctorNameFB || 'that doctor'} is not available on that day. Please choose another day.`
      }
      const pickedStartFB = String(pickedSessionFB.start_time)
      const doctorFB = {
        ...doctorRowFB,
        start_time: pickedStartFB.length === 5 ? `${pickedStartFB}:00` : pickedStartFB,
        end_time: pickedSessionFB.end_time
      }

      // Check doctor leave for that date (same check as create_tomorrow_booking)
      const leaveCheckFB = await pool.query(
        `SELECT id FROM doctor_leaves WHERE doctor_id = $1 AND leave_date = $2 LIMIT 1`,
        [doctorFB.id, bookingDateFB]
      )
      if (leaveCheckFB.rows.length > 0) {
        const dayNamesFB = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        return { success: false, message: `${doctorFB.name} is on leave on that date (${dayNamesFB[targetDow]}). Please choose another day.` }
      }

      // Capacity count for that date: same bookings create_tomorrow_booking counts. A null max means no limit; 0 means no bookings.
      const futureCountSqlFB = `SELECT COUNT(*) AS count FROM bookings
         WHERE tenant_id = $1 AND doctor_id = $2 AND booking_date = $3
         AND status != 'cancelled' AND (booking_type IS NULL OR booking_type != 'procedure')`
      const futureIsFullFB = (count) => doctorFB.max_tokens_daily !== null && doctorFB.max_tokens_daily !== undefined && count >= doctorFB.max_tokens_daily
      const fullFutureMessageFB = { success: false, message: `${doctorFB.name} is fully booked on that date. Please choose another day or doctor.` }
      // Quick check before creating anything; the authoritative check runs again under the doctor-row lock below
      const futureCountResFB = await pool.query(futureCountSqlFB, [tenant.id, doctorFB.id, bookingDateFB])
      if (futureIsFullFB(parseInt(futureCountResFB.rows[0].count || 0))) {
        return fullFutureMessageFB
      }

      // Check duplicate booking for future date — scoped to patient name so family members sharing a number can each book
      // (compared with the cleaned name, which is the value that gets stored)
      const futureDuplicateSqlFB = `SELECT id FROM bookings WHERE customer_id = $1 AND doctor_id = $2 AND booking_date = $3 AND LOWER(patient_name) = LOWER($4) AND status NOT IN ('cancelled', 'completed') LIMIT 1`
      if (customer?.id) {
        const activeBookingResFB = await pool.query(
          futureDuplicateSqlFB,
          [customer.id, doctorFB.id, bookingDateFB, formattedNameFB]
        )
        if (activeBookingResFB.rows.length > 0) {
          return { success: false, message: `${patientNameFB} already has a booking with ${doctorFB.name} on that date.` }
        }
      }

      // Find customer (outside transaction — read-only)
      const custResFB = await pool.query(
        `SELECT id FROM customers WHERE tenant_id = $1 AND phone = $2 LIMIT 1`,
        [tenant.id, customer.phone]
      )
      const customerIdFB = custResFB.rows[0]?.id || customer.id

      // Find or create patient (outside transaction — non-fatal)
      let patientIdFB = null
      try {
        const existingPat = await pool.query(
          `SELECT id FROM patients WHERE tenant_id = $1 AND customer_id = $2 AND LOWER(name) = LOWER($3) LIMIT 1`,
          [tenant.id, customerIdFB, formattedNameFB]
        )
        if (existingPat.rows.length) {
          patientIdFB = existingPat.rows[0].id
        } else {
          const newPat = await pool.query(
            `INSERT INTO patients (tenant_id, customer_id, name, phone)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (tenant_id, customer_id, LOWER(name)) DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [tenant.id, customerIdFB, formattedNameFB, customer.phone]
          )
          patientIdFB = newPat.rows[0]?.id || null
        }
      } catch (patErr) {
        logger.warn('create_future_booking patient find-or-create failed:', patErr.message)
      }

      // Transactional booking insert with FOR UPDATE lock
      const clientFB = await pool.connect()
      let tokenNumberFB, bookingIdFB
      try {
        await clientFB.query('BEGIN')

        // Lock doctor row to serialise concurrent bookings
        await clientFB.query(
          `SELECT id FROM clinic_doctors WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
          [doctorFB.id, tenant.id]
        )

        // Authoritative capacity and duplicate checks under the doctor-row lock
        const lockedCountResFB = await clientFB.query(futureCountSqlFB, [tenant.id, doctorFB.id, bookingDateFB])
        if (futureIsFullFB(parseInt(lockedCountResFB.rows[0].count || 0))) {
          await clientFB.query('ROLLBACK')
          return fullFutureMessageFB
        }
        if (customer?.id) {
          const lockedDuplicateResFB = await clientFB.query(futureDuplicateSqlFB, [customer.id, doctorFB.id, bookingDateFB, formattedNameFB])
          if (lockedDuplicateResFB.rows.length > 0) {
            await clientFB.query('ROLLBACK')
            return { success: false, message: `${patientNameFB} already has a booking with ${doctorFB.name} on that date.` }
          }
        }

        // MAX-based token number inside transaction
        const tokenResFB = await clientFB.query(
          `SELECT COALESCE(MAX(token_number), 0) AS max_token FROM bookings
           WHERE doctor_id = $1 AND booking_date = $2 AND status != 'cancelled' AND tenant_id = $3`,
          [doctorFB.id, bookingDateFB, tenant.id]
        )
        tokenNumberFB = parseInt(tokenResFB.rows[0].max_token) + 1

        // Insert booking — RETURNING id eliminates separate SELECT
        const bookingResFB = await clientFB.query(
          `INSERT INTO bookings (tenant_id, customer_id, doctor_id, source, status, booking_date, token_number, patient_name, patient_id, slot_time)
           VALUES ($1, $2, $3, 'whatsapp', 'pending', $4, $5, $6, $7, $8)
           RETURNING id`,
          [tenant.id, customerIdFB, doctorFB.id, bookingDateFB, tokenNumberFB, formattedNameFB, patientIdFB, sessionFilterFB ? sessionStartFB : (doctorFB.start_time || null)]
        )
        bookingIdFB = bookingResFB.rows[0].id

        // Insert clinic token
        await clientFB.query(
          `INSERT INTO clinic_tokens (tenant_id, booking_id, doctor_id, token_number, status, issued_at)
           VALUES ($1, $2, $3, $4, 'waiting', $5)`,
          [tenant.id, bookingIdFB, doctorFB.id, tokenNumberFB, bookingDateFB]
        )

        await clientFB.query('COMMIT')
      } catch (txErrFB) {
        await clientFB.query('ROLLBACK')
        logger.error('create_future_booking transaction failed:', txErrFB.message)
        return `DIRECT:Sorry, I could not complete your booking. Please try again.`
      } finally {
        clientFB.release()
      }

      const bookingDayName = targetDate.toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' })

      let contactPhoneFB = tenant.whatsapp_number
      try {
        const bpResFB = await pool.query(`SELECT business_phone FROM tenant_settings WHERE tenant_id = $1`, [tenant.id])
        contactPhoneFB = bpResFB.rows[0]?.business_phone || tenant.whatsapp_number
      } catch {}
      const avgMinsFB = doctorFB.avg_consultation_minutes || 20
      const fbSlot = (sessionStartFB || doctorFB.start_time || '09:00:00').toString().slice(0, 5)
      const [fbH, fbM] = fbSlot.split(':').map(Number)
      const fbEstMins = fbH * 60 + fbM + (tokenNumberFB - 1) * avgMinsFB
      const fbEstH = Math.floor(fbEstMins / 60) % 24
      const fbEstM = fbEstMins % 60
      const fbEstAmPm = fbEstH >= 12 ? 'PM' : 'AM'
      const fbEstH12 = fbEstH % 12 || 12
      const fbEstTime = `${fbEstH12}:${String(fbEstM).padStart(2, '0')} ${fbEstAmPm}`
      return `DIRECT:Booking confirmed! 🏥
Token Number: ${tokenNumberFB}
Doctor: ${doctorFB.name}
${doctorFB.specialization}
Date: ${bookingDayName}, ${bookingDateFB}
🕘 Session starts at ${sessionFilterFB ? fmtFB(sessionStartFB) : fmtFB(doctorFB.start_time)}
📍 Please arrive at the clinic and show your token number to reception.
Your turn will be called after you check in.
For queries, contact us: ${contactPhoneFB}`
    }

      case 'cancel_booking': {
        const { booking_id } = args
        const bookingCheck = await pool.query(
          `SELECT b.booking_type, b.token_number, b.booking_date, b.slot_time, cd.name AS doctor_name
           FROM bookings b LEFT JOIN clinic_doctors cd ON cd.id = b.doctor_id
           WHERE b.id = $1 AND b.tenant_id = $2 AND b.customer_id = $3`,
          [booking_id, tenant.id, customer?.id || null]
        )
        if (!bookingCheck.rows.length) {
          return { success: false, message: 'Booking not found or already cancelled.' }
        }
        const { booking_type, token_number, booking_date: cancelDate, slot_time: cancelTime, doctor_name: cancelDoctor } = bookingCheck.rows[0]
        if (booking_type === 'procedure') {
          const ClinicModel = require('../industries/clinic/clinic.model')
          await ClinicModel.cancelProcedureBooking(pool, tenant.id, booking_id)
        } else {
          const result = await pool.query(
            `UPDATE bookings SET status = 'cancelled', updated_at = NOW()
             WHERE id = $1 AND tenant_id = $2 AND customer_id = $3
             RETURNING id`,
            [booking_id, tenant.id, customer?.id || null]
          )
          if (!result.rows.length) {
            return { success: false, message: 'Booking not found or already cancelled.' }
          }
          await pool.query(
            `UPDATE clinic_tokens SET status = 'cancelled' WHERE tenant_id = $1 AND booking_id = $2`,
            [tenant.id, booking_id]
          )
        }
        return {
          success: true,
          // A booking without a token number (appointment, procedure) is described by its date, time and doctor
          message: token_number != null
            ? `Token #${token_number} has been cancelled successfully.`
            : `Your booking on ${formatBookingWhen(cancelDate, cancelTime)}${cancelDoctor ? ` with ${cancelDoctor}` : ''} has been cancelled successfully.`
        }
      }

      case 'get_patient_bookings': {
        if (!customer?.id) {
          return { bookings: [], message: 'No bookings found for this number.' }
        }
        const result = await pool.query(
          `SELECT b.id, b.token_number, b.booking_date, b.status, b.booking_type,
                  b.slot_time, b.end_time, b.patient_name,
                  cd.name AS doctor_name, cd.specialization,
                  p.name AS procedure_name
           FROM bookings b
           LEFT JOIN clinic_doctors cd ON cd.id = b.doctor_id
           LEFT JOIN procedures p ON p.id = b.procedure_id
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
        const bookings = result.rows.map(b => {
          const date = new Date(b.booking_date).toLocaleDateString('en-IN');
          const patientLabel = b.patient_name ? ` for ${b.patient_name}` : '';
          if (b.booking_type === 'procedure' && b.procedure_name) {
            const fmtTimeProcedure = (t) => { if (!t) return ''; const [h, m] = t.toString().split(':').map(Number); return ` at ${h > 12 ? h - 12 : h || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`; };
            const time = fmtTimeProcedure(b.slot_time);
            return `• ${b.procedure_name}${patientLabel} with ${b.doctor_name} on ${date}${time} (${b.status})`;
          }
          const fmtTime = (t) => { if (!t) return ''; const [h, m] = t.toString().split(':').map(Number); return ` at ${h > 12 ? h - 12 : h || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`; };
          const session = fmtTime(b.slot_time);
          if (b.token_number == null) {
            // No token number: show the date, time and doctor instead of "Token #null"
            return `• Booking${patientLabel} with ${b.doctor_name} on ${formatBookingWhen(b.booking_date, b.slot_time)} (${b.status})`;
          }
          return `• Token #${b.token_number}${patientLabel} with ${b.doctor_name} on ${date}${session} (${b.status})`;
        })
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
          [tenant.id, `%${escapeLike(query)}%`]
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
        const duplicateCheck = await pool.query(
          `SELECT id FROM leads WHERE tenant_id = $1 AND customer_phone = $2 AND product_id = $3 AND created_at >= NOW() - INTERVAL '24 hours' LIMIT 1`,
          [tenant.id, customer.phone || customer.id, product_id]
        )
        const isDuplicate = duplicateCheck.rows.length > 0
        await pool.query(
          'INSERT INTO leads (tenant_id, customer_phone, customer_name, product_id, product_name, quantity, delivery_address, alt_phone, notes, status, unit_price, order_total, is_duplicate) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, \'new\', $10, $11, $12)',
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
            orderTotal,
            isDuplicate
          ]
        )
        await pool.query(
          `UPDATE customers SET name = $1 WHERE tenant_id = $2 AND phone = $3`,
          [args.customer_name, tenant.id, customer.phone]
        )
        return `DIRECT:✅ Order confirmed!

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
