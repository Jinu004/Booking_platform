const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required')
}
const JWT_EXPIRES_IN = '7d'

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN
  })
}

function verifyToken(token) {
  // generateToken signs with jsonwebtoken's default for a string secret, HS256; only that algorithm is accepted
  return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })
}

module.exports = {
  generateToken,
  verifyToken,
  bcrypt,
  JWT_SECRET
}
