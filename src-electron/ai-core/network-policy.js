/**
 * AI Core 统一网络错误策略。
 * 只返回阶段、状态和分类等诊断元数据，不携带 API Key、请求正文或响应正文。
 */
export const NETWORK_ERROR_CLASSIFICATIONS = Object.freeze({
  CONFIG: 'local_config',
  DNS_CONNECTION: 'dns_connection',
  PROXY: 'proxy',
  TLS: 'tls',
  TIMEOUT: 'timeout',
  RATE_LIMIT: 'rate_limit',
  AUTH: 'auth',
  MODEL_REQUEST: 'model_request',
  SERVER: 'server_5xx',
  USER_CANCELLED: 'user_cancelled',
  STREAM_INTERRUPTED: 'stream_interrupted',
  UNKNOWN: 'unknown'
})

const KNOWN_CLASSIFICATIONS = new Set(Object.values(NETWORK_ERROR_CLASSIFICATIONS))
const KNOWN_PHASES = new Set(['connect', 'response', 'stream', 'read', 'request', 'config'])

const RETRYABLE = new Set([
  NETWORK_ERROR_CLASSIFICATIONS.DNS_CONNECTION,
  NETWORK_ERROR_CLASSIFICATIONS.PROXY,
  NETWORK_ERROR_CLASSIFICATIONS.TLS,
  NETWORK_ERROR_CLASSIFICATIONS.TIMEOUT,
  NETWORK_ERROR_CLASSIFICATIONS.RATE_LIMIT,
  NETWORK_ERROR_CLASSIFICATIONS.SERVER,
  NETWORK_ERROR_CLASSIFICATIONS.STREAM_INTERRUPTED
])

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/** Parse HTTP Retry-After seconds or an HTTP date into milliseconds. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value === '') return null
  const seconds = numberOrNull(String(value).trim())
  if (seconds != null && seconds >= 0) return Math.min(seconds * 1000, 120000)
  const timestamp = Date.parse(String(value))
  if (!Number.isFinite(timestamp)) return null
  return Math.max(0, Math.min(timestamp - now, 120000))
}

export function classifyNetworkError(error, { status = null, phase = 'request', cancelled = false } = {}) {
  if (cancelled || error?.name === 'AbortError' || error?.code === 'ERR_CANCELED') return NETWORK_ERROR_CLASSIFICATIONS.USER_CANCELLED
  const numericStatus = numberOrNull(status ?? error?.status)
  if (numericStatus === 401 || numericStatus === 403) return NETWORK_ERROR_CLASSIFICATIONS.AUTH
  if (numericStatus === 429) return NETWORK_ERROR_CLASSIFICATIONS.RATE_LIMIT
  if (numericStatus >= 500 && numericStatus <= 599) return NETWORK_ERROR_CLASSIFICATIONS.SERVER
  if (numericStatus >= 400 && numericStatus <= 499) return NETWORK_ERROR_CLASSIFICATIONS.MODEL_REQUEST

  const code = String(error?.code || '').toUpperCase()
  const message = String(error?.message || '').toLowerCase()
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code) || /dns|name or service|network is unreachable|connection refused/.test(message)) return NETWORK_ERROR_CLASSIFICATIONS.DNS_CONNECTION
  if (['EPROXY', 'ERR_PROXY_CONNECTION_FAILED'].includes(code) || /proxy/.test(message)) return NETWORK_ERROR_CLASSIFICATIONS.PROXY
  if (['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(code) || /certificate|tls|ssl/.test(message)) return NETWORK_ERROR_CLASSIFICATIONS.TLS
  if (['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(code) || /timed out|timeout/.test(message)) return NETWORK_ERROR_CLASSIFICATIONS.TIMEOUT
  if (phase === 'stream' || phase === 'read') return NETWORK_ERROR_CLASSIFICATIONS.STREAM_INTERRUPTED
  if (phase === 'config') return NETWORK_ERROR_CLASSIFICATIONS.CONFIG
  return NETWORK_ERROR_CLASSIFICATIONS.UNKNOWN
}

export function isRetryableClassification(classification) {
  return RETRYABLE.has(classification)
}

export function shouldRetryNetworkError({ classification, attempt = 0, maxAttempts = 2, hasOutput = false, hasSideEffect = false } = {}) {
  return !hasOutput && !hasSideEffect && attempt < maxAttempts - 1 && isRetryableClassification(classification)
}

export function createNetworkDiagnostic({ provider = '', requestId = '', phase = 'request', status = null, classification = NETWORK_ERROR_CLASSIFICATIONS.UNKNOWN, elapsedMs = null, retryAfterMs = null } = {}) {
  const safePhase = String(phase || 'request')
  return {
    provider: String(provider || 'unknown').slice(0, 40),
    requestId: String(requestId || '').slice(0, 80),
    phase: KNOWN_PHASES.has(safePhase) ? safePhase : 'request',
    status: numberOrNull(status),
    classification: KNOWN_CLASSIFICATIONS.has(classification) ? classification : NETWORK_ERROR_CLASSIFICATIONS.UNKNOWN,
    elapsedMs: numberOrNull(elapsedMs),
    retryAfterMs: numberOrNull(retryAfterMs),
    retryable: isRetryableClassification(KNOWN_CLASSIFICATIONS.has(classification) ? classification : NETWORK_ERROR_CLASSIFICATIONS.UNKNOWN)
  }
}

/** Copy only the supported diagnostic fields so arbitrary upstream data cannot cross IPC or persistence boundaries. */
export function sanitizeNetworkDiagnostic(diagnostic, fallback = {}) {
  const source = diagnostic && typeof diagnostic === 'object' ? diagnostic : {}
  const classification = source.classification || fallback.classification
  const hasNetworkSignal = Boolean(diagnostic || classification || /^AI_CORE_NETWORK_/.test(String(fallback.code || '')))
  if (!hasNetworkSignal) return null
  return createNetworkDiagnostic({
    provider: source.provider ?? fallback.provider,
    requestId: source.requestId ?? fallback.requestId,
    phase: source.phase ?? fallback.stage ?? fallback.phase,
    status: source.status ?? fallback.status,
    classification: KNOWN_CLASSIFICATIONS.has(classification) ? classification : NETWORK_ERROR_CLASSIFICATIONS.UNKNOWN,
    elapsedMs: source.elapsedMs,
    retryAfterMs: source.retryAfterMs
  })
}

