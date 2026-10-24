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
// Each time it opens it loads the clinic's booking mode (with a retry in the form when that fails: never a silent fallback
// to token mode) and a fresh doctor list. After a save it closes, shows the token receipt or a short toast, then calls onSaved(result).
// Keep it mounted all the time: the receipt must stay on screen after the form has closed.
export default function NewBookingModal({ open, onClose, onSaved, prefill }) {
  const { addToast } = useStore();
  const staff = getStoredStaff();
  const [bookingMode, setBookingMode] = useState(null);
  const [modeStatus, setModeStatus] = useState('loading');
  const [doctors, setDoctors] = useState([]);
  const [receiptBooking, setReceiptBooking] = useState(null);
  const modeRequest = useRef(0); // only the newest settings request may set the state

  const loadMode = () => {
    const id = ++modeRequest.current;
    setBookingMode(null);
    setModeStatus('loading');
    getClinicSettings()
      .then(res => {
        if (id !== modeRequest.current) return;
        const d = res?.data || res;
        setBookingMode(d?.booking_mode === 'appointment' ? 'appointment' : 'token');
        setModeStatus('ready');
      })
      .catch(() => {
        if (id !== modeRequest.current) return;
        setModeStatus('error');
      });
  };

  useEffect(() => {
    if (!open) return undefined;
    loadMode();
    let cancelled = false;
    getDoctors()
      .then(res => { if (!cancelled && res?.data) setDoctors(res.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

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
        onRetryMode={loadMode}
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
