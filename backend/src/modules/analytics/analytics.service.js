const pool = require('../../config/database')
const tenantQuery = require('../../utils/tenantQuery')
const logger = require('../../utils/logger')

/**
 * Gets overview stats for dashboard
 */
async function getOverviewStats(tenantId, period) {
  // To keep it clean and robust for now, we'll return structured placeholder data 
  // intertwined with real basic counts where simple. 
  // Time-series aggregations would normally use rich SQL query intervals based on "period".
  
  try {
    const bookingQuery = `
      SELECT count(*) as total, 
             sum(case when status = 'completed' then 1 else 0 end) as completed,
             sum(case when status = 'cancelled' then 1 else 0 end) as cancelled,
             sum(case when status = 'noshow' then 1 else 0 end) as noshow
      FROM bookings WHERE tenant_id = $1
    `
    const bRes = await pool.query(bookingQuery, [tenantId])
    const bStats = bRes.rows[0]

    return {
      bookings: {
        total: parseInt(bStats.total) || 0,
        completed: parseInt(bStats.completed) || 0,
        cancelled: parseInt(bStats.cancelled) || 0,
        noshow: parseInt(bStats.noshow) || 0
      },
      revenue: { total: 0, average: 0 },
      patients: { total: 0, new: 0, returning: 0 },
      aiStats: { messagesHandled: 0, escalations: 0, resolutionRate: 0 }
    }
  } catch (error) {
    logger.error('Error fetching overview stats:', error.message)
    throw error
  }
}

/**
 * Gets daily booking counts for chart
 */
async function getDailyBookings(tenantId) {
  const query = `
    SELECT DATE(created_at) as date, count(*) as count 
    FROM bookings 
    WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
    GROUP BY DATE(created_at)
    ORDER BY DATE(created_at)
  `
  const res = await pool.query(query, [tenantId])
  return res.rows
}

/**
 * Gets doctor performance stats
 */
async function getDoctorStats(tenantId) {
  const query = `
    SELECT d.name as "doctorName", 
           count(b.id) as "totalBookings", 
           sum(case when b.status = 'completed' then 1 else 0 end) as completed,
           sum(case when b.status = 'cancelled' then 1 else 0 end) as cancelled,
           0 as revenue
    FROM clinic_doctors d
    LEFT JOIN clinic_tokens t ON t.doctor_id = d.id
    LEFT JOIN bookings b ON b.id = t.booking_id
    WHERE d.tenant_id = $1
    GROUP BY d.name
  `
  const res = await pool.query(query, [tenantId])
  return res.rows.map(row => ({
    doctorName: row.doctorName,
    totalBookings: parseInt(row.totalBookings) || 0,
    completed: parseInt(row.completed) || 0,
    cancelled: parseInt(row.cancelled) || 0,
    revenue: parseInt(row.revenue) || 0
  }))
}

/**
 * Gets patient acquisition stats
 */
async function getPatientStats(tenantId, period) {
  return { new: 0, returning: 0 }
}

/**
 * Gets WhatsApp conversation stats
 */
async function getConversationStats(tenantId, period) {
  return {
    total: 0, aiHandled: 0, escalated: 0,
    resolved: 0, avgResponseTime: 0
  }
}

module.exports = {
  getOverviewStats,
  getDailyBookings,
  getDoctorStats,
  getPatientStats,
  getConversationStats
}
