// Application-wide constants

export const APP_NAME = 'ReceptionAI';

export const STORAGE_KEYS = {
  AUTH_TOKEN: 'auth_token',
  STAFF_DATA: 'staff_data',
};

export const PLANS = {
  starter: {
    id: 'starter',
    name: 'Starter',
    price: 2999,
    priceDisplay: '2,999',
    doctors: '1 doctor',
    conversations: '1,000 conv/mo',
    features: [
      'AI WhatsApp Bot',
      'Up to 150 Daily Tokens',
      'Basic Analytics',
      'Email & WhatsApp Support',
    ],
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    price: 5999,
    priceDisplay: '5,999',
    doctors: 'Up to 5 doctors',
    conversations: '3,000 conv/mo',
    popular: true,
    features: [
      'Everything in Starter',
      'Up to 300 Daily Tokens',
      'Advanced Analytics',
      'Priority Support',
      'Multi-doctor Support',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 9999,
    priceDisplay: '9,999',
    doctors: 'Up to 10 doctors',
    conversations: '6,000 conv/mo',
    features: [
      'Everything in Growth',
      'Unlimited Daily Tokens',
      'Full Analytics',
      'Dedicated Support',
      'Custom AI Personality',
    ],
  },
};

export const POLL_INTERVALS = {
  DASHBOARD: 15000,
  BOOKINGS: 30000,
};
