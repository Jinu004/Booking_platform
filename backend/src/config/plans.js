const { errorResponse } = require('../utils/response')

// Plan rules shared by the backend checks. Plan names: starter, growth, pro. A missing or unknown plan counts as starter.
const PLAN_NAMES = ['starter', 'growth', 'pro']
const DOCTOR_LIMITS = { starter: 1, growth: 5, pro: 10 }
const POSTER_PLANS = ['growth', 'pro']
const POSTERS_PLAN_MESSAGE = 'Offers and posters are available on the Growth and Pro plans.'

const normalizePlan = (plan) => (PLAN_NAMES.includes(plan) ? plan : 'starter')
const doctorLimitFor = (plan) => DOCTOR_LIMITS[normalizePlan(plan)]
const postersAllowed = (plan) => POSTER_PLANS.includes(normalizePlan(plan))

// Route guard for everything that creates, schedules or reads posters and bulk campaigns (use after requireAuth).
// A super admin is never refused here.
function requirePostersPlan(req, res, next) {
  if (req.staff?.role === 'super_admin') return next()
  if (!postersAllowed(req.tenant?.plan)) return errorResponse(res, POSTERS_PLAN_MESSAGE, 403)
  next()
}

module.exports = {
  PLAN_NAMES,
  DOCTOR_LIMITS,
  POSTER_PLANS,
  POSTERS_PLAN_MESSAGE,
  normalizePlan,
  doctorLimitFor,
  postersAllowed,
  requirePostersPlan
}
