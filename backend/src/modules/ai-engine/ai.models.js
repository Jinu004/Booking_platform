// The Gemini model names of the WhatsApp AI, in one place.
// DEFAULT_MODEL (gemini-3.5-flash-lite, on the new SDK) answers attempt 1 for every clinic without an allowed override, including every
// clinic created later (tenants.ai_model starts as NULL). FALLBACK_MODEL (gemini-2.5-flash-lite, on the old SDK) answers the retry
// attempts (2 and 3). gemini-2.5-flash is retired by Google on 1 Dec 2026 and is no longer selectable: gemini-3.5-flash-lite is the
// only override. The old-SDK paths below (generationConfigFor, usesNewSdk) stay, because FALLBACK_MODEL still uses them.
// A clinic's tenants.ai_model (the super admin "AI Model Override") is used only when it is one of ALLOWED_OVERRIDES; anything else
// (null, empty, a stored gemini-2.5-flash, gemini-2.5-pro, unknown text) is ignored and the clinic gets DEFAULT_MODEL.

const DEFAULT_MODEL = 'gemini-3.5-flash-lite'
const FALLBACK_MODEL = 'gemini-2.5-flash-lite'
const ALLOWED_OVERRIDES = ['gemini-3.5-flash-lite']
// The retired model: a save that still sends it (the older super admin dropdown) is stored as "no override" (NULL), never refused
const RETIRED_OVERRIDES = ['gemini-2.5-flash']

function resolveModel(tenantAiModel) {
  return typeof tenantAiModel === 'string' && ALLOWED_OVERRIDES.includes(tenantAiModel) ? tenantAiModel : DEFAULT_MODEL
}

// Gemini 2.5 models: thinking off (thinkingBudget 0), exactly the config the AI has always sent.
// Any other model gets no thinkingConfig at all: Google documents minimal thinking as the default of gemini-3.5-flash-lite, and does not
// say how the newer models treat thinkingBudget, so it is not sent to them.
function generationConfigFor(model) {
  if (typeof model === 'string' && model.startsWith('gemini-2.5')) {
    return { thinkingConfig: { thinkingBudget: 0 } }
  }
  return {}
}

// Which SDK answers a model (ai.gemini.js): gemini-2.5 models stay on the old SDK (@google/generative-ai) exactly as before; every other
// model uses the new SDK (@google/genai), which sends tool results with role 'user' as the newer models require.
function usesNewSdk(model) {
  return typeof model === 'string' && !model.startsWith('gemini-2.5')
}

module.exports = { DEFAULT_MODEL, FALLBACK_MODEL, ALLOWED_OVERRIDES, RETIRED_OVERRIDES, resolveModel, generationConfigFor, usesNewSdk }
