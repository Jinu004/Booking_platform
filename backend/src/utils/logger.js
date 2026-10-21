const winston = require('winston');
const env = require('../config/env');

const { combine, timestamp, printf, colorize } = winston.format;

const logFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level}]: ${message}`;
});

const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  transports: [
    // Rotation: at 10 MB the file is rolled (combined.log stays the newest, older ones are combined1.log, combined2.log, ...), 10 files kept.
    // Safe because pm2 runs one process (fork mode); several processes writing the same file would clash.
    new winston.transports.File({ filename: 'error.log', level: 'error', maxsize: 10485760, maxFiles: 10, tailable: true }),
    new winston.transports.File({ filename: 'combined.log', maxsize: 10485760, maxFiles: 10, tailable: true })
  ]
});

if (env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: combine(
      colorize(),
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      logFormat
    )
  }));
}

module.exports = logger;
