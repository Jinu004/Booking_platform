// Campaign sender settings. Plain constants: no environment variables.

module.exports = {
  // A clinic's first campaign sends to at most this many patients
  FIRST_CAMPAIGN_LIMIT: 50,

  // Messages claimed per tick, and the random pause between two sends
  BATCH_SIZE: 10,
  GAP_MIN_MS: 15000,
  GAP_MAX_MS: 30000,

  // Send only when WINDOW_START_HOUR:00 <= IST time < WINDOW_END_HOUR:00
  WINDOW_START_HOUR: 10,
  WINDOW_END_HOUR: 19,

  // Share of the messaging tier's daily limit the sender may use (all template sends of the last 24 hours count)
  BUDGET_FRACTION: 0.8,

  // A recipient with one of these Meta error codes pauses the campaign at once
  IMMEDIATE_PAUSE_CODES: [131049, 131048, 130429, 131031, 190],

  // 131026 (undeliverable): pause when more than this share of at least this many sent or failed recipients has it
  UNDELIVERABLE_CODE: 131026,
  UNDELIVERABLE_RATIO: 0.3,
  UNDELIVERABLE_MIN_SAMPLE: 10,

  // Consecutive send errors in one batch before the campaign is paused
  REPEATED_ERROR_LIMIT: 5,

  // A claimed row with no Meta message id after this long is marked failed (never retried)
  STALE_CLAIM_MINUTES: 15,

  // Redis lock per campaign
  LOCK_SECONDS: 600
}
