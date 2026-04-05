const { Pool } = require('pg')
const logger = require('../utils/logger')

/**
 * PostgreSQL connection pool
 * Shared across all modules
 * Gracefully handles connection failures
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
})

pool.on('connect', () => {
  logger.info('PostgreSQL connected successfully')
})

pool.on('error', (err) => {
  logger.warn('PostgreSQL connection error:', err.message)
})

// Test connection on startup but do not crash if it fails
pool.connect()
  .then(client => {
    logger.info('PostgreSQL connected successfully')
    client.release()
  })
  .catch(err => {
    logger.warn(
      'PostgreSQL not available — running without database.',
      err.message
    )
    logger.warn(
      'Start PostgreSQL or connect to Oracle VM to enable database features.'
    )
  })

module.exports = pool
