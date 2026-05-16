const pool = require('../../config/database')
const logger = require('../../utils/logger')

function getInterval(period) {
  switch (period) {
    case 'today': return "INTERVAL '1 day'"
    case 'week': return "INTERVAL '7 days'"
    case 'month':
    default: return "INTERVAL '30 days'"
  }
}

async function getOverviewStats(tenantId, period) {
  try {
    const interval = getInterval(period)
    const bRes = await pool.query(`
      SELECT
        count(*) as total,
        sum(case when status = 'completed' then 1 else 0 end) as completed,
        sum(case when status = 'cancelled' then 1 else 0 end) as cancelled,
        sum(case when status = 'noshow' then 1 else 0 end) as noshow
      FROM bookings
      WHERE tenant_id = $1 AND created_at >= NOW() - ${interval}
    `, [tenantId])

    const pRes = await pool.query(`
      SELECT count(*) as new_patients
      FROM customers
      WHERE tenant_id = $1 AND created_at >= NOW() - ${interval}
    `, [tenantId])

    const cRes = await pool.query(`
      SELECT
        count(*) as total,
        sum(case when mode = 'ai' then 1 else 0 end) as ai_handled,
        sum(case when needs_attention = true then 1 else 0 end) as escalated
      FROM conversations
      WHERE tenant_id = $1 AND started_at >= NOW() - ${interval}
    `, [tenantId])

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

async function getDailyBookings(tenantId, period) {
  const interval = getInterval(period)
  const res = await pool.query(`
    SELECT DATE(created_at) as date, count(*) as count
    FROM bookings
    WHERE tenant_id = $1 AND created_at >= NOW() - ${interval}
    GROUP BY DATE(created_at)
    ORDER BY DATE(created_at)
  `, [tenantId])
  return res.rows
}

async function getDoctorStats(tenantId, period) {
  const interval = getInterval(period)
  const res = await pool.query(`
    SELECT d.name as "doctorName",
           count(b.id) as "totalBookings",
           sum(case when b.status = 'completed' then 1 else 0 end) as completed,
           sum(case when b.status = 'cancelled' then 1 else 0 end) as cancelled,
           0 as revenue
    FROM clinic_doctors d
    LEFT JOIN clinic_tokens t ON t.doctor_id = d.id
    LEFT JOIN bookings b ON b.id = t.booking_id AND b.created_at >= NOW() - ${interval}
    WHERE d.tenant_id = $1
    GROUP BY d.name
  `, [tenantId])
  return res.rows.map(row => ({
    doctorName: row.doctorName,
    totalBookings: parseInt(row.totalBookings) || 0,
    completed: parseInt(row.completed) || 0,
    cancelled: parseInt(row.cancelled) || 0,
    revenue: parseInt(row.revenue) || 0
  }))
}

async function getPatientStats(tenantId, period) {
  return { new: 0, returning: 0 }
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
      WHERE tenant_id = $1 AND started_at >= NOW() - ${interval}
    `, [tenantId])
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
