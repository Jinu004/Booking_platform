// WhatsApp appointment booking by clock time, for clinics with booking_mode 'appointment' AND the tenant_configs key
// ai_appointment_booking = 'true' (see utils/appointmentFlag.js). Every other clinic never reaches this code.
//
// The patient says a day and time ("Saturday 5 pm"); the flow reads it with utils/dayTimeParse.js, offers up to 3 nearest free times
// as reply buttons, and books the tapped one with createAppointmentBooking (doctor row lock + overlap check). All messages are plain
// text or interactive replies inside the patient's open 24-hour window; no template is sent here.
//
// Layout: pure helpers (exported for tests) -> createFlow(deps) (the state machine; deps injected) -> handleIncoming / startFromTool
// (the real wiring used by the webhook and the AI tool).
//
// Ids (distinct from every token-flow id): aptdoc|<doctorId>, aptday|<doctorId>|YYYY-MM-DD, apt|<doctorId>|YYYY-MM-DD|HHMM,
// aptpat|<patientId> and aptpat|new. State: session state 'apt' with step apt_doctor | apt_time | apt_pick | apt_patient | apt_name.

const { parseDayAndTime } = require('../../../utils/dayTimeParse');
const { isAppointmentBookingOn } = require('../../../utils/appointmentFlag');

const MAX_DAYS_AHEAD = 14;
const MIN_LEAD_MINUTES = 30;
const APT_ID_RE = /^(aptdoc|aptday|apt|aptpat)\|/;
const GREETINGS = ['hi', 'hello', 'hey', 'hii', 'helo', 'hai', 'hiya', 'start', 'menu'];
const EXAMPLE = 'Saturday 5 pm';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const toMinutes = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
const hhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const compact = (minutes) => hhmm(minutes).replace(':', '');
const fromCompact = (text) => (/^\d{4}$/.test(text) ? toMinutes(`${text.slice(0, 2)}:${text.slice(2)}`) : null);

/** "5:00 PM" for minutes from midnight (0 gives "12:00 AM") */
function formatTimeLabel(minutes) {
  const h = Math.floor(minutes / 60);
  return `${h % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** "Sat 25 Oct" for a YYYY-MM-DD date */
function formatDateLabel(dateStr) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${days[dt.getUTCDay()]} ${dt.getUTCDate()} ${months[dt.getUTCMonth()]}`;
}

function addDaysStr(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** Today's date (YYYY-MM-DD) and the minutes since midnight, in IST */
function istNowParts(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return { dateStr: `${get('year')}-${get('month')}-${get('day')}`, minutes: parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10) };
}

/**
 * The free times (minutes) that may be offered: never in the past, at least 30 minutes from now on today, and within 14 days.
 * @param {number[]} slots minutes from midnight
 * @param {string} dateStr YYYY-MM-DD
 * @param {{ dateStr: string, minutes: number }} nowIst
 */
function bookableSlots(slots, dateStr, nowIst) {
  if (dateStr < nowIst.dateStr || dateStr > addDaysStr(nowIst.dateStr, MAX_DAYS_AHEAD)) return [];
  if (dateStr === nowIst.dateStr) return slots.filter((m) => m >= nowIst.minutes + MIN_LEAD_MINUTES);
  return slots.slice();
}

/**
 * Up to n free times closest to the target (an exact match first, then by distance; equal distance: the earlier time).
 * @param {Array<number|string>} slots minutes, or HH:MM text
 * @returns {number[]} minutes, closest first
 */
function pickNearestSlots(slots, target, n = 3) {
  const minutes = [...new Set((slots || []).map((s) => (typeof s === 'string' ? toMinutes(s) : s)))].filter(Number.isFinite);
  return minutes
    .map((m) => ({ m, dist: Math.abs(m - target) }))
    .sort((a, b) => a.dist - b.dist || a.m - b.m)
    .slice(0, n)
    .map((x) => x.m);
}

/**
 * Picks one target from the candidates a bare hour gives (05:00 and 17:00): the one inside the span of the doctor's free times;
 * when both or neither are inside, the one nearer to a free time (a tie goes to the later one).
 * @param {number[]} candidates minutes
 * @param {Array<number|string>} slots free times
 */
