import React, { useState, useEffect, useRef } from 'react';
import api from '../utils/api';
import { getDoctorSchedule, getProcedures, getAvailableSlots, scheduleProcedureBooking, scheduleAppointmentBooking } from '../services/clinic.service';
import LoadError from './LoadError';
import { getErrorMessage } from '../utils/errorMessage';
import { plural } from '../utils/plural';

// ONE staff booking form for the Bookings page. What it books decides the last step:
//   token clinic + visit     -> "Now" (issue a token today) or "Pick a session"  -> POST /bookings/manual
//   appointment clinic+visit -> date + free time                                 -> scheduleAppointmentBooking
//   procedure (any clinic)   -> procedure + date + free slot                     -> scheduleProcedureBooking
// onBooked(result) is called after a save: { kind: 'token_now' | 'token_session' | 'appointment' | 'procedure', booking? }.
// The page closes the form, refreshes its list and shows the receipt or the toast.

// Phone fields take digits, spaces and a leading "+" (the backend checks and normalises the number)
const PHONE_HELP = '10 digits for India, or + and the country code for other countries';
const cleanPhoneInput = (value) => {
  const text = String(value).replace(/[^\d+\s]/g, '');
  return ((text.startsWith('+') ? '+' : '') + text.replace(/\+/g, '')).slice(0, 16);
};
// The patient lookup starts when the number looks complete: 10 or more digits, or "+" and 8 or more digits (spaces ignored)
const phoneReadyForLookup = (value) => {
  const text = String(value).trim();
  const digits = text.replace(/\D/g, '').length;
  return text.startsWith('+') ? digits >= 8 : digits >= 10;
};

const todayISTString = () => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const clockText = (t) => {
  const [h, m] = t.toString().split(':');
  const hr = parseInt(h);
  return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
};

const INPUT = 'w-full border border-ink/[0.12] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand';
const LABEL = 'block text-sm font-medium text-ink/80 mb-1';

const emptyForm = () => ({
  phone: '', name: '', doctorId: '',
  type: 'visit',            // 'visit' | 'procedure'
  tokenWhen: 'now',         // token clinic visit: 'now' | 'session'
  date: todayISTString(), session: '', time: '', procedureId: '',
  notes: '', consent: '', isPresent: true, sendWhatsapp: true
});

const PATH_LABELS = {
  tokenNow: 'Issue token',
  appointment: 'Book appointment',
  tokenSession: 'Schedule booking',
  procedure: 'Schedule procedure'
};

