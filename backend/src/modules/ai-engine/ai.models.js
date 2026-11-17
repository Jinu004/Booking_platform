// The Gemini model names of the WhatsApp AI, in one place.
// DEFAULT_MODEL answers attempt 1 for every clinic without an allowed override; FALLBACK_MODEL answers the retry attempts (2 and 3).
// A clinic's tenants.ai_model (the super admin "AI Model Override") is used only when it is one of ALLOWED_OVERRIDES; anything else
// (null, empty, gemini-2.5-pro, unknown text) is ignored and the clinic gets DEFAULT_MODEL.

const DEFAULT_MODEL = 'gemini-2.5-flash'
const FALLBACK_MODEL = 'gemini-2.5-flash-lite'
const ALLOWED_OVERRIDES = ['gemini-2.5-flash', 'gemini-3.5-flash-lite']

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

module.exports = { DEFAULT_MODEL, FALLBACK_MODEL, ALLOWED_OVERRIDES, resolveModel, generationConfigFor }
