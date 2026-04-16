const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const env = require('./config/env');
const requestLogger = require('./middleware/requestLogger');
const errorHandler = require('./middleware/errorHandler');
const { successResponse } = require('./utils/response');
const logger = require('./utils/logger');
const { apiLimiter, webhookLimiter } = require('./middleware/rateLimiter');
const channelRouter = require('./modules/channel/channel.router');

// Database initialization
require('./config/database');
require('./config/redis');

const app = express();
app.set('trust proxy', 1)


// 1. Middleware inside app
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. Request Logger
app.use(requestLogger);

// 3. Rate limiters before routes
app.use('/api', apiLimiter);
app.use('/webhook', webhookLimiter);

// 4. Health check route
app.get('/health', (req, res) => {
  return successResponse(res, {
    status: 'ok',
    timestamp: new Date(),
    environment: env.NODE_ENV
  });
});

// 5. /api/v1/tenants routes
const tenantRoutes = require('./modules/tenant/tenant.routes');
app.use('/api/v1/tenants', tenantRoutes);

// 6. /api/v1/auth routes (when built)
// app.use('/api/v1/auth', ...);

// 7. /webhook routes
app.use('/webhook', channelRouter);

// 8. /api/v1/conversations routes
const conversationRoutes = require('./modules/conversation/conversation.routes');
app.use('/api/v1/conversations', conversationRoutes);

// 8. Global Error Handler must be the last middleware
app.use(errorHandler);

const PORT = env.PORT || 3001;

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
