const axios = require('axios');

// Meta's Resumable Upload API: turns a sample image into a "header_handle" for a template with an image header.
// Step a: POST /<app id>/uploads opens an upload session. Step b: POST /<session id> sends the bytes and returns { h: <handle> }.
// Tokens are never logged or put in error messages.

const META_API_URL = 'https://graph.facebook.com/v24.0'; // same version as the templates service
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png'];
const SESSION_TIMEOUT_MS = 15000;
const UPLOAD_TIMEOUT_MS = 20000;
// Meta error codes that mean "this token may not do this": the app token is tried once in that case
const AUTH_ERROR_CODES = [10, 100, 190, 200];
const MAX_MESSAGE_CHARS = 200;

// Carries Meta's code and a short message so the route can report them
class UploadError extends Error {
  constructor(message, metaCode = null) {
    super(message);
    this.name = 'UploadError';
    this.metaCode = metaCode;
  }
}

function metaCodeOf(err) {
  const code = Number(err?.response?.data?.error?.code);
  return Number.isInteger(code) ? code : null;
}

function describe(err) {
  const metaError = err?.response?.data?.error;
  const text = String(metaError?.error_user_msg || metaError?.message || err?.message || 'upload failed')
    .replace(/\s+/g, ' ')
    .replace(/[A-Za-z0-9]{20,}\|[A-Za-z0-9]{10,}/g, '[token]')
    .replace(/EA[A-Za-z0-9]{20,}/g, '[token]')
    .slice(0, MAX_MESSAGE_CHARS);
  return text;
}

async function uploadWith(token, { appId, buffer, mimeType, fileName }) {
  const session = await axios.post(`${META_API_URL}/${appId}/uploads`, null, {
    params: { file_length: buffer.length, file_type: mimeType, file_name: fileName, access_token: token },
    timeout: SESSION_TIMEOUT_MS
  });
  const sessionId = session.data?.id;
  if (!sessionId) throw new UploadError('Meta did not return an upload session');

  const upload = await axios.post(`${META_API_URL}/${sessionId}`, buffer, {
    headers: { Authorization: `OAuth ${token}`, file_offset: '0', 'Content-Type': 'application/octet-stream' },
    timeout: UPLOAD_TIMEOUT_MS,
    maxBodyLength: MAX_BYTES + 1024
  });
  const handle = upload.data?.h;
  if (!handle) throw new UploadError('Meta did not return an upload handle');
  return String(handle);
}

/**
 * Uploads a sample image and returns the header handle.
 * The clinic's own token is tried first; if Meta answers with a permission or auth error (code 10, 100, 190 or 200),
 * the upload is retried once with the app access token (META_APP_ID|META_APP_SECRET).
 * @returns {Promise<string>} the handle (header_handle)
 */
async function uploadTemplateSample({ appId, token, buffer, mimeType, fileName }) {
  if (!appId) throw new UploadError('The Meta app id is not configured');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new UploadError('The image is empty');
  if (buffer.length > MAX_BYTES) throw new UploadError('The image is larger than 5 MB');
  if (!ALLOWED_TYPES.includes(mimeType)) throw new UploadError('The image must be JPEG or PNG');
  const safeName = String(fileName || 'poster').split('/').pop().replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'poster';
  const args = { appId, buffer, mimeType, fileName: safeName };

  try {
    return await uploadWith(token, args);
  } catch (firstErr) {
    const code = metaCodeOf(firstErr);
    const appSecret = process.env.META_APP_SECRET;
    if (code === null || !AUTH_ERROR_CODES.includes(code) || !appSecret) {
      throw new UploadError(describe(firstErr), code);
    }
    // One retry with the app token
    try {
      return await uploadWith(`${appId}|${appSecret}`, args);
    } catch (secondErr) {
      throw new UploadError(describe(secondErr), metaCodeOf(secondErr) ?? code);
    }
  }
}

module.exports = { uploadTemplateSample, UploadError, MAX_BYTES, ALLOWED_TYPES };
