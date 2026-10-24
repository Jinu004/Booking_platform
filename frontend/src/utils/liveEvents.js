// Live conversation events (server-sent events) over fetch, so the login token goes in the Authorization header and never in the URL.
// ONE shared connection for the whole app: the first subscriber opens it, the last one to leave closes it.
//
//   const unsubscribe = subscribeLiveEvents({
//     new_message: (e) => { const data = JSON.parse(e.data); ... },   // e = { type, data } like a MessageEvent
//     onStatus: (state) => { ... }                                    // 'connecting' | 'open' | 'reconnecting'
//   });
//
// Nothing here logs tokens, message text or phone numbers.
import api, { logoutUnauthorized } from './api';
import useStore from '../store/useStore';
import { getStoredStaff } from '../services/auth.service';

// The roles the backend allows on the other /hitl routes (hitl.routes.js requireRole lists)
const ALLOWED_ROLES = ['admin', 'manager', 'receptionist', 'super_admin'];

const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 30000;
const STABLE_AFTER_MS = 10000;  // a connection that stayed open this long resets the back-off
const DEAD_AFTER_MS = 90000;    // no bytes at all (the server sends a heartbeat every 30 s) means a dead connection

const subscribers = new Set(); // { handlers }
let connection = null;         // { stopped, controller, wake }
let currentState = 'connecting';
let stopOnLogout = null;

function setState(state) {
  currentState = state;
  subscribers.forEach((sub) => {
    if (typeof sub.handlers.onStatus === 'function') {
      try { sub.handlers.onStatus(state); } catch { /* a handler must not break the stream */ }
    }
  });
}

function dispatch(eventName, dataText) {
  const event = { type: eventName, data: dataText };
  subscribers.forEach((sub) => {
    const handler = sub.handlers[eventName];
    if (eventName !== 'onStatus' && typeof handler === 'function') {
      try { handler(event); } catch { /* a handler must not break the stream */ }
    }
  });
}

// Server-sent events parser: handles chunk boundaries, CRLF / LF / CR line ends, ":" comment lines (the heartbeat),
// "event:" and "data:" fields (several data lines are joined with a newline) and a blank line that ends an event.
function createParser(onEvent) {
  let buffer = '';
  let eventName = '';
  let dataLines = [];

  const handleLine = (line) => {
    if (line === '') {
      if (dataLines.length > 0) onEvent(eventName || 'message', dataLines.join('\n'));
      eventName = '';
      dataLines = [];
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') eventName = value;
    else if (field === 'data') dataLines.push(value);
    // id and retry are not used
  };

  return {
    feed(chunk) {
      buffer += chunk;
      let start = 0;
      for (let i = 0; i < buffer.length; i++) {
        const ch = buffer[i];
        if (ch === '\n') {
          handleLine(buffer.slice(start, i));
          start = i + 1;
        } else if (ch === '\r') {
          if (i === buffer.length - 1) break; // maybe the first half of "\r\n": wait for the next chunk
          handleLine(buffer.slice(start, i));
          if (buffer[i + 1] === '\n') i++;
          start = i + 1;
        }
      }
      buffer = buffer.slice(start);
    }
  };
}

// Waits, but can be cut short when the connection is stopped
function sleep(ms, conn) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    conn.wake = () => { clearTimeout(timer); resolve(); };
  });
}

async function run(conn) {
  let backoff = BACKOFF_START_MS;
  let everOpened = false;

  while (!conn.stopped) {
    const token = localStorage.getItem('auth_token'); // read at every connect, as the api helper does for each request
    if (!token) break;

    const controller = new AbortController();
    conn.controller = controller;
    setState(everOpened ? 'reconnecting' : 'connecting');

    let openedAt = 0;
    let deadTimer = null;
    const armDeadTimer = () => {
      clearTimeout(deadTimer);
      deadTimer = setTimeout(() => controller.abort(), DEAD_AFTER_MS);
    };

    try {
      armDeadTimer();
      const response = await fetch(`${api.defaults.baseURL}/hitl/events`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        cache: 'no-store',
        signal: controller.signal
      });
      if (response.status === 401) {
        conn.stopped = true;
        logoutUnauthorized();
        break;
      }
      if (response.status === 403) {
        conn.stopped = true; // not allowed on this stream: no retry, no logout
        break;
      }
      if (!response.ok || !response.body) throw new Error('stream not available');

      openedAt = Date.now();
      everOpened = true;
      setState('open');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = createParser(dispatch);
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        armDeadTimer(); // any bytes, a heartbeat included, show the connection is alive
        parser.feed(decoder.decode(value, { stream: true }));
      }
    } catch {
      // Aborted (dead connection or shutdown) or a network error: reconnect below unless stopped
    } finally {
      clearTimeout(deadTimer);
    }

    if (conn.stopped) break;
    if (openedAt && Date.now() - openedAt > STABLE_AFTER_MS) backoff = BACKOFF_START_MS;
    setState('reconnecting');
    await sleep(backoff + Math.random() * backoff * 0.25, conn);
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
  }

  if (connection === conn) connection = null;
}

function startConnection() {
  const conn = { stopped: false, controller: null, wake: null };
  connection = conn;
  // A logout (the store clears the login) closes the stream at once
  if (!stopOnLogout) {
    stopOnLogout = useStore.subscribe((state) => {
      if (!state.isAuthenticated) stopConnection();
    });
  }
  run(conn);
}

function stopConnection() {
  const conn = connection;
  connection = null;
  if (stopOnLogout) {
    stopOnLogout();
    stopOnLogout = null;
  }
  if (!conn) return;
  conn.stopped = true;
  if (conn.controller) conn.controller.abort();
  if (conn.wake) conn.wake();
}

export function subscribeLiveEvents(handlers = {}) {
  let role = null;
  try { role = getStoredStaff()?.role || null; } catch { role = null; }
  if (!ALLOWED_ROLES.includes(role)) return () => {};

  const sub = { handlers };
  subscribers.add(sub);
  if (typeof handlers.onStatus === 'function') {
    try { handlers.onStatus(currentState); } catch { /* ignore */ }
  }
  if (!connection) startConnection();

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    subscribers.delete(sub);
    if (subscribers.size === 0) stopConnection();
  };
}
