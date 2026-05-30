// Mirrors backend industry.config.js — defines per-industry UI behavior
export const INDUSTRY_CONFIG = {
  clinic: {
    label: 'Clinic',
    features: { booking: true, reminders: true, ehr: true, catalogue: false, leads: false },
    terms: { staff: 'Doctor', bookingUnit: 'Token', customer: 'Patient' }
  },
  enquiry: {
    label: 'Sales & Enquiry',
    features: { booking: false, reminders: false, ehr: false, catalogue: true, leads: true },
    terms: { staff: 'Staff', bookingUnit: 'Order', customer: 'Customer' },
    // Theme: Deep Navy + Sky Blue
    // Sidebar: bg-[#1E2E45], divider: #2A3F5F
    // Page bg: #F0F4F8, text: #1E2E45
    // Accent: #4A91C4 (primary), #3A7BAE (hover), #7BAFD4 (subtle)
    // Tint bg: #EBF3FA (light), #D0DCE8 (muted)
  }
};

export function getIndustryConfig(industry) {
  return INDUSTRY_CONFIG[industry] || INDUSTRY_CONFIG.clinic;
}
