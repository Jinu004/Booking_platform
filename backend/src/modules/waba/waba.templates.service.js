const axios = require('axios');
const pool = require('../../config/database');
const logger = require('../../utils/logger');
const { decrypt } = require('../../utils/secretBox');
const { TEMPLATES } = require('./waba.templates');
const { uploadTemplateSample, UploadError } = require('./waba.upload');

const META_API_URL = 'https://graph.facebook.com/v24.0';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAGES = 20;

// Error with an HTTP status the route can return as clean JSON
class TemplateError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Short, safe description of a failed Meta call: HTTP status and Meta error code/message only (no URLs, tokens or bodies)
function metaFailure(err) {
  const status = err.response?.status;
  const metaError = err.response?.data?.error;
  const parts = [
    status ? `HTTP ${status}` : null,
    metaError?.code ? `code ${metaError.code}` : null,
    metaError?.error_user_msg
      ? String(metaError.error_user_msg).slice(0, 200)
      : (metaError?.message ? String(metaError.message).slice(0, 200) : (err.response ? null : 'no response from Meta'))
  ].filter(Boolean);
  return parts.join(' ') || 'request failed';
}

// The clinic's OWN WABA id and token (never the shared env token or META_WABA_ID)
async function loadConnection(tenantId) {
  if (!tenantId || !UUID_PATTERN.test(String(tenantId))) {
    throw new TemplateError('Invalid tenant id', 400);
  }
  const res = await pool.query(
    'SELECT id, whatsapp_waba_id, whatsapp_phone_number_id, whatsapp_access_token_enc FROM tenants WHERE id = $1',
    [tenantId]
  );
  if (!res.rows.length) throw new TemplateError('Tenant not found', 404);
  const row = res.rows[0];
  if (!row.whatsapp_waba_id || !row.whatsapp_access_token_enc) {
    throw new TemplateError('This clinic has no WhatsApp Business account connected (WABA id or token is missing). Connect the number first.', 400);
  }
  let token;
  try {
    token = decrypt(row.whatsapp_access_token_enc);
  } catch (err) {
    throw new TemplateError('The stored token could not be decrypted (check TOKEN_ENCRYPTION_KEY)', 500);
  }
  return {
    wabaId: String(row.whatsapp_waba_id),
    phoneNumberId: row.whatsapp_phone_number_id ? String(row.whatsapp_phone_number_id) : null,
    token
  };
}

// All templates of the WABA, following paging
async function listMetaTemplates(wabaId, token) {
  const headers = { Authorization: `Bearer ${token}` };
  const found = [];
  let url = `${META_API_URL}/${wabaId}/message_templates`;
  let params = { fields: 'name,language,status,category,id', limit: 100 };
  for (let page = 0; page < MAX_PAGES && url; page++) {
    const res = await axios.get(url, { headers, params });
    if (Array.isArray(res.data?.data)) found.push(...res.data.data);
    url = res.data?.paging?.next || null; // the next link already carries its query
    params = undefined;
  }
  return found;
}

function templateKey(name, language) {
  return `${name}|${language}`;
}

function buildComponents(template) {
  const body = { type: 'BODY', text: template.body };
  if (template.bodyExamples && template.bodyExamples.length) {
    body.example = { body_text: [template.bodyExamples] };
  }
  const components = [];
  // Optional image header (before the body); templates without a header produce exactly the same components as before
  if (template.header && template.header.format === 'IMAGE' && template.header.sampleHandle) {
    components.push({ type: 'HEADER', format: 'IMAGE', example: { header_handle: [template.header.sampleHandle] } });
  }
  components.push(body);
  if (template.buttons && template.buttons.length) {
    components.push({
      type: 'BUTTONS',
      buttons: template.buttons.map(text => ({ type: 'QUICK_REPLY', text }))
    });
  }
  return components;
}

