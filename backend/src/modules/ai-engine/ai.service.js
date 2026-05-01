const { GoogleGenerativeAI } = require('@google/generative-ai')
const { getSystemPrompt } = require('./ai.prompts')
const { getFunctionDefinitions } = require('./ai.functions')
const { executeFunction } = require('./ai.executor')
const logger = require('../../utils/logger')

const client = new GoogleGenerativeAI(
  process.env.GEMINI_API_KEY || ''
)

const MODEL = 'gemini-2.0-flash'

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

    // Initialize Gemini model with tools
    const model = client.getGenerativeModel({
      model: MODEL,
      systemInstruction: systemPrompt,
      tools: [{ functionDeclarations }]
    })

    // Build conversation history for Gemini
    // Gemini uses 'model' not 'assistant' for AI role
    // Skip the last message — it will be sent fresh
    const history = (recentMessages || [])
      .slice(0, -1)
      .map(msg => ({
        role: msg.role === 'assistant' || msg.role === 'staff' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }))

    // Get the latest message text to send
    const latestMessage = recentMessages?.[recentMessages.length - 1]?.content || ''

    // Start chat session with conversation history
    const chat = model.startChat({ history })

    // Send the latest patient message
    let response = await chat.sendMessage(latestMessage)
    let result = response.response

    // Function calling loop — Gemini may call multiple functions
    const maxIterations = 5
    let iteration = 0

    while (iteration < maxIterations) {
      iteration++

      const candidate = result.candidates?.[0]
      if (!candidate) break

      // Collect any function calls in this response
      const functionCallParts = (candidate.content?.parts || [])
        .filter(part => part.functionCall)

      // No more function calls — final text response
      if (!functionCallParts.length) break

      // Execute each function call in parallel
      const functionResponses = []

      for (const part of functionCallParts) {
        const { name, args } = part.functionCall

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
          return 'I am connecting you with a staff member who can better assist you. Please wait a moment.'
        }

        functionResponses.push({
          functionResponse: {
            name,
            response: { result: functionResult }
          }
        })
      }

      // Feed function results back to Gemini
      response = await chat.sendMessage(functionResponses)
      result = response.response
    }

    // Extract final text response from Gemini
    const text = result.text()
    if (!text || !text.trim()) {
      return 'I apologize, I could not process your request. Please try again.'
    }

    return text.trim()

  } catch (err) {
    logger.error('Gemini AI error:', err.message)

    if (err.message?.includes('API_KEY') || err.message?.includes('API key')) {
      logger.warn('GEMINI_API_KEY invalid or missing')
      return 'Our AI assistant is currently unavailable. Please contact the clinic directly.'
    }

    return 'I am having trouble processing your request right now. Please try again in a moment.'
  }
}

module.exports = { processMessage }
