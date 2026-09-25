const crypto = require('crypto');

const META_APP_SECRET = process.env.META_APP_SECRET;
const WABA_ID = '4235419063436925';
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
const TO_NUMBER = '919567990394';

function generatePayload(phone) {
  const msgId = 'wamid.test' + crypto.randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: WABA_ID,
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: TO_NUMBER,
            phone_number_id: PHONE_NUMBER_ID
          },
          contacts: [{ profile: { name: 'Test Patient' }, wa_id: phone }],
          messages: [{
            from: phone,
            id: msgId,
            timestamp: timestamp,
            text: { body: 'Hi' },
            type: 'text',
            to: TO_NUMBER
          }]
        },
        field: 'messages'
      }]
    }]
  };
}

function generateSignature(body) {
  return 'sha256=' + crypto
    .createHmac('sha256', META_APP_SECRET)
    .update(typeof body === 'string' ? body : JSON.stringify(body))
    .digest('hex');
}

module.exports = {
  setWebhookPayload: async function(requestParams, context, ee) {
    const phone = '91' + (9000000000 + Math.floor(Math.random() * 999999999)).toString();
    const payload = generatePayload(phone);
    const bodyStr = JSON.stringify(payload);
    const signature = generateSignature(bodyStr);
    requestParams.body = bodyStr;
    requestParams.headers = requestParams.headers || {};
    requestParams.headers['Content-Type'] = 'application/json';
    requestParams.headers['X-Hub-Signature-256'] = signature;
  }
};
