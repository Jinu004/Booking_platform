const { GoogleGenerativeAI } = require('@google/generative-ai')
const { getSystemPrompt } = require('./ai.prompts')
const { getFunctionDefinitions } = require('./ai.functions')
const { executeFunction } = require('./ai.executor')
const logger = require('../../utils/logger')

const client = new GoogleGenerativeAI(
  process.env.GEMINI_API_KEY || ''
)

const MODEL = 'gemini-2.5-flash'

/**
 * Processes an incoming message through Gemini
 * Handles multi-turn function calling loop
 *
 * @param {object} context
 * @param {object} context.tenant
 * @param {object} context.customer
 * @param {object} context.conversation
 * @param {Array}  context.recentMessages
 * @param {object} context.session
 * @param {object} context.configs
 * @param {object} context.additionalData
 * @returns {Promise<string>} AI response text
 */
async function processMessage(context) {
  const {
    tenant,
    customer,
    conversation,
    recentMessages,
    configs = {},
    additionalData = {}
  } = context

  try {
    if (!process.env.GEMINI_API_KEY) {
      logger.warn('GEMINI_API_KEY not set — AI features disabled')
      return 'Our AI assistant is currently being set up. Please call the clinic directly for assistance.'
    }

    const systemPrompt = getSystemPrompt(tenant, configs, additionalData)
    const functionDeclarations = getFunctionDefinitions(tenant.industry)

    let lastError;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        let currentModel = MODEL;
        if (attempt === 2 && lastError && (lastError.message?.includes('503') || lastError.message?.includes('Service Unavailable'))) {
          logger.warn('Falling back to gemini-2.5-pro due to 503 error');
          currentModel = 'gemini-2.5-pro';
        }

        // Initialize Gemini model with tools
        const model = client.getGenerativeModel({
          model: currentModel,
          systemInstruction: systemPrompt,
          tools: [{ functionDeclarations }]
        })

        // Build conversation history for Gemini
        // Gemini uses 'model' not 'assistant' for AI role
        // Skip the last message — it will be sent fresh
        const errorPhrases = ['having trouble', 'could not process', 'try again'];

        const history = (recentMessages || [])
          .slice(0, -1)
          .filter(msg => {
            if (msg.role === 'staff') return false;
            if (msg.role === 'assistant') {
              const content = msg.content?.toLowerCase() || '';
              if (errorPhrases.some(phrase => content.includes(phrase))) return false;
            }
            return true;
          })
          .map(msg => ({
            role: msg.role === 'assistant' || msg.role === 'staff' ? 'model' : 'user',
            parts: [{ text: msg.content }]
          }))

        const firstUserIndex = history.findIndex(m => m.role === 'user');
        const cleanHistory = firstUserIndex > 0 ? history.slice(firstUserIndex) : history;

        // Get the latest message text to send
        const latestMessage = recentMessages?.[recentMessages.length - 1]?.content || ''

        // Start chat session with conversation history
        const chat = model.startChat({ history: cleanHistory })

        // Send the latest patient message
        let response = await chat.sendMessage(latestMessage)
        let result = response.response

        // Function calling loop — Gemini may call multiple functions
        const maxIterations = 5
        let iteration = 0
        let escalated = false;
        const escalationMessage = 'I am connecting you with a staff member who can better assist you. Please wait a moment.';

        while (iteration < maxIterations) {
          iteration++

          const candidate = result.candidates?.[0]
          if (!candidate) break

          // Collect any function calls in this response
          const functionCallParts = (candidate.content?.parts || [])
            .filter(part => part.functionCall)

          // No more function calls — final text response
          if (!functionCallParts.length) break

          // Execute each function call sequentially
          const functionResponses = []
          const executedFunctions = new Set()

          for (const part of functionCallParts) {
            const { name, args } = part.functionCall
            
            if (executedFunctions.has(name)) {
              continue;
            }
            executedFunctions.add(name);

            logger.info(`Gemini calling function: ${name}`, JSON.stringify(args))

            const functionResult = await executeFunction(
              name,
              args,
              { tenant, customer, conversation }
            )

            // Handle escalation signal
            if (
              typeof functionResult === 'string' &&
              functionResult.startsWith('ESCALATE:')
            ) {
              escalated = true;
              break;
            }

            functionResponses.push({
              functionResponse: {
                name,
                response: { result: functionResult }
              }
            })
          }
          
          if (escalated) break;

          // Feed function results back to Gemini
          response = await chat.sendMessage(functionResponses)
          result = response.response
        }

        if (escalated) {
          return { escalated: true, text: escalationMessage };
        }

        // Extract final text response from Gemini
        let text;
        try {
          text = result.text()
        } catch (textErr) {
          return { error: true, text: 'Sorry, I could not process that. Please type 1 to Book Appointment, 2 to Check My Booking, or 3 to Talk to Staff.' };
        }
        if (!text || !text.trim()) {
          throw new Error('Empty text response from Gemini');
        }

        return text.trim()

      } catch (err) {
        lastError = err;
        if (attempt === 1) {
          logger.warn(`Gemini attempt 1 failed: ${err.message}. Retrying in 2000ms...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
    
    // If both attempts fail, throw to the outer catch block
    throw lastError;

  } catch (err) {
    logger.error('Gemini AI error:', err.message || err.name || String(err))

    if (err.message?.includes('API_KEY') || err.message?.includes('API key')) {
      logger.warn('GEMINI_API_KEY invalid or missing')
      return { error: true, text: 'Our AI assistant is currently unavailable. Please contact the clinic directly.' }
    }

    return { error: true, text: 'Sorry, I could not process that. Please type 1 to Book Appointment, 2 to Check My Booking, or 3 to Talk to Staff.' }
  }
}

module.exports = { processMessage }