export default function BookingForm({
  open, onClose, onBooked,
  bookingMode,              // 'token' | 'appointment' (only used when modeStatus is 'ready')
  modeStatus = 'ready',     // 'loading' | 'ready' | 'error'
  onRetryMode,
  doctors = [],
  staffRole,
  ownDoctorId,
  // Optional: book for a known patient. { phone, name, customerId, patientId, doctorId } - the patient section is then read-only
  // (no lookup, no patient picker, no consent change) and a procedure is booked with customer_id and patient_id instead of the phone.
  prefill
}) {
  const [f, setF] = useState(emptyForm);
  const set = (patch) => setF(prev => ({ ...prev, ...patch }));
  const [patients, setPatients] = useState([]);
  const [procedures, setProcedures] = useState([]);
  const [proceduresError, setProceduresError] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [sessionsError, setSessionsError] = useState(false);
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsLoaded, setSlotsLoaded] = useState(false);
  const [slotsError, setSlotsError] = useState(false);
  const [reload, setReload] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const submitRef = useRef(false);
  const phoneRef = useRef('');

  const modeReady = modeStatus === 'ready' && (bookingMode === 'token' || bookingMode === 'appointment');

  // The doctor role only books for their own doctor
  const baseDoctors = staffRole === 'doctor' && ownDoctorId ? doctors.filter(d => d.id === ownDoctorId) : doctors;

  const isProcedure = f.type === 'procedure' && procedures.length > 0;
  const path = isProcedure
    ? 'procedure'
    : bookingMode === 'appointment'
      ? 'appointment'
      : (f.tokenWhen === 'now' ? 'tokenNow' : 'tokenSession');

  // "Issue a token now" only offers doctors who are available today and right now (as the old New booking form did)
  const doctorOptions = path === 'tokenNow' ? baseDoctors.filter(d => d.available_today && d.available_now) : baseDoctors;
  const optionIds = doctorOptions.map(d => d.id).join(',');
  const doctor = doctorOptions.find(d => d.id === f.doctorId) || null;
  const procedure = procedures.find(p => p.id === f.procedureId) || null;

  // A fresh form every time it opens
  useEffect(() => {
    if (!open) return;
    setF(prefill
      ? { ...emptyForm(), phone: prefill.phone || '', name: prefill.name || '', doctorId: prefill.doctorId || '' }
      : emptyForm());
    setPatients([]);
    setError('');
    setSubmitting(false);
    submitRef.current = false;
    phoneRef.current = '';
  }, [open]);

  // One doctor: chosen automatically (the field is hidden). A chosen doctor that is no longer offered is cleared.
  useEffect(() => {
    if (!open) return;
    const ids = optionIds ? optionIds.split(',') : [];
    setF(prev => {
      if (ids.length === 1) {
        return prev.doctorId === ids[0] ? prev : { ...prev, doctorId: ids[0], session: '', time: '', procedureId: '', type: 'visit' };
      }
      if (prev.doctorId && !ids.includes(prev.doctorId)) {
        return { ...prev, doctorId: '', session: '', time: '', procedureId: '', type: 'visit' };
      }
      return prev;
    });
  }, [open, optionIds]);

  // The procedures of the chosen doctor
  useEffect(() => {
    if (!open || !f.doctorId) { setProcedures([]); setProceduresError(false); return undefined; }
    let cancelled = false;
    setProceduresError(false);
    getProcedures(f.doctorId)
      .then(res => { if (!cancelled) setProcedures(Array.isArray(res?.data) ? res.data : []); })
      .catch(() => { if (!cancelled) { setProcedures([]); setProceduresError(true); } });
    return () => { cancelled = true; };
  }, [open, f.doctorId]);

  // Sessions of that doctor on the chosen weekday (token clinic, "Pick a session")
  useEffect(() => {
    if (!open || path !== 'tokenSession' || !f.doctorId || !f.date) {
      setSessions([]); setSessionsLoaded(false); setSessionsError(false); setSessionsLoading(false);
      return undefined;
    }
    let cancelled = false;
    setSessionsLoading(true);
    setSessionsLoaded(false);
    setSessionsError(false);
    getDoctorSchedule(f.doctorId)
      .then(res => {
        if (cancelled) return;
        const dow = new Date(f.date + 'T00:00:00').getDay();
        const list = (res?.data || []).filter(s => s.day_of_week === dow && s.is_available);
        setSessions(list);
        setSessionsLoaded(true);
        setF(prev => (list.some(s => s.start_time === prev.session) ? prev : { ...prev, session: '' }));
      })
      .catch(() => { if (!cancelled) { setSessions([]); setSessionsError(true); } })
      .finally(() => { if (!cancelled) setSessionsLoading(false); });
    return () => { cancelled = true; };
  }, [open, path, f.doctorId, f.date, reload]);

  // Free times of that doctor and date: the visit length for an appointment, the procedure length for a procedure
  const slotKind = path === 'appointment' ? 'appointment' : (path === 'procedure' && procedure ? 'procedure' : null);
  useEffect(() => {
    if (!open || !slotKind || !f.doctorId || !f.date) {
      setSlots([]); setSlotsLoaded(false); setSlotsError(false); setSlotsLoading(false);
      return undefined;
    }
    let cancelled = false;
    setSlotsLoading(true);
    setSlotsLoaded(false);
    setSlotsError(false);
    const request = slotKind === 'procedure'
      ? getAvailableSlots(f.doctorId, f.date, procedure.duration_minutes)
      : getAvailableSlots(f.doctorId, f.date);
    request
      .then(res => {
        if (cancelled) return;
        const list = Array.isArray(res?.data) ? res.data : [];
        setSlots(list);
        setSlotsLoaded(true);
        setF(prev => (list.includes(prev.time) ? prev : { ...prev, time: '' }));
      })
      .catch(() => { if (!cancelled) { setSlots([]); setSlotsError(true); } })
      .finally(() => { if (!cancelled) setSlotsLoading(false); });
    return () => { cancelled = true; };
  }, [open, slotKind, f.doctorId, f.date, f.procedureId, reload]);

  const handlePhone = async (value) => {
    const typed = cleanPhoneInput(value);
    phoneRef.current = typed;
    set({ phone: typed });
    setPatients([]);
    if (!phoneReadyForLookup(typed)) return;
    try {
      const res = await api.get(`/bookings/lookup?phone=${encodeURIComponent(typed.trim())}`);
      if (phoneRef.current !== typed) return; // the number changed while the lookup ran
      const customer = res?.data?.customer || null;
      const found = res?.data?.patients || [];
      setPatients(found);
      if (found.length === 1) setF(prev => (prev.name.trim() ? prev : { ...prev, name: found[0].name }));
      else if (found.length === 0 && customer?.name) setF(prev => (prev.name.trim() ? prev : { ...prev, name: customer.name }));
    } catch { /* no lookup result: staff types the name */ }
  };

  const slotModeNeedsReload = path === 'appointment' || path === 'procedure';

  const canSubmit = modeReady && !submitting
    && phoneReadyForLookup(f.phone) && !!f.name.trim() && !!f.doctorId
    && (
      path === 'tokenNow'
      || (path === 'tokenSession' && !!f.date && sessionsLoaded && sessions.length > 0 && !!f.session)
      || (path === 'appointment' && !!f.date && !!f.time)
      || (path === 'procedure' && !!f.procedureId && !!f.date && !!f.time)
    );

  const submit = async () => {
    if (submitRef.current) return;
    setError('');
    if (!phoneReadyForLookup(f.phone)) { setError('Enter a valid phone number: 10 digits for India, or + and the country code for other countries.'); return; }
    if (!f.name.trim()) { setError('Enter the patient name.'); return; }
    if (!f.doctorId) { setError('Choose a doctor.'); return; }
    if (path === 'tokenSession' && !f.session) { setError('Choose a session.'); return; }
    if (path === 'appointment' && !f.time) { setError('Choose a free time.'); return; }
    if (path === 'procedure' && (!f.procedureId || !f.time)) { setError('Choose a procedure and a free time.'); return; }
    submitRef.current = true;
    setSubmitting(true);
    try {
      const phone = f.phone.trim(); // as typed: the backend normalises it
      const name = f.name.trim();
      const notes = f.notes.trim();
      let result;
      if (path === 'tokenNow') {
        const body = { patientName: name, patientPhone: phone, doctorId: f.doctorId, notes, isPresent: f.isPresent, sendWhatsapp: f.sendWhatsapp };
        if (f.consent) body.marketing_consent = f.consent;
        const res = await api.post('/bookings/manual', body);
        result = { kind: 'token_now', booking: res?.data || null };
      } else if (path === 'tokenSession') {
        const body = { patientPhone: phone, patientName: name, doctorId: f.doctorId, bookingDate: f.date, slot_time: f.session || null, notes, isPresent: false, sendWhatsapp: f.sendWhatsapp };
        if (f.consent) body.marketing_consent = f.consent;
        await api.post('/bookings/manual', body);
        result = { kind: 'token_session' };
      } else if (path === 'appointment') {
        const body = { patient_name: name, phone, date: f.date, start_time: f.time, notes, send_whatsapp: f.sendWhatsapp === true };
        if (f.consent) body.marketing_consent = f.consent;
        await scheduleAppointmentBooking(f.doctorId, body);
        result = { kind: 'appointment' };
      } else {
        const [h, m] = f.time.split(':').map(Number);
        const endMins = h * 60 + m + procedure.duration_minutes;
        const endH = Math.floor(endMins / 60).toString().padStart(2, '0');
        const endM = (endMins % 60).toString().padStart(2, '0');
        // A known patient (prefill): their real ids, no phone. Otherwise no ids: the backend finds or creates them from the phone.
        const body = {
          procedure_id: f.procedureId,
          patient_name: name,
          date: f.date,
          start_time: f.time,
          end_time: `${endH}:${endM}`,
          send_whatsapp: f.sendWhatsapp === true
        };
        if (prefill?.customerId) {
          body.customer_id = prefill.customerId;
          if (prefill.patientId) body.patient_id = prefill.patientId;
        } else {
          body.phone = phone;
        }
        await scheduleProcedureBooking(f.doctorId, body);
        result = { kind: 'procedure' };
      }
      onBooked(result);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not save, please try again.'));
      // The time may have been taken meanwhile: show the current free times again
      if (slotModeNeedsReload || path === 'tokenSession') setReload(n => n + 1);
    } finally {
      submitRef.current = false;
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const doctorLabel = (d) => (path === 'tokenNow'
    ? `${d.name}${d.specialization ? ` (${d.specialization})` : ''}${d.max_tokens_daily > 0 ? ` - max ${plural(d.max_tokens_daily, 'token')}` : ''}`
    : d.name);

  const fmtSession = (t) => (t ? clockText(t) : '');

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-xl font-bold text-ink">New booking</h2>
          <button onClick={onClose} disabled={submitting} className="text-ink/40 hover:text-ink/65 text-2xl font-bold disabled:opacity-50">×</button>
        </div>

        {modeStatus === 'loading' && <p className="text-sm text-ink/40">Loading...</p>}
        {modeStatus === 'error' && (
          <LoadError message="Could not load the clinic settings. Try again." onRetry={onRetryMode} />
        )}

        {modeReady && (
          <div className="space-y-4">
            {error && <div className="bg-red-50 text-red-600 text-sm px-3 py-2 rounded-lg">{error}</div>}

            {/* 1. Patient */}
            {prefill ? (
              <div>
                <label className={LABEL}>Patient</label>
                <p className="text-sm text-ink"><span className="font-medium">{f.name}</span>{f.phone ? <span className="text-ink/55">, {f.phone}</span> : null}</p>
              </div>
            ) : (
              <div>
                <label className={LABEL}>Patient Phone</label>
                <input type="tel" maxLength={16} value={f.phone} disabled={submitting}
                  onChange={e => handlePhone(e.target.value)}
                  className={INPUT}
                  placeholder="9876543210 or +971501234567" />
                <p className="text-xs text-ink/50 mt-1">{PHONE_HELP}</p>
              </div>
            )}
            {!prefill && patients.length > 1 && (
              <div>
                <label className={LABEL}>Patients with this number</label>
                <select defaultValue="" disabled={submitting}
                  onChange={e => set({ name: e.target.value === '__new__' ? '' : e.target.value })}
                  className={INPUT}>
                  <option value="" disabled>Choose a patient</option>
                  {patients.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                  <option value="__new__">New patient (type the name below)</option>
                </select>
              </div>
            )}
            {!prefill && (
              <div>
                <label className={LABEL}>Patient Name</label>
                <input type="text" value={f.name} disabled={submitting}
                  onChange={e => set({ name: e.target.value })}
                  className={INPUT}
                  placeholder="Patient name" />
              </div>
            )}

            {/* 2. Doctor */}
            {doctorOptions.length > 1 && (
              <div>
                <label className={LABEL}>Doctor</label>
                <select value={f.doctorId} disabled={submitting}
                  onChange={e => set({ doctorId: e.target.value, session: '', time: '', procedureId: '', type: 'visit' })}
                  className={INPUT}>
                  <option value="">Select doctor</option>
                  {doctorOptions.map(d => <option key={d.id} value={d.id}>{doctorLabel(d)}</option>)}
                </select>
              </div>
            )}
            {doctorOptions.length === 1 && (
              <p className="text-sm text-ink/65">Doctor: <span className="font-medium text-ink">{doctorOptions[0].name}</span></p>
            )}
            {doctorOptions.length === 0 && (
              <p className="text-sm text-red-500">
                {path === 'tokenNow' ? 'No doctor is available right now. Choose "Pick a session" to book a later time.' : 'No doctors found.'}
              </p>
            )}

            {/* 3. Booking type */}
            {f.doctorId && procedures.length > 0 && (
              <div>
                <label className={LABEL}>Booking type</label>
                <div className="flex rounded-lg border border-ink/[0.12] overflow-hidden">
                  {[['visit', 'Visit'], ['procedure', 'Procedure']].map(([value, label]) => (
                    <button key={value} type="button" disabled={submitting}
                      onClick={() => set({ type: value, time: '', session: '', procedureId: '' })}
                      className={`flex-1 px-3 py-2 text-sm font-medium transition ${f.type === value ? 'bg-brand text-white' : 'bg-white text-ink/65 hover:bg-ink/[0.03]'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {f.doctorId && proceduresError && (
              <p className="text-xs text-amber-600">Could not load this doctor's procedures, so only visits can be booked.</p>
            )}

            {/* 4. Last step */}
            {path === 'tokenNow' || path === 'tokenSession' ? (
              <div>
                <label className={LABEL}>When</label>
                <div className="flex rounded-lg border border-ink/[0.12] overflow-hidden">
                  {[['now', 'Now (issue a token today)'], ['session', 'Pick a session']].map(([value, label]) => (
                    <button key={value} type="button" disabled={submitting}
                      onClick={() => set({ tokenWhen: value, session: '' })}
                      className={`flex-1 px-3 py-2 text-sm font-medium transition ${f.tokenWhen === value ? 'bg-brand text-white' : 'bg-white text-ink/65 hover:bg-ink/[0.03]'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {path === 'procedure' && (
              <div>
                <label className={LABEL}>Procedure</label>
                <select value={f.procedureId} disabled={submitting}
                  onChange={e => set({ procedureId: e.target.value, time: '' })}
                  className={INPUT}>
                  <option value="">Select procedure</option>
                  {procedures.map(p => <option key={p.id} value={p.id}>{p.name} ({p.duration_minutes} min)</option>)}
                </select>
              </div>
            )}

            {path !== 'tokenNow' && (
              <div>
                <label className={LABEL}>Date</label>
                <input type="date" value={f.date} disabled={submitting}
                  min={path === 'tokenSession' ? undefined : todayISTString()}
                  onChange={e => set({ date: e.target.value, time: '', session: '' })}
                  className={INPUT} />
              </div>
            )}

            {path === 'tokenSession' && f.doctorId && f.date && (
              <div>
                <label className={LABEL}>Session</label>
                {sessionsLoading ? (
                  <p className="text-sm text-ink/40">Loading sessions...</p>
                ) : sessionsError ? (
                  <LoadError message="Could not load the sessions." onRetry={() => setReload(n => n + 1)} />
                ) : sessionsLoaded && sessions.length === 0 ? (
                  <p className="text-sm text-red-500 font-medium">No sessions available on this date. Please select another date.</p>
                ) : (
                  <select value={f.session} disabled={submitting}
                    onChange={e => set({ session: e.target.value })}
                    className={INPUT}>
                    <option value="">Select session</option>
                    {sessions.map((s, i) => <option key={i} value={s.start_time}>{fmtSession(s.start_time)} – {fmtSession(s.end_time)}</option>)}
                  </select>
                )}
              </div>
            )}

            {path === 'appointment' && doctor && (() => {
              const minutes = parseInt(doctor.avg_consultation_minutes, 10) > 0 ? parseInt(doctor.avg_consultation_minutes, 10) : 15;
              return <p className="text-xs text-ink/55">Visit length: {minutes} min (set per doctor on the Doctors page)</p>;
            })()}

            {slotKind && f.doctorId && f.date && (
              <div>
                <label className={LABEL}>{slotKind === 'procedure' ? 'Available Slot' : 'Time'}</label>
                {slotsLoading ? (
                  <p className="text-sm text-ink/40">Loading free times...</p>
                ) : slotsError ? (
                  <LoadError message="Could not load the free times." onRetry={() => setReload(n => n + 1)} />
                ) : slotsLoaded && slots.length === 0 ? (
                  <p className="text-sm text-red-500">No free times for this doctor on this date.</p>
                ) : (
                  <select value={f.time} disabled={submitting}
                    onChange={e => set({ time: e.target.value })}
                    className={INPUT}>
                    <option value="">Select time</option>
                    {slots.map(s => <option key={s} value={s}>{clockText(s)}</option>)}
                  </select>
                )}
              </div>
            )}

            {path === 'tokenNow' && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={f.isPresent} disabled={submitting}
                  onChange={e => set({ isPresent: e.target.checked })}
                  className="w-4 h-4 rounded accent-accent" />
                <span className="text-sm font-medium text-ink/80">Patient is here now</span>
              </label>
            )}

            {/* 5. Common bottom */}
            {path !== 'procedure' && (
              <div>
                <label className={LABEL}>Notes (optional)</label>
                <textarea rows={2} value={f.notes} disabled={submitting}
                  onChange={e => set({ notes: e.target.value })}
                  className={`${INPUT} resize-none`} />
              </div>
            )}

            {path !== 'procedure' && !prefill && (
              <div>
                <label className={LABEL}>WhatsApp updates</label>
                <select value={f.consent} disabled={submitting}
                  onChange={e => set({ consent: e.target.value })}
                  className={INPUT}>
                  <option value="">Not asked</option>
                  <option value="all">Checkups + offers</option>
                  <option value="checkups">Checkups only</option>
                  <option value="none">No updates</option>
                </select>
                <p className="text-xs text-ink/40 mt-1">Only choose if the patient agreed when asked at reception.</p>
              </div>
            )}

            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={f.sendWhatsapp} disabled={submitting}
                  onChange={e => set({ sendWhatsapp: e.target.checked })}
                  className="w-4 h-4 rounded accent-accent" />
                <span className="text-sm font-medium text-ink/80">Send WhatsApp confirmation to the patient</span>
              </label>
              <p className="text-xs text-ink/40 mt-1">The patient gets an approved WhatsApp message with the booking details.</p>
            </div>

            <button
              onClick={submit}
              disabled={!canSubmit}
              className="w-full bg-brand text-white py-2.5 rounded-lg font-bold hover:bg-brand-hover transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Saving...' : PATH_LABELS[path]}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
