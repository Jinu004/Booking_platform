const DB_NAME = 'receptionai-offline';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('cache')) {
        db.createObjectStore('cache', { keyPath: 'key' });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

export async function saveToCache(key, data) {
  try {
    const db = await openDB();
    const tx = db.transaction('cache', 'readwrite');
    tx.objectStore('cache').put({ key, data, savedAt: Date.now() });
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch (err) {
    console.warn('[OfflineCache] save failed:', err);
  }
}

export async function loadFromCache(key) {
  try {
    const db = await openDB();
    const tx = db.transaction('cache', 'readonly');
    const result = await new Promise((res, rej) => {
      const req = tx.objectStore('cache').get(key);
      req.onsuccess = e => res(e.target.result);
      req.onerror = rej;
    });
    return result?.data ?? null;
  } catch (err) {
    console.warn('[OfflineCache] load failed:', err);
    return null;
  }
}
