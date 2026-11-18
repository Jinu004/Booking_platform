const { Storage } = require('@google-cloud/storage')
const { v4: uuidv4 } = require('uuid')
const pool = require('../../config/database')
const { successResponse, errorResponse } = require('../../utils/response')
const logger = require('../../utils/logger')

const storage = new Storage()
const BUCKET = process.env.POSTER_BUCKET_NAME || 'receptionai-posters-prod'

// Reads the magic bytes of an uploaded file: JPEG (FF D8 FF), PNG (89 50 4E 47 0D 0A 1A 0A) or WebP ("RIFF" .... "WEBP").
// Returns { mime, ext } or null for anything else.
function detectImageType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' }
  return null
}

async function submitPosterRequest(req, res) {
  try {
    const { id: tenantId } = req.params

    if (req.staff.role !== 'super_admin' && req.staff.tenantId !== tenantId) {
      return errorResponse(res, 'Forbidden: tenant mismatch', 403)
    }

    if (!req.file) {
      return errorResponse(res, 'Poster image is required', 400)
    }

    // The caption is the text patients see under the poster: required, checked before anything is uploaded
    const caption = String(req.body.caption || '').trim()
    if (!caption) {
      return errorResponse(res, 'Please add a caption. It is the text patients see under the poster.', 400)
    }
    if (caption.length > 300) {
      return errorResponse(res, 'Caption is too long (maximum 300 characters).', 400)
    }
    // The file header decides the type (the client's MIME header and filename are not trusted)
    const detected = detectImageType(req.file.buffer)
    if (!detected) {
      return errorResponse(res, 'Only JPEG, PNG or WebP images are allowed', 400)
    }
    // Stored name: generated id plus the extension of the verified type, never the client's original filename
    const filename = `${tenantId}/${uuidv4()}.${detected.ext}`

    const bucket = storage.bucket(BUCKET)
    const blob = bucket.file(filename)
    await blob.save(req.file.buffer, {
      contentType: detected.mime,
      metadata: { cacheControl: 'public, max-age=31536000' }
    })

    const imageUrl = `https://storage.googleapis.com/${BUCKET}/${filename}`

    const result = await pool.query(
      `INSERT INTO poster_requests (tenant_id, image_url, caption)
       VALUES ($1, $2, $3) RETURNING *`,
      [tenantId, imageUrl, caption]
    )

    return successResponse(res, result.rows[0], 201)
  } catch (err) {
    logger.error('Poster upload failed:', err.message)
    return errorResponse(res, 'Failed to upload poster', 500)
  }
}

async function getPosterRequests(req, res) {
  try {
    const { id: tenantId } = req.params

    if (req.staff.role !== 'super_admin' && req.staff.tenantId !== tenantId) {
      return errorResponse(res, 'Forbidden: tenant mismatch', 403)
    }

    const result = await pool.query(
      `SELECT * FROM poster_requests WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId]
    )

    return successResponse(res, result.rows)
  } catch (err) {
    logger.error('Error fetching poster requests:', err.message)
    return errorResponse(res, 'Failed to fetch poster requests', 500)
  }
}

// ---------------------------------------------------------------------------
// Poster image viewing: the bucket is private, so the image is streamed through an authenticated route.
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// Reads the object of a poster request and sends it. Logs only the poster request id (never the object name or URL).
async function sendPosterImage(res, poster) {
  let file
  try {
    const { downloadPoster } = require('../waba/waba.templates.service')
    file = await downloadPoster(poster.image_url)
  } catch (err) {
    logger.warn(`POSTER_IMAGE poster=${poster.id} result=not_found`)
    return errorResponse(res, 'Poster image not found', 404)
  }
  if (!IMAGE_TYPES.includes(file.mimeType)) {
    logger.warn(`POSTER_IMAGE poster=${poster.id} result=unsupported_type`)
    return errorResponse(res, 'Poster file is not an image', 415)
  }
  res.set({
    'Content-Type': file.mimeType,
    'Content-Disposition': 'inline',
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': String(file.buffer.length)
  })
  return res.status(200).send(file.buffer)
}

// GET /tenants/:id/poster-requests/:requestId/image  (admin and manager of that clinic)
async function getPosterImage(req, res) {
  try {
    const { id: tenantId, requestId } = req.params

    if (req.staff.role !== 'super_admin' && req.staff.tenantId !== tenantId) {
      return errorResponse(res, 'Forbidden: tenant mismatch', 403)
    }
    if (!UUID_RE.test(String(tenantId)) || !UUID_RE.test(String(requestId))) {
      return errorResponse(res, 'Poster request not found', 404)
    }

    const result = await pool.query(
      'SELECT id, image_url FROM poster_requests WHERE id = $1 AND tenant_id = $2',
      [requestId, tenantId]
    )
    if (!result.rows.length) return errorResponse(res, 'Poster request not found', 404)
    return sendPosterImage(res, result.rows[0])
  } catch (err) {
    logger.error('Error streaming poster image:', err.message)
    return errorResponse(res, 'Failed to load poster image', 500)
  }
}

// GET /superadmin/poster-requests/:id/image  (super admin: any clinic)
async function getPosterImageAsSuperAdmin(req, res) {
  try {
    const { id } = req.params
    if (!UUID_RE.test(String(id))) return errorResponse(res, 'Poster request not found', 404)

    const result = await pool.query('SELECT id, image_url FROM poster_requests WHERE id = $1', [id])
    if (!result.rows.length) return errorResponse(res, 'Poster request not found', 404)
    return sendPosterImage(res, result.rows[0])
  } catch (err) {
    logger.error('Error streaming poster image:', err.message)
    return errorResponse(res, 'Failed to load poster image', 500)
  }
}

module.exports = { submitPosterRequest, getPosterRequests, getPosterImage, getPosterImageAsSuperAdmin }
