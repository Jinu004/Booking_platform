// The two switches of WhatsApp appointment booking by clock time. A clinic uses it only when BOTH are on:
//   booking_mode = 'appointment'   (the clinic books by time; set in Settings)
//   ai_appointment_booking = 'true' (a tenant_configs key, set by a super admin)
// Every other clinic keeps the token booking flow unchanged.
function isAppointmentBookingOn(configs) {
  return !!configs && configs.booking_mode === 'appointment' && configs.ai_appointment_booking === 'true';
}

// Enquiry-only mode: tenant_configs booking_off = 'true' (set by a super admin). The WhatsApp AI then never starts or continues a booking
// for that clinic. A missing key, or any other value, means booking works exactly as before.
function isBookingOff(configs) {
  return !!configs && configs.booking_off === 'true';
}

module.exports = { isAppointmentBookingOn, isBookingOff };
