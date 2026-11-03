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
    features: [
      'Patients book on WhatsApp any time, day or night',
      'Automatic reminders before the appointment',
      'A live list of who is waiting today',
      'Automatic follow-up with patients who have not visited for a while',
      'Simple reports on bookings, visits and missed appointments',
      'Your staff can step in and reply to any chat',
      '1 doctor',
    ],
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    price: 5999,
    priceDisplay: '5,999',
    popular: true,
    features: [
      'Everything in Starter',
      "The AI answers patients' questions about your clinic: timings, treatments, fees, offers and location",
      'Send offers and festival greetings to your patients on WhatsApp',
      'Up to 5 doctors',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 9999,
    priceDisplay: '9,999',
    features: [
      'Everything in Growth',
      'Digital patient records: history, diagnosis and notes in one place',
      'Prescriptions as a PDF sent to the patient on WhatsApp',
      "The AI knows each doctor's speciality, timings and fee and helps patients pick the right one",
      'Up to 10 doctors',
    ],
  },
};

export const POLL_INTERVALS = {
  DASHBOARD: 15000,
  BOOKINGS: 30000,
};
