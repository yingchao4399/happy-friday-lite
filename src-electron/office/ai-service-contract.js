/**
 * Shared contract helpers for the HTML AI adapter.
 *
 * These functions deliberately project provider results into the shapes used
 * by GenOffice HTML. They do not decide whether a provider is configured and
 * never turn a missing provider into a successful empty result.
 */

export const OFFICE_AI_SERVICE_CONTRACT_VERSION = 'friday.office-ai.v1'
export const MAX_SKILL_TEXT_CHARS = 32_000
export const MAX_FILE_NAME_CHARS = 60

const OWN = Object.prototype.hasOwnProperty
const HTTP_URL = /^https?:\/\//i
const FILE_NAME_RESERVED = /[<>:"/\\|?*\u0000-\u001f]/g

export class OfficeAiServiceError extends Error {
  constructor(code, message = code, { retryable = false, cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'OfficeAiServiceError'
    this.code = code
    this.retryable = retryable
  }
}

export function serviceError(code, message = code, options = {}) {
  return new OfficeAiServiceError(code, message, options)
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value, name, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw serviceError('OFFICE_AI_CONTRACT_INVALID', `${name} 无效`)
  }
  return value.trim()
}

function optionalText(value, max = 2000) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined
}

function positiveInt(value, fallback, max) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) return fallback
  return Math.min(number, max)
}

function publicUrl(value, field) {
  const url = text(value, field, 4096)
  if (!HTTP_URL.test(url)) throw serviceError('OFFICE_AI_RESULT_INVALID', `${field} 必须是 HTTP(S) 地址`)
  return url
}

function resultError(input, fallbackCode = 'OFFICE_AI_PROVIDER_ERROR') {
  if (input instanceof OfficeAiServiceError) return input
  const code = optionalText(input?.code, 120) || fallbackCode
  const message = optionalText(input?.message || input?.error, 500) || code
  return serviceError(code, message, { retryable: input?.retryable === true, cause: input })
}

/** Return an internal, non-secret service envelope. */
export function createServiceResult({ data, requestId, error } = {}) {
  const base = { contractVersion: OFFICE_AI_SERVICE_CONTRACT_VERSION }
  if (typeof requestId === 'string' && requestId) base.requestId = requestId
  if (error) {
    const normalized = resultError(error)
    return Object.freeze({
      ...base,
      ok: false,
      error: Object.freeze({
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable === true,
      }),
    })
  }
  return Object.freeze({ ...base, ok: true, data })
}

/**
 * Project a provider response to the exact web_search result contract.
 * A provider error is an object with method=error; it is never [] or null.
 */
export function normalizeWebSearchResult(input, { requestId } = {}) {
  if (input instanceof Error || (plainObject(input) && (input.ok === false || input.error))) {
    const error = resultError(input)
    return Object.freeze({
      results: [],
      method: 'error',
      error: error.message,
      ...(typeof requestId === 'string' && requestId ? { requestId } : {}),
    })
  }
  if (!plainObject(input) || !Array.isArray(input.results)) {
    throw serviceError('OFFICE_AI_RESULT_INVALID', 'web search 返回值必须包含 results 数组')
  }
  const method = text(input.method, 'method', 120)
  if (method === 'error') {
    return Object.freeze({
      results: [],
      method: 'error',
      error: optionalText(input.error, 500) || 'web search provider error',
      ...(typeof requestId === 'string' && requestId ? { requestId } : {}),
    })
  }
  const results = input.results.map((item, index) => {
    if (!plainObject(item)) throw serviceError('OFFICE_AI_RESULT_INVALID', `results[${index}] 无效`)
    return Object.freeze({
      title: optionalText(item.title, 1000) || '',
      url: publicUrl(item.url, `results[${index}].url`),
      snippet: optionalText(item.snippet, 5000) || '',
    })
  })
  return Object.freeze({
    results: Object.freeze(results),
    ...(optionalText(input.answer, 10_000) ? { answer: optionalText(input.answer, 10_000) } : {}),
    method,
    ...(typeof requestId === 'string' && requestId ? { requestId } : {}),
  })
}