async function upsertTemplateRow(tenantId, template, fields) {
  await pool.query(
    `INSERT INTO tenant_templates (tenant_id, name, language, category, meta_template_id, status, last_error)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, name, language) DO UPDATE
     SET category = EXCLUDED.category,
         meta_template_id = COALESCE(EXCLUDED.meta_template_id, tenant_templates.meta_template_id),
         status = EXCLUDED.status,
         last_error = EXCLUDED.last_error,
         updated_at = NOW()`,
    [
      tenantId,
      template.name,
      template.language,
      fields.category || template.category,
      fields.metaTemplateId || null,
      fields.status,
      fields.lastError || null
    ]
  );
}

/**
 * Creates the standard templates on the clinic's own WhatsApp Business account.
 * Templates that already exist there are only recorded, never created again.
 * @returns {Promise<Array<{name, status, error}>>}
 */
async function createTemplatesForTenant(tenantId) {
  const { wabaId, token } = await loadConnection(tenantId);

  let existing;
  try {
    existing = await listMetaTemplates(wabaId, token);
  } catch (err) {
    logger.warn(`TEMPLATES_CREATE tenant=${tenantId} list_failed ${metaFailure(err)}`);
    throw new TemplateError(`Could not read the existing templates from Meta (${metaFailure(err)})`, 502);
  }
  const existingByKey = new Map(existing.map(t => [templateKey(t.name, t.language), t]));

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const summary = [];
  let created = 0;
  let existingCount = 0;
  let failed = 0;

  for (const template of TEMPLATES) {
    try {
      const already = existingByKey.get(templateKey(template.name, template.language));
      if (already) {
        await upsertTemplateRow(tenantId, template, {
          category: already.category,
          metaTemplateId: already.id,
          status: already.status || 'PENDING'
        });
        existingCount++;
        summary.push({ name: template.name, status: already.status || 'PENDING', error: null, existing: true });
        continue;
      }

      const res = await axios.post(
        `${META_API_URL}/${wabaId}/message_templates`,
        {
          name: template.name,
          language: template.language,
          category: template.category,
          components: buildComponents(template)
        },
        { headers }
      );
      const status = res.data?.status || 'PENDING';
      await upsertTemplateRow(tenantId, template, {
        category: res.data?.category || template.category,
        metaTemplateId: res.data?.id ? String(res.data.id) : null,
        status
      });
      created++;
      summary.push({ name: template.name, status, error: null, existing: false });
    } catch (err) {
      const message = err.response ? metaFailure(err) : String(err.message || 'failed').slice(0, 200);
      failed++;
      summary.push({ name: template.name, status: 'ERROR', error: message });
      try {
        await upsertTemplateRow(tenantId, template, { status: 'ERROR', lastError: message });
      } catch (dbErr) {
        logger.warn(`TEMPLATES_CREATE tenant=${tenantId} could not record the result for ${template.name}`);
      }
    }
  }

  logger.info(`TEMPLATES_CREATE tenant=${tenantId} created=${created} existing=${existingCount} failed=${failed}`);
  return summary;
}

/**
 * Re-reads the statuses from Meta and updates this tenant's rows (status, category, template id).
 * A row whose template is no longer on the WhatsApp account becomes NOT_FOUND.
 * @returns {Promise<Array>} the tenant's rows
 */
