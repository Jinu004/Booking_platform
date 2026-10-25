const pool = require('../../config/database')
const { successResponse, errorResponse } = require('../../utils/response')
const TenantService = require('../tenant/tenant.service')
const { logAction } = require('../../utils/audit')
const { sanitizeKnowledgeBase } = require('./settings.controller')

// Data layer of the guided clinic knowledge base (migration 045): short answers, treatments, offers and unanswered questions.
// Every route is admin or manager only (settings.routes.js), tenant-scoped from the login (req.tenantId), and every query carries tenant_id.
// Reads work on any plan (the page shows a lock message); writes need the growth or pro plan, checked here on the server.
// Nothing here is cached, and nothing in the AI path reads these tables yet.

const MAX_TREATMENTS = 60
const MAX_OFFERS = 20
const MAX_QA = 10

const FAQ_LIMITS = {
  clinic_phone: 20,
  address: 300,
  maps_link: 300,
  payment_methods: 400,
  cancellation_policy: 400,
  emergency_instructions: 400,
  closed_days: 400,
  facilities: 400,
  staff_languages: 400,
  never_answer: 400
}

const isUUID = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
const isISODate = (str) => typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str))
  && new Date(`${str}T00:00:00Z`).toISOString().slice(0, 10) === str
const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)

// Writes are for growth and pro clinics only. Returns true when it has already answered 403.
function blockedByPlan(req, res) {
  if (['growth', 'pro'].includes(req.tenant?.plan)) return false
  errorResponse(res, 'This feature is available on the Growth and Pro plans.', 403)
  return true
}

// One text value: must be a string, trimmed, within the limit, and passed through the same injection filter as the knowledge base.
// The limit is checked before and after the filter (the filter's replacement text can be longer than what it replaces).
function cleanText(value, label, max, { required = false } = {}) {
  if (typeof value !== 'string') return { ok: false, message: `${label} must be text` }
  const trimmed = value.trim()
  if (trimmed.length > max) return { ok: false, message: `${label} is too long (maximum ${max} characters)` }
  if (required && !trimmed) return { ok: false, message: `${label} is required` }
  const cleaned = trimmed ? sanitizeKnowledgeBase(trimmed, 'pro').trim() : ''
  if (cleaned.length > max) return { ok: false, message: `${label} is too long (maximum ${max} characters)` }
  return { ok: true, value: cleaned }
}

async function audit(req, action, entityType, entityId, fields) {
  // Ids and field names only, never the text
  await logAction({
    tenantId: req.tenantId,
    staffId: req.staff?.id,
    action,
    entityType,
    entityId,
    metadata: fields && fields.length ? { fields } : null,
    ipAddress: req.ip
  })
}

// UPDATE of the given columns of one row of this clinic. sets: [[column, value, sqlCast]]. Column names are fixed strings from this file.
async function updateRow(table, id, tenantId, sets) {
  const params = [id, tenantId]
  const parts = sets.map(([column, value, cast]) => {
    params.push(value)
    return `${column} = $${params.length}${cast ? `::${cast}` : ''}`
  })
  parts.push('updated_at = NOW()')
  const result = await pool.query(
    `UPDATE ${table} SET ${parts.join(', ')} WHERE id = $1::uuid AND tenant_id = $2::uuid RETURNING id`,
    params
  )
  return result.rows[0] || null
}

// ---------------------------------------------------------------------------
// Short answers: GET and PUT /settings/ai-faq
// ---------------------------------------------------------------------------

const withAllFaqKeys = (stored) => {
  const source = isPlainObject(stored) ? stored : {}
  return Object.fromEntries(Object.keys(FAQ_LIMITS).map(key => [key, typeof source[key] === 'string' ? source[key] : '']))
}

async function getAiFaq(req, res, next) {
  try {
    const result = await pool.query('SELECT ai_faq FROM tenant_settings WHERE tenant_id = $1', [req.tenantId])
    return successResponse(res, withAllFaqKeys(result.rows[0]?.ai_faq))
  } catch (err) {
    next(err)
  }
}

