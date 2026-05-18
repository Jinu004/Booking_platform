const pool = require('../../config/database')
const logger = require('../../utils/logger')

/**
 * Maps a period string to a PostgreSQL interval duration string.
 * Returns a plain duration string used as a parameterized $N::interval value —
 * never interpolated into SQL — eliminating any injection risk.
 */
function getInterval(period) {
  switch (period) {
    case 'today': return '1 day'
    case 'week':  return '7 days'
    case 'month':
    default:      return '30 days'
  }
}

async function getOverviewStats(tenantId, period, doctorId = null) {
  try {
    const interval = getInterval(period)

    // Bookings query — optionally scoped to a single doctor
    const bParams = [tenantId, interval]
    let bSql = `
      SELECT
        count(*) as total,
        sum(case when status = 'completed' then 1 else 0 end) as completed,
        sum(case when status = 'cancelled' then 1 else 0 end) as cancelled,
        sum(case when status = 'noshow' then 1 else 0 end) as noshow
      FROM bookings
      WHERE tenant_id = $1 AND created_at >= NOW() - $2::interval`
    if (doctorId) {
      bParams.push(doctorId)
      bSql += ` AND doctor_id = $3`
    }
    const bRes = await pool.query(bSql, bParams)

    // Patients query — when doctor filter active, count only patients seen by this doctor
    const pParams = [tenantId, interval]
    let pSql = `
      SELECT count(*) as new_patients
      FROM customers
      WHERE tenant_id = $1 AND created_at >= NOW() - $2::interval`
    if (doctorId) {
      pParams.push(doctorId)
      pSql += ` AND id IN (
        SELECT DISTINCT customer_id FROM bookings
        WHERE tenant_id = $1 AND doctor_id = $3
      )`
    }
    const pRes = await pool.query(pSql, pParams)

    const cRes = await pool.query(`
      SELECT
        count(*) as total,
        sum(case when mode = 'ai' then 1 else 0 end) as ai_handled,
        sum(case when needs_attention = true then 1 else 0 end) as escalated
      FROM conversations
      WHERE tenant_id = $1 AND started_at >= NOW() - $2::interval
    `, [tenantId, interval])

    const bStats = bRes.rows[0]
    const cStats = cRes.rows[0]
    const total = parseInt(cStats.total) || 0
    const aiHandled = parseInt(cStats.ai_handled) || 0
    const resolutionRate = total > 0 ? Math.round((aiHandled / total) * 100) : 0

    return {
      bookings: {
        total: parseInt(bStats.total) || 0,
        completed: parseInt(bStats.completed) || 0,
        cancelled: parseInt(bStats.cancelled) || 0,
        noshow: parseInt(bStats.noshow) || 0
      },
      patients: {
        new: parseInt(pRes.rows[0].new_patients) || 0
      },
      aiStats: {
        resolutionRate
      }
    }
  } catch (error) {
    logger.error('Error fetching overview stats:', error.message)
    throw error
  }
}

async function getDailyBookings(tenantId, period, doctorId = null) {
  const interval = getInterval(period)
  const params = [tenantId, interval]
  let sql = `
    SELECT DATE(created_at) as date, count(*) as count
    FROM bookings
    WHERE tenant_id = $1 AND created_at >= NOW() - $2::interval`
  if (doctorId) {
    params.push(doctorId)
    sql += ` AND doctor_id = $3`
  }
  sql += ` GROUP BY DATE(created_at) ORDER BY DATE(created_at)`
  const res = await pool.query(sql, params)
  return res.rows
}

async function getDoctorStats(tenantId, period, doctorId = null) {
  const interval = getInterval(period)
  const params = [tenantId, interval]
  let sql = `
    SELECT d.name as "doctorName",
           count(b.id) as "totalBookings",
           sum(case when b.status = 'completed' then 1 else 0 end) as completed,
           sum(case when b.status = 'cancelled' then 1 else 0 end) as cancelled,
           0 as revenue
    FROM clinic_doctors d
    LEFT JOIN clinic_tokens t ON t.doctor_id = d.id
    LEFT JOIN bookings b ON b.id = t.booking_id AND b.created_at >= NOW() - $2::interval
    WHERE d.tenant_id = $1`
  if (doctorId) {
    params.push(doctorId)
    sql += ` AND d.id = $3`
  }
  sql += ` GROUP BY d.name`
  const res = await pool.query(sql, params)
  return res.rows.map(row => ({
    doctorName: row.doctorName,
    totalBookings: parseInt(row.totalBookings) || 0,
    completed: parseInt(row.completed) || 0,
    cancelled: parseInt(row.cancelled) || 0,
    revenue: parseInt(row.revenue) || 0
  }))
}

async function getPatientStats(tenantId, period) {
  try {
    const interval = getInterval(period)
    const res = await pool.query(`
      SELECT
        count(*) FILTER (WHERE created_at >= NOW() - $2::interval) as new_patients,
        count(*) FILTER (WHERE created_at < NOW() - $2::interval) as returning_patients
      FROM customers
      WHERE tenant_id = $1
    `, [tenantId, interval])
    return {
      new: parseInt(res.rows[0].new_patients) || 0,
      returning: parseInt(res.rows[0].returning_patients) || 0
    }
  } catch (error) {
    logger.error('Error fetching patient stats:', error.message)
    throw error
  }
}

async function getConversationStats(tenantId, period) {
  try {
    const interval = getInterval(period)
    const res = await pool.query(`
      SELECT
        count(*) as total,
        sum(case when mode = 'ai' then 1 else 0 end) as ai_handled,
        sum(case when needs_attention = true then 1 else 0 end) as escalated,
        sum(case when status = 'resolved' then 1 else 0 end) as resolved
      FROM conversations
      WHERE tenant_id = $1 AND started_at >= NOW() - $2::interval
    `, [tenantId, interval])
    const row = res.rows[0]
    return {
      total: parseInt(row.total) || 0,
      aiHandled: parseInt(row.ai_handled) || 0,
      escalated: parseInt(row.escalated) || 0,
      resolved: parseInt(row.resolved) || 0
    }
  } catch (error) {
    logger.error('Error fetching conversation stats:', error.message)
    throw error
  }
}

module.exports = {
  getOverviewStats,
  getDailyBookings,
  getDoctorStats,
  getPatientStats,
  getConversationStats
}
