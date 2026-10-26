import React, { useState, useEffect, useRef } from 'react';
import Modal from '../shared/Modal';
import { previewCustomerErasure, eraseCustomer } from '../../services/clinic.service';
import { getErrorMessage } from '../../utils/errorMessage';

// The api helper (utils/api.js) rejects with the server's response body ({ success: false, data: null, error: '<text>' }), NOT with the
// HTTP status. The status is therefore recognised by the text the backend sends for it:
//   403: "Forbidden: insufficient permissions" (requireRole) or "Account ..." (suspended / pending / inactive clinic)
//   404: "Not found" (the customer is not in this clinic, or was already erased)
// The api helper has already shown its own toast for a 403, so this modal adds none.
const errorText = (err) => (err && typeof err.error === 'string' ? err.error.trim() : '');
const isForbidden = (err) => /^(Forbidden|Account )/i.test(errorText(err));
const isNotFound = (err) => errorText(err) === 'Not found';
const NOT_FOUND_MESSAGE = 'Patient not found. It may already have been erased.';

// The counts shown to the admin (a row with zero is hidden)
const COUNT_ROWS = [
  ['patients', 'Patients'],
  ['bookings', 'Bookings'],
  ['tokens', 'Queue tokens'],
  ['notifications', 'Notifications'],
  ['conversations', 'Conversations'],
  ['messages', 'Messages'],
  ['visitNotes', 'Visit notes'],
  ['conditions', 'Conditions'],
  ['campaignRecipients', 'Campaign records'],
  ['unansweredQuestions', 'Unanswered questions'],
];

