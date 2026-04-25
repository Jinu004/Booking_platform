const { Resend } = require('resend')

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
    console.error('Email send failed:', err)
    throw err
  }
}

async function sendWelcomeEmail({
  to, name, clinicName
}) {
  try {
    await resend.emails.send({
      from: 'ReceptionAI <noreply@receptionai.in>',
      to,
      subject: `Welcome to ReceptionAI — ${clinicName}`,
      html: `
        <div style="font-family: Arial,
          sans-serif; max-width: 600px;
          margin: 0 auto;">
          <h2 style="color: #2563EB;">
            Welcome to ReceptionAI!
          </h2>
          <p>Hello ${name},</p>
          <p>Your account for ${clinicName}
             has been created.</p>
          <p>Login at:</p>
          <a href="https://receptionai.in/login"
             style="display: inline-block;
             background: #2563EB;
             color: white; padding: 12px 24px;
             border-radius: 8px;
             text-decoration: none;">
            Login to ReceptionAI
          </a>
          <p style="color: #666; font-size: 14px;">
            ReceptionAI Team
          </p>
        </div>
      `
    })
  } catch (err) {
    console.error('Welcome email failed:', err)
    // Don't throw — welcome email failure
    // should not block account creation
  }
}

module.exports = {
  sendPasswordResetEmail,
  sendWelcomeEmail
}
