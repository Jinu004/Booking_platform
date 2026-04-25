const pool = require('../config/database')
const bcrypt = require('bcryptjs')

async function createAdmin() {
  const email = 'admin@apollomedical.in'
  const password = 'Admin@123'
  const tenantId = '262467ed-7cf3-418b-b46c-6038540f9260'

  const password_hash = await bcrypt.hash(password, 12)
  
  const result = await pool.query(
  `INSERT INTO staff
   (tenant_id, name, email, role,
    is_active, password_hash, email_verified)
   VALUES ($1, $2, $3, $4, $5, $6, $7)
   RETURNING id, name, email, role`,
  [
    tenantId,
    'Admin User',
    email,
    'admin',
    true,
    password_hash,
    true
  ]
)
  console.log('Admin created:', result.rows[0])
  console.log('Email:', email)
  console.log('Password:', password)
  process.exit(0)
}

createAdmin().catch(console.error)
