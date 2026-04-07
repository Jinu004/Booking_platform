const express = require('express')
const router = express.Router()
const whatsappWebhook = require('./whatsapp/whatsapp.webhook')

// WhatsApp webhook routes
router.use('/whatsapp', whatsappWebhook)

// Future channels added here:
// router.use('/web', webWebhook)
// router.use('/voice', voiceWebhook)

module.exports = router
