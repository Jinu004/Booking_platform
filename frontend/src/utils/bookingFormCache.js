import { STORAGE_KEYS } from '../constants';

// What the New booking form keeps between openings (the clinic's booking mode and doctor list), shared by NewBookingModal.jsx.
// It is kept in this tiny module (no imports from the services or components) so the logout code can clear it without a circular import.
// The data belongs to ONE logged-in user of ONE clinic: the key below says which, and data stored under another key is never used.
const cache = { key: null, mode: null, doctors: null };

// "<clinic id>:<staff id>" of the logged-in user, read from the stored login each time; null when nobody is logged in
export function getBookingFormCacheKey() {
  try {
    const staff = JSON.parse(localStorage.getItem(STORAGE_KEYS.STAFF_DATA) || 'null');
    if (!staff || !staff.tenantId || !staff.id) return null;
    return `${staff.tenantId}:${staff.id}`;
  } catch {
    return null;
  }
}

// The cached mode and doctors for this key; both null when the cache belongs to someone else (it is then discarded)
export function readBookingFormCache(key) {
  if (!key || cache.key !== key) {
    if (cache.key !== null && cache.key !== key) {
      cache.key = null;
      cache.mode = null;
      cache.doctors = null;
    }
    return { mode: null, doctors: null };
  }
  return { mode: cache.mode, doctors: cache.doctors };
}

// Stores one part of the cache for this key (switching to a new key starts a fresh cache)
export function writeBookingFormCache(key, part) {
  if (!key) return;
  if (cache.key !== key) {
    cache.key = key;
    cache.mode = null;
    cache.doctors = null;
  }
  Object.assign(cache, part);
}

// Called when the user logs out
export function clearBookingFormCache() {
  cache.key = null;
  cache.mode = null;
  cache.doctors = null;
}