async function refreshTemplateStatuses(tenantId) {
  const { wabaId, token } = await loadConnection(tenantId);

  let existing;
  try {
    existing = await listMetaTemplates(wabaId, token);
  } catch (err) {
    logger.warn(`TEMPLATES_REFRESH tenant=${tenantId} list_failed ${metaFailure(err)}`);
    throw new TemplateError(`Could not read the templates from Meta (${metaFailure(err)})`, 502);
  }
  const existingByKey = new Map(existing.map(t => [templateKey(t.name, t.language), t]));

  const rows = await pool.query(
    'SELECT id, name, language FROM tenant_templates WHERE tenant_id = $1',
    [tenantId]
  );
  let updated = 0;
  let missing = 0;
  for (const row of rows.rows) {
    const meta = existingByKey.get(templateKey(row.name, row.language));
    if (meta) {
      await pool.query(
        `UPDATE tenant_templates
         SET status = $1, category = COALESCE($2, category), meta_template_id = COALESCE($3, meta_template_id),
             last_error = NULL, updated_at = NOW()
         WHERE id = $4`,
        [meta.status || 'PENDING', meta.category || null, meta.id ? String(meta.id) : null, row.id]
      );
      updated++;
    } else {
      await pool.query(
        `UPDATE tenant_templates
         SET status = 'NOT_FOUND', last_error = 'Template not found on the WhatsApp account', updated_at = NOW()
         WHERE id = $1`,
        [row.id]
      );
      missing++;
    }
  }

  logger.info(`TEMPLATES_REFRESH tenant=${tenantId} updated=${updated} not_found=${missing}`);
  return getTenantTemplates(tenantId);
}

async function getTenantTemplates(tenantId) {
  if (!tenantId || !UUID_PATTERN.test(String(tenantId))) {
    throw new TemplateError('Invalid tenant id', 400);
  }
  const res = await pool.query(
    `SELECT id, name, language, category, meta_template_id, status, last_error, created_at, updated_at
     FROM tenant_templates WHERE tenant_id = $1 ORDER BY name`,
    [tenantId]
  );
  return res.rows;
}

// ---------------------------------------------------------------------------
// One reusable poster template per clinic: an image header, three body variables and a "Stop offers" button.
// The sample image is the clinic's approved poster (poster_requests), uploaded to Meta with the Resumable Upload API.
// ---------------------------------------------------------------------------

