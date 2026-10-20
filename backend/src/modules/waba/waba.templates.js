// The WhatsApp message templates every clinic needs on its own WhatsApp Business account.
// Names must match what the backend sends (see whatsapp.meta.js sendTemplateMessage callers).
// bodyExamples: sample values for {{1}}, {{2}}, ... (Meta requires them for templates with variables).
// buttons: optional QUICK_REPLY button labels.

const TEMPLATES = [
  {
    name: 'appointment_confirmation',
    language: 'en',
    category: 'UTILITY',
    body: 'Your appointment has been confirmed. Thank you for choosing our clinic.',
    bodyExamples: [],
    buttons: []
  },
  {
    name: 'appointment_reminder_v2_',
    language: 'en',
    category: 'UTILITY',
    body: 'Just a reminder about your appointment at {{1}} on {{2}}. Please arrive a few minutes early.',
    bodyExamples: ['Apollo Medical Centre', '9:00 AM session, Token #3'],
    buttons: []
  },
  {
    name: 'noshow_followup',
    language: 'en',
    category: 'UTILITY',
    body: 'We noticed you could not make it to your recent appointment. Please press reschedule if you would like to book for another day.',
    bodyExamples: [],
    buttons: ['Reschedule']
  },
  {
    name: 'recall_checkup',
    language: 'en',
    category: 'MARKETING',
    body: 'Hi {{1}} 👋\n\nIt\'s been {{2}} months since your last visit at {{3}}. We\'d love to see you again! 😊\n\nRegular checkups keep small issues from becoming big ones — your health is worth 30 minutes.\n\nShall we book you in?',
    bodyExamples: ['Akash', '2', 'Apollo'],
    buttons: ['Book Appointment', 'Maybe Later']
  },
  {
    name: 'out_of_hours',
    language: 'en',
    category: 'UTILITY',
    body: 'Thank you for reaching out. Our clinic is closed at the moment. We will get back to you as soon as we open.',
    bodyExamples: [],
    buttons: []
  },
  {
    name: 'follow_up',
    language: 'en',
    category: 'UTILITY',
    body: 'We have received your earlier message. Please reply to this message so our staff can assist you.',
    bodyExamples: [],
    buttons: []
  },
  {
    name: 'procedure_scheduled',
    language: 'en',
    category: 'UTILITY',
    body: 'Your {{1}} appointment has been scheduled for {{2}} at {{3}}. Please arrive a few minutes early and contact us if you need assistance',
    bodyExamples: ['Hair Transplant', '13 Jul 2026', '9:00 AM'],
    buttons: []
  }
];

module.exports = { TEMPLATES };
