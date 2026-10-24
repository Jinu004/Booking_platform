import React, { useState, useEffect, useRef } from 'react';
import BookingForm from './BookingForm';
import TokenReceipt from './shared/TokenReceipt';
import { getClinicSettings } from '../services/settings.service';
import { getDoctors } from '../services/clinic.service';
import { getStoredStaff } from '../services/auth.service';
import useStore from '../store/useStore';

// The shared "New booking" modal. It owns what the form needs, so any page can use it:
//   <NewBookingModal open={open} onClose={() => setOpen(false)} onSaved={refreshThePage} />
// Optional prefill = { phone, name, customerId, patientId, doctorId } books for a known patient (see BookingForm).
// The booking mode and the doctors are loaded when the wrapper mounts and kept (also in a small module-level cache, so a remount
// reuses them). When the form opens with data already loaded it shows the full form at once and refreshes the doctors (and the
// mode) quietly in the background; "loading" only shows when there is no data yet, and the retry only when the mode has never loaded.
// bookingMode is 'appointment' only when booking_mode === 'appointment' once loaded: a failed load never turns into token mode.
// After a save it closes, shows the token receipt or a short toast, then calls onSaved(result).
// Keep it mounted all the time: the receipt must stay on screen after the form has closed.
const cache = { mode: null, doctors: null };

export default function NewBookingModal({ open, onClose, onSaved, prefill }) {
  const { addToast } = useStore();
  const staff = getStoredStaff();
  const [bookingMode, setBookingMode] = useState(cache.mode);          // null until the first successful load
  const [modeFailed, setModeFailed] = useState(false);                 // only matters while bookingMode is still null
  const [doctors, setDoctors] = useState(cache.doctors || []);
  const [doctorsSettled, setDoctorsSettled] = useState(cache.doctors !== null); // the doctors request has finished (or data exists)
  const [receiptBooking, setReceiptBooking] = useState(null);
  const modeRequest = useRef(0);    // only the newest settings request may set the state
  const doctorsRequest = useRef(0); // same for the doctors request
  const firstOpenEffect = useRef(true);

  const loadMode = () => {
    const id = ++modeRequest.current;
    getClinicSettings()
      .then(res => {
        if (id !== modeRequest.current) return;
        const d = res?.data || res;
        const mode = d?.booking_mode === 'appointment' ? 'appointment' : 'token';
        cache.mode = mode;
        setBookingMode(mode);
        setModeFailed(false);
      })
      .catch(() => {
        if (id !== modeRequest.current) return;
        setModeFailed(true); // a failed refresh keeps the mode already loaded (the status below stays 'ready')
      });
  };

  const loadDoctors = () => {
    const id = ++doctorsRequest.current;
    getDoctors()
      .then(res => {
        if (id !== doctorsRequest.current) return;
        if (res?.data) {
          cache.doctors = res.data;
          setDoctors(res.data);
        }
        setDoctorsSettled(true);
      })
      .catch(() => {
        if (id !== doctorsRequest.current) return;
        setDoctorsSettled(true); // keep the list we have; the form says so when it is empty
      });
  };

  // Once, when the wrapper mounts
  useEffect(() => {
    loadMode();
    loadDoctors();
  }, []);

  // Every time the form opens: refresh quietly (the first run is the mount, which has just loaded everything)
  useEffect(() => {
    const isFirstRun = firstOpenEffect.current;
    firstOpenEffect.current = false;
    if (!open || isFirstRun) return;
    loadDoctors();
    loadMode();
  }, [open]);

  const retryMode = () => {
    setModeFailed(false);
    loadMode();
  };

  // What the form sees: 'ready' as soon as the mode is known and the doctors request has finished; 'error' only when the mode
  // has never loaded; 'loading' otherwise
  const modeStatus = bookingMode
    ? (doctorsSettled ? 'ready' : 'loading')
    : (modeFailed ? 'error' : 'loading');

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
        onRetryMode={retryMode}
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
