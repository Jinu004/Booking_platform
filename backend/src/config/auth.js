const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production'
const JWT_EXPIRES_IN = '7d'

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN
  })
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET)
}

module.exports = {
  generateToken,
  verifyToken,
  bcrypt,
  JWT_SECRET
}
