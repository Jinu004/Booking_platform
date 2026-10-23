/**
 * Emails to promoters. Sending is best effort: a failed email never fails the action that caused it.
 * Nothing is sent when RESEND_API_KEY is not set or NODE_ENV is 'test'.
 */
const logger = require('../../utils/logger');

const FROM = 'ReceptionAI Partners <noreply@receptionai.in>';

function frontendUrl() {
  return process.env.FRONTEND_URL || 'https://receptionai.in';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function layout(title, body) {
  return `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
    <h2 style="color: #4f46e5;">${esc(title)}</h2>${body}
    <p style="color: #666; font-size: 14px;">ReceptionAI Partner Team</p></div>`;
}

function button(href, label) {
  return `<a href="${esc(href)}" style="display: inline-block; background: #4f46e5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin: 16px 0;">${esc(label)}</a>`;
}

async function send(to, subject, html) {
  if (!process.env.RESEND_API_KEY || process.env.NODE_ENV === 'test') {
    logger.info(`Promoter email skipped (no RESEND_API_KEY or test mode): ${subject}`);
    return false;
  }
  try {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({ from: FROM, to, subject, html });
    return true;
  } catch (err) {
    logger.warn(`Promoter email failed (${subject}): ${err.message}`);
    return false;
  }
}

function rupees(paise) {
  return '₹' + (Number(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const emails = {
  applicationReceived: (p) => send(p.email, 'We received your partner application',
    layout('Thanks for applying', `<p>Hello ${esc(p.name)},</p><p>We received your application to become a ReceptionAI partner. We will email you once it is reviewed.</p>`)),

  approved: (p) => send(p.email, 'You are now a ReceptionAI partner',
    layout('Welcome, partner!', `<p>Hello ${esc(p.name)},</p>
      <p>Your partner account is active. Your referral code is <strong>${esc(p.code)}</strong>.</p>
      <p>Share this link with clinics: <br><a href="${esc(frontendUrl())}/onboarding?ref=${esc(p.code)}">${esc(frontendUrl())}/onboarding?ref=${esc(p.code)}</a></p>
      ${button(`${frontendUrl()}/partner/login`, 'Open partner dashboard')}`)),

  setPassword: (p, token) => send(p.email, 'Set up your ReceptionAI partner account',
    layout('Set your password', `<p>Hello ${esc(p.name)},</p><p>A ReceptionAI partner account was created for you. Set your password to sign in. The link expires in 48 hours.</p>
      ${button(`${frontendUrl()}/partner/reset-password?token=${token}`, 'Set password')}`)),

  passwordReset: (p, token) => send(p.email, 'Reset your partner password',
    layout('Reset your password', `<p>Hello ${esc(p.name)},</p><p>Click below to reset your password. The link expires in 1 hour.</p>
      ${button(`${frontendUrl()}/partner/reset-password?token=${token}`, 'Reset password')}
      <p style="color:#666;font-size:14px;">If you did not request this, ignore this email.</p>`)),

  newClinic: (p, clinicName) => send(p.email, `New clinic signed up with your code: ${clinicName}`,
    layout('A clinic used your referral code', `<p>Hello ${esc(p.name)},</p><p><strong>${esc(clinicName)}</strong> signed up with your referral code. You will start earning once the clinic is active and pays.</p>
      ${button(`${frontendUrl()}/partner/clinics`, 'View your clinics')}`)),

  payoutPaid: (p, payout) => send(p.email, `Payout sent: ${rupees(payout.net_paise)}`,
    layout('Your payout is on its way', `<p>Hello ${esc(p.name)},</p>
      <p>We sent <strong>${rupees(payout.net_paise)}</strong> (reference ${esc(payout.utr)}).</p>
      ${button(`${frontendUrl()}/partner/payouts`, 'View payout statement')}`)),

  statusChanged: (p, status, reason) => send(p.email, `Your partner account is ${status}`,
    layout(`Account ${status}`, `<p>Hello ${esc(p.name)},</p><p>Your ReceptionAI partner account is now <strong>${esc(status)}</strong>.${reason ? ` Reason: ${esc(reason)}` : ''}</p>`))
};

module.exports = { emails, rupees };