function resolveTarget(candidates, slots) {
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const minutes = (slots || []).map((s) => (typeof s === 'string' ? toMinutes(s) : s)).filter(Number.isFinite);
  if (minutes.length === 0) return candidates[0];
  const lo = Math.min(...minutes);
  const hi = Math.max(...minutes);
  const inside = candidates.filter((c) => c >= lo && c <= hi);
  if (inside.length === 1) return inside[0];
  const nearest = (c) => Math.min(...minutes.map((s) => Math.abs(s - c)));
  return [...candidates].sort((a, b) => nearest(a) - nearest(b) || b - a)[0];
}

const clip = (text, max) => String(text).slice(0, max);

/** Reply buttons for times: the title is the time only (max 20 characters); the date goes in the message body */
function buildTimeButtons(doctorId, dateStr, minutesList) {
  return [...minutesList].sort((a, b) => a - b).slice(0, 3).map((m) => ({ id: `apt|${doctorId}|${dateStr}|${compact(m)}`, title: clip(formatTimeLabel(m), 20) }));
}

/** Reply buttons for days (up to 3) */
function buildDayButtons(doctorId, dates, nowIst) {
  return dates.slice(0, 3).map((d) => ({
    id: `aptday|${doctorId}|${d}`,
    title: clip(nowIst && d === nowIst.dateStr ? 'Today' : nowIst && d === addDaysStr(nowIst.dateStr, 1) ? 'Tomorrow' : formatDateLabel(d), 20)
  }));
}

function buildMenuButtons() {
  return [
    { id: 'menu_book', title: 'Book Appointment' },
    { id: 'menu_check', title: 'Check My Booking' },
    { id: 'menu_staff', title: 'Talk to Staff' }
  ];
}

/** A usable patient name: 2 to 100 characters, with a letter in it */
function cleanPatientName(text) {
  const name = String(text || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 100 || !/\p{L}/u.test(name)) return null;
  return name;
}

// ---------------------------------------------------------------------------
// The state machine. deps are injected so the whole flow can be tested without a database or WhatsApp.
//   deps.now() -> Date
//   deps.state.get/set/clear(tenantId, phone)            (conversation.flow.js shapes)
//   deps.clinic.listDoctors(tenantId) -> [{ id, name, specialization, avg_consultation_minutes }]
//   deps.clinic.getSlots(tenantId, doctor, dateStr) -> ['HH:MM', ...] (free times, appointment mode)
//   deps.clinic.visitMinutes(doctor) -> number
//   deps.clinic.createAppointment(tenantId, doctorId, input) -> booking row with .confirmation
//   deps.db.listPatients(tenantId, customerId) -> [{ id, name }]
//   deps.db.hasSameDayBooking(tenantId, doctorId, dateStr, patientId) -> boolean
// Step functions return "specs" ({ type: 'text' | 'buttons' | 'list', ... }) that deliver() sends; startFromTool turns them into
// the tool answer instead.
// ---------------------------------------------------------------------------

