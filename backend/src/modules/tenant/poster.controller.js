const { Storage } = require('@google-cloud/storage')
const { v4: uuidv4 } = require('uuid')
const pool = require('../../config/database')
const { successResponse, errorResponse } = require('../../utils/response')
const logger = require('../../utils/logger')

const storage = new Storage()
const BUCKET = 'receptionai-poster-uploads'

async function submitPosterRequest(req, res) {
  try {
    const { id: tenantId } = req.params

    if (req.staff.role !== 'super_admin' && req.staff.tenantId !== tenantId) {
      return errorResponse(res, 'Forbidden: tenant mismatch', 403)
    }

    if (!req.file) {
      return errorResponse(res, 'Poster image is required', 400)
    }

    const caption = req.body.caption || null
    const ext = req.file.originalname.split('.').pop()
    const filename = `${tenantId}/${uuidv4()}-${req.file.originalname}`

    const bucket = storage.bucket(BUCKET)
    const blob = bucket.file(filename)
    await blob.save(req.file.buffer, {
      contentType: req.file.mimetype,
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
