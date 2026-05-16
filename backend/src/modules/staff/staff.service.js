const StaffModel = require('./staff.model')
const pool = require('../../config/database')
const ClinicModel = require('../industries/clinic/clinic.model');

/**
 * Invites a new staff member
 */
async function inviteStaff(tenantId, staffData) {
  // If production, here we would use Clerk backend SDK to create a user and send an invite link.
  // For now, we directly create the record in the database.
  
  // Check if role is valid
  const allowedRoles = ['admin', 'manager', 'receptionist', 'doctor'];
  if (!allowedRoles.includes(staffData.role)) {
    throw new Error('Invalid role specified');
  }

  const staff = await StaffModel.createStaff(pool, tenantId, staffData)

  // If role is doctor and specialized, we might need to sync with clinic doctors table.
  // In a robust implementation, Clinic module would listen to staff creation event or we do it here.
  if (staff.role === 'doctor') {
    await ClinicModel.createDoctor(pool, tenantId, {
      name: staff.name,
      email: staff.email,
      phone: staff.phone,
      specialization: staffData.specialization || 'General',
      maxTokensDaily: 30,
      consultationFee: 0
    });
  }

  return staff
}

/**
 * Gets all staff with their booking counts (booking counts mapped manually or via sub-query)
 */
async function getStaffWithStats(tenantId) {
  const staffArray = await StaffModel.getStaff(pool, tenantId)
  // Get today's booking counts per doctor email
  const bookingRes = await pool.query(`
    SELECT d.email, COUNT(*) as count
    FROM bookings b
    JOIN clinic_doctors d ON d.id = b.doctor_id
    WHERE b.tenant_id = $1 AND b.booking_date = CURRENT_DATE
    GROUP BY d.email
  `, [tenantId])
  const countByEmail = {}
  for (const row of bookingRes.rows) {
    countByEmail[row.email] = parseInt(row.count) || 0
  }
  return staffArray.map(staff => ({
    ...staff,
    bookings_count: countByEmail[staff.email] || 0
  }))
}

/**
 * Updates staff role
 */
async function updateStaffRole(tenantId, staffId, newRole) {
  const allowedRoles = ['admin', 'manager', 'receptionist', 'doctor'];
  if (!allowedRoles.includes(newRole)) {
    throw new Error('Invalid role specified');
  }

  const staff = await StaffModel.updateStaff(pool, tenantId, staffId, { role: newRole })
  return staff
}

module.exports = {
  inviteStaff,
  getStaffWithStats,
  updateStaffRole
}