// Body: any of the allowed keys with text values. A key sent with an empty string is removed (skipped); keys not sent are left alone.
async function putAiFaq(req, res, next) {
  try {
    if (blockedByPlan(req, res)) return
    const body = req.body
    if (!isPlainObject(body)) return errorResponse(res, 'Send an object with the answers to save', 400)
    const keys = Object.keys(body)
    if (keys.length === 0) return errorResponse(res, 'Nothing to save', 400)

    const toSet = {}
    const toRemove = []
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(FAQ_LIMITS, key)) {
        return errorResponse(res, `Unknown field: ${String(key).replace(/[^A-Za-z0-9_]/g, '').slice(0, 40)}`, 400)
      }
      const checked = cleanText(body[key], key, FAQ_LIMITS[key])
      if (!checked.ok) return errorResponse(res, checked.message, 400)
      if (checked.value === '') toRemove.push(key)
      else toSet[key] = checked.value
    }

    await TenantService.ensureTenantSettings(req.tenantId)
    const result = await pool.query(
      `UPDATE tenant_settings
       SET ai_faq = ((ai_faq || $2::jsonb) - $3::text[]), updated_at = NOW()
       WHERE tenant_id = $1
       RETURNING ai_faq`,
      [req.tenantId, JSON.stringify(toSet), toRemove]
    )
    await audit(req, 'ai_faq_updated', 'ai_faq', req.tenantId, keys)
    await TenantService.touchAiInfo(req.tenantId)
    return successResponse(res, withAllFaqKeys(result.rows[0]?.ai_faq))
  } catch (err) {
    next(err)
  }
}

// ---------------------------------------------------------------------------
// Treatments: /settings/treatments
// ---------------------------------------------------------------------------

const TREATMENT_COLUMNS = 'id, name, price_text, details, sort_order, is_active, created_at, updated_at'

function readTreatment(body, partial) {
  if (!isPlainObject(body)) return { error: 'Send an object with the treatment details' }
  const out = {}
  if (!partial || body.name !== undefined) {
    const name = cleanText(body.name === undefined ? '' : body.name, 'Name', 120, { required: true })
    if (!name.ok) return { error: name.message }
    out.name = name.value
  }
  for (const [key, label, max] of [['price_text', 'Price', 60], ['details', 'Details', 300]]) {
    if (body[key] === undefined) continue
    if (body[key] === null) { out[key] = null; continue }
    const text = cleanText(body[key], label, max)
    if (!text.ok) return { error: text.message }
    out[key] = text.value === '' ? null : text.value
  }
  if (body.sort_order !== undefined) {
    if (!Number.isInteger(body.sort_order) || body.sort_order < 0 || body.sort_order > 100000) {
      return { error: 'Sort order must be a whole number from 0 to 100000' }
    }
    out.sort_order = body.sort_order
  }
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== 'boolean') return { error: 'Active must be true or false' }
    out.is_active = body.is_active
  }
  return { values: out }
}

