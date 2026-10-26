// The prompt-injection filter shared by every text a clinic writes that ends up in an AI prompt (the knowledge base, the guided answers,
// the doctor profiles). It replaces the phrases below with "[removed]". It does not cut the text to a length: callers do that themselves.
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions?/gi,
  /you\s+are\s+now/gi,
  /new\s+instructions?:/gi,
  /system\s*:/gi,
  /\[system\]/gi,
  /forget\s+(everything|all)/gi,
  /disregard\s+(all\s+)?previous/gi,
];

function stripInjection(text) {
  if (!text) return text;
  let cleaned = text;
  for (const pattern of INJECTION_PATTERNS) {
    cleaned = cleaned.replace(pattern, '[removed]');
  }
  return cleaned;
}

module.exports = { INJECTION_PATTERNS, stripInjection };
