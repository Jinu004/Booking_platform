/**
 * Returns function declarations for Gemini API
 * Gemini uses uppercase type values: 'OBJECT', 'STRING', etc.
 *
 * @param {string} industry
 * @returns {Array} Gemini function declarations
 */
function getFunctionDefinitions(industry) {
  const commonFunctions = [
    {
      name: 'get_clinic_info',
      description: 'Get clinic information including working hours and available doctors',
      parameters: {
        type: 'OBJECT',
        properties: {},
        required: []
      }
    },
    {
      name: 'get_available_doctors',
      description: 'Gets list of all doctors available today with their specialization, tokens remaining and session start time. Call this when patient wants to book an appointment and you need to show them which doctors are available.',
      parameters: {
        type: 'OBJECT',
        properties: {},
        required: []
      }
    },
    {
      name: 'check_doctor_availability',
      description: 'Check if a specific doctor is available today and how many tokens remain',
      parameters: {
        type: 'OBJECT',
        properties: {
          doctor_name: {
            type: 'STRING',
            description: 'Name of the doctor to check'
          }
        },
        required: ['doctor_name']
      }
    },
    {
      name: 'create_token_booking',
      description: 'Create a booking and issue a token number for the patient',
      parameters: {
        type: 'OBJECT',
        properties: {
          doctor_name: {
            type: 'STRING',
            description: 'Name of the doctor'
          },
          patient_name: {
            type: 'STRING',
            description: 'Name of the patient'
          }
        },
        required: ['doctor_name', 'patient_name']
      }
    },
    {
      name: 'cancel_booking',
      description: 'Cancel an existing booking for the patient',
      parameters: {
        type: 'OBJECT',
        properties: {
          booking_id: {
            type: 'STRING',
            description: 'ID of the booking to cancel'
          }
        },
        required: ['booking_id']
      }
    },
    {
      name: 'get_patient_bookings',
      description: 'Get all upcoming bookings for the current patient',
      parameters: {
        type: 'OBJECT',
        properties: {},
        required: []
      }
    },
    {
      name: 'escalate_to_human',
      description: 'Escalate to human staff when you cannot help the patient',
      parameters: {
        type: 'OBJECT',
        properties: {
          reason: {
            type: 'STRING',
            description: 'Reason for escalation'
          }
        },
        required: ['reason']
      }
    }
  ]

  return commonFunctions
}

module.exports = { getFunctionDefinitions }
