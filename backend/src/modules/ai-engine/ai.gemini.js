// One AI turn against Gemini, with the same shape for both SDKs, so ai.service.js has a single tool loop.
//
// - gemini-2.5 models: the old SDK (@google/generative-ai), with exactly the calls ai.service.js always made
//   (getGenerativeModel + startChat + chat.sendMessage with an AbortSignal timeout).
// - every other model (usesNewSdk in ai.models.js): the new SDK (@google/genai) with our own contents array. The model's own content
//   is appended unchanged after every response (any thought signatures stay as received) and function responses are sent with role
//   'user', which the newer models require (they reject the old SDK's role 'function').
//
// startTurn({ model, systemPrompt, tools, generationConfig, history }) returns { send(textOrFunctionResponseParts, timeoutMs) }.
// send() resolves to { candidatesContent, functionCallParts, text, blocked, finishReason, usageMetadata, modelVersion, raw } and
// rejects with the SDK's error unchanged (ai.service.js classifies it). Nothing here logs message content.

const { usesNewSdk } = require('./ai.models')

// The SDK clients are created on first use. Tests can replace them with setClientFactories (no network, no API key needed).
const defaultFactories = {
  legacy: () => {
    const { GoogleGenerativeAI } = require('@google/generative-ai')
    return new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')
  },
  genai: () => {
    const { GoogleGenAI } = require('@google/genai')
    return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '', vertexai: false })
  }
}
let factories = { ...defaultFactories }
let legacyClient = null
let genaiClient = null

function setClientFactories(next = {}) {
  factories = { ...defaultFactories, ...next }
  legacyClient = null
  genaiClient = null
}

function getLegacyClient() {
  if (!legacyClient) legacyClient = factories.legacy()
  return legacyClient
}

function getGenaiClient() {
  if (!genaiClient) genaiClient = factories.genai()
  return genaiClient
}

const functionCallPartsOf = (content) => (content?.parts || []).filter(part => part && part.functionCall)

// ---------------------------------------------------------------------------------------------------------------------------------
// Old SDK (gemini-2.5 models): the calls ai.service.js made before this adapter, unchanged
// ---------------------------------------------------------------------------------------------------------------------------------
function startLegacyTurn({ model, systemPrompt, tools, generationConfig, history }) {
  const generativeModel = getLegacyClient().getGenerativeModel({
    model,
    systemInstruction: systemPrompt,
    tools: [{ functionDeclarations: tools }],
    generationConfig
  })
  const chat = generativeModel.startChat({ history })

  return {
    async send(message, timeoutMs) {
      const response = await chat.sendMessage(message, { signal: AbortSignal.timeout(timeoutMs) })
      const result = response.response
      const candidate = result.candidates?.[0]
      // result.text() throws for a blocked prompt or a blocked candidate: that is the "blocked" case, as before
      let text = null
      let blocked = false
      try {
        text = result.text()
      } catch (textErr) {
        blocked = true
      }
      return {
        candidatesContent: candidate?.content || null,
        functionCallParts: candidate ? functionCallPartsOf(candidate.content) : [],
        text,
        blocked,
        finishReason: candidate?.finishReason || null,
        usageMetadata: result.usageMetadata || null,
        modelVersion: result.modelVersion || null,
        raw: result
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// New SDK (every non-2.5 model): explicit generateContent with our own contents array
// ---------------------------------------------------------------------------------------------------------------------------------
function startGenaiTurn({ model, systemPrompt, tools, generationConfig, history }) {
  // The same cleaned history as the old path (roles 'user' and 'model', text parts), copied so the caller's array is not changed
  const contents = [...(history || [])]
  const baseConfig = {
    systemInstruction: systemPrompt,
    tools: [{ functionDeclarations: tools }],
    ...generationConfig,
    // Our own tool loop and our own retries only: no automatic function calling, no automatic continuation, no SDK retryOptions
    automaticFunctionCalling: { disable: true },
    automaticContinuation: false
  }

  return {
    async send(message, timeoutMs) {
      // The patient's text, or a tool round's functionResponse parts: both go as a 'user' turn
      const parts = typeof message === 'string' ? [{ text: message }] : message
      contents.push({ role: 'user', parts })

      const response = await getGenaiClient().models.generateContent({
        model,
        contents,
        config: { ...baseConfig, abortSignal: AbortSignal.timeout(timeoutMs) }
      })

      const candidate = response?.candidates?.[0]
      const content = candidate?.content
      if (content) {
        // The model's own content, unchanged (role 'model' is added only if the API left it out)
        contents.push(content.role ? content : { role: 'model', ...content })
      }
      const functionCallParts = functionCallPartsOf(content)
      // The text parts joined, thought parts skipped (as the SDK's response.text does); null when there is no text
      let text = null
      for (const part of content?.parts || []) {
        if (part && typeof part.text === 'string' && !(typeof part.thought === 'boolean' && part.thought)) {
          text = (text || '') + part.text
        }
      }
      if (text === '') text = null
      const blocked = !response?.candidates?.length || !!response?.promptFeedback?.blockReason || (text === null && functionCallParts.length === 0)
      return {
        candidatesContent: content || null,
        functionCallParts,
        text,
        blocked,
        finishReason: candidate?.finishReason || null,
        usageMetadata: response?.usageMetadata || null,
        modelVersion: response?.modelVersion || null,
        raw: response
      }
    }
  }
}

function startTurn(params) {
  return usesNewSdk(params.model) ? startGenaiTurn(params) : startLegacyTurn(params)
}

module.exports = { startTurn, setClientFactories }
