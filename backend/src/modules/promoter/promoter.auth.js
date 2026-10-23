/**
 * Partner (promoter) authentication. Completely separate from staff auth:
 *  - own tables (promoters, promoter_sessions, promoter_password_resets)
 *  - JWT with typ 'promoter' (staff requireAuth rejects these; requirePromoter rejects staff tokens)
 *  - session must exist in promoter_sessions (logout and suspension take effect immediately)
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../../config/database');
const { generateToken, verifyToken } = require('../../config/auth');
const { errorResponse } = require('../../utils/response');
const { httpError } = require('../../utils/route');
const logger = require('../../utils/logger');
const { PUBLIC_COLUMNS, selfView, createResetToken } = require('./promoter.service');
const { emails } = require('./promoter.email');
const { logPromoterAudit } = require('./promoter.audit');

const SESSION_DAYS = 7;
let dummy = null;
const dummyHash = () => (dummy = dummy || bcrypt.hashSync('not-a-real-password', 12));
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

async function requirePromoter(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return errorResponse(res, 'Authentication required', 401);
    const token = header.slice(7);
    let decoded;
    try {
      decoded = verifyToken(token);
    } catch {
      return errorResponse(res, 'Invalid or expired token', 401);
    }
    if (decoded.typ !== 'promoter' || !decoded.sub) return errorResponse(res, 'Invalid token', 401);
    const q = await pool.query(`
      SELECT p.id, p.code, p.name, p.email, p.status FROM promoter_sessions s
      JOIN promoters p ON p.id = s.promoter_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND p.id = $2`, [hash(token), decoded.sub]);
    if (!q.rows.length) return errorResponse(res, 'Session expired. Please sign in again.', 401);
    const p = q.rows[0];
    if (p.status !== 'active') return errorResponse(res, 'Your partner account is not active', 403);
    req.promoter = { id: p.id, code: p.code, name: p.name, email: p.email };
    next();
  } catch (err) {
    logger.error(`Promoter auth error: ${err.message}`);
    return errorResponse(res, 'Authentication failed', 401);
  }
}

async function login({ email, password }, { ip, userAgent } = {}) {
  if (!email || !password) throw httpError('Email and password are required', 400);
  const q = await pool.query(`SELECT * FROM promoters WHERE LOWER(email) = LOWER($1)`, [String(email).trim()]);
  const p = q.rows[0];
  // Same message and similar timing for unknown email and wrong password
  const ok = p && p.password_hash
    ? await bcrypt.compare(String(password), p.password_hash)
    : (await bcrypt.compare(String(password), dummyHash()), false);
  if (!ok) throw httpError('Invalid email or password', 401);
  if (p.status === 'pending') throw httpError('Your application is waiting for approval. We will email you once it is approved.', 403);
  if (p.status !== 'active') throw httpError('Your partner account is not active. Please contact support.', 403);

  const token = generateToken({ typ: 'promoter', sub: p.id });
  await pool.query(
    `INSERT INTO promoter_sessions (promoter_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, now() + ($3 || ' days')::interval, $4, $5)`,
    [p.id, hash(token), String(SESSION_DAYS), ip || null, userAgent ? String(userAgent).slice(0, 300) : null]);
  await pool.query(`UPDATE promoters SET last_login = now() WHERE id = $1`, [p.id]);
  await pool.query(`DELETE FROM promoter_sessions WHERE promoter_id = $1 AND expires_at < now()`, [p.id]);
  const fresh = await pool.query(`SELECT ${PUBLIC_COLUMNS} FROM promoters WHERE id = $1`, [p.id]);
  return { token, promoter: selfView(fresh.rows[0]) };
}

async function logout(req) {
  const token = (req.headers.authorization || '').slice(7);
  await pool.query(`DELETE FROM promoter_sessions WHERE token_hash = $1`, [hash(token)]);
  return { ok: true };
}

async function forgotPassword({ email }) {
  const message = { message: 'If this email belongs to a partner account you will receive a reset link' };
  if (!email) return message;
  const q = await pool.query(`SELECT id, name, email, status FROM promoters WHERE LOWER(email) = LOWER($1)`, [String(email).trim()]);
  const p = q.rows[0];
  if (!p || !['active', 'pending'].includes(p.status)) return message;
  const token = await createResetToken(pool, p.id, 1);
  emails.passwordReset(p, token);
  return message;
}

async function resetPassword({ token, password }, { ip } = {}) {
  if (!token || !password) throw httpError('Token and password are required', 400);
  if (String(password).length < 8) throw httpError('Password must be at least 8 characters', 400);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const q = await client.query(`
      SELECT * FROM promoter_password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
    [hash(String(token))]);
    if (!q.rows.length) throw httpError('This link is invalid or has expired', 400);
    const r = q.rows[0];
    await client.query(`UPDATE promoter_password_resets SET used_at = now() WHERE id = $1`, [r.id]);
    await client.query(`UPDATE promoters SET password_hash = $2, updated_at = now() WHERE id = $1`, [r.promoter_id, await bcrypt.hash(String(password), 12)]);
    await client.query(`DELETE FROM promoter_sessions WHERE promoter_id = $1`, [r.promoter_id]);
    await logPromoterAudit(client, { actorType: 'promoter', actorId: r.promoter_id, action: 'promoter.password_reset', promoterId: r.promoter_id, ip });
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function changePassword(promoterId, { current_password, new_password }) {
  if (!new_password || String(new_password).length < 8) throw httpError('New password must be at least 8 characters', 400);
  const q = await pool.query(`SELECT password_hash FROM promoters WHERE id = $1`, [promoterId]);
  if (!q.rows[0]?.password_hash || !(await bcrypt.compare(String(current_password || ''), q.rows[0].password_hash))) {
    throw httpError('Current password is incorrect', 400);
  }
  await pool.query(`UPDATE promoters SET password_hash = $2, updated_at = now() WHERE id = $1`, [promoterId, await bcrypt.hash(String(new_password), 12)]);
  return { ok: true };
}

module.exports = { requirePromoter, login, logout, forgotPassword, resetPassword, changePassword };