/** Project a provider response to the exact search_images result contract. */
export function normalizeImageSearchResult(input, { requestId } = {}) {
  if (input instanceof Error || (plainObject(input) && (input.ok === false || input.error))) {
    const error = resultError(input)
    return Object.freeze({
      images: [],
      method: 'error',
      error: error.message,
      ...(typeof requestId === 'string' && requestId ? { requestId } : {}),
    })
  }
  if (!plainObject(input) || !Array.isArray(input.images)) {
    throw serviceError('OFFICE_AI_RESULT_INVALID', 'image search 返回值必须包含 images 数组')
  }
  const method = text(input.method, 'method', 120)
  if (method === 'error') {
    return Object.freeze({
      images: [],
      method: 'error',
      error: optionalText(input.error, 500) || 'image search provider error',
      ...(typeof requestId === 'string' && requestId ? { requestId } : {}),
    })
  }
  const images = input.images.map((item, index) => {
    if (!plainObject(item)) throw serviceError('OFFICE_AI_RESULT_INVALID', `images[${index}] 无效`)
    const imageUrl = item.imageUrl ?? item.url
    const normalized = {
      title: optionalText(item.title, 1000) || '',
      imageUrl: publicUrl(imageUrl, `images[${index}].imageUrl`),
    }
    for (const key of ['width', 'height']) {
      if (item[key] != null) {
        const value = Number(item[key])
        if (!Number.isSafeInteger(value) || value < 1 || value > 100_000) {
          throw serviceError('OFFICE_AI_RESULT_INVALID', `images[${index}].${key} 无效`)
        }
        normalized[key] = value
      }
    }
    return Object.freeze(normalized)
  })
  return Object.freeze({
    images: Object.freeze(images),
    method,
    ...(typeof requestId === 'string' && requestId ? { requestId } : {}),
  })
}

export const normalizeWebSearch = normalizeWebSearchResult
export const normalizeImageSearch = normalizeImageSearchResult
export const projectWebSearchResult = normalizeWebSearchResult
export const projectImageSearchResult = normalizeImageSearchResult

/**
 * Project installed skills to the HTML shell shape. Paths and IDs are never
 * exposed to the renderer; read access must use a separate inventory token.
 */
export function normalizeSkillsList(input) {
  if (!Array.isArray(input)) throw serviceError('OFFICE_AI_RESULT_INVALID', 'skills-list 返回值必须是数组')
  return Object.freeze(input.map((skill, index) => {
    if (!plainObject(skill)) throw serviceError('OFFICE_AI_RESULT_INVALID', `skills[${index}] 无效`)
    return Object.freeze({
      name: text(skill.name, `skills[${index}].name`, 240),
      description: optionalText(skill.description, 2000) || '',
      relevant: skill.relevant === true,
    })
  }))
}

export const normalizeSkillList = normalizeSkillsList
export const projectSkillsList = normalizeSkillsList

/** Skill text is a string at the preload boundary and is explicitly capped. */
export function normalizeSkillText(input, { maxChars = MAX_SKILL_TEXT_CHARS } = {}) {
  if (!Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > MAX_SKILL_TEXT_CHARS) {
    throw serviceError('OFFICE_AI_CONTRACT_INVALID', 'skill text 上限无效')
  }
  if (typeof input !== 'string') throw serviceError('OFFICE_AI_RESULT_INVALID', 'skill-text 必须返回字符串')
  return input.slice(0, maxChars)
}

export const projectSkillText = normalizeSkillText

