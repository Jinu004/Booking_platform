// The retry rules of one AI turn (used by ai.service.js processMessage). No imports: the logger and the waiting function are passed in,
// so the rules can be tested without Gemini, a database or the app's environment.
//
// A retry restarts the WHOLE turn from the patient's message, so any tool that already ran in the turn can run again. Tools that only
// read, or that are safe to repeat, do not matter. After a tool that changes something (a booking, a lead, a message sent to the patient)
// nothing is retried for any error: the patient gets a safe reply instead.

// Tools that only read, or that are idempotent when repeated:
//   get_clinic_info, get_patient_bookings, get_available_doctors / get_available_doctors_tomorrow (get_available_doctors*),
//   get_doctor_schedule, check_doctor_availability, get_patient_profiles, get_catalogue, get_product   (read only)
//   cancel_booking          (cancelling an already cancelled booking changes nothing and answers the same success text)
//   log_unanswered_question (skips an identical question of the last 24 hours and more than 3 per conversation per hour)
//   escalate_to_human       (returns a signal only; the hand-off itself happens after the turn, and the signal ends the turn)
// Every other tool counts as state-changing, including capture_lead, every create_* tool, start_appointment_booking, show_welcome,
// show_all_doctors and anything unknown.
const SAFE_TO_REPEAT_TOOLS = new Set([
  'get_clinic_info',
  'get_patient_bookings',
  'get_available_doctors',
  'get_available_doctors_tomorrow',
  'get_doctor_schedule',
  'check_doctor_availability',
  'get_patient_profiles',
  'get_catalogue',
  'get_product',
  'cancel_booking',
  'log_unanswered_question',
  'escalate_to_human'
]);

function isSafeToRepeatTool(name) {
  return typeof name === 'string' && (SAFE_TO_REPEAT_TOOLS.has(name) || name.startsWith('get_available_doctors'));
}

// The reply when a state-changing tool already ran and the turn then failed
function safeReplyAfterStateChange(industry) {
  return industry === 'enquiry'
    ? "Thanks, I've noted your request. Our team will get back to you shortly."
    : "Thanks, I've noted your request. Please check 'Check My Booking' or call the clinic to confirm.";
}

const errorClass = (err) => String((err && (err.name || err.code)) || 'Error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs the attempts of one turn.
 * @param {object} o
 * @param {number} o.maxAttempts
 * @param {(attempt: number) => Promise<any>} o.runAttempt  one attempt of the whole turn; its return value is the turn's result
 * @param {(err: Error) => boolean} o.isTransient           whether the error may be retried
 * @param {() => { toolHasRun: boolean, stateChangingTool: string|null }} o.getTurnState  read after a failure
 * @param {(err: Error, state: object) => any} o.onStateChangingStop  the result when a state-changing tool ran (the safe reply)
 * @param {{ warn: Function }} o.logger
 * @param {string} [o.tenantId]
 * @param {(ms: number) => Promise<void>} [o.sleep]
 */
async function runAttemptsWithRetry({ maxAttempts, runAttempt, isTransient, getTurnState, onStateChangingStop, logger, tenantId = 'unknown', sleep = defaultSleep }) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await runAttempt(attempt);
    } catch (err) {
      lastError = err;
      const state = getTurnState();
      if (state && state.stateChangingTool) {
        // Never restart the turn after a state-changing tool, whatever the error: only tenant id, tool name and error class are logged
        logger.warn(`AI_RETRY_BLOCKED tenant=${tenantId} tool=${state.stateChangingTool} class=${errorClass(err)}`);
        return onStateChangingStop(err, state);
      }
      if (attempt < maxAttempts) {
        if (isTransient(err)) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000); // 1s, 2s, 4s cap 8s
          logger.warn(`Gemini attempt ${attempt} failed (${err.message}). Retrying in ${delay}ms...`);
          await sleep(delay);
        } else {
          // Non-transient error (bad API key, invalid request) — don't retry
          logger.warn(`Gemini attempt ${attempt} failed with non-transient error — not retrying: ${err.message}`);
          break;
        }
      }
    }
  }
  // All attempts failed: the caller's outer catch answers with the failure text
  throw lastError;
}

module.exports = { runAttemptsWithRetry, isSafeToRepeatTool, safeReplyAfterStateChange, SAFE_TO_REPEAT_TOOLS };