function createFlow(deps) {
  const nowIst = () => istNowParts(deps.now());
  const text = (body, extra = {}) => ({ type: 'text', body, ...extra });
  const buttons = (body, btns) => ({ type: 'buttons', body, buttons: btns });

  const save = (ctx, step, d = {}) => deps.state.set(ctx.tenant.id, ctx.phone, {
    state: 'apt', step, kind: 'apt',
    doctorId: d.doctorId || null, doctorName: d.doctorName || null, date: d.date || null,
    sessionStart: d.pending || null, attempts: d.attempts || 0, pendingName: d.pendingName || null
  });

  const findDoctor = async (ctx, doctorId) => (await deps.clinic.listDoctors(ctx.tenant.id)).find((d) => d.id === doctorId) || null;

  // Free, bookable times of a doctor on a date, as minutes
  const freeMinutes = async (ctx, doctor, dateStr) => {
    const slots = await deps.clinic.getSlots(ctx.tenant.id, doctor, dateStr);
    return bookableSlots(slots.map(toMinutes).filter(Number.isFinite), dateStr, nowIst());
  };

  const askDayTime = (doctor) => text(`Which day and time would suit you with ${doctor.name}? For example: ${EXAMPLE}.`);

  // The patient told us a day only, or a time only, or nothing usable
  const askForDay = async (ctx, doctor, pendingMinutes) => {
    const now = nowIst();
    await save(ctx, 'apt_time', { doctorId: doctor.id, doctorName: doctor.name, pending: pendingMinutes.map(hhmm).join(',') });
    return [buttons('Which day would you like?', buildDayButtons(doctor.id, [now.dateStr, addDaysStr(now.dateStr, 1)], now))];
  };

  // Up to 3 days (next 14) with free times, nearest to the wanted date
  const nearbyDays = async (ctx, doctor, wantedDate) => {
    const now = nowIst();
    const found = [];
    for (let i = 0; i <= MAX_DAYS_AHEAD; i++) {
      const day = addDaysStr(now.dateStr, i);
      if (day === wantedDate) continue;
      if ((await freeMinutes(ctx, doctor, day)).length > 0) found.push(day);
    }
    const diff = (day) => Math.abs((Date.parse(day) - Date.parse(wantedDate)) / 86400000);
    return found.sort((a, b) => diff(a) - diff(b) || (a < b ? -1 : 1)).slice(0, 3);
  };

  const noTimeThatDay = async (ctx, doctor, dateStr) => {
    const days = await nearbyDays(ctx, doctor, dateStr);
    if (days.length === 0) {
      await deps.state.clear(ctx.tenant.id, ctx.phone);
      return [text(`Sorry, ${doctor.name} has no free times in the next two weeks. Please call the clinic and our team will help you.`)];
    }
    await save(ctx, 'apt_time', { doctorId: doctor.id, doctorName: doctor.name });
    return [buttons(`${doctor.name} has no free time on ${formatDateLabel(dateStr)}. These days have free times:`, buildDayButtons(doctor.id, days, nowIst()))];
  };

  // Offers the 3 free times nearest to the candidates on a date
  const showNearest = async (ctx, doctor, dateStr, candidates, prefix = '') => {
    const free = await freeMinutes(ctx, doctor, dateStr);
    if (free.length === 0) return noTimeThatDay(ctx, doctor, dateStr);
    const target = resolveTarget(candidates, free);
    const picks = pickNearestSlots(free, target, 3);
    await save(ctx, 'apt_pick', { doctorId: doctor.id, doctorName: doctor.name, date: dateStr });
    return [buttons(`${prefix}${doctor.name}, ${formatDateLabel(dateStr)}. These are the closest free times. Tap one to book:`, buildTimeButtons(doctor.id, dateStr, picks))];
  };

  const askName = async (ctx, doctor, dateStr, timeMinutes, attempts = 0) => {
    await save(ctx, 'apt_name', { doctorId: doctor.id, doctorName: doctor.name, date: dateStr, pending: hhmm(timeMinutes), attempts });
    return [text('Please reply with the patient\'s full name.')];
  };

  // Time text while the flow waits for a day and time
  const onTimeText = async (ctx, flow, input) => {
    const d = flow.data;
    const doctor = await findDoctor(ctx, d.doctorId);
    if (!doctor) return startBooking(ctx, {});
    const parsed = parseDayAndTime(input, deps.now());
    const pending = (d.sessionStart || '').split(',').filter(Boolean).map(toMinutes);
    const date = parsed.date || d.date || null;
    const times = parsed.times.length ? parsed.times : pending;

    if (!date && times.length === 0) {
      const attempts = (d.attempts || 0) + 1;
      if (attempts >= 2) {
        await deps.state.clear(ctx.tenant.id, ctx.phone);
        return [{ type: 'escalate' }];
      }
      await save(ctx, 'apt_time', { doctorId: doctor.id, doctorName: doctor.name, attempts });
      return [buttons(`Sorry, I did not catch that. Please tell me a day and time, for example: ${EXAMPLE}. Or pick a day:`, buildDayButtons(doctor.id, [nowIst().dateStr, addDaysStr(nowIst().dateStr, 1)], nowIst()))];
    }
    if (!date) return askForDay(ctx, doctor, times);
    if (date > addDaysStr(nowIst().dateStr, MAX_DAYS_AHEAD)) {
      return [text(`I can book up to ${MAX_DAYS_AHEAD} days ahead. Which day within the next two weeks would suit you?`)];
    }
    if (times.length === 0) {
      await save(ctx, 'apt_time', { doctorId: doctor.id, doctorName: doctor.name, date });
      return [text(`What time on ${formatDateLabel(date)}? For example: 5 pm.`)];
    }
    return showNearest(ctx, doctor, date, times);
  };

  const startBooking = async (ctx, { doctorName, preferredText } = {}) => {
    const doctors = await deps.clinic.listDoctors(ctx.tenant.id);
    if (doctors.length === 0) return [text('Sorry, no doctors are available for booking right now. Please call the clinic.')];
    let doctor = null;
    if (doctors.length === 1) doctor = doctors[0];
    else if (doctorName) {
      const wanted = String(doctorName).toLowerCase();
      doctor = doctors.find((d) => d.name.toLowerCase().includes(wanted) || wanted.includes(d.name.toLowerCase())) || null;
    }
    if (!doctor) {
      await save(ctx, 'apt_doctor');
      return [{
        type: 'list',
        body: 'Which doctor would you like to see?',
        buttonText: 'Select Doctor',
        items: doctors.slice(0, 10).map((d) => ({ id: `aptdoc|${d.id}`, title: clip(d.name, 24), description: clip(d.specialization || 'Doctor', 72) }))
      }];
    }
    return onDoctor(ctx, doctor, preferredText);
  };

  const onDoctor = async (ctx, doctor, preferredText) => {
    await save(ctx, 'apt_time', { doctorId: doctor.id, doctorName: doctor.name });
    if (preferredText && String(preferredText).trim()) {
      return onTimeText(ctx, { data: { doctorId: doctor.id, doctorName: doctor.name, attempts: 0 } }, preferredText);
    }
    return [askDayTime(doctor)];
  };

  const bookNow = async (ctx, doctor, dateStr, timeMinutes, who) => {
    const free = await freeMinutes(ctx, doctor, dateStr);
    if (!free.includes(timeMinutes)) {
      return showNearest(ctx, doctor, dateStr, [timeMinutes], 'That time was just taken. ');
    }
    if (who.patientId && await deps.db.hasSameDayBooking(ctx.tenant.id, doctor.id, dateStr, who.patientId)) {
      await deps.state.clear(ctx.tenant.id, ctx.phone);
      return [text(`${who.patientName || 'This patient'} already has an appointment with ${doctor.name} on ${formatDateLabel(dateStr)}. Reply CANCEL to cancel it, or call the clinic to change it.`)];
    }
    try {
      const booking = await deps.clinic.createAppointment(ctx.tenant.id, doctor.id, {
        patientName: who.patientName || ctx.customer?.name || 'Patient',
        patientId: who.patientId || undefined,
        phone: ctx.customer?.phone || ctx.phone,
        date: dateStr,
        startTime: hhmm(timeMinutes),
        source: 'whatsapp'
      });
      const c = booking.confirmation;
      const length = toMinutes(c.end_time) - toMinutes(c.start_time);
      await deps.state.clear(ctx.tenant.id, ctx.phone);
      return [text(`Your appointment with ${c.doctor_name} is booked for ${formatDateLabel(c.date)}, ${formatTimeLabel(toMinutes(c.start_time))} (about ${length} minutes). Reply CANCEL to cancel.`, { afterBooking: true })];
    } catch (err) {
      if (err && err.statusCode === 409) {
        return showNearest(ctx, doctor, dateStr, [timeMinutes], 'That time was just taken. ');
      }
      deps.log.warn(`APT_FLOW booking_failed class=${(err && (err.name || err.code)) || 'Error'} tenant=${ctx.tenant.id}`);
      await deps.state.clear(ctx.tenant.id, ctx.phone);
      return [text('Sorry, I could not complete your booking. Please try again, or call the clinic and our team will help you.')];
    }
  };

  // A tapped time: choose or ask for the patient, then book
  const onTime = async (ctx, doctor, dateStr, timeMinutes) => {
    const free = await freeMinutes(ctx, doctor, dateStr);
    if (!free.includes(timeMinutes)) return showNearest(ctx, doctor, dateStr, [timeMinutes], 'That time was just taken. ');
    const patients = ctx.customer?.id ? await deps.db.listPatients(ctx.tenant.id, ctx.customer.id) : [];
    if (patients.length === 0) return askName(ctx, doctor, dateStr, timeMinutes);
    if (patients.length === 1) return bookNow(ctx, doctor, dateStr, timeMinutes, { patientId: patients[0].id, patientName: patients[0].name });
    await save(ctx, 'apt_patient', { doctorId: doctor.id, doctorName: doctor.name, date: dateStr, pending: hhmm(timeMinutes) });
    return [{
      type: 'list',
      body: 'Who is this appointment for?',
      buttonText: 'Select Patient',
      items: [
        ...patients.slice(0, 9).map((p) => ({ id: `aptpat|${p.id}`, title: clip(p.name, 24), description: 'Existing profile' })),
        { id: 'aptpat|new', title: 'New patient', description: 'Add a new patient' }
      ]
    }];
  };

  const dispatchTap = async (ctx, id) => {
    const parts = id.split('|');
    const kind = parts[0];
    const flow = await deps.state.get(ctx.tenant.id, ctx.phone);
    const live = flow && flow.state === 'apt' && !flow.expired ? flow : null;

    if (kind === 'aptdoc') {
      const doctor = await findDoctor(ctx, parts[1]);
      if (!doctor) return [text('Sorry, that doctor is not available. Please send Hi to start again.')];
      return onDoctor(ctx, doctor);
    }
    if (kind === 'aptday') {
      const doctor = await findDoctor(ctx, parts[1]);
      const dateStr = parts[2];
      if (!doctor || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return [text('Sorry, that option has expired. Please send Hi to start again.')];
      const pending = live && live.data.sessionStart && live.data.doctorId === doctor.id ? live.data.sessionStart.split(',').filter(Boolean).map(toMinutes) : [];
      if (pending.length > 0) return showNearest(ctx, doctor, dateStr, pending);
      await save(ctx, 'apt_time', { doctorId: doctor.id, doctorName: doctor.name, date: dateStr });
      return [text(`What time on ${formatDateLabel(dateStr)}? For example: 5 pm.`)];
    }
    if (kind === 'apt') {
      const doctor = await findDoctor(ctx, parts[1]);
      const dateStr = parts[2];
      const minutes = fromCompact(parts[3] || '');
      if (!doctor || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '') || minutes === null) return [text('Sorry, that option has expired. Please send Hi to start again.')];
      return onTime(ctx, doctor, dateStr, minutes);
    }
    if (kind === 'aptpat') {
      if (!live || !live.data.doctorId || !live.data.date || !live.data.sessionStart) return [text('Sorry, that option has expired. Please send Hi to start again.')];
      const doctor = await findDoctor(ctx, live.data.doctorId);
      if (!doctor) return [text('Sorry, that doctor is not available. Please send Hi to start again.')];
      const minutes = toMinutes(live.data.sessionStart);
      if (parts[1] === 'new') return askName(ctx, doctor, live.data.date, minutes);
      const patients = ctx.customer?.id ? await deps.db.listPatients(ctx.tenant.id, ctx.customer.id) : [];
      const patient = patients.find((p) => p.id === parts[1]);
      if (!patient) return [text('Sorry, I could not find that patient. Please send Hi to start again.')];
      return bookNow(ctx, doctor, live.data.date, minutes, { patientId: patient.id, patientName: patient.name });
    }
    return [text('Sorry, that option has expired. Please send Hi to start again.')];
  };

  const onNameText = async (ctx, flow, input) => {
    const d = flow.data;
    const doctor = await findDoctor(ctx, d.doctorId);
    if (!doctor || !d.date || !d.sessionStart) {
      await deps.state.clear(ctx.tenant.id, ctx.phone);
      return [text('Sorry, that took too long. Please send Hi to start again.')];
    }
    const name = cleanPatientName(input);
    if (!name) {
      const attempts = (d.attempts || 0) + 1;
      if (attempts >= 2) {
        await deps.state.clear(ctx.tenant.id, ctx.phone);
        return [text('Sorry, I could not read the name. Please call the clinic and our team will help you with the booking.')];
      }
      return askName(ctx, doctor, d.date, toMinutes(d.sessionStart), attempts);
    }
    return bookNow(ctx, doctor, d.date, toMinutes(d.sessionStart), { patientName: name });
  };

  const greeting = async (ctx) => {
    await deps.state.clear(ctx.tenant.id, ctx.phone);
    return [buttons(`Hello! Welcome to ${ctx.tenant.name} 👋\nHow can I help you today?`, buildMenuButtons())];
  };

  /**
   * Handles one incoming message. Returns { handled: boolean, specs: [] }.
   * flagged: the clinic has both switches on.
   */
  const handle = async (ctx, message, flagged) => {
    const id = message.interactiveId ? String(message.interactiveId) : '';
    const isAptId = APT_ID_RE.test(id);
    if (!flagged) {
      if (isAptId) return { handled: true, specs: [text('This booking option is no longer available. Please send Hi to start again.')] };
      return { handled: false, specs: [] };
    }
    const typed = String(message.message || '').trim();
    if (isAptId) return { handled: true, specs: await dispatchTap(ctx, id) };

    if (typed === 'Book Appointment' || typed === 'Book Another Day' || typed === 'Reschedule') {
      return { handled: true, specs: await startBooking(ctx, {}) };
    }
    if (!id && GREETINGS.includes(typed.toLowerCase())) return { handled: true, specs: await greeting(ctx) };

    const flow = await deps.state.get(ctx.tenant.id, ctx.phone);
    if (!flow || flow.state !== 'apt') return { handled: false, specs: [] };
    // These buttons belong to other handlers: drop our state and let them answer
    if (typed === 'Check My Booking' || typed === 'Talk to Staff' || (!id && /^cancel$/i.test(typed))) {
      await deps.state.clear(ctx.tenant.id, ctx.phone);
      return { handled: false, specs: [] };
    }
    if (id) return { handled: false, specs: [] };
    if (flow.expired) {
      await deps.state.clear(ctx.tenant.id, ctx.phone);
      return { handled: false, specs: [] };
    }
    if (message.type !== 'text') return { handled: false, specs: [] };

    if (flow.step === 'apt_doctor') {
      const doctors = await deps.clinic.listDoctors(ctx.tenant.id);
      const lower = typed.toLowerCase();
      const doctor = doctors.find((d) => lower.includes(d.name.toLowerCase().replace(/^dr\.?\s*/, '')));
      if (doctor) return { handled: true, specs: await onDoctor(ctx, doctor) };
      return { handled: true, specs: await startBooking(ctx, {}) };
    }
    if (flow.step === 'apt_time' || flow.step === 'apt_pick') return { handled: true, specs: await onTimeText(ctx, flow, typed) };
    if (flow.step === 'apt_patient') {
      // A typed name instead of a tap: the same as "New patient"
      const doctor = await findDoctor(ctx, flow.data.doctorId);
      if (!doctor || !flow.data.date || !flow.data.sessionStart) return { handled: false, specs: [] };
      const name = cleanPatientName(typed);
      if (!name) return { handled: true, specs: await askName(ctx, doctor, flow.data.date, toMinutes(flow.data.sessionStart)) };
      return { handled: true, specs: await bookNow(ctx, doctor, flow.data.date, toMinutes(flow.data.sessionStart), { patientName: name }) };
    }
    if (flow.step === 'apt_name') return { handled: true, specs: await onNameText(ctx, flow, typed) };
    return { handled: false, specs: [] };
  };

  return { handle, startBooking };
}