async function listTreatments(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT ${TREATMENT_COLUMNS} FROM clinic_treatments WHERE tenant_id = $1 ORDER BY sort_order ASC, created_at ASC`,
      [req.tenantId]
    )
    return successResponse(res, result.rows)
  } catch (err) {
    next(err)
  }
}

async function createTreatment(req, res, next) {
  try {
    if (blockedByPlan(req, res)) return
    const read = readTreatment(req.body, false)
    if (read.error) return errorResponse(res, read.error, 400)
    const v = read.values
    // The limit is part of the insert, so it holds even for two simultaneous requests
    const result = await pool.query(
      `INSERT INTO clinic_treatments (tenant_id, name, price_text, details, sort_order, is_active)
       SELECT $1::uuid, $2::varchar, $3::varchar, $4::varchar,
              COALESCE($5::int, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM clinic_treatments WHERE tenant_id = $1::uuid)),
              COALESCE($6::boolean, true)
       WHERE (SELECT COUNT(*) FROM clinic_treatments WHERE tenant_id = $1::uuid) < ${MAX_TREATMENTS}
       RETURNING ${TREATMENT_COLUMNS}`,
      [req.tenantId, v.name, v.price_text ?? null, v.details ?? null, v.sort_order ?? null, v.is_active ?? null]
    )
    if (!result.rows.length) return errorResponse(res, `You can add up to ${MAX_TREATMENTS} treatments`, 409)
    await audit(req, 'treatment_created', 'clinic_treatment', result.rows[0].id, Object.keys(v))
    await TenantService.touchAiInfo(req.tenantId)
    return successResponse(res, result.rows[0], 201)
  } catch (err) {
    next(err)
  }
}

async function updateTreatment(req, res, next) {
  try {
    if (blockedByPlan(req, res)) return
    if (!isUUID(req.params.id)) return errorResponse(res, 'Invalid treatment id', 400)
    const read = readTreatment(req.body, true)
    if (read.error) return errorResponse(res, read.error, 400)
    const v = read.values
    const sets = Object.keys(v).map(column => [column, v[column], column === 'sort_order' ? 'int' : column === 'is_active' ? 'boolean' : 'varchar'])
    if (!sets.length) return errorResponse(res, 'Nothing to update', 400)
    const updated = await updateRow('clinic_treatments', req.params.id, req.tenantId, sets)
    if (!updated) return errorResponse(res, 'Treatment not found', 404)
    const result = await pool.query(`SELECT ${TREATMENT_COLUMNS} FROM clinic_treatments WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.tenantId])
    await audit(req, 'treatment_updated', 'clinic_treatment', req.params.id, Object.keys(v))
    await TenantService.touchAiInfo(req.tenantId)
    return successResponse(res, result.rows[0])
  } catch (err) {
    next(err)
  }
}

async function deleteTreatment(req, res, next) {
  try {
    if (blockedByPlan(req, res)) return
    if (!isUUID(req.params.id)) return errorResponse(res, 'Invalid treatment id', 400)
    const result = await pool.query('DELETE FROM clinic_treatments WHERE id = $1 AND tenant_id = $2 RETURNING id', [req.params.id, req.tenantId])
    if (!result.rows.length) return errorResponse(res, 'Treatment not found', 404)
    await audit(req, 'treatment_deleted', 'clinic_treatment', req.params.id, null)
    await TenantService.touchAiInfo(req.tenantId)
    return successResponse(res, { id: req.params.id })
  } catch (err) {
    next(err)
  }
}

// ---------------------------------------------------------------------------
// Offers: /settings/offers
// ---------------------------------------------------------------------------

// Dates come out as plain YYYY-MM-DD text; is_running is computed with today's date in IST
const OFFER_SELECT = `
  SELECT id, title, details,
         to_char(start_date, 'YYYY-MM-DD') AS start_date,
         to_char(end_date, 'YYYY-MM-DD') AS end_date,
         qa, poster_request_id, is_active, created_at, updated_at,
         (is_active AND (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date BETWEEN start_date AND end_date) AS is_running
  FROM clinic_offers`

// qa: up to 10 { q, a } pairs, both texts required
function readQa(value) {
  if (!Array.isArray(value)) return { error: 'Questions and answers must be a list' }
  if (value.length > MAX_QA) return { error: `An offer can have up to ${MAX_QA} questions` }
  const out = []
  for (const item of value) {
    if (!isPlainObject(item)) return { error: 'Each question needs a question and an answer' }
    const q = cleanText(item.q, 'Question', 200, { required: true })
    if (!q.ok) return { error: q.message }
    const a = cleanText(item.a, 'Answer', 400, { required: true })
    if (!a.ok) return { error: a.message }
    out.push({ q: q.value, a: a.value })
  }
  return { value: out }
}

