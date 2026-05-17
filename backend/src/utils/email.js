const { Resend } = require('resend')
const logger = require('./logger')

const resend = new Resend(
  process.env.RESEND_API_KEY
)

async function sendPasswordResetEmail({
  to, name, resetUrl
}) {
  try {
    await resend.emails.send({
      from: 'ReceptionAI <noreply@receptionai.in>',
      to,
      subject: 'Reset your ReceptionAI password',
      html: `
        <div style="font-family: Arial,
          sans-serif; max-width: 600px;
          margin: 0 auto;">
          <h2 style="color: #2563EB;">
            Reset Your Password
          </h2>
          <p>Hello ${name},</p>
          <p>You requested a password reset
             for your ReceptionAI account.</p>
          <p>Click the button below to reset
             your password. This link expires
             in 1 hour.</p>
          <a href="${resetUrl}"
             style="display: inline-block;
             background: #2563EB;
             color: white; padding: 12px 24px;
             border-radius: 8px;
             text-decoration: none;
             margin: 16px 0;">
            Reset Password
          </a>
          <p style="color: #666; font-size: 14px;">
            If you did not request this,
            please ignore this email.
          </p>
          <p style="color: #666; font-size: 14px;">
            ReceptionAI Team
          </p>
        </div>
      `
    })
  } catch (err) {
    logger.error('Email send failed:', err)
    throw err
  }
}

async function sendWelcomeEmail({ to, name, clinicName, tempPassword }) {
  try {
    await resend.emails.send({
      from: 'ReceptionAI <noreply@receptionai.in>',
      to,
      subject: `Welcome to ReceptionAI — ${clinicName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #0d9488;">Welcome to ReceptionAI!</h2>
          <p>Hello ${name},</p>
          <p>Your staff account for <strong>${clinicName}</strong> has been created.</p>
          ${tempPassword ? `
          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="margin: 0 0 8px 0; font-weight: bold; color: #166534;">Your Login Credentials:</p>
            <p style="margin: 4px 0; color: #374151;"><strong>Email:</strong> ${to}</p>
            <p style="margin: 4px 0; color: #374151;"><strong>Temporary Password:</strong> <code style="background: #e5e7eb; padding: 2px 6px; border-radius: 4px;">${tempPassword}</code></p>
          </div>
          <p style="color: #dc2626; font-size: 14px;">Please change your password after first login.</p>
          ` : ''}
          <a href="https://receptionai.in/login"
             style="display: inline-block; background: #0d9488; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin: 16px 0;">
            Login to ReceptionAI
          </a>
          <p style="color: #666; font-size: 14px;">ReceptionAI Team</p>
        </div>
      `
    })
  } catch (err) {
    logger.error('Welcome email failed:', err)
  }
}

module.exports = {
  sendPasswordResetEmail,
  sendWelcomeEmail
}
