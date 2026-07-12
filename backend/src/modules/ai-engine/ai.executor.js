const pool = require('../../config/database')
const logger = require('../../utils/logger')

// Escape special LIKE pattern characters to prevent unexpected query behavior
function escapeLike(str) {
  return str.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
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
               COUNT(b.id) FILTER (WHERE b.status != 'cancelled') AS booked_count
        FROM clinic_doctors cd
        JOIN doctor_schedules ds ON ds.doctor_id = cd.id AND ds.day_of_week = $2 AND ds.is_available = true
        LEFT JOIN bookings b ON b.doctor_id = cd.id AND b.booking_date = CURRENT_DATE AND b.tenant_id = $1
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
            return `🩺 ${doc.name} (${doc.specialization})\n   🕘 ${sessionLabel} — ${remaining} tokens available`
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
            id: doc.id,
            title: doc.name.slice(0, 24),
            description: `${doc.specialization || 'General'} — ${sessionLabel} (${remaining} left)`.slice(0, 72)
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
             AND b.booking_date = CURRENT_DATE
             AND b.status != 'cancelled'
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
          return `🩺 ${doc.name} (${doc.specialization})\n   🕘 ${sessionLabel} — ${remaining} tokens available`
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
              description: `${doc.specialization || 'General'} — ${sessionLabel} (${remaining} left)`.slice(0, 72)
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
          description: `${doc.specialization || 'General'} — ${daysCount} day${daysCount > 1 ? 's' : ''} this week`.slice(0, 72)
        }
      })

      const textList = doctors.map(doc => {
        const daysCount = doctorDaysCount.get(doc.id) || 1
        return `🩺 ${doc.name} (${doc.specialization}) — ${daysCount} day${daysCount > 1 ? 's' : ''} this week`
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
          return `🩺 ${doc.name} (${doc.specialization})\n   🕘 ${sessionTime} — ${remaining} tokens available`
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
                  cd.available_today, cd.max_tokens_daily,
                  COUNT(b.id) AS booked_count
           FROM clinic_doctors cd
           LEFT JOIN bookings b
             ON b.doctor_id = cd.id
             AND b.booking_date = CURRENT_DATE
             AND b.status != 'cancelled'
           WHERE cd.tenant_id = $1
             AND LOWER(cd.name) LIKE LOWER($2) AND cd.is_active = true
           GROUP BY cd.id`,
          [tenant.id, `%${escapeLike(doctor_name)}%`]
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
           ORDER BY start_time ASC`,
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

        var sessionTime, selectedSessionStart

        if (liveSessions.length === 1) {
          const { start_time, end_time } = liveSessions[0]
          const [startH, startM] = start_time.split(':').map(Number)
          const startMinutes = startH * 60 + startM
          if (currentMinutes < startMinutes) {
            return { available: false, message: `${doctor.name}'s session starts at ${fmt(start_time)}. Please book after the session begins.` }
          }
          sessionTime = `${fmt(start_time)} - ${fmt(end_time)}`
          selectedSessionStart = start_time
        } else {
          const { sendButtons: sendBtnsCDA } = require('../channel/whatsapp/whatsapp.adapter')
          const custPhoneSel = ctx.customer?.phone
          if (custPhoneSel) {
            const sessionButtonsCDA = liveSessions.slice(0, 3).map(sess => ({
              id: `session_${doctor.id}_${sess.start_time.replace(/:/g, '-')}`,
              title: `${fmt(sess.start_time)} - ${fmt(sess.end_time)}`.slice(0, 20)
            }))
            const sessionListText = liveSessions.map(sess => `${fmt(sess.start_time)} - ${fmt(sess.end_time)}`).join(' or ')
            try {
              await sendBtnsCDA(custPhoneSel, `${doctor.name} has multiple sessions today. Select one:`, sessionButtonsCDA)
              return `DIRECT:__INTERACTIVE_SENT__::${doctor.name} (${doctor.specialization}) has sessions: ${sessionListText}\n\nPlease select a session above.`
            } catch (sendErrSel) {
              logger.warn('Session selection sendButtons failed:', sendErrSel.message)
            }
          }
          // Fallback — use earliest live session if send failed
          const { start_time, end_time } = liveSessions[0]
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
            const ctxCDA = `${doctor.name} (${doctor.specialization})\nSession: ${sessionTime}\n${remaining} tokens remaining.\n\nWho is this booking for?\n${nameListCDA}\n• Book for someone else`
            const bodyTextCDA = `${doctor.name} is available.\nWho is this booking for?`
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
  const { doctor_name, patient_name, session_start_time } = args
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
     WHERE tenant_id = $1 AND LOWER(name) LIKE LOWER($2) AND available_today = true AND is_active = true
     LIMIT 1`,
    [tenant.id, `%${escapeLike(doctor_name)}%`]
  )
  if (!doctorRes.rows.length) {
    return { success: false, message: `Dr. ${doctor_name} is not available today.` }
  }
  const doctor = doctorRes.rows[0]

  // Check duplicate booking for today — scoped to patient name so family members sharing a number can each book
  if (customer?.id) {
    const activeBookingRes = await pool.query(
      `SELECT id FROM bookings WHERE customer_id = $1 AND doctor_id = $2 AND booking_date = CURRENT_DATE AND LOWER(patient_name) = LOWER($3) AND status NOT IN ('cancelled', 'completed') LIMIT 1`,
      [customer.id, doctor.id, formattedName]
    )
    if (activeBookingRes.rows.length > 0) {
      return { success: false, message: `${formattedName} already has an active booking with ${doctor.name} today.` }
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
    const bookingRes = await bookingClient.query(
      `INSERT INTO bookings
         (tenant_id, customer_id, conversation_id, doctor_id,
          source, status, booking_date, token_number, notes, patient_name, patient_id, slot_time)
       VALUES ($1, $2, $3, $4, 'whatsapp', 'pending', CURRENT_DATE,
         (SELECT COUNT(*) + 1 FROM bookings WHERE doctor_id = $4 AND booking_date = CURRENT_DATE AND status != 'cancelled'),
         $5, $6, $7, $8)
       RETURNING id, token_number`,
      [tenant.id, customer?.id || null, conversation?.id || null, doctor.id,
       `Booked via WhatsApp for ${formattedName}`, formattedName, patientId, slotTimeValue]
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

  return `DIRECT:Booking confirmed! 🏥
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
           WHERE tenant_id = $1 AND LOWER(name) LIKE LOWER($2) AND is_active = true
           LIMIT 1`,
          [tenant.id, `%${escapeLike(doctor_name)}%`]
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
          const bookingRes = await tomorrowClient.query(
            `INSERT INTO bookings
               (tenant_id, customer_id, conversation_id, doctor_id,
                source, status, booking_date, token_number, notes, patient_name, patient_id)
             VALUES ($1, $2, $3, $4, 'whatsapp', 'pending', $5,
               (SELECT COUNT(*) + 1 FROM bookings WHERE doctor_id = $4 AND booking_date = $5 AND status != 'cancelled'),
               $6, $7, $8)
             RETURNING id, token_number`,
            [tenant.id, customer?.id || null, conversation?.id || null, doctor.id,
             tomorrowDate, `Booked via WhatsApp for ${formattedName}`, formattedName, patientId]
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

        return `DIRECT:Booking confirmed for tomorrow! 🏥
Token Number: ${tokenNumber}
Doctor: ${doctor.name}
${doctor.specialization}
📅 ${dayNames[tomorrowDow]}, ${new Date(tomorrowDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}
🕘 Session: ${sessionTime}
Please arrive before session begins.
Reply CANCEL to cancel your booking.`
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
      if (customerPhone) {
        let sentGPP = false
        try {
          await sendDoctorList(customerPhone, 'Who is this booking for?', listItems, 'Select Patient')
          sentGPP = true
        } catch (sendErr1) {
          logger.warn('get_patient_profiles send attempt 1 failed, retrying:', sendErr1.message)
          await new Promise(r => setTimeout(r, 500))
          try {
            await sendDoctorList(customerPhone, 'Who is this booking for?', listItems, 'Select Patient')
            sentGPP = true
          } catch (sendErr2) {
            logger.warn('get_patient_profiles send attempt 2 failed, falling back to text:', sendErr2.message)
          }
        }
        if (sentGPP) return `DIRECT:__INTERACTIVE_SENT__::${contextText}`
      }
      return `DIRECT:${contextText}\n\nPlease reply with the name to book for, or type a new name.`
    }

    case 'create_future_booking': {
      const { doctor_name: doctorNameFB, patient_name: patientNameFB, booking_date: bookingDateFB, session_start_time: sessionStartFB } = args
      if (!doctorNameFB || !patientNameFB || !bookingDateFB) {
        return `DIRECT:Sorry, I need the doctor name, your name, and booking date to complete this booking.`
      }
      const targetDate = new Date(bookingDateFB)
      if (isNaN(targetDate.getTime())) {
        return `DIRECT:Sorry, I couldn't process that date. Please try again.`
      }
      const targetDow = targetDate.getDay()
      const formattedNameFB = patientNameFB.replace(/[^a-zA-Z\sഀ-ൿ-]/g, '').trim().slice(0, 100).replace(/\b\w/g, c => c.toUpperCase())
      if (!formattedNameFB) return `DIRECT:Please provide a valid name to confirm booking.`

      const fmtFB = t => { if (!t) return ''; const [h, m] = t.split(':'); const hr = parseInt(h); return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}` }

      // Find doctor (outside transaction — read-only)
      const sessionFilterFB = sessionStartFB && /^\d{2}:\d{2}(:\d{2})?$/.test(sessionStartFB)
      const docResFB = sessionFilterFB
        ? await pool.query(
            `SELECT cd.id, cd.name, cd.specialization, cd.max_tokens_daily,
                    ds.start_time, ds.end_time
             FROM clinic_doctors cd
             JOIN doctor_schedules ds ON ds.doctor_id = cd.id AND ds.day_of_week = $2 AND ds.is_available = true
             WHERE cd.tenant_id = $1 AND cd.is_active = true AND LOWER(cd.name) LIKE LOWER($3)
               AND ds.start_time::text LIKE $4 || '%'
             LIMIT 1`,
            [tenant.id, targetDow, `%${doctorNameFB}%`, sessionStartFB]
          )
        : await pool.query(
            `SELECT cd.id, cd.name, cd.specialization, cd.max_tokens_daily,
                    ds.start_time, ds.end_time
             FROM clinic_doctors cd
             JOIN doctor_schedules ds ON ds.doctor_id = cd.id AND ds.day_of_week = $2 AND ds.is_available = true
             WHERE cd.tenant_id = $1 AND cd.is_active = true AND LOWER(cd.name) LIKE LOWER($3)
             ORDER BY ds.start_time ASC
             LIMIT 1`,
            [tenant.id, targetDow, `%${doctorNameFB}%`]
          )
      if (!docResFB.rows.length) {
        return `DIRECT:Sorry, ${doctorNameFB} is not available on that day. Please choose another day.`
      }
      const doctorFB = docResFB.rows[0]

      // Check duplicate booking for future date — scoped to patient name so family members sharing a number can each book
      if (customer?.id) {
        const activeBookingResFB = await pool.query(
          `SELECT id FROM bookings WHERE customer_id = $1 AND doctor_id = $2 AND booking_date = $3 AND LOWER(patient_name) = LOWER($4) AND status NOT IN ('cancelled', 'completed') LIMIT 1`,
          [customer.id, doctorFB.id, bookingDateFB, patientNameFB]
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

      return `DIRECT:Booking confirmed! 🏥
Token Number: ${tokenNumberFB}
Doctor: ${doctorFB.name}
${doctorFB.specialization}
Date: ${bookingDayName}, ${bookingDateFB}
🕘 Session starts at ${sessionFilterFB ? fmtFB(sessionStartFB) : fmtFB(doctorFB.start_time)}
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
            const time = b.slot_time ? ` at ${b.slot_time}` : '';
            return `• ${b.procedure_name}${patientLabel} with ${b.doctor_name} on ${date}${time} (${b.status})`;
          }
          const session = b.slot_time ? ` at ${b.slot_time}` : '';
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