// existing: the stored row (as YYYY-MM-DD text) when this is an update, so the dates can be checked together
function readOffer(body, partial, existing) {
  if (!isPlainObject(body)) return { error: 'Send an object with the offer details' }
  const out = {}
  if (!partial || body.title !== undefined) {
    const title = cleanText(body.title === undefined ? '' : body.title, 'Title', 120, { required: true })
    if (!title.ok) return { error: title.message }
    out.title = title.value
  }
  if (body.details !== undefined) {
    if (body.details === null) out.details = null
    else {
      const details = cleanText(body.details, 'Details', 500)
      if (!details.ok) return { error: details.message }
      out.details = details.value === '' ? null : details.value
    }
  }
  for (const [key, label] of [['start_date', 'Start date'], ['end_date', 'End date']]) {
    if (!partial || body[key] !== undefined) {
      if (!isISODate(body[key])) return { error: `${label} must be a valid date (YYYY-MM-DD)` }
      out[key] = body[key]
    }
  }
  const start = out.start_date || (existing && existing.start_date)
  const end = out.end_date || (existing && existing.end_date)
  if (start && end && end < start) return { error: 'The end date must be on or after the start date' }
  if (body.qa !== undefined) {
    const qa = readQa(body.qa)
    if (qa.error) return { error: qa.error }
    out.qa = qa.value
  }
  if (body.poster_request_id !== undefined) {
    if (body.poster_request_id !== null && !isUUID(body.poster_request_id)) return { error: 'Invalid poster' }
    out.poster_request_id = body.poster_request_id
  }
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== 'boolean') return { error: 'Active must be true or false' }
    out.is_active = body.is_active
  }
  return { values: out }
}

// A poster given for an offer must be one of this clinic's own
async function posterBelongsToTenant(posterId, tenantId) {
  if (posterId === null || posterId === undefined) return true
  const result = await pool.query('SELECT 1 FROM poster_requests WHERE id = $1 AND tenant_id = $2', [posterId, tenantId])
  return result.rows.length > 0
}

async function listOffers(req, res, next) {
  try {
    const result = await pool.query(`${OFFER_SELECT} WHERE tenant_id = $1 ORDER BY start_date DESC, created_at DESC`, [req.tenantId])
    return successResponse(res, result.rows)
  } catch (err) {
    next(err)
  }
}

async function createOffer(req, res, next) {
  try {
    if (blockedByPlan(req, res)) return
    const read = readOffer(req.body, false, null)
    if (read.error) return errorResponse(res, read.error, 400)
    const v = read.values
    if (!(await posterBelongsToTenant(v.poster_request_id, req.tenantId))) return errorResponse(res, 'Poster not found', 400)
    const result = await pool.query(
      `INSERT INTO clinic_offers (tenant_id, title, details, start_date, end_date, qa, poster_request_id, is_active)
       SELECT $1::uuid, $2::varchar, $3::varchar, $4::date, $5::date, $6::jsonb, $7::uuid, COALESCE($8::boolean, true)
       WHERE (SELECT COUNT(*) FROM clinic_offers WHERE tenant_id = $1::uuid) < ${MAX_OFFERS}
       RETURNING id`,
      [req.tenantId, v.title, v.details ?? null, v.start_date, v.end_date, JSON.stringify(v.qa || []), v.poster_request_id ?? null, v.is_active ?? null]
    )
    if (!result.rows.length) return errorResponse(res, `You can add up to ${MAX_OFFERS} offers`, 409)
    const id = result.rows[0].id
    const saved = await pool.query(`${OFFER_SELECT} WHERE id = $1 AND tenant_id = $2`, [id, req.tenantId])
    await audit(req, 'offer_created', 'clinic_offer', id, Object.keys(v))
    await TenantService.touchAiInfo(req.tenantId)
    return successResponse(res, saved.rows[0], 201)
  } catch (err) {
    next(err)
  }
}

