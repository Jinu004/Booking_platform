const { GoogleGenerativeAI } = require('@google/generative-ai')
const { getSystemPrompt } = require('./ai.prompts')
const { getFunctionDefinitions } = require('./ai.functions')
const { executeFunction } = require('./ai.executor')
const logger = require('../../utils/logger')
const pool = require('../../config/database')
const redisClient = require('../../config/redis')

const client = new GoogleGenerativeAI(
  process.env.GEMINI_API_KEY || ''
)

const MODELS = {
  pro: 'gemini-2.5-pro',
  growth: 'gemini-2.5-flash',
  starter: 'gemini-2.5-flash'
}
const MODEL = 'gemini-2.5-flash' // default fallback

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

    // Inject doctor profiles for Pro plan clinics
    if (tenant.plan === 'pro' && tenant.industry === 'clinic') {
      try {
        const profilesResult = await pool.query(
          `SELECT name, specialization, profile_description FROM clinic_doctors WHERE tenant_id = $1 AND is_active = true AND profile_description IS NOT NULL AND profile_description != ''`,
          [tenant.id]
        )
        additionalData.doctorProfiles = profilesResult.rows
      } catch (err) {
        logger.warn('Failed to fetch doctor profiles for prompt:', err.message)
      }
    }

    // Inject doctor schedules for Pro plan clinics
    if (tenant.plan === 'pro' && tenant.industry === 'clinic') {
      try {
        const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
        const todayDow = nowIST.getDay()
        const schedCacheKey = `doctor_schedules:${tenant.id}:${todayDow}`
        let schedData = null
        try {
          const cached = await redisClient.get(schedCacheKey)
          if (cached) schedData = JSON.parse(cached)
        } catch (err) {
          logger.warn('Redis get failed for doctor schedules:', err.message)
        }
        if (!schedData) {
          const schedResult = await pool.query(
            `SELECT d.name, d.specialization, ds.day_of_week, ds.start_time, ds.end_time, ds.is_available
             FROM clinic_doctors d
             LEFT JOIN doctor_schedules ds ON d.id = ds.doctor_id
             WHERE d.tenant_id = $1 AND d.is_active = true
             ORDER BY d.name, ds.day_of_week`,
            [tenant.id]
          )
          const onDutyResult = await pool.query(
            `SELECT DISTINCT d.name FROM clinic_doctors d
             JOIN doctor_schedules ds ON d.id = ds.doctor_id
             WHERE d.tenant_id = $1
               AND d.is_active = true
               AND ds.day_of_week = $2
               AND ds.is_available = true
               AND d.leave_days = 0`,
            [tenant.id, todayDow]
          )
          schedData = {
            doctorSchedules: schedResult.rows,
            onDutyDoctors: onDutyResult.rows.map(r => r.name)
          }
          try {
            await redisClient.setEx(schedCacheKey, 60, JSON.stringify(schedData))
          } catch (err) {
            logger.warn('Redis set failed for doctor schedules:', err.message)
          }
        }
        additionalData.doctorSchedules = schedData.doctorSchedules
        additionalData.onDutyDoctors = schedData.onDutyDoctors
      } catch (err) {
        logger.warn('Failed to fetch doctor schedules for prompt:', err.message)
      }
    }

    // Inject knowledge base for Growth and Pro plan clinics
    if ((tenant.plan === 'growth' || tenant.plan === 'pro') && (tenant.industry === 'clinic' || tenant.industry === 'enquiry')) {
      try {
        const kbCacheKey = `tenant_settings:${tenant.id}`
        let kbData = null
        try {
          const cached = await redisClient.get(kbCacheKey)
          if (cached) kbData = JSON.parse(cached)
        } catch (err) {
          logger.warn('Redis get failed for knowledge base:', err.message)
        }
        if (!kbData) {
          const kbResult = await pool.query(
            'SELECT ai_knowledge_base, business_address, business_phone, business_email, payment_upi, payment_phone FROM tenant_settings WHERE tenant_id = $1',
            [tenant.id]
          )
          kbData = kbResult.rows[0] || {}
          try {
            await redisClient.setEx(kbCacheKey, 60, JSON.stringify(kbData))
          } catch (err) {
            logger.warn('Redis set failed for knowledge base:', err.message)
          }
        }
        const kb = kbData.ai_knowledge_base
        if (kb && kb.trim()) {
          additionalData.knowledgeBase = kb.trim()
        }
        additionalData.businessAddress = kbData.business_address || ''
        additionalData.businessPhone = kbData.business_phone || ''
        additionalData.businessEmail = kbData.business_email || ''
        additionalData.paymentUpi = kbData.payment_upi || ''
        additionalData.paymentPhone = kbData.payment_phone || ''
      } catch (err) {
        logger.warn('Failed to fetch knowledge base for prompt:', err.message)
      }
    }

    const systemPrompt = getSystemPrompt(tenant, configs, additionalData)
    const functionDeclarations = getFunctionDefinitions(tenant.industry)

    let lastError;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        let currentModel = attempt === 1 ? (MODELS[tenant.plan] || MODEL) : (tenant.plan === 'pro' ? 'gemini-2.5-flash' : 'gemini-2.5-flash-lite');
        if (attempt === 2 && lastError && (lastError.message?.includes('503') || lastError.message?.includes('Service Unavailable'))) {
          logger.warn('Falling back to gemini-2.5-flash-lite due to 503 error');
          currentModel = tenant.plan === 'pro' ? 'gemini-2.5-flash' : 'gemini-2.5-flash-lite';
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
          .slice(-21, -1)
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

        // Reject oversized messages to prevent prompt injection and wasted tokens
        if (latestMessage.length > 1000) {
          return 'Your message is too long. Please send a shorter message.'
        }

        // Basic prompt injection filter
        const injectionPatterns = [
          /ignore (all |previous |prior )?instructions/i,
          /you are now/i,
          /forget (all |your )?instructions/i,
          /\[SYSTEM\]/i,
          /new instructions:/i,
          /pretend you are/i,
          /act as (a |an )?different/i,
        ];
        if (injectionPatterns.some(pattern => pattern.test(latestMessage))) {
          logger.warn(`Possible prompt injection attempt: ${latestMessage.slice(0, 100)}`);
          return 'I can only help with clinic appointments and bookings. Please type 1 to Book Appointment, 2 to Check My Booking, or 3 to Talk to Staff.';
        }

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

            // Handle direct-return signal — bypass Gemini rewrite
            if (typeof functionResult === 'string' && functionResult.startsWith('DIRECT:')) {
              return functionResult.slice(7).trim();
            }

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
    logger.error('Gemini AI error: ' + JSON.stringify(err) + ' ' + err.stack)

    if (err.message?.includes('API_KEY') || err.message?.includes('API key')) {
      logger.warn('GEMINI_API_KEY invalid or missing')
      return { error: true, text: 'Our AI assistant is currently unavailable. Please contact the clinic directly.' }
    }

    return { error: true, text: 'Sorry, I could not process that. Please type 1 to Book Appointment, 2 to Check My Booking, or 3 to Talk to Staff.' }
  }
}

module.exports = { processMessage }