// ---------------------------------------------------------------------------
// Real wiring (used by the webhook and by the AI tool)
// ---------------------------------------------------------------------------

function realDeps() {
  const pool = require('../../../config/database');
  const logger = require('../../../utils/logger');
  const flow = require('../../conversation/conversation.flow');
  const ClinicModel = require('../../industries/clinic/clinic.model');
  return {
    now: () => new Date(),
    state: { get: flow.getFlow, set: flow.setFlow, clear: flow.clearFlow },
    clinic: {
      listDoctors: async (tenantId) => (await ClinicModel.getDoctors(pool, tenantId)) || [],
      getSlots: async (tenantId, doctor, dateStr) => ClinicModel.getAvailableSlots(pool, tenantId, doctor.id, dateStr, ClinicModel.getVisitLengthMinutes(doctor.avg_consultation_minutes)),
      visitMinutes: (doctor) => ClinicModel.getVisitLengthMinutes(doctor.avg_consultation_minutes),
      createAppointment: (tenantId, doctorId, input) => ClinicModel.createAppointmentBooking(pool, tenantId, doctorId, input)
    },
    db: {
      listPatients: async (tenantId, customerId) => (await pool.query(
        'SELECT id, name FROM patients WHERE tenant_id = $1 AND customer_id = $2 ORDER BY name ASC LIMIT 9', [tenantId, customerId]
      )).rows,
      hasSameDayBooking: async (tenantId, doctorId, dateStr, patientId) => (await pool.query(
        `SELECT 1 FROM bookings WHERE tenant_id = $1 AND doctor_id = $2 AND booking_date = $3 AND patient_id = $4
         AND status NOT IN ('cancelled', 'noshow', 'completed') LIMIT 1`, [tenantId, doctorId, dateStr, patientId]
      )).rows.length > 0
    },
    log: logger
  };
}

