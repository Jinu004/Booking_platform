import React, { useState, useEffect } from 'react';
import api from '../../utils/api';

// A poster thumbnail loaded through an authenticated endpoint (the bucket is private), with a click-to-enlarge view.
// path: the endpoint path relative to the shared api helper's base URL, e.g. /superadmin/poster-requests/<id>/image
export default function PosterImage({ path, alt = 'Poster', className = 'w-16 h-16 object-cover rounded-lg border border-gray-200' }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  // Fetch only when the path changes. The object URL is revoked on unmount or path change, and a late result is ignored.
  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    setSrc(null);
    setFailed(false);
    setOpen(false);
    api.get(path, { responseType: 'blob', silent: true })
      .then(blob => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  // Escape closes the enlarged view
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (failed) {
    return <span className={`${className} flex items-center justify-center bg-gray-50 text-gray-400 text-xl flex-shrink-0`}>📄</span>;
  }
  if (!src) {
    return <span className={`${className} bg-gray-100 animate-pulse flex-shrink-0`} />;
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="View poster full size" className="flex-shrink-0">
        <img src={src} alt={alt} className={`${className} hover:opacity-80 transition cursor-zoom-in`} />
      </button>
      {open && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute top-4 right-4 px-3 py-1.5 bg-white text-gray-800 text-sm font-medium rounded-lg shadow hover:bg-gray-100"
          >
            Close
          </button>
          <img
            src={src}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg bg-white"
          />
        </div>
      )}
    </>
  );
}
