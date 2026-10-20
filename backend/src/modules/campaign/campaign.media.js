const pool = require('../../config/database')
const logger = require('../../utils/logger')
const { runAsTenant } = require('../channel/whatsapp/senderContext')
const { uploadMedia } = require('../channel/whatsapp/whatsapp.meta')
const { downloadPoster } = require('../waba/waba.templates.service')
const { CampaignError } = require('./campaign.service')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ALLOWED_TYPES = ['image/jpeg', 'image/png']

function logResult(tenantId, campaignId, result) {
  logger.info(`CAMPAIGN_MEDIA tenant=${tenantId} campaign=${campaignId} result=${result}`)
}

/**
 * Makes sure the (draft, running or paused) campaign's poster is uploaded to the clinic's own WhatsApp account and returns the Meta media id.
 * The clinic's own token and phone number id are required: the shared platform token is never used.
 * Nothing calls this yet.
 * @returns {Promise<string>} campaigns.meta_media_id
 */
async function ensureCampaignMedia(tenantId, campaignId) {
  if (!UUID_RE.test(String(tenantId)) || !UUID_RE.test(String(campaignId))) {
    throw new CampaignError('Campaign not found', 404)
  }

  const campaignRes = await pool.query(
    'SELECT id, status, meta_media_id, poster_request_id FROM campaigns WHERE id = $1 AND tenant_id = $2',
    [campaignId, tenantId]
  )
  const campaign = campaignRes.rows[0]
  if (!campaign) throw new CampaignError('Campaign not found', 404)
  if (!['draft', 'running', 'paused'].includes(campaign.status)) {
    throw new CampaignError('The poster cannot be uploaded for a completed or cancelled campaign', 409)
  }
  if (campaign.meta_media_id) {
    logResult(tenantId, campaignId, 'already_uploaded')
    return campaign.meta_media_id
  }
  if (!campaign.poster_request_id) {
    logResult(tenantId, campaignId, 'no_poster')
    throw new CampaignError('The poster for this campaign no longer exists', 409)
  }

  // The clinic must have its own token and phone number id; uploadMedia would otherwise fall back to the shared token
  const tenantRes = await pool.query(
    'SELECT whatsapp_access_token_enc, whatsapp_phone_number_id FROM tenants WHERE id = $1',
    [tenantId]
  )
  const tenant = tenantRes.rows[0]
  if (!tenant || !tenant.whatsapp_access_token_enc || !tenant.whatsapp_phone_number_id) {
    logResult(tenantId, campaignId, 'not_connected')
    throw new CampaignError('This clinic has no WhatsApp connection of its own (token or phone number id is missing)', 409)
  }

  const posterRes = await pool.query(
    'SELECT image_url FROM poster_requests WHERE id = $1 AND tenant_id = $2',
    [campaign.poster_request_id, tenantId]
  )
  if (!posterRes.rows.length) {
    logResult(tenantId, campaignId, 'no_poster')
    throw new CampaignError('The poster for this campaign no longer exists', 409)
  }

  let poster
  try {
    poster = await downloadPoster(posterRes.rows[0].image_url)
  } catch (err) {
    logResult(tenantId, campaignId, 'poster_unreadable')
    throw new CampaignError(err.message || 'Could not read the poster file', err.status || 502)
  }
  if (!ALLOWED_TYPES.includes(poster.mimeType)) {
    logResult(tenantId, campaignId, 'unsupported_type')
    throw new CampaignError('The poster must be JPEG or PNG', 400)
  }

  let mediaId
  try {
    // Second guard inside the sender context: the context must carry the clinic's own token
    mediaId = await runAsTenant(tenantId, async () => {
      const { getAccessToken, getPhoneNumberId } = require('../channel/whatsapp/senderContext')
      if (!getAccessToken() || !getPhoneNumberId()) {
        throw new CampaignError('This clinic has no usable WhatsApp token or phone number id', 409)
      }
      return uploadMedia(poster.buffer, poster.mimeType, poster.fileName)
    })
  } catch (err) {
    if (err instanceof CampaignError) {
      logResult(tenantId, campaignId, 'not_connected')
      throw err
    }
    logResult(tenantId, campaignId, 'upload_failed')
    throw new CampaignError('Meta did not accept the poster upload', 502)
  }
  if (!mediaId) {
    logResult(tenantId, campaignId, 'upload_failed')
    throw new CampaignError('Meta did not return a media id', 502)
  }

  await pool.query(
    'UPDATE campaigns SET meta_media_id = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3',
    [String(mediaId), campaignId, tenantId]
  )
  logResult(tenantId, campaignId, 'uploaded')
  return String(mediaId)
}

module.exports = { ensureCampaignMedia }