// Props: isOpen, customerId (customers.id, NOT the patient id), onClose, onErased (the caller shows the success message and navigates)
export default function ErasePatientModal({ isOpen, customerId, onClose, onErased }) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [data, setData] = useState(null);
  const [keepNotes, setKeepNotes] = useState(false);
  const [typed, setTyped] = useState('');
  const [erasing, setErasing] = useState(false);
  const [eraseError, setEraseError] = useState('');
  const requestRef = useRef(0); // ignores an answer that arrives after the window was closed or reopened

  const loadPreview = async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setLoadError('');
    setData(null);
    try {
      const res = await previewCustomerErasure(customerId);
      if (requestId !== requestRef.current) return;
      setData(res?.data || null);
      if (!res?.data) setLoadError('Could not load the preview. Please try again.');
    } catch (err) {
      if (requestId !== requestRef.current) return;
      if (isForbidden(err)) { onClose(); return; }
      setLoadError(isNotFound(err) ? NOT_FOUND_MESSAGE : getErrorMessage(err, 'Could not load the preview. Please try again.'));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  };

  // Every opening starts clean and loads a fresh preview
  useEffect(() => {
    if (!isOpen || !customerId) {
      requestRef.current += 1;
      return undefined;
    }
    setKeepNotes(false);
    setTyped('');
    setErasing(false);
    setEraseError('');
    loadPreview();
    return () => { requestRef.current += 1; };
  }, [isOpen, customerId]);

  const handleErase = async () => {
    if (typed !== 'DELETE' || erasing || !data) return;
    setErasing(true);
    setEraseError('');
    try {
      await eraseCustomer(customerId, { keepMedicalNotes: keepNotes });
      if (onErased) onErased();
      setErasing(false);
    } catch (err) {
      setErasing(false);
      if (isForbidden(err)) { onClose(); return; }
      setEraseError(isNotFound(err) ? NOT_FOUND_MESSAGE : getErrorMessage(err, 'Could not erase the patient data. Please try again.'));
    }
  };

  // While the request runs nothing can close the window: not the X, the overlay, Escape or Cancel
  const safeClose = () => { if (!erasing) onClose(); };

  const counts = data?.counts || {};
  const patients = Array.isArray(data?.patients) ? data.patients : null;
  const patientCount = Number.isFinite(counts.patients) ? counts.patients : (patients ? patients.length : 0);
  const shared = patientCount > 1 || (patients ? patients.length > 1 : false);
  const rows = COUNT_ROWS.filter(([key]) => Number(counts[key]) > 0);
  const notFound = (loadError === NOT_FOUND_MESSAGE) || (eraseError === NOT_FOUND_MESSAGE);

  return (
    <Modal isOpen={isOpen} onClose={safeClose} title="Erase patient data" size="md" showCloseButton={!erasing}>
      {loading && (
        <div className="flex items-center gap-3 py-8 justify-center text-sm text-gray-500">
          <span className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" aria-hidden="true" />
          Counting…
        </div>
      )}

      {!loading && loadError && (
        <div className="space-y-4">
          <p className="text-sm text-red-600" role="alert">{loadError}</p>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
              Close
            </button>
            {loadError !== NOT_FOUND_MESSAGE && (
              <button type="button" onClick={loadPreview} className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition">
                Retry
              </button>
            )}
          </div>
        </div>
      )}

      {!loading && !loadError && data && (
        <div className="space-y-4">
          <div>
            <p className="text-base font-semibold text-gray-900 break-words">{data.customer?.name || 'Unknown patient'}</p>
            {data.customer?.phone && <p className="text-sm text-gray-500">{data.customer.phone}</p>}
          </div>

          {shared && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-3 py-2">
              This erases all {patientCount} patients that share this phone number.
            </div>
          )}

          {patients && patients.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 font-medium mb-1">{patients.length === 1 ? 'Patient' : 'Patients'}</p>
              <ul className="text-sm text-gray-800 space-y-0.5 max-h-32 overflow-y-auto border border-gray-100 rounded-lg px-3 py-2">
                {patients.map((p) => (
                  <li key={p.id} className="break-words">{p.name || 'Unnamed patient'}</li>
                ))}
              </ul>
              {patientCount > patients.length && (
                <p className="text-xs text-gray-500 mt-1">and {patientCount - patients.length} more</p>
              )}
            </div>
          )}

          <div>
            <p className="text-xs text-gray-500 font-medium mb-1">This will be removed</p>
            {rows.length === 0 ? (
              <p className="text-sm text-gray-500">No other records are linked to this patient.</p>
            ) : (
              <ul className="text-sm text-gray-800 divide-y divide-gray-100 border border-gray-100 rounded-lg">
                {rows.map(([key, label]) => (
                  <li key={key} className="flex items-center justify-between px-3 py-1.5">
                    <span>{key === 'visitNotes' && keepNotes ? 'Visit notes (kept without the name)' : label}</span>
                    <span className="font-semibold tabular-nums">{key === 'visitNotes' && keepNotes ? 0 : counts[key]}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={keepNotes}
              disabled={erasing}
              onChange={(e) => setKeepNotes(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded"
            />
            <span className="text-sm text-gray-800">
              Keep medical notes without the patient's name
              <span className="block text-xs text-gray-500">Notes may still contain the patient's name in their text.</span>
            </span>
          </label>

          <p className="text-sm font-semibold text-red-700">This cannot be undone. Backups keep the data for up to 14 days.</p>

          <div>
            <label htmlFor="erase-confirm" className="block text-xs text-gray-500 font-medium mb-1">Type DELETE to confirm</label>
            <input
              id="erase-confirm"
              type="text"
              value={typed}
              disabled={erasing}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              autoCapitalize="characters"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:bg-gray-100"
            />
          </div>

          {eraseError && <p className="text-sm text-red-600" role="alert">{eraseError}</p>}

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
            <button
              type="button"
              onClick={safeClose}
              disabled={erasing}
              className="px-4 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition"
            >
              {notFound ? 'Close' : 'Cancel'}
            </button>
            {!notFound && (
              <button
                type="button"
                onClick={handleErase}
                disabled={typed !== 'DELETE' || erasing}
                className="px-4 py-2.5 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {erasing ? 'Erasing…' : 'Erase permanently'}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