/** Return a user-safe summary for network errors while keeping request diagnostics separately available. */
export function safeNetworkErrorSummary(error, fallback = '请求失败') {
  const diagnostic = sanitizeNetworkDiagnostic(error?.diagnostic, error || {})
  if (!diagnostic) {
    if (error?.type === 'Llm' || /^AI_CORE_NETWORK_/.test(String(error?.code || ''))) return fallback
    return error?.message || String(error || fallback)
  }
  const status = diagnostic.status == null ? '' : `，HTTP ${diagnostic.status}`
  return `模型请求失败（${diagnostic.classification}${status}）`
}

export function annotateNetworkError(error, options = {}) {
  const classification = options.classification || classifyNetworkError(error, options)
  const diagnostic = createNetworkDiagnostic({ ...options, classification })
  const target = error instanceof Error ? error : new Error(String(error || 'Network request failed'))
  target.code = target.code || `AI_CORE_NETWORK_${classification.toUpperCase()}`
  target.stage = options.phase || target.stage || 'request'
  target.classification = diagnostic.classification
  target.recoverable = diagnostic.retryable
  target.retryAfterMs = diagnostic.retryAfterMs
  target.diagnostic = diagnostic
  // Clear any provider-supplied response text from message and stack before the error
  // can reach IPC, history metadata, or logging code.
  target.message = safeNetworkErrorSummary(target)
  target.stack = `${target.name || 'Error'}: ${target.message}`
  return target
}

/**
 * Retry only the request establishment/response-header phase. A caller must not
 * use this helper after a streamed body has been exposed or a side effect ran.
 */
export async function fetchWithFiniteRetry(url, options = {}, { provider = '', requestId = '', maxAttempts = 2, hasSideEffect = false, sleep = delay, fetchImpl = fetch } = {}) {
  let lastError
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const startedAt = Date.now()
    try {
      const response = await fetchImpl(url, options)
      if (response.ok || !shouldRetryNetworkError({ classification: classifyNetworkError(null, { status: response.status }), attempt, maxAttempts, hasSideEffect })) return response
      const classification = classifyNetworkError(null, { status: response.status })
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
      lastError = annotateNetworkError(new Error(`模型请求失败（${response.status}）`), { provider, requestId, phase: 'response', status: response.status, classification, elapsedMs: Date.now() - startedAt, retryAfterMs })
      if (!shouldRetryNetworkError({ classification, attempt, maxAttempts, hasSideEffect })) throw lastError
      try { await response.body?.cancel?.() } catch { /* release the transient response before retry */ }
      await sleep(retryAfterMs ?? backoff(attempt))
    } catch (error) {
      // HTTP response errors are already classified and, when retryable, slept
      // in the response branch above. Preserve their status classification.
      if (error?.diagnostic) throw error
      const classification = classifyNetworkError(error, { phase: 'connect' })
      lastError = annotateNetworkError(error, { provider, requestId, phase: 'connect', classification, elapsedMs: Date.now() - startedAt })
      if (!shouldRetryNetworkError({ classification, attempt, maxAttempts, hasSideEffect })) throw lastError
      await sleep(backoff(attempt))
    }
  }
  throw lastError || annotateNetworkError(new Error('模型请求失败'), { provider, requestId })
}

function backoff(attempt) {
  return Math.min(4000, 250 * (2 ** attempt))
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
