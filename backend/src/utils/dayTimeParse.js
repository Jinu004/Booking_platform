// Reads the day and time a patient typed ("saturday around 5", "tomorrow 5:30 pm", "25th 4pm") into plain values.
// Pure: no database, no network, no clock except the `now` that is passed in. All reasoning is in Asia/Kolkata (IST).

const DAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTH_INDEX = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DAY_RE = 'sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?';
const MONTH_RE = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
// Words for a time of day (minutes from midnight)
const WORD_MINUTES = { morning: 10 * 60, noon: 12 * 60, afternoon: 15 * 60, evening: 17 * 60, night: 19 * 60 };

const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

function isRealDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function addDays(date, n) {
  const dt = new Date(Date.UTC(date.y, date.m - 1, date.d + n));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

// Today's calendar date in IST
function istToday(now) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type) => parseInt(parts.find((p) => p.type === type).value, 10);
  return { y: get('year'), m: get('month'), d: get('day') };
}

// A time given with am or pm: 12 am is 00:00, 12 pm is 12:00
function withMeridiem(hour, minute, meridiem) {
  if (hour < 1 || hour > 12) return null;
  const h24 = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
  return h24 * 60 + minute;
}

/**
 * @param {string} text what the patient typed
 * @param {Date} now the current moment (IST is used for every decision)
 * @returns {{ date: string|null, times: number[], label_ok: boolean }}
 *   date: 'YYYY-MM-DD' (never before today in IST) or null when no day was recognised.
 *   times: minutes from midnight, ascending. A bare hour ("around 5") gives two candidates (05:00 and 17:00) so the caller can
 *     pick the one inside the doctor's working hours. Empty when no time was recognised (a day alone gives no time).
 *   label_ok: true when a day or a time was recognised, so the caller can repeat back what it understood.
 *   A day name means its next occurrence (today counts, "next <day>" means after today). Today with a time that has already
 *   passed is returned as it is; the caller decides.
 */
function parseDayAndTime(text, now = new Date()) {
  const none = { date: null, times: [], label_ok: false };
  try {
    if (typeof text !== 'string' || !text.trim()) return none;
    const today = istToday(now);
    const todayStr = ymd(today.y, today.m, today.d);
    const todayDow = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay();

    let rest = ` ${text.toLowerCase().replace(/a\.m\.?/g, 'am').replace(/p\.m\.?/g, 'pm')} `;
    // Finds the first match, blanks it out of the remaining text so a later step cannot read it again, and returns it
    const take = (re) => {
      const m = re.exec(rest);
      if (m) rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`;
      return m;
    };

    // ---- the day ----
    let date = null;
    let tonight = false;
    let m;
    if ((m = take(/\bday after tomorrow\b/))) {
      date = addDays(today, 2);
    } else if ((m = take(/\b(?:tomorrow|tmrw|tmr)\b/))) {
      date = addDays(today, 1);
    } else if ((m = take(/\b(today|tonight)\b/))) {
      date = today;
      tonight = m[1] === 'tonight';
    } else if ((m = take(new RegExp(`(?:\\b(next|this)\\s+)?\\b(${DAY_RE})\\b`)))) {
      const target = DAY_INDEX[m[2].slice(0, 3)];
      let diff = (target - todayDow + 7) % 7;
      if (m[1] === 'next' && diff === 0) diff = 7;
      date = addDays(today, diff);
    }

    if (!date) {
      let y = null;
      let mo = null;
      let d = null;
      if ((m = take(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?(${MONTH_RE})\\b`)))) {
        d = parseInt(m[1], 10); mo = MONTH_INDEX[m[2].slice(0, 3)];
      } else if ((m = take(new RegExp(`\\b(${MONTH_RE})\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b`)))) {
        mo = MONTH_INDEX[m[1].slice(0, 3)]; d = parseInt(m[2], 10);
      } else if ((m = take(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/))) {
        d = parseInt(m[1], 10); mo = parseInt(m[2], 10);
        if (m[3]) y = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
      } else if ((m = take(/\b(\d{1,2})(?:st|nd|rd|th)\b/))) {
        // Only the day of the month: this month, or the next one when that day has passed
        d = parseInt(m[1], 10);
        mo = today.m;
        y = today.y;
        if (d < today.d) { mo += 1; if (mo > 12) { mo = 1; y += 1; } }
      }
      if (d !== null && mo !== null) {
        let year = y !== null ? y : today.y;
        if (isRealDate(year, mo, d) && ymd(year, mo, d) < todayStr && y === null) year += 1; // a past date means next year
        if (isRealDate(year, mo, d) && ymd(year, mo, d) >= todayStr) date = { y: year, m: mo, d };
      }
    }

    // ---- the time ----
    let period = tonight ? 'night' : null;
    if ((m = take(/\b(morning|noon|afternoon|evening|night)\b/))) period = m[1];

    let times = [];
    let numeric = false;
    if ((m = take(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/))) {
      const hour = parseInt(m[1], 10);
      const minute = parseInt(m[2], 10);
      if (minute <= 59) {
        numeric = true;
        if (m[3]) {
          const t = withMeridiem(hour, minute, m[3]);
          if (t !== null) times = [t];
        } else if (hour >= 13 && hour <= 23) {
          times = [hour * 60 + minute];
        } else if (hour === 0 || hour === 12) {
          times = [hour * 60 + minute];
        } else if (hour >= 1 && hour <= 11) {
          times = [hour * 60 + minute, (hour + 12) * 60 + minute];
        }
      }
    } else if ((m = take(/\b(\d{1,2})\s*(am|pm)\b/))) {
      const t = withMeridiem(parseInt(m[1], 10), 0, m[2]);
      if (t !== null) { numeric = true; times = [t]; }
    } else if ((m = /\b(\d{1,2})\b/.exec(rest))) {
      // A bare hour ("around 5", "at 5", "5")
      const hour = parseInt(m[1], 10);
      if (hour >= 1 && hour <= 11) { numeric = true; times = [hour * 60, (hour + 12) * 60]; }
      else if (hour === 12) { numeric = true; times = [12 * 60]; }
      else if (hour >= 13 && hour <= 23) { numeric = true; times = [hour * 60]; }
    }

    if (numeric && times.length === 2 && period) {
      // "5 in the evening": the word picks the am or the pm candidate
      if (period === 'morning') times = [times[0]];
      else if (period === 'afternoon' || period === 'evening' || period === 'night') times = [times[1]];
    }
    if (!numeric && period) times = [WORD_MINUTES[period]];

    // "tonight" alone means today
    if (tonight && !date) date = today;

    times = [...new Set(times)].sort((a, b) => a - b);
    const dateText = date ? ymd(date.y, date.m, date.d) : null;
    return { date: dateText, times, label_ok: dateText !== null || times.length > 0 };
  } catch (err) {
    return none;
  }
}

module.exports = { parseDayAndTime };
