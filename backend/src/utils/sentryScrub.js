// Scrubs a Sentry event before it leaves the server: no phone numbers, emails, query strings, cookies, request bodies,
// authorization or token headers, or client ip. Used as Sentry's beforeSend. It must never throw.

const PHONE_RUN = /\b\d{10,15}\b/g;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

// 10 to 15 digit runs (phone numbers) and email addresses
function redact(str) {
  if (typeof str !== 'string') return str;
  return str.replace(PHONE_RUN, '[redacted-phone]').replace(EMAIL, '[redacted-email]');
}

// A URL without its query string or fragment (and without phone-like digit runs in the path)
function cleanUrl(url) {
  if (typeof url !== 'string') return url;
  return redact(url.split('?')[0].split('#')[0]);
}

// Header names removed completely: authorization, cookies, anything that looks like a token, key, secret or signature
const SENSITIVE_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie)$|token|secret|api[-_]?key|signature|auth/i;

// Client address headers, removed by exact name (they carry the caller's ip)
const IP_HEADERS = ['x-forwarded-for', 'x-real-ip', 'forwarded', 'cf-connecting-ip'];

// Non-global copies: a global regex keeps lastIndex between test() calls and would skip matches
const PHONE_TEST = /\b\d{10,15}\b/;
const EMAIL_TEST = /[^\s@]+@[^\s@]+\.[^\s@]+/;

function looksPersonal(text) {
  return PHONE_TEST.test(text) || EMAIL_TEST.test(text);
}

// Deletes every entry whose key or value looks like a phone number or an email
function dropPersonalEntries(obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    let text = '';
    if (typeof value === 'string') text = value;
    else if (typeof value === 'number') text = String(value);
    else if (value && typeof value === 'object') {
      try { text = JSON.stringify(value) || ''; } catch (e) { text = ''; } // circular objects: judge by key only
    }
    if (looksPersonal(key) || looksPersonal(text)) delete obj[key];
  }
}

function scrubEvent(event) {
  try {
    if (event.exception && event.exception.values) {
      event.exception.values.forEach((ex) => {
        if (ex.value) ex.value = redact(ex.value);
      });
    }
    if (event.message) event.message = redact(event.message);

    if (event.request) {
      delete event.request.cookies;
      delete event.request.data;
      delete event.request.query_string;
      if (event.request.url) event.request.url = cleanUrl(event.request.url);
      if (event.request.headers && typeof event.request.headers === 'object') {
        for (const name of Object.keys(event.request.headers)) {
          if (SENSITIVE_HEADER.test(name) || IP_HEADERS.includes(name.toLowerCase())) delete event.request.headers[name];
        }
      }
    }

    dropPersonalEntries(event.extra);
    if (event.contexts) dropPersonalEntries(event.contexts.request);
    dropPersonalEntries(event.tags);

    if (event.user) delete event.user.ip_address;

    if (Array.isArray(event.breadcrumbs)) {
      event.breadcrumbs.forEach((crumb) => {
        if (!crumb) return;
        if (crumb.message) crumb.message = redact(crumb.message);
        if (crumb.data && typeof crumb.data === 'object') {
          for (const key of Object.keys(crumb.data)) {
            const value = crumb.data[key];
            if (/^http\.(query|fragment)$/.test(key) || key === 'query') {
              delete crumb.data[key];
            } else if (typeof value === 'string') {
              // Any URL in the breadcrumb loses its query string; other text loses phone numbers and emails
              crumb.data[key] = /^https?:\/\//i.test(value) || key === 'url' ? cleanUrl(value) : redact(value);
            }
          }
        }
      });
    }
  } catch (err) {
    // Never let the scrubber break error reporting: send what we have
  }
  return event;
}

module.exports = { scrubEvent, redact, cleanUrl };
