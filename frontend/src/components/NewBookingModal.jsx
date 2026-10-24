import React, { useState, useEffect, useRef } from 'react';
import BookingForm from './BookingForm';
import TokenReceipt from './shared/TokenReceipt';
import { getClinicSettings } from '../services/settings.service';
import { getDoctors } from '../services/clinic.service';
import { getStoredStaff } from '../services/auth.service';
import { getBookingFormCacheKey, readBookingFormCache, writeBookingFormCache } from '../utils/bookingFormCache';
import useStore from '../store/useStore';

// The shared "New booking" modal. It owns what the form needs, so any page can use it:
//   <NewBookingModal open={open} onClose={() => setOpen(false)} onSaved={refreshThePage} />
// Optional prefill = { phone, name, customerId, patientId, doctorId } books for a known patient (see BookingForm).
// The booking mode and the doctors are loaded when the wrapper mounts and kept (also in a small cache that belongs to the logged-in
// clinic and user, see utils/bookingFormCache.js, so a remount reuses them and another login never sees them). When the form opens
// with data already loaded it shows the full form at once and refreshes the doctors (and the mode) quietly in the background;
// "loading" only shows when there is no data yet, and the retry only when the first load failed or timed out (15 seconds).
// A first load that answers after the timeout is still accepted when it is the newest request of the same login.
// A failed or timed-out background refresh keeps the data already shown.
// bookingMode is 'appointment' only when booking_mode === 'appointment' once loaded: a failed load never turns into token mode.
// After a save it closes, shows the token receipt or a short toast, then calls onSaved(result).
// Keep it mounted all the time: the receipt must stay on screen after the form has closed.
const REQUEST_TIMEOUT_MS = 15000;

export default function NewBookingModal({ open, onClose, onSaved, prefill }) {
  const { addToast } = useStore();
  const staff = getStoredStaff();
  const [initial] = useState(() => readBookingFormCache(getBookingFormCacheKey())); // empty unless it belongs to this login
  const [bookingMode, setBookingMode] = useState(initial.mode);          // null until the first successful load
  const [modeFailed, setModeFailed] = useState(false);                   // only matters while bookingMode is still null
  const [doctors, setDoctors] = useState(initial.doctors || []);
  const [doctorsLoaded, setDoctorsLoaded] = useState(initial.doctors !== null); // a doctor list (possibly empty) has been received
  const [doctorsFailed, setDoctorsFailed] = useState(false);             // only matters while no list has been received
  const [receiptBooking, setReceiptBooking] = useState(null);
  const modeRequest = useRef(0);    // only the newest settings request may set the state
  const doctorsRequest = useRef(0); // same for the doctors request
  const timers = useRef(new Set()); // the 15-second failure timers, cleared when the wrapper unmounts

  // The timeout only MARKS the load as failed (the error with Retry while there is no data). The request itself keeps going: if its
  // answer still arrives and it is the newest request of the same login, it is accepted and the error goes away. An older request
  // or an answer for another login is ignored; a failure after data exists changes nothing on screen.
  const startTimer = (id, requestRef, onTimeout) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      if (id === requestRef.current) onTimeout();
    }, REQUEST_TIMEOUT_MS);
    timers.current.add(timer);
    return timer;
  };
  const stopTimer = (timer) => {
    clearTimeout(timer);
    timers.current.delete(timer);
  };

  const loadMode = () => {
    const id = ++modeRequest.current;
    const key = getBookingFormCacheKey();
    const timer = startTimer(id, modeRequest, () => setModeFailed(true));
    getClinicSettings()
      .then(res => {
        stopTimer(timer);
        if (id !== modeRequest.current || getBookingFormCacheKey() !== key) return;
        const d = res?.data || res;
        const mode = d?.booking_mode === 'appointment' ? 'appointment' : 'token';
        writeBookingFormCache(key, { mode });
        setBookingMode(mode);
        setModeFailed(false);
      })
      .catch(() => {
        stopTimer(timer);
        if (id !== modeRequest.current) return;
        setModeFailed(true); // a failed refresh keeps the mode already loaded (the status below stays 'ready')
      });
  };

  const loadDoctors = () => {
    const id = ++doctorsRequest.current;
    const key = getBookingFormCacheKey();
    const timer = startTimer(id, doctorsRequest, () => setDoctorsFailed(true));
    getDoctors()
      .then(res => {
        stopTimer(timer);
        if (id !== doctorsRequest.current || getBookingFormCacheKey() !== key) return;
        if (Array.isArray(res?.data)) {
          writeBookingFormCache(key, { doctors: res.data });
          setDoctors(res.data);
          setDoctorsLoaded(true);
          setDoctorsFailed(false);
        } else {
          setDoctorsFailed(true);
        }
      })
      .catch(() => {
        stopTimer(timer);
        if (id !== doctorsRequest.current) return;
        setDoctorsFailed(true); // a failed refresh keeps the list already shown
      });
  };

  // The silent first load (settings + doctors) waits until the browser is idle after the page's own first load (at most 2 s, or 1.5 s
  // where requestIdleCallback does not exist). If the form is opened before that, the load starts at once (see the effect below), so the
  // loading, error and Retry behaviour the user sees does not change. The timers are cleared when the wrapper unmounts.
  const initialLoadStarted = useRef(false);
  const startInitialLoad = () => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    loadMode();
    loadDoctors();
  };
  useEffect(() => {
    let idleHandle = null;
    let timeoutHandle = null;
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(startInitialLoad, { timeout: 2000 });
    } else {
      timeoutHandle = setTimeout(startInitialLoad, 1500);
    }
    const pending = timers.current;
    return () => {
      if (idleHandle !== null && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleHandle);
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  // Every time the form opens: if the silent first load has not run yet it starts now (and is the refresh); otherwise refresh quietly
  useEffect(() => {
    if (!open) return;
    if (!initialLoadStarted.current) {
      startInitialLoad();
      return;
    }
    loadDoctors();
    loadMode();
  }, [open]);

  const retry = () => {
    setModeFailed(false);
    setDoctorsFailed(false);
    loadMode();
    loadDoctors();
  };

  // What the form sees: 'ready' as soon as the mode is known and a doctor list has been received; 'error' only while a first
  // load has failed or timed out; 'loading' otherwise
  const hasMode = bookingMode === 'token' || bookingMode === 'appointment';
  const modeStatus = hasMode && doctorsLoaded
    ? 'ready'
    : (((!hasMode && modeFailed) || (!doctorsLoaded && doctorsFailed)) ? 'error' : 'loading');

  // After a save: close the form, then the token receipt or a short message, then let the host page refresh itself
  const handleBooked = (result) => {
    onClose();
    if (result?.kind === 'token_now') {
      if (result.booking) setReceiptBooking(result.booking);
      else addToast('Token issued', 'success');
    } else if (result?.kind === 'appointment') {
      addToast('Appointment booked', 'success');
    } else if (result?.kind === 'procedure') {
      addToast('Procedure scheduled', 'success');
    } else {
      addToast('Booking scheduled', 'success');
    }
    if (onSaved) onSaved(result);
  };

  return (
    <>
      <BookingForm
        open={open}
        onClose={onClose}
        onBooked={handleBooked}
        bookingMode={bookingMode}
        modeStatus={modeStatus}
        onRetryMode={retry}
        doctors={doctors}
        staffRole={staff?.role}
        ownDoctorId={staff?.doctor_id}
        prefill={prefill}
      />
      {receiptBooking && (
        <TokenReceipt booking={receiptBooking} onClose={() => setReceiptBooking(null)} />
      )}
    </>
  );
}
