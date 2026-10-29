import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NETWORK_ERROR_CLASSIFICATIONS,
  annotateNetworkError,
  classifyNetworkError,
  createNetworkDiagnostic,
  fetchWithFiniteRetry,
  parseRetryAfter,
  safeNetworkErrorSummary,
  sanitizeNetworkDiagnostic,
  shouldRetryNetworkError
} from '../../src-electron/ai-core/network-policy.js'

test('classifies provider failures without exposing response content', () => {
  assert.equal(classifyNetworkError({ code: 'ENOTFOUND' }, { phase: 'connect' }), NETWORK_ERROR_CLASSIFICATIONS.DNS_CONNECTION)
  assert.equal(classifyNetworkError({ code: 'CERT_HAS_EXPIRED' }, { phase: 'connect' }), NETWORK_ERROR_CLASSIFICATIONS.TLS)
  assert.equal(classifyNetworkError(null, { status: 401 }), NETWORK_ERROR_CLASSIFICATIONS.AUTH)
  assert.equal(classifyNetworkError(null, { status: 429 }), NETWORK_ERROR_CLASSIFICATIONS.RATE_LIMIT)
  assert.equal(classifyNetworkError(null, { status: 503 }), NETWORK_ERROR_CLASSIFICATIONS.SERVER)
  const error = annotateNetworkError(new Error('secret api key should not be logged'), { provider: 'demo', requestId: 'req-1', phase: 'response', status: 503 })
  assert.equal(error.classification, NETWORK_ERROR_CLASSIFICATIONS.SERVER)
  assert.equal(error.diagnostic.provider, 'demo')
  assert.equal(error.diagnostic.requestId, 'req-1')
  assert.equal(error.diagnostic.body, undefined)
  assert.equal(error.message.includes('secret api key'), false)
  assert.equal(error.stack.includes('secret api key'), false)
  assert.equal(safeNetworkErrorSummary(error).includes('secret api key'), false)
  assert.equal(sanitizeNetworkDiagnostic({ provider: 'demo', requestId: 'req-1', classification: 'unexpected', body: 'secret' }).body, undefined)
})

test('parses bounded Retry-After values and retry gates', () => {
  assert.equal(parseRetryAfter('2'), 2000)
  assert.equal(parseRetryAfter('999999'), 120000)
  assert.equal(parseRetryAfter('invalid'), null)
  assert.equal(shouldRetryNetworkError({ classification: NETWORK_ERROR_CLASSIFICATIONS.SERVER, attempt: 0, maxAttempts: 2 }), true)
  assert.equal(shouldRetryNetworkError({ classification: NETWORK_ERROR_CLASSIFICATIONS.AUTH, attempt: 0, maxAttempts: 2 }), false)
  assert.equal(shouldRetryNetworkError({ classification: NETWORK_ERROR_CLASSIFICATIONS.SERVER, attempt: 0, maxAttempts: 2, hasOutput: true }), false)
  assert.equal(createNetworkDiagnostic({ classification: NETWORK_ERROR_CLASSIFICATIONS.SERVER, status: 503 }).retryable, true)
})

test('finite retry retries a transient status once and returns the next response', async () => {
  const originalFetch = globalThis.fetch
  const originalSetTimeout = globalThis.setTimeout
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    if (calls === 1) return new Response('busy', { status: 503, headers: { 'retry-after': '0' } })
    return new Response('{"ok":true}', { status: 200 })
  }
  globalThis.setTimeout = (fn) => { fn(); return 0 }
  try {
    const response = await fetchWithFiniteRetry('https://example.test', {}, { provider: 'demo', requestId: 'req-2', sleep: async () => {} })
    assert.equal(response.status, 200)
    assert.equal(calls, 2)
  } finally {
    globalThis.fetch = originalFetch
    globalThis.setTimeout = originalSetTimeout
  }
})
