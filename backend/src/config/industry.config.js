/**
 * Industry registry — defines labels, features, and behavior per industry.
 * Adding a new vertical = adding a new entry here. Core code reads from this.
 */
const INDUSTRY_CONFIG = {
  clinic: {
    label: 'Clinic',
    features: {
      booking: true,
      reminders: true,
      ehr: true,
      catalogue: false,
      leads: false
    },
    terms: {
      staff: 'Doctor',
      bookingUnit: 'Token',
      customer: 'Patient'
    }
  },
  enquiry: {
    label: 'Sales & Enquiry',
    features: {
      booking: false,
      reminders: false,
      ehr: false,
      catalogue: true,
      leads: true
    },
    terms: {
      staff: 'Staff',
      bookingUnit: 'Order',
      customer: 'Customer'
    }
  }
};

function getIndustryConfig(industry) {
  return INDUSTRY_CONFIG[industry] || INDUSTRY_CONFIG.clinic;
}

module.exports = { INDUSTRY_CONFIG, getIndustryConfig };