const POSTER_TEMPLATE = {
  name: 'clinic_poster',
  language: 'en',
  category: 'MARKETING',
  body: 'Hello {{1}}, here is the latest from {{2}}.\n\n{{3}}\n\nReply STOP to stop receiving offers.',
  bodyExamples: ['Priya', 'Skin Clinic', 'Free skin check-up camp this Saturday, 10 am to 1 pm'],
  buttons: ['Stop offers']
};
const POSTER_BUCKET = 'receptionai-poster-uploads';
const POSTER_URL_PREFIX = `https://storage.googleapis.com/${POSTER_BUCKET}/`;
const POSTER_MIME_BY_EXTENSION = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// Downloads the poster bytes from the bucket (default credentials). The object name is recovered from image_url:
// the stored value is not URL-encoded, so the raw name is tried first and the decoded one second.
async function downloadPoster(imageUrl) {
  if (!imageUrl || !String(imageUrl).startsWith(POSTER_URL_PREFIX)) {
    throw new TemplateError('The poster file is not in the poster bucket', 400);
  }
  const rawName = String(imageUrl).slice(POSTER_URL_PREFIX.length);
  let decodedName = rawName;
  try { decodedName = decodeURIComponent(rawName); } catch (_) { /* keep the raw name */ }

  const { Storage } = require('@google-cloud/storage');
  const bucket = new Storage().bucket(POSTER_BUCKET);
  let lastErr = null;
  for (const objectName of [...new Set([rawName, decodedName])]) {
    try {
      const file = bucket.file(objectName);
      const [buffer] = await file.download();
      let mimeType = null;
      try {
        const [metadata] = await file.getMetadata();
        mimeType = metadata?.contentType || null;
      } catch (_) { /* fall back to the extension */ }
      if (!mimeType) {
        mimeType = POSTER_MIME_BY_EXTENSION[objectName.split('.').pop().toLowerCase()] || null;
      }
      return { buffer, mimeType, fileName: objectName.split('/').pop() };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new TemplateError(`Could not read the poster file (${String(lastErr?.message || 'unknown').slice(0, 120)})`, 502);
}

async function createPosterTemplateInner(tenantId, posterRequestId) {
  const { wabaId, token } = await loadConnection(tenantId);
  if (!posterRequestId || !UUID_PATTERN.test(String(posterRequestId))) {
    throw new TemplateError('poster_request_id is required and must be a valid id', 400);
  }

  const posterRes = await pool.query(
    'SELECT id, tenant_id, image_url, status FROM poster_requests WHERE id = $1 AND tenant_id = $2',
    [posterRequestId, tenantId]
  );
  if (!posterRes.rows.length) throw new TemplateError('Poster request not found for this clinic', 404);
  const poster = posterRes.rows[0];
  if (poster.status !== 'approved') throw new TemplateError('The poster request is not approved', 409);

  const existing = await pool.query(
    'SELECT status FROM tenant_templates WHERE tenant_id = $1 AND name = $2 AND language = $3',
    [tenantId, POSTER_TEMPLATE.name, POSTER_TEMPLATE.language]
  );
  if (existing.rows.length) {
    throw new TemplateError(`This clinic already has a poster template (${POSTER_TEMPLATE.name}, status ${existing.rows[0].status})`, 409);
  }

  const appId = process.env.META_APP_ID;
  if (!appId) throw new TemplateError('META_APP_ID is not configured on the server', 500);

  const { buffer, mimeType, fileName } = await downloadPoster(poster.image_url);
  if (mimeType !== 'image/jpeg' && mimeType !== 'image/png') {
    throw new TemplateError('The poster must be JPEG or PNG for a WhatsApp template', 400);
  }

  let sampleHandle;
  try {
    sampleHandle = await uploadTemplateSample({ appId, token, buffer, mimeType, fileName });
  } catch (err) {
    const upload = new TemplateError(`Meta upload failed${err.metaCode ? ` (code ${err.metaCode})` : ''}: ${String(err.message).slice(0, 200)}`, 502);
    upload.metaCode = err.metaCode ?? null;
    throw upload;
  }

  let created;
  try {
    const res = await axios.post(
      `${META_API_URL}/${wabaId}/message_templates`,
      {
        name: POSTER_TEMPLATE.name,
        language: POSTER_TEMPLATE.language,
        category: POSTER_TEMPLATE.category,
        components: buildComponents({ ...POSTER_TEMPLATE, header: { format: 'IMAGE', sampleHandle } })
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 20000 }
    );
    created = res.data || {};
  } catch (err) {
    const failure = new TemplateError(`Meta rejected the poster template: ${metaFailure(err)}`, 502);
    failure.metaCode = Number.isInteger(Number(err.response?.data?.error?.code)) ? Number(err.response.data.error.code) : null;
    throw failure;
  }

  await upsertTemplateRow(tenantId, POSTER_TEMPLATE, {
    category: created.category || POSTER_TEMPLATE.category,
    metaTemplateId: created.id ? String(created.id) : null,
    status: created.status || 'PENDING'
  });
  const row = await pool.query(
    `SELECT id, name, language, category, meta_template_id, status, last_error, created_at, updated_at
     FROM tenant_templates WHERE tenant_id = $1 AND name = $2 AND language = $3`,
    [tenantId, POSTER_TEMPLATE.name, POSTER_TEMPLATE.language]
  );
  return { status: created.status || 'PENDING', template: row.rows[0] };
}

/**
 * Creates the clinic's poster template from an approved poster request. One Meta call to upload the sample, one to create.
 * @returns {Promise<{status, template}>}
 */
async function createPosterTemplate(tenantId, posterRequestId) {
  try {
    const result = await createPosterTemplateInner(tenantId, posterRequestId);
    logger.info(`META_POSTER_TEMPLATE tenant=${tenantId} result=ok code=none`);
    return result;
  } catch (err) {
    logger.info(`META_POSTER_TEMPLATE tenant=${tenantId} result=failed code=${err?.metaCode ?? 'none'}`);
    throw err;
  }
}

module.exports = {
  createTemplatesForTenant,
  refreshTemplateStatuses,
  getTenantTemplates,
  createPosterTemplate,
  buildComponents,
  TemplateError,
  // shared with the read-only WABA info service
  loadConnection,
  metaFailure,
  META_API_URL
};
