// Plain-language labels for the Meta error codes recorded in send_failures
const SEND_FAILURE_LABELS = {
  132001: 'Template missing or not approved',
  132000: 'Template parameters do not match',
  131047: 'More than 24 hours since the patient last wrote',
  131042: 'Payment problem on the WhatsApp account',
  131026: 'Message could not be delivered (for example the number is not on WhatsApp)',
  131048: 'Sending restricted on this number',
  131049: 'Held by Meta to protect the patient experience',
  131030: 'Recipient not in allowed list'
};

const OTHER_LABEL = 'Other error (see code and message)';

function labelForCode(code) {
  return SEND_FAILURE_LABELS[code] || OTHER_LABEL;
}

module.exports = { SEND_FAILURE_LABELS, OTHER_LABEL, labelForCode };
