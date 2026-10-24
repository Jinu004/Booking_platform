// Patient names typed on WhatsApp: one set of rules for the coded booking flow, the appointment flow and the AI booking tools,
// and the clean-up of a name for a template greeting. Names are never concatenated into SQL or HTML by this code.
//
// A name may hold letters and combining marks of ANY script (Latin, Malayalam, Tamil, Hindi, Arabic...), spaces, hyphens, dots and
// apostrophes (' and the curly one), so "D'Souza" and "A.K Raj" stay as typed. Digits, emoji, symbols, line breaks and "?" are not names.

// Words/phrases that are a reply or a command, not a name
const NAME_STOP_WORDS = new Set(['hi', 'hello', 'hey', 'menu', 'book', 'cancel', 'yes', 'no', 'ok', 'okay', 'thanks', 'thank you', 'tomorrow', 'today'])
// Whole words that mark typed text as a question or request rather than a name
const NAME_BLOCKED_WORDS = new Set(['what', 'when', 'where', 'how', 'why', 'who', 'which', 'time', 'timing', 'timings', 'open', 'close', 'closed', 'hours', 'doctor', 'appointment', 'book', 'booking', 'cancel', 'reschedule', 'fee', 'fees', 'price', 'address', 'location', 'available', 'availability', 'please', 'help', 'want', 'need', 'can', 'could', 'do', 'does', 'is', 'are', 'will', 'today', 'tomorrow', 'token', 'clinic', 'hospital'])

const DISALLOWED_CHARS = /[^\p{L}\p{M}\s.'’-]/gu

/**
 * The name as it is stored: only allowed characters, single spaces, at most 100 characters, Latin words capitalised after a space,
 * hyphen, dot or apostrophe (other scripts keep their letters as typed). '' when no letter is left.
 */
function formatPatientName(raw) {
  const cleaned = Array.from(String(raw == null ? '' : raw)
    .replace(DISALLOWED_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim())
    .slice(0, 100)
    .join('')
    .trim()
  if (!/\p{L}/u.test(cleaned)) return ''
  return cleaned.replace(/(^|[\s.'’-])([a-z])/g, (m, lead, letter) => lead + letter.toUpperCase())
}

/**
 * Checks typed text that is expected to be a patient name. Returns { typed, cleaned } or null.
 * `cleaned` is exactly what formatPatientName stores, so the validated name is the stored name.
 */
function validatePatientName(text) {
  const typed = String(text == null ? '' : text).trim()
  if (!typed || typed.includes('?')) return null
  if (/[\r\n\t]/.test(typed)) return null
  const words = typed.split(/\s+/)
  if (words.length > 4) return null
  if (words.some(w => NAME_BLOCKED_WORDS.has(w.toLowerCase().replace(/^[.'’-]+|[.'’-]+$/g, '')))) return null
  // Letters and marks of any script, spaces, hyphens, dots, apostrophes only: digits, emoji and symbols are rejected
  if (/[^\p{L}\p{M}\s.'’-]/u.test(typed)) return null
  if (NAME_STOP_WORDS.has(typed.toLowerCase().replace(/\s+/g, ' '))) return null
  const cleaned = formatPatientName(typed)
  const letterCount = (cleaned.match(/\p{L}/gu) || []).length
  if (letterCount < 2 || cleaned.length < 2 || cleaned.length > 60) return null
  return { typed, cleaned }
}

// Used only after validatePatientName accepted the text: true when the text is very likely a real name, so it can be booked
// without asking for confirmation. Latin letters only, 2 or 3 words, one word of 3+ letters.
function isConfidentName(typed) {
  const t = (typed || '').trim()
  if (!/^[a-zA-Z\s.'’-]+$/.test(t)) return false
  const words = t.split(/\s+/)
  if (words.length < 2 || words.length > 3) return false
  return words.some(w => (w.match(/[a-zA-Z]/g) || []).length >= 3)
}

/**
 * A stored name made safe for a template greeting variable ("Hi {{1}}"): letters of any script, spaces, dots, apostrophes and hyphens
 * only (no emoji, symbols, digits, line breaks or tabs), single spaces, at most 30 characters. "there" when nothing is left.
 */
function greetingName(name) {
  const cleaned = Array.from(String(name == null ? '' : name)
    .replace(DISALLOWED_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim())
    .slice(0, 30)
    .join('')
    .trim()
  return /\p{L}/u.test(cleaned) ? cleaned : 'there'
}

module.exports = { validatePatientName, isConfidentName, formatPatientName, greetingName, NAME_STOP_WORDS, NAME_BLOCKED_WORDS }
