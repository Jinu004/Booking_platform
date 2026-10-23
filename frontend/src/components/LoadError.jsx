import React from 'react';

// Shown in place of a list or form whose data could not be loaded, so a failure is never mistaken for "no data"
export default function LoadError({ message = 'Could not load. Try again.', onRetry }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
      <p className="text-sm text-red-700">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-3 py-1.5 text-sm font-medium text-red-700 border border-red-300 rounded-lg hover:bg-red-100"
        >
          Retry
        </button>
      )}
    </div>
  );
}