let sharedFlow = null;
const getFlow = () => (sharedFlow || (sharedFlow = createFlow(realDeps())));

// Sends the specs of one reply and records them in the conversation like the other webhook replies
async function deliver(ctx, specs, io) {
  for (const spec of specs) {
    if (spec.type === 'escalate') {
      await io.escalate(ctx);
      continue;
    }
    if (spec.type === 'text') await io.sendMessage(ctx.phone, spec.body);
    else if (spec.type === 'buttons') await io.sendButtons(ctx.phone, spec.body, spec.buttons);
    else if (spec.type === 'list') await io.sendDoctorList(ctx.phone, spec.body, spec.items, spec.buttonText);
    await io.recordOutbound(ctx, spec.body);
    if (spec.afterBooking) await io.afterBooking(ctx);
  }
}

/**
 * The webhook entry. Returns true when the message was handled here (the webhook then stops); false for every other message.
 * Never throws. Clinics without both switches get false (or the short "start again" text for an expired apt| button).
 */
async function handleIncoming({ tenant, context, message, source }) {
  const logger = require('../../../utils/logger');
  let flagged = false;
  try {
    const TenantService = require('../../tenant/tenant.service');
    flagged = isAppointmentBookingOn(await TenantService.getAllConfigs(tenant.id));
  } catch (err) {
    flagged = false;
  }
  const isAptId = !!message.interactiveId && APT_ID_RE.test(String(message.interactiveId));
  if (!flagged && !isAptId) return false;

  const ConversationService = require('../../conversation/conversation.service');
  const HITLService = require('../../hitl/hitl.service');
  const HITLModel = require('../../hitl/hitl.model');
  const adapter = require('./whatsapp.adapter');
  const ctx = { tenant, conversation: context.conversation, customer: context.customer, phone: message.from, source };
  const io = {
    sendMessage: adapter.sendMessage,
    sendButtons: adapter.sendButtons,
    sendDoctorList: adapter.sendDoctorList,
    recordOutbound: async (c, body) => {
      await ConversationService.saveOutboundMessage(c.conversation.id, body, 'assistant');
      HITLService.broadcastToTenant(c.tenant.id, 'new_message', {
        conversationId: c.conversation.id,
        message: { role: 'assistant', content: body, created_at: new Date().toISOString() }
      });
    },
    // The existing human handoff inside working hours; outside them only the clinic's own plain out-of-hours text (no template here)
    escalate: async (c) => {
      const settings = await HITLModel.getTenantSettings(c.tenant.id);
      if (settings && HITLService.isWithinWorkingHours(settings.working_hours)) {
        await HITLService.handleAIHandoffRequest(c.tenant, { ...c.conversation, customer_phone: c.customer?.phone || c.phone }, null);
      } else {
        const body = (settings && settings.out_of_hours_message) || 'Our clinic is closed right now. Our team will get back to you during working hours.';
        await adapter.sendMessage(c.phone, body);
        await ConversationService.saveOutboundMessage(c.conversation.id, body, 'assistant');
      }
    },
    // The clinic contact card (once per conversation) and the first-booking consent question, as after an AI token booking
    afterBooking: async (c) => {
      if (c.source !== 'meta') return;
      try {
        const pool = require('../../../config/database');
        if (c.tenant.whatsapp_number) {
          const sent = await pool.query('SELECT contact_card_sent FROM conversations WHERE id = $1', [c.conversation.id]);
          if (sent.rows[0]?.contact_card_sent !== true) {
            await require('./whatsapp.meta').sendContact(c.phone, c.tenant.name, c.tenant.whatsapp_number);
            await pool.query('UPDATE conversations SET contact_card_sent = true WHERE id = $1', [c.conversation.id]);
          }
        }
      } catch (err) {
        logger.warn(`APT_FLOW contact_card_failed class=${(err && err.name) || 'Error'}`);
      }
      require('../../consent/consent.service').askConsentOnce(c.tenant, c.customer?.id, c.phone, c.tenant.name, c.conversation.id).catch(() => {});
    }
  };

  try {
    const result = await getFlow().handle(ctx, message, flagged);
    if (!result.handled) return false;
    await ConversationService.saveInboundMessage(ctx.conversation.id, message.message, message.type || 'text');
    HITLService.broadcastToTenant(tenant.id, 'new_message', {
      conversationId: ctx.conversation.id,
      message: { role: 'user', content: message.message, created_at: new Date().toISOString() }
    });
    await deliver(ctx, result.specs, io);
    return true;
  } catch (err) {
    logger.error(`APT_FLOW error class=${(err && (err.name || err.code)) || 'Error'} tenant=${tenant.id}`);
    try {
      await require('../../conversation/conversation.flow').clearFlow(tenant.id, message.from);
      await adapter.sendMessage(message.from, 'Sorry, something went wrong. Please try again, or call the clinic and our team will help you.');
    } catch (sendErr) { /* nothing more to do */ }
    return true;
  }
}

