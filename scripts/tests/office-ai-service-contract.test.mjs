import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_SKILL_TEXT_CHARS,
  OfficeAiServiceError,
  assertNoPlaceholderResult,
  createServiceResult,
  normalizeAiSettingsSnapshot,
  normalizeGskStatus,
  normalizeImageSearchResult,
  normalizeSkillText,
  normalizeSkillsList,
  normalizeSuggestedFileName,
  normalizeWebSearchResult,
  projectCapability,
} from '../../src-electron/office/ai-service-contract.js'

test('web search projects valid results and preserves a real zero-result response', () => {
  assert.deepEqual(normalizeWebSearchResult({ method: 'serper', results: [] }), { method: 'serper', results: [] })
  const result = normalizeWebSearchResult({
    method: 'duckduckgo',
    answer: 'answer',
    results: [{ title: 'Example', url: 'https://example.com', snippet: 'snippet' }],
  }, { requestId: 'r1' })
  assert.equal(result.requestId, 'r1')
  assert.equal(result.results[0].url, 'https://example.com')
  assert.throws(() => normalizeWebSearchResult([]), /results 数组/)
})

test('search failures are distinguishable from empty results', () => {
  assert.deepEqual(normalizeWebSearchResult({ ok: false, error: 'offline' }), {
    method: 'error', results: [], error: 'offline',
  })
  assert.deepEqual(normalizeImageSearchResult(new Error('timeout')), {
    method: 'error', images: [], error: 'timeout',
  })
  assert.throws(() => normalizeImageSearchResult({ method: 'serper', images: [{ imageUrl: 'file:///secret.png' }] }), /HTTP\(S\)/)
})

test('image search projects dimensions and rejects malformed provider output', () => {
  const result = normalizeImageSearchResult({
    method: 'provider',
    images: [{ title: 'Image', url: 'https://cdn.example/image.jpg', width: 640, height: 480 }],
  })
  assert.deepEqual(result.images[0], {
    title: 'Image', imageUrl: 'https://cdn.example/image.jpg', width: 640, height: 480,
  })
  assert.throws(() => normalizeImageSearchResult({ method: 'provider', images: [{}] }), /imageUrl/)
})

test('skills and naming project only safe target shapes', () => {
  assert.deepEqual(normalizeSkillsList([{ name: 'research', description: 'Research', relevant: true }]), [
    { name: 'research', description: 'Research', relevant: true },
  ])
  assert.equal(normalizeSkillText('x'.repeat(MAX_SKILL_TEXT_CHARS + 10)).length, MAX_SKILL_TEXT_CHARS)
  assert.deepEqual(normalizeSuggestedFileName({ ok: false, reason: 'empty-content' }), { ok: false, reason: 'empty-content' })
  assert.deepEqual(normalizeSuggestedFileName({ ok: true, name: 'CON: quarterly/report' }), { ok: true, name: 'CON quarterly report' })
  assert.deepEqual(normalizeSuggestedFileName({ ok: true, name: 'CON' }), { ok: true, name: 'file-CON' })
  assert.deepEqual(normalizeSuggestedFileName({ ok: true, name: '   ' }), { ok: false, reason: 'empty-name' })
  assert.deepEqual(normalizeSkillsList([{ name: 'x', path: 'C:\\secret' }]), [
    { name: 'x', description: '', relevant: false },
  ])
})

test('settings and login status do not invent availability or expose secrets', () => {
  const snapshot = normalizeAiSettingsSnapshot({
    provider: 'friday',
    model: 'model-1',
    configured: true,
    providers: { friday: { configured: true, model: 'model-1', apiKey: 'secret' } },
    capabilities: { webSearch: true, generateImage: false },
  })
  assert.equal(snapshot.providers.friday.apiKey, undefined)
  assert.equal(snapshot.capabilities.webSearch, true)
  assert.equal(normalizeGskStatus({ loggedIn: 'yes', email: 'x@example.com' }).loggedIn, false)
  assert.equal(normalizeGskStatus(null).loggedIn, false)
  assert.deepEqual(projectCapability({ id: 'generate_image', available: true, configured: false }), {
    id: 'generate_image', available: false, reason: 'not-configured',
  })
})

test('generic service envelopes and placeholder guard are explicit', () => {
  assert.deepEqual(createServiceResult({ data: { ok: 1 }, requestId: 'r' }), {
    contractVersion: 'friday.office-ai.v1', ok: true, data: { ok: 1 }, requestId: 'r',
  })
  const failed = createServiceResult({ error: { code: 'OFFLINE', message: 'offline', retryable: true } })
  assert.deepEqual(failed.error, { code: 'OFFLINE', message: 'offline', retryable: true })
  assert.throws(() => assertNoPlaceholderResult([]), OfficeAiServiceError)
  assert.throws(() => assertNoPlaceholderResult(null), /不能返回/)
})