/** Name suggestion projection consumed by the HTML save dialog. */
export function normalizeSuggestedFileName(input) {
  if (!plainObject(input)) throw serviceError('OFFICE_AI_RESULT_INVALID', '命名服务返回值无效')
  if (input.ok === false) {
    return Object.freeze({ ok: false, reason: optionalText(input.reason, 160) || 'unavailable' })
  }
  if (input.ok !== true) throw serviceError('OFFICE_AI_RESULT_INVALID', '命名服务必须明确返回 ok')
  const name = sanitizeFileStem(input.name)
  if (!name) return Object.freeze({ ok: false, reason: 'empty-name' })
  return Object.freeze({ ok: true, name })
}

export const projectSuggestedFileName = normalizeSuggestedFileName

export function sanitizeFileStem(input) {
  if (typeof input !== 'string') return ''
  let value = input.normalize('NFKC').replace(FILE_NAME_RESERVED, ' ').replace(/\s{2,}/g, ' ').replace(/[. ]+$/g, '').trim()
  value = value.replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i, 'file-$1')
  return value.slice(0, MAX_FILE_NAME_CHARS).trim()
}

/**
 * Public settings snapshot: only values needed for UI capability projection.
 * Keys, cookies and provider internals are rejected rather than copied.
 */
export function normalizeAiSettingsSnapshot(input = {}) {
  if (!plainObject(input)) throw serviceError('OFFICE_AI_RESULT_INVALID', 'AI 设置必须是对象')
  const providers = {}
  if (plainObject(input.providers)) {
    for (const [id, provider] of Object.entries(input.providers)) {
      if (!/^[a-zA-Z0-9._-]{1,80}$/.test(id) || !plainObject(provider)) continue
      providers[id] = Object.freeze({
        configured: provider.configured === true,
        model: optionalText(provider.model, 200) || undefined,
        enabled: provider.enabled !== false,
      })
    }
  }
  const capabilities = {}
  if (plainObject(input.capabilities)) {
    for (const [name, value] of Object.entries(input.capabilities)) {
      if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(name)) continue
      capabilities[name] = value === true
    }
  }
  return Object.freeze({
    contractVersion: OFFICE_AI_SERVICE_CONTRACT_VERSION,
    provider: optionalText(input.provider, 120) || null,
    model: optionalText(input.model, 200) || null,
    providers: Object.freeze(providers),
    capabilities: Object.freeze(capabilities),
    // Kept for compatibility with the GenOffice HTML capability gate. This
    // is only true when the host explicitly proves a configured media service.
    gskToolsEnabled: input.gskToolsEnabled === true,
    maxOutputTokens: Number.isSafeInteger(input.maxOutputTokens) && input.maxOutputTokens > 0
      ? Math.min(input.maxOutputTokens, 32_768)
      : 8192,
    configured: input.configured === true,
    updatedAt: Number.isSafeInteger(input.updatedAt) && input.updatedAt > 0 ? input.updatedAt : 0,
  })
}

export const normalizeAiSettings = normalizeAiSettingsSnapshot
export const projectAiSettings = normalizeAiSettingsSnapshot

export function normalizeGskStatus(input = {}) {
  if (!plainObject(input)) return Object.freeze({ loggedIn: false })
  const status = { loggedIn: input.loggedIn === true }
  const email = optionalText(input.email, 320)
  if (email) status.email = email
  const reason = optionalText(input.reason, 160)
  if (reason) status.reason = reason
  return Object.freeze(status)
}

export const projectGskStatus = normalizeGskStatus

/** Return a capability only when its provider is configured and explicitly available. */
export function projectCapability({ id, available, configured, reason } = {}) {
  const capabilityId = text(id, 'capability.id', 160)
  const isAvailable = available === true && configured === true
  return Object.freeze({
    id: capabilityId,
    available: isAvailable,
    ...(isAvailable ? {} : { reason: optionalText(reason, 240) || (configured === true ? 'provider-unavailable' : 'not-configured') }),
  })
}

export function assertNoPlaceholderResult(value, kind = 'service') {
  if (Array.isArray(value) || value == null) {
    throw serviceError('OFFICE_AI_PLACEHOLDER_RESULT', `${kind} 不能返回数组、null 或 undefined`)
  }
  return value
}