/**
 * The Gemini tool start_appointment_booking(doctor_name?, preferred_text?). Returns the tool answer string the executor gives back:
 * 'DIRECT:<text>' for a plain reply, or 'DIRECT:__INTERACTIVE_SENT__::<text>' when buttons or a list were sent here.
 */
async function startFromTool(ctx, args = {}) {
  const adapter = require('./whatsapp.adapter');
  const logger = require('../../../utils/logger');
  try {
    const phone = ctx.customer?.phone;
    if (!phone) return 'DIRECT:Sorry, I could not start the booking. Please try again.';
    const flowCtx = { tenant: ctx.tenant, conversation: ctx.conversation, customer: ctx.customer, phone, source: 'meta' };
    const specs = await getFlow().startBooking(flowCtx, { doctorName: args.doctor_name, preferredText: args.preferred_text });
    const spec = specs[0] || { type: 'text', body: 'Sorry, I could not start the booking. Please try again.' };
    if (spec.type === 'buttons') {
      await adapter.sendButtons(phone, spec.body, spec.buttons);
      return `DIRECT:__INTERACTIVE_SENT__::${spec.body}`;
    }
    if (spec.type === 'list') {
      await adapter.sendDoctorList(phone, spec.body, spec.items, spec.buttonText);
      return `DIRECT:__INTERACTIVE_SENT__::${spec.body}`;
    }
    if (spec.type === 'escalate') return 'ESCALATE:appointment booking not understood';
    return `DIRECT:${spec.body}`;
  } catch (err) {
    logger.error(`APT_FLOW tool_error class=${(err && (err.name || err.code)) || 'Error'}`);
    return 'DIRECT:Sorry, I could not start the booking. Please try again, or call the clinic and our team will help you.';
  }
}

module.exports = {
  // pure helpers
  pickNearestSlots, resolveTarget, formatTimeLabel, formatDateLabel, bookableSlots, buildTimeButtons, buildDayButtons, buildMenuButtons,
  cleanPatientName, istNowParts, addDaysStr, toMinutes,
  // the state machine (injectable) and the real wiring
  createFlow, handleIncoming, startFromTool
};
