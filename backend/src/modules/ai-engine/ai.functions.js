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
      name: 'show_welcome',
      description: 'Shows the welcome message with today\'s available doctors as an interactive list and option buttons. Call this when patient sends their first message, says hi/hello, or needs to see the main menu.',
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
      name: 'show_all_doctors',
      description: 'Shows all active doctors with their next available day. Call this when patient taps Book Another Day button or wants to book for a future date.',
      parameters: {
        type: 'OBJECT',
        properties: {},
        required: []
      }
    },
    {
      name: 'get_available_doctors_tomorrow',
      description: 'Gets list of all doctors available tomorrow with their specialization, session times and tokens remaining. Call this when patient selects option 2 (Book for Tomorrow) and you need to show which doctors are available the next day.',
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
      name: 'create_tomorrow_booking',
      description: 'Creates a booking for tomorrow for a specific doctor. Use this when patient selects option 2 (Book for Tomorrow) and confirms with their name.',
      parameters: {
        type: 'OBJECT',
        properties: {
          doctor_name: {
            type: 'STRING',
            description: 'The name of the doctor to book with'
          },
          patient_name: {
            type: 'STRING',
            description: 'The name of the patient making the booking'
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

  if (industry === 'enquiry') {
    return [
      {
        name: 'get_catalogue',
        description: 'Get the full product catalogue with names, IDs, prices, descriptions and stock status. Call this when a customer asks about products, prices, or what is available.',
        parameters: { type: 'OBJECT', properties: {}, required: [] }
      },
      {
        name: 'get_product',
        description: 'Get details of a specific product by product ID or name. Call this when customer asks about a specific item.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Product name or product ID to search for' }
          },
          required: ['query']
        }
      },
      {
        name: 'capture_lead',
        description: 'Save a customer order/lead after collecting all required details. Call this ONLY after you have confirmed: customer name, product ID, quantity, and delivery address read back and confirmed by customer.',
        parameters: {
          type: 'OBJECT',
          properties: {
            customer_name: { type: 'STRING', description: 'Full name of the customer' },
            product_id: { type: 'STRING', description: 'Product ID from the catalogue' },
            product_name: { type: 'STRING', description: 'Product name' },
            quantity: { type: 'INTEGER', description: 'Number of units ordered' },
            delivery_address: { type: 'STRING', description: 'Full delivery address confirmed by customer' },
            alt_phone: { type: 'STRING', description: 'Alternative phone number if provided, otherwise empty string' },
            notes: { type: 'STRING', description: 'Any special instructions or notes, otherwise empty string' }
          },
          required: ['customer_name', 'product_id', 'product_name', 'quantity', 'delivery_address']
        }
      },
      {
        name: 'escalate_to_human',
        description: 'Transfer the conversation to a human staff member. Call this when customer requests to talk to a person or when you cannot help.',
        parameters: {
          type: 'OBJECT',
          properties: {
            reason: { type: 'STRING', description: 'Brief reason for escalation' }
          },
          required: ['reason']
        }
      }
    ]
  }

  return commonFunctions
}

module.exports = { getFunctionDefinitions }
