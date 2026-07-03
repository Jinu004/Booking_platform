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
const pool = require('./config/database');
require('./config/redis');

const app = express();
app.set('trust proxy', 1)


// 1. Middleware inside app
app.use(helmet());
const corsOptions = {
  origin: (origin, callback) => {
    const allowed = [
      'https://receptionai.in',
      'https://www.receptionai.in',
      ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) : [])
    ];
    if (!origin || allowed.includes(origin) || (env.NODE_ENV !== 'production' && /^http:\/\/localhost(:\d+)?$/.test(origin))) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  credentials: true
};
app.use(cors(corsOptions));
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true }));

// 2. Request Logger
app.use(requestLogger);

// 3. Rate limiters before routes
app.use('/api', apiLimiter);
app.use('/webhook', webhookLimiter);

// 4. Health check route
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: 'connected'
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      database: 'disconnected',
      error: err.message
    });
  }
});

// 5. /api/v1/tenants routes
const tenantRoutes = require('./modules/tenant/tenant.routes');
app.use('/api/v1/tenants', tenantRoutes);

// Super Admin Routes
const superAdminRoutes = require('./modules/superadmin/superadmin.routes');
app.use('/api/v1/superadmin', superAdminRoutes);

// Onboarding Routes
const onboardingRoutes = require('./modules/onboarding/onboarding.routes');
app.use('/api/v1/onboarding', onboardingRoutes);

// 6. /api/v1/auth routes (when built)
// app.use('/api/v1/auth', ...);

// 7. /webhook routes
app.use('/webhook', channelRouter);

// 8. /api/v1/conversations routes
const conversationRoutes = require('./modules/conversation/conversation.routes');
app.use('/api/v1/conversations', conversationRoutes);

// 9. /api/v1/bookings routes
const bookingRoutes = require('./modules/booking/booking.routes');
app.use('/api/v1/bookings', bookingRoutes);

// 10. /api/v1/customers routes
const crmRoutes = require('./modules/crm/crm.routes');
app.use('/api/v1/customers', crmRoutes);
app.use('/api/v1/crm', crmRoutes);

// 11. /api/v1/clinic routes
const clinicRoutes = require('./modules/industries/clinic/clinic.routes');
app.use('/api/v1/clinic', clinicRoutes);

// 12. /api/v1/auth routes
const authRoutes = require('./modules/auth/auth.routes');
app.use('/api/v1/auth', authRoutes);

// 13. /api/v1/staff routes
const staffRoutes = require('./modules/staff/staff.routes');
app.use('/api/v1/staff', staffRoutes);

// 14. /api/v1/analytics routes
const analyticsRoutes = require('./modules/analytics/analytics.routes');
app.use('/api/v1/analytics', analyticsRoutes);

// 15. /api/v1/settings routes
const settingsRoutes = require('./modules/settings/settings.routes');
app.use('/api/v1/settings', settingsRoutes);

// HITL Routes
const hitlRoutes = require('./modules/hitl/hitl.routes');
app.use('/api/v1/hitl', hitlRoutes);

const ehrRoutes = require('./modules/ehr/ehr.routes');
app.use('/api/v1/ehr', ehrRoutes);

const wabaRoutes = require('./modules/waba/waba.routes');
app.use('/api/v1/admin/waba', wabaRoutes);

const pushRoutes = require('./modules/push/push.routes');
app.use('/api/v1/push', pushRoutes);

// Enquiry vertical routes
const catalogueRoutes = require('./modules/catalogue/catalogue.routes');
app.use('/api/v1/catalogue', catalogueRoutes);

const leadsRoutes = require('./modules/leads/leads.routes');
app.use('/api/v1/leads', leadsRoutes);

// 17. Global Error Handler must be the last middleware
app.use(errorHandler);

const PORT = env.PORT || 3001;

// Safety check — refuse to start if auth bypass is enabled outside development
if (env.BYPASS_AUTH === 'true' && env.NODE_ENV !== 'development') {
  logger.error('FATAL: BYPASS_AUTH=true is not allowed outside NODE_ENV=development. Refusing to start.');
  process.exit(1);
}

// Initialize Scheduled Jobs
const { initializeSchedulers } = require('./modules/notification/notification.scheduler');
initializeSchedulers();

const { startHITLCron } = require('./modules/hitl/hitl.cron');
const { startRetentionCron } = require('./cron/retention.cron');
const { startNoShowCron } = require('./cron/noshow.cron');
const { broadcastToTenant } = require('./modules/hitl/hitl.service');

setTimeout(() => {
  console.log('Starting HITL cron...');
  startHITLCron(pool, broadcastToTenant);
  console.log('Starting Retention cron...');
  startNoShowCron();
  console.log('Starting No-show cron...');
  startRetentionCron();
}, 5000);
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
