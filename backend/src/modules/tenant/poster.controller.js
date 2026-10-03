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

module.exports = { submitPosterRequest }
