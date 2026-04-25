const pool = require('../../config/database')
const logger = require('../../utils/logger')
const { successResponse, errorResponse } = require('../../utils/response')
const { generateToken, bcrypt } = require('../../config/auth')
const { sendPasswordResetEmail } = require('../../utils/email')

/**
 * POST /auth/login
 * Staff login with email and password
 * Returns JWT token and staff info
 */
async function login(req, res) {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return errorResponse(res,
        'Email and password required', 400)
    }

    // Find staff by email
    const result = await pool.query(
      `SELECT s.*, t.name AS tenant_name,
              t.plan AS tenant_plan,
              t.status AS tenant_status
       FROM staff s
       JOIN tenants t ON t.id = s.tenant_id
       WHERE LOWER(s.email) = LOWER($1)
       AND s.is_active = true`,
      [email]
    )

    if (!result.rows.length) {
      return errorResponse(res,
        'Invalid email or password', 401)
    }

    const staff = result.rows[0]

    // Check if tenant is active
    if (staff.tenant_status === 'suspended') {
      return errorResponse(res,
        'Your clinic account has been suspended. Please contact support.', 403)
    }

    // Verify password
    const validPassword = await bcrypt.compare(
      password, staff.password_hash
    )

    if (!validPassword) {
      return errorResponse(res,
        'Invalid email or password', 401)
    }

    // Update last login
    await pool.query(
      `UPDATE staff SET last_login = NOW()
       WHERE id = $1`,
      [staff.id]
    )

    // Generate JWT token
    const token = generateToken({
      staffId: staff.id,
      tenantId: staff.tenant_id,
      role: staff.role,
      email: staff.email,
      name: staff.name
    })

    // Store session in database
    await pool.query(
      `INSERT INTO auth_sessions
       (id, staff_id, tenant_id, token,
        expires_at, ip_address, user_agent)
       VALUES (
         gen_random_uuid(), $1, $2, $3,
         NOW() + INTERVAL '7 days',
         $4, $5
       )`,
      [
        staff.id,
        staff.tenant_id,
        token,
        req.ip,
        req.headers['user-agent']
      ]
    )

    return successResponse(res, {
      token,
      staff: {
        id: staff.id,
        name: staff.name,
        email: staff.email,
        role: staff.role,
        tenantId: staff.tenant_id,
        tenantName: staff.tenant_name,
        tenantPlan: staff.tenant_plan
      }
    })
  } catch (err) {
    logger.error('Login error:', err.message)
    return errorResponse(res, 'Login failed')
  }
}

/**
 * POST /auth/logout
 * Invalidates the session token
 */
async function logout(req, res) {
  try {
    const token = req.headers.authorization
      ?.replace('Bearer ', '')

    if (token) {
      await pool.query(
        `DELETE FROM auth_sessions
         WHERE token = $1`,
        [token]
      )
    }

    return successResponse(res,
      { message: 'Logged out successfully' })
  } catch (err) {
    logger.error('Logout error:', err.message)
    return errorResponse(res, 'Logout failed')
  }
}

/**
 * GET /auth/me
 * Returns current staff info from token
 */
async function getMe(req, res) {
  try {
    return successResponse(res, {
      staff: req.staff,
      tenant: req.tenant
    })
  } catch (err) {
    return errorResponse(res, 'Failed to get user')
  }
}

/**
 * POST /auth/forgot-password
 * Sends password reset email via Resend
 */
async function forgotPassword(req, res) {
  try {
    const { email } = req.body

    if (!email) {
      return errorResponse(res,
        'Email required', 400)
    }

    const result = await pool.query(
      `SELECT id, name FROM staff
       WHERE LOWER(email) = LOWER($1)
       AND is_active = true`,
      [email]
    )

    // Always return success to prevent
    // email enumeration attacks
    if (!result.rows.length) {
      return successResponse(res, {
        message: 'If this email exists you will receive a reset link'
      })
    }

    const staff = result.rows[0]

    // Generate reset token
    const resetToken = require('crypto')
      .randomBytes(32).toString('hex')

    // Store reset token
    await pool.query(
      `INSERT INTO auth_password_resets
       (staff_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [staff.id, resetToken]
    )

    // Send reset email via Resend
    const resetUrl =
      `https://receptionai.in/reset-password?token=${resetToken}`

    await sendPasswordResetEmail({
      to: email,
      name: staff.name,
      resetUrl
    })

    return successResponse(res, {
      message: 'If this email exists you will receive a reset link'
    })
  } catch (err) {
    logger.error('Forgot password error:',
      err.message)
    return errorResponse(res,
      'Failed to send reset email')
  }
}

/**
 * POST /auth/reset-password
 * Resets password using token from email
 */
async function resetPassword(req, res) {
  try {
    const { token, password } = req.body

    if (!token || !password) {
      return errorResponse(res,
        'Token and password required', 400)
    }

    if (password.length < 8) {
      return errorResponse(res,
        'Password must be at least 8 characters', 400)
    }

    // Find valid reset token
    const result = await pool.query(
      `SELECT staff_id FROM auth_password_resets
       WHERE token = $1
       AND expires_at > NOW()
       AND used = false`,
      [token]
    )

    if (!result.rows.length) {
      return errorResponse(res,
        'Invalid or expired reset token', 400)
    }

    const { staff_id } = result.rows[0]

    // Hash new password
    const password_hash =
      await bcrypt.hash(password, 12)

    // Update password
    await pool.query(
      `UPDATE staff SET password_hash = $1
       WHERE id = $2`,
      [password_hash, staff_id]
    )

    // Mark token as used
    await pool.query(
      `UPDATE auth_password_resets
       SET used = true WHERE token = $1`,
      [token]
    )

    // Invalidate all existing sessions
    await pool.query(
      `DELETE FROM auth_sessions
       WHERE staff_id = $1`,
      [staff_id]
    )

    return successResponse(res, {
      message: 'Password reset successfully'
    })
  } catch (err) {
    logger.error('Reset password error:',
      err.message)
    return errorResponse(res,
      'Failed to reset password')
  }
}

module.exports = {
  login,
  logout,
  getMe,
  forgotPassword,
  resetPassword
}
