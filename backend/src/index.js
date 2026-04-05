const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const env = require('./config/env');
const requestLogger = require('./middleware/requestLogger');
const errorHandler = require('./middleware/errorHandler');
const { successResponse } = require('./utils/response');
const logger = require('./utils/logger');

// Database initialization
require('./config/database');

const app = express();

// Middleware inside app
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// Health check route
app.get('/health', (req, res) => {
  return successResponse(res, {
    status: 'ok',
    timestamp: new Date(),
    environment: env.NODE_ENV
  });
});

// Main routes
const tenantRoutes = require('./modules/tenant/tenant.routes');
app.use('/api/v1/tenants', tenantRoutes);

// Global Error Handler must be the last middleware
app.use(errorHandler);

const PORT = env.PORT || 3001;

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