async function updateOffer(req, res, next) {
  try {
    if (blockedByPlan(req, res)) return
    if (!isUUID(req.params.id)) return errorResponse(res, 'Invalid offer id', 400)
    const current = await pool.query(`${OFFER_SELECT} WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.tenantId])
    if (!current.rows.length) return errorResponse(res, 'Offer not found', 404)
    const read = readOffer(req.body, true, current.rows[0])
    if (read.error) return errorResponse(res, read.error, 400)
    const v = read.values
    if (v.poster_request_id !== undefined && !(await posterBelongsToTenant(v.poster_request_id, req.tenantId))) {
      return errorResponse(res, 'Poster not found', 400)
    }
    const casts = { title: 'varchar', details: 'varchar', start_date: 'date', end_date: 'date', qa: 'jsonb', poster_request_id: 'uuid', is_active: 'boolean' }
    const sets = Object.keys(v).map(column => [column, column === 'qa' ? JSON.stringify(v.qa) : v[column], casts[column]])
    if (!sets.length) return errorResponse(res, 'Nothing to update', 400)
    const updated = await updateRow('clinic_offers', req.params.id, req.tenantId, sets)
    if (!updated) return errorResponse(res, 'Offer not found', 404)
    const saved = await pool.query(`${OFFER_SELECT} WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.tenantId])
    await audit(req, 'offer_updated', 'clinic_offer', req.params.id, Object.keys(v))
    await TenantService.touchAiInfo(req.tenantId)
    return successResponse(res, saved.rows[0])
  } catch (err) {
    next(err)
  }
}

async function deleteOffer(req, res, next) {
  try {
    if (blockedByPlan(req, res)) return
    if (!isUUID(req.params.id)) return errorResponse(res, 'Invalid offer id', 400)
    const result = await pool.query('DELETE FROM clinic_offers WHERE id = $1 AND tenant_id = $2 RETURNING id', [req.params.id, req.tenantId])
    if (!result.rows.length) return errorResponse(res, 'Offer not found', 404)
    await audit(req, 'offer_deleted', 'clinic_offer', req.params.id, null)
    await TenantService.touchAiInfo(req.tenantId)
    return successResponse(res, { id: req.params.id })
  } catch (err) {
    next(err)
  }
}

// ---------------------------------------------------------------------------
// Unanswered questions: GET /settings/unanswered-questions, PATCH /settings/unanswered-questions/:id/resolve
// ---------------------------------------------------------------------------

async function listUnansweredQuestions(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT id, question, conversation_id, created_at, resolved_at
       FROM unanswered_questions
       WHERE tenant_id = $1
       ORDER BY (resolved_at IS NOT NULL) ASC, created_at DESC
       LIMIT 50`,
      [req.tenantId]
    )
    return successResponse(res, result.rows)
  } catch (err) {
    next(err)
  }
}

async function resolveUnansweredQuestion(req, res, next) {
  try {
    if (blockedByPlan(req, res)) return
    if (!isUUID(req.params.id)) return errorResponse(res, 'Invalid question id', 400)
    const result = await pool.query(
      `UPDATE unanswered_questions SET resolved_at = COALESCE(resolved_at, NOW())
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, question, conversation_id, created_at, resolved_at`,
      [req.params.id, req.tenantId]
    )
    if (!result.rows.length) return errorResponse(res, 'Question not found', 404)
    await audit(req, 'unanswered_question_resolved', 'unanswered_question', req.params.id, null)
    return successResponse(res, result.rows[0])
  } catch (err) {
    next(err)
  }
}

module.exports = {
  getAiFaq,
  putAiFaq,
  listTreatments,
  createTreatment,
  updateTreatment,
  deleteTreatment,
  listOffers,
  createOffer,
  updateOffer,
  deleteOffer,
  listUnansweredQuestions,
  resolveUnansweredQuestion
}
