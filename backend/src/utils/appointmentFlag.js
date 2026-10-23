// The two switches of WhatsApp appointment booking by clock time. A clinic uses it only when BOTH are on:
//   booking_mode = 'appointment'   (the clinic books by time; set in Settings)
//   ai_appointment_booking = 'true' (a tenant_configs key, set by a super admin)
// Every other clinic keeps the token booking flow unchanged.
function isAppointmentBookingOn(configs) {
  return !!configs && configs.booking_mode === 'appointment' && configs.ai_appointment_booking === 'true';
}

module.exports = { isAppointmentBookingOn };
