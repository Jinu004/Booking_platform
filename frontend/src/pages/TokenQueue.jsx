import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { getQueue, updateTokenStatus, setAppointmentQueueStatus } from '../services/clinic.service';
import { completeBooking } from '../services/booking.service';
import { getStoredStaff } from '../services/auth.service';
import { plural } from '../utils/plural';
import { doctorInitial } from '../utils/doctorName';
import { getErrorMessage } from '../utils/errorMessage';
import LoadError from '../components/LoadError';
import NewBookingModal from '../components/NewBookingModal';
import usePollWhileVisible from '../hooks/usePollWhileVisible';
import useStore from '../store/useStore';

// The queue serves token bookings and appointment bookings from one list. queue_status is waiting | arrived | in_consult | done.
// The pill keeps the page's existing wording and colours: waiting = "Booked", arrived = "Waiting", in_consult = "In Consult", done = "Done".
const PILL_STATUS = { waiting: 'waiting', arrived: 'arrived', in_consult: 'in_progress', done: 'done' };

const getStatusPill = (status) => {
  switch (status) {
    case 'waiting': case 'pending':
      return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-ink/[0.05] text-ink/65">Booked</span>;
    case 'arrived':
      return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">Waiting</span>;
    case 'in_progress':
      return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">In Consult</span>;
    case 'done': case 'completed':
      return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">Done</span>;
    case 'cancelled':
      return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800">Cancelled</span>;
    default:
      return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-ink/[0.05] text-ink/65">{status}</span>;
  }
};

