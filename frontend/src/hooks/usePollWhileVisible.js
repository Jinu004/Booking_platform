import { useEffect, useRef } from 'react';

// Calls `callback` every `intervalMs` while the tab is visible. While the tab is hidden the interval is stopped; when it becomes visible
// again the callback runs once at once and the interval restarts. The latest `callback` is always used (it may read current state).
// This does NOT run the callback on mount: the page does its first load itself.
export default function usePollWhileVisible(callback, intervalMs) {
  const latest = useRef(callback);
  useEffect(() => { latest.current = callback; });

  useEffect(() => {
    let timer = null;
    const run = () => {
      try {
        const result = latest.current();
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } catch { /* a failing refresh must not stop the polling */ }
    };
    const start = () => { if (!timer) timer = setInterval(run, intervalMs); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { run(); start(); } else { stop(); }
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);
}
