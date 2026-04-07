const { createClient } = require('redis')
const logger = require('../utils/logger')

const redisUrl = process.env.REDIS_URL
  || 'redis://localhost:6379'

// Detect if using TLS (Upstash uses rediss://, but we also check the hostname since .env has redis://)
const isTLS = redisUrl.startsWith('rediss://') || redisUrl.includes('upstash.io')

/**
 * Redis client for session and cache storage
 * Supports both local Redis and Upstash TLS
 */
const client = createClient({
  url: redisUrl,
  socket: isTLS ? {
    tls: true,
    rejectUnauthorized: false
  } : {}
})

client.on('connect', () => {
  logger.info('Redis connected successfully')
})

client.on('error', (err) => {
  logger.warn('Redis connection error:', err.message)
})

client.on('reconnecting', () => {
  logger.info('Redis reconnecting...')
})

client.connect().catch((err) => {
  logger.warn(
    'Redis not available — session features disabled.',
    err.message
  )
})

module.exports = client
