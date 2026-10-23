// The text to show for a failed api call. The shared api helper rejects with the server's response body, so the message is err.error.
// Generic server texts are not worth showing, so the caller's fallback is used for them.
const GENERIC_TEXTS = ['Internal Server Error', 'Something went wrong', 'Cannot connect to server'];

export function getErrorMessage(err, fallback) {
  const text = err && typeof err.error === 'string' ? err.error.trim() : '';
  if (text === 'Cannot connect to server') return 'Cannot connect to server. Check your internet and try again.';
  if (text && !GENERIC_TEXTS.includes(text)) return text;
  return fallback;
}