// "14:05" -> "2:05 PM"; null for a missing or malformed time
const fmtClock = (t) => {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  return `${h > 12 ? h - 12 : h || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

// "HH:MM" -> minutes since midnight; null when missing or malformed
const minutesOf = (t) => {
  const match = /^([01]?[0-9]|2[0-3]):([0-5][0-9])/.exec(String(t || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

// The current time in India as minutes since midnight (null if the time zone is not available)
const nowMinutesIST = () => {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    const h = Number(parts.find(p => p.type === 'hour')?.value) % 24;
    const m = Number(parts.find(p => p.type === 'minute')?.value);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
  } catch {
    return null;
  }
};

const isTokenRow = (r) => r.token_number !== null && r.token_number !== undefined;

// Token rows keep the order the old token endpoint gave: by slot_time (missing last), then token number
const sortTokenRows = (rows) => [...rows].sort((a, b) => {
  const sa = a.slot_time || null;
  const sb = b.slot_time || null;
  if (sa !== sb) {
    if (sa === null) return 1;
    if (sb === null) return -1;
    return sa < sb ? -1 : 1;
  }
  return (a.token_number || 0) - (b.token_number || 0);
});

const LATE_AFTER_MINUTES = 10;

// Secondary actions behind a row's "⋯" button (only undo steps for now; extend this list to add more, e.g. No-show or Skip).
// Each item: { key, label, run } where run() returns the request promise. A row with an empty list shows no "⋯" button.
const getSecondaryActions = (t, tokenRow) => {
  if (t.queue_status === 'arrived') {
    return [{
      key: 'undo_arrived',
      label: 'Undo arrived',
      run: () => (tokenRow ? updateTokenStatus(t.token_id, 'waiting') : setAppointmentQueueStatus(t.id, 'waiting'))
    }];
  }
  if (t.queue_status === 'in_consult') {
    return [{
      key: 'undo_call_in',
      label: 'Undo call-in',
      run: () => (tokenRow ? updateTokenStatus(t.token_id, 'arrived') : setAppointmentQueueStatus(t.id, 'arrived'))
    }];
  }
  return [];
};

const TokenQueue = () => {
  const [queue, setQueue] = useState([]);
  const [activeFilter, setActiveFilter] = useState('all');
  const [loadingId, setLoadingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [doctorFilter, setDoctorFilter] = useState('all');
  const [collapsedSessions, setCollapsedSessions] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [loadError, setLoadError] = useState('');   // the last load failed
  const [hasLoaded, setHasLoaded] = useState(false); // a load has worked at least once, so there is good data to keep on screen
  const [bookingOpen, setBookingOpen] = useState(false);
  const { addToast } = useStore();

  // The row whose "⋯" strip is open: { id, status } (the status it had when opened). Only one strip is open at a time.
  const [openMore, setOpenMore] = useState(null);
  const moreButtons = useRef({}); // row id -> its "⋯" button, so focus can return to it

  const closeMore = (focusButton) => {
    const id = openMore ? openMore.id : null;
    setOpenMore(null);
    if (focusButton && id && moreButtons.current[id]) moreButtons.current[id].focus();
  };

  // A refresh in which the row's status changed (or the row is gone) closes the strip; a refresh with the same status keeps it open
  useEffect(() => {
    if (openMore === null) return;
    const row = queue.find(r => r.id === openMore.id);
    if (!row || row.queue_status !== openMore.status) setOpenMore(null);
  }, [queue, openMore]);

  // Escape closes the open strip and returns focus to its button
  useEffect(() => {
    if (openMore === null) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpenMore(null);
        if (moreButtons.current[openMore.id]) moreButtons.current[openMore.id].focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openMore]);

  const staff = getStoredStaff();
  const isDoctor = staff?.role === 'doctor';
  const staffDoctorId = isDoctor ? staff?.doctor_id : null;

  // Counts the requests: an answer that arrives after a newer request was started is ignored (a slow poll must not overwrite fresher data)
  const fetchSeqRef = useRef(0);
  const fetchQueue = async () => {
    const seq = ++fetchSeqRef.current;
    try {
      const res = await getQueue();
      if (seq !== fetchSeqRef.current) return;
      const rows = res?.data || [];
      setQueue(isDoctor ? rows.filter(t => t.doctor_id === staffDoctorId) : rows);
      setLoadError('');
      setHasLoaded(true);
    } catch (err) {
      if (seq !== fetchSeqRef.current) return;
      // The last good data stays on screen; it is replaced by an error only while there is none
      setLoadError(getErrorMessage(err, 'Could not load the queue. Try again.'));
    }
    finally { if (seq === fetchSeqRef.current) setLoading(false); }
  };

  useEffect(() => {
    fetchQueue();
  }, []);
  // Refreshes every 15 s while the tab is visible; paused when hidden, refreshed once when it is shown again
  usePollWhileVisible(fetchQueue, 15000);

  // One status action: a failure shows the server's message in a toast; the list is refreshed either way
  const runAction = async (row, action) => {
    setLoadingId(row.id);
    try {
      await action();
    } catch (err) {
      addToast(getErrorMessage(err, 'Could not update this patient. Try again.'), 'error');
    } finally {
      await fetchQueue();
      setLoadingId(null);
    }
  };

  const doctors = [...new Set(queue.map(t => t.doctor_name))].filter(Boolean);

  const statusMatches = (t) => (
    activeFilter === 'all' ? t.queue_status !== 'done'
      : activeFilter === 'arrived' ? t.queue_status === 'arrived'
        : activeFilter === 'in_consult' ? t.queue_status === 'in_consult'
          : t.queue_status === 'done'
  );

  const filteredRows = queue
    .filter(statusMatches)
    .filter(t => doctorFilter === 'all' || t.doctor_name === doctorFilter)
    .filter(t => !searchQuery || (t.patient_name || '').toLowerCase().includes(searchQuery.toLowerCase()) || (t.patient_phone || '').includes(searchQuery));

  // Token rows in the old order, appointment rows in the order the server gives (doctor, status, time)
  const tokenRows = sortTokenRows(filteredRows.filter(isTokenRow));
  const appointmentRows = filteredRows.filter(r => !isTokenRow(r));

  // "Up next": per doctor with nobody in consult, the first arrived row (else the first waiting row) in list order
  const upNextIds = new Set();
  {
    const ordered = [...sortTokenRows(queue.filter(isTokenRow)), ...queue.filter(r => !isTokenRow(r))];
    const byDoctor = {};
    ordered.forEach(r => { (byDoctor[r.doctor_id] = byDoctor[r.doctor_id] || []).push(r); });
    Object.values(byDoctor).forEach(rows => {
      if (rows.some(r => r.queue_status === 'in_consult')) return;
      const next = rows.find(r => r.queue_status === 'arrived') || rows.find(r => r.queue_status === 'waiting');
      if (next) upNextIds.add(next.id);
    });
  }
  const nowMins = nowMinutesIST();

  const count = (status) => queue.filter(t => t.queue_status === status).length;
  const tabs = [
    { key: 'all', label: 'All', count: queue.length },
    { key: 'arrived', label: 'Waiting', count: count('arrived') },
    { key: 'in_consult', label: 'In Consult', count: count('in_consult') },
    { key: 'done', label: 'Done', count: count('done') },
  ];

  const doctorBusy = (t) => queue.some(x => x.doctor_id === t.doctor_id && x.queue_status === 'in_consult');

  const renderRow = (t) => {
    const tokenRow = isTokenRow(t);
    const clock = fmtClock(t.slot_time);
    const clockParts = clock ? clock.split(' ') : null;
    const endClock = fmtClock(t.end_time);
    const startMins = minutesOf(t.slot_time);
    const isLate = !tokenRow && t.queue_status === 'waiting' && startMins !== null && nowMins !== null && nowMins - startMins > LATE_AFTER_MINUTES;
    const busy = loadingId === t.id;
    const btn = 'px-3 md:px-4 py-1.5 md:py-2 text-xs md:text-sm font-semibold text-white rounded-lg disabled:opacity-50 transition';
    const secondary = getSecondaryActions(t, tokenRow);
    const moreOpen = openMore !== null && openMore.id === t.id && secondary.length > 0;
    return (
      <div key={t.id}>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 px-3 md:px-6 py-4 md:py-5 hover:bg-ink/[0.02] transition">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          {tokenRow ? (
            <div className="w-10 h-10 md:w-14 md:h-14 bg-ink/[0.05] rounded-xl flex items-center justify-center font-mono font-semibold text-ink text-sm md:text-base flex-shrink-0">
              {t.doctor_name ? doctorInitial(t.doctor_name) : '?'}-{t.token_number}
            </div>
          ) : (
            <div className="w-10 h-10 md:w-14 md:h-14 bg-ink/[0.05] rounded-xl flex flex-col items-center justify-center font-mono font-semibold text-ink leading-tight flex-shrink-0">
              <span className="text-[11px] md:text-sm">{clockParts ? clockParts[0] : '—'}</span>
              {clockParts && <span className="text-[9px] md:text-[10px] text-ink/50">{clockParts[1]}</span>}
            </div>
          )}
          <div className="min-w-0">
            <p className="font-semibold text-ink text-base truncate">{t.patient_name || 'Walk-in'}</p>
            <p className="text-sm text-ink/60 font-medium">{t.doctor_name}</p>
            {t.patient_phone && <p className="text-xs text-ink/40">{t.patient_phone}</p>}
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {tokenRow
                ? (clock && <span className="text-xs text-ink/40">🕘 {clock}</span>)
                : (clock && <span className="text-xs text-ink/40">{clock}{endClock ? ` - ${endClock}` : ''}</span>)}
              {t.source === 'walkin' ? (
                <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-semibold">Walk-in</span>
              ) : t.source === 'whatsapp' ? (
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">WhatsApp</span>
              ) : null}
              {upNextIds.has(t.id) && (
                <span className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded-full font-semibold">Up next</span>
              )}
              {isLate && (
                <span className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold">Late</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:gap-3 pl-14 md:pl-0 md:flex-shrink-0">
          {getStatusPill(PILL_STATUS[t.queue_status] || t.queue_status)}
          {t.queue_status === 'waiting' && (
            <button
              disabled={busy}
              onClick={() => runAction(t, () => (tokenRow ? updateTokenStatus(t.token_id, 'arrived') : setAppointmentQueueStatus(t.id, 'arrived')))}
              className={`${btn} bg-amber-500 hover:bg-amber-600`}
            >{busy ? '...' : 'Mark arrived'}</button>
          )}
          {(t.queue_status === 'arrived' || (!tokenRow && t.queue_status === 'waiting')) && (
            <button
              disabled={busy || doctorBusy(t)}
              onClick={() => runAction(t, () => (tokenRow ? updateTokenStatus(t.token_id, 'in_progress') : setAppointmentQueueStatus(t.id, 'in_consult')))}
              className={`${btn} bg-blue-500 hover:bg-blue-600`}
            >{busy ? '...' : 'Call in'}</button>
          )}
          {t.queue_status === 'in_consult' && (
            <button
              disabled={busy}
              onClick={() => runAction(t, () => (tokenRow ? updateTokenStatus(t.token_id, 'completed') : completeBooking(t.id)))}
              className={`${btn} bg-green-500 hover:bg-green-600`}
            >{busy ? '...' : 'Finish'}</button>
          )}
          {(t.patient_id || t.customer_id) && (
            <Link
              to={`/patients/${t.patient_id || t.customer_id}`}
              className="px-3 md:px-4 py-1.5 md:py-2 text-xs md:text-sm font-semibold text-ink/80 border border-ink/[0.12] rounded-lg hover:bg-ink/[0.04] transition"
            >Profile</Link>
          )}
          {secondary.length > 0 && (
            <button
              type="button"
              ref={(el) => { moreButtons.current[t.id] = el; }}
              aria-label="More actions"
              aria-expanded={moreOpen}
              aria-controls={`row-more-${t.id}`}
              onClick={() => (moreOpen ? closeMore(true) : setOpenMore({ id: t.id, status: t.queue_status }))}
              className="-my-1.5 md:my-0 h-10 w-10 md:h-8 md:w-8 flex items-center justify-center rounded-lg border border-ink/[0.12] text-ink/80 hover:text-ink hover:bg-ink/[0.04] transition text-lg leading-none flex-shrink-0"
            >⋯</button>
          )}
        </div>
      </div>
      {moreOpen && (
        <div id={`row-more-${t.id}`} className="px-3 md:px-6 pb-3 md:pb-4 -mt-1">
          <div className="flex flex-wrap items-center gap-2 pl-14 md:pl-[4.5rem]">
            {secondary.map(action => (
              <button
                key={action.key}
                type="button"
                disabled={busy}
                onClick={() => { closeMore(true); runAction(t, action.run); }}
                className="px-3 py-2 md:py-1.5 min-h-[40px] md:min-h-0 text-xs md:text-sm font-semibold text-ink/80 border border-ink/[0.15] rounded-lg hover:bg-ink/[0.04] disabled:opacity-50 transition"
              >{busy ? '...' : action.label}</button>
            ))}
          </div>
        </div>
      )}
      </div>
    );
  };

  return (
    <div className="p-3 md:p-6 max-w-4xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <span className="w-3 h-3 rounded-full bg-green-500 animate-pulse inline-block flex-shrink-0"></span>
          <h1 className="text-xl md:text-[28px] font-semibold tracking-[-0.035em] text-ink whitespace-nowrap">Today's queue</h1>
          <span className="font-mono text-xs font-medium px-2 py-0.5 rounded-full bg-ink/[0.06] text-ink/70">{queue.length}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Search patient..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="px-3 py-2 text-sm border border-ink/[0.12] bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-ink/15 w-36 md:w-48"
          />
          {!isDoctor && doctors.length > 1 && (
            <select
              value={doctorFilter}
              onChange={e => setDoctorFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-ink/[0.12] bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-ink/15"
            >
              <option value="all">All Doctors</option>
              {doctors.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          <button
            type="button"
            onClick={() => setBookingOpen(true)}
            className="px-4 py-2 text-sm font-medium bg-brand text-white rounded-lg hover:bg-brand-hover transition"
          >
            + New booking
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm text-ink/55 mb-3 px-1">
        <span>Today: <strong className="text-ink">{queue.length}</strong></span>
        <span>· Waiting: <strong className="text-amber-600">{count('arrived')}</strong></span>
        <span>· In Consult: <strong className="text-blue-600">{count('in_consult')}</strong></span>
        <span>· Done: <strong className="text-green-600">{count('done')}</strong></span>
      </div>
      <div className="bg-white rounded-2xl border border-ink/[0.08] shadow-card overflow-hidden">
        <div className="flex gap-1.5 px-3 md:px-4 py-3 border-b border-ink/[0.06]">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveFilter(tab.key)}
              className={`flex-1 md:flex-none text-xs md:text-[13px] transition rounded-full px-2 md:px-3.5 py-1.5 font-medium whitespace-nowrap ${
                activeFilter === tab.key ? 'bg-accent text-white' : 'text-ink/55 hover:text-ink hover:bg-ink/[0.04]'
              }`}
            >
              {tab.label} <span className="ml-1 font-mono text-[11px] opacity-70">{tab.count}</span>
            </button>
          ))}
        </div>

        {loadError && hasLoaded && (
          <div role="alert" className="px-4 py-2 flex items-center justify-between gap-3 text-xs text-amber-700 bg-amber-50 border-b border-amber-100">
            <span>Could not load the queue. Showing the last list; retrying…</span>
            <button type="button" onClick={fetchQueue} className="font-semibold text-amber-900 underline underline-offset-2">Retry</button>
          </div>
        )}
        {loading ? (
          <div className="p-12 text-center text-sm text-ink/40">Loading queue...</div>
        ) : loadError && !hasLoaded ? (
          <div className="p-6"><LoadError message={loadError} onRetry={fetchQueue} /></div>
        ) : filteredRows.length === 0 ? (
          <div className="p-12 text-center text-sm text-ink/40">Nothing in the queue yet</div>
        ) : (
          <div className="divide-y divide-ink/[0.08]">
            {(() => {
              const tokenBlock = (() => {
                if (tokenRows.length === 0) return null;
                const uniqueSlots = [...new Set(tokenRows.map(t => t.slot_time).filter(Boolean))];
                if (uniqueSlots.length > 1 || isDoctor) {
                  const slotKeys = [...new Set(tokenRows.map(t => t.slot_time || 'walkin'))];
                  return slotKeys.map((key, ki) => {
                    const group = tokenRows.filter(t => (t.slot_time || 'walkin') === key);
                    const label = key === 'walkin' ? 'Walk-ins' : `Session ${ki + 1} — ${fmtClock(key) || key}`;
                    const allDone = group.every(t => t.queue_status === 'done');
                    const isCollapsed = collapsedSessions[key] !== undefined ? collapsedSessions[key] : allDone;
                    return (
                      <React.Fragment key={key}>
                        <div
                          className="px-4 py-2 bg-ink/[0.03] font-mono text-[11px] font-medium text-ink/55 uppercase tracking-[0.08em] border-b border-ink/[0.06] flex items-center justify-between cursor-pointer select-none"
                          onClick={() => setCollapsedSessions(prev => ({ ...prev, [key]: !isCollapsed }))}
                        >
                          <span>{label} <span className="ml-2 font-normal text-ink/40">({plural(group.length, 'patient')})</span></span>
                          <span>{isCollapsed ? '▸' : '▾'}</span>
                        </div>
                        {!isCollapsed && group.map(t => renderRow(t))}
                      </React.Fragment>
                    );
                  });
                }
                return tokenRows.map(t => renderRow(t));
              })();
              return (
                <>
                  {tokenBlock}
                  {appointmentRows.length > 0 && tokenRows.length > 0 && (
                    <div className="px-4 py-2 bg-ink/[0.03] font-mono text-[11px] font-medium text-ink/55 uppercase tracking-[0.08em] border-b border-ink/[0.06]">
                      Appointments <span className="ml-2 font-normal text-ink/40">({plural(appointmentRows.length, 'patient')})</span>
                    </div>
                  )}
                  {appointmentRows.map(t => renderRow(t))}
                </>
              );
            })()}
          </div>
        )}

        <div className="px-6 py-3 border-t border-ink/[0.06] bg-ink/[0.02] text-sm text-ink/55">
          Showing {filteredRows.length} of {plural(queue.length, 'patient')} today
        </div>
      </div>

      <NewBookingModal
        open={bookingOpen}
        onClose={() => setBookingOpen(false)}
        onSaved={fetchQueue}
      />
    </div>
  );
};

export default TokenQueue;
