import test from 'node:test'
import assert from 'node:assert/strict'
import { serializeCanonicalMessages, validateCanonicalMessages, TranscriptError } from '../../src-electron/ai-core/canonical-message.js'
import { toOpenAiMessages } from '../../src-electron/office/canonical-transcript.js'
import { safeNetworkErrorSummary, annotateNetworkError, NETWORK_ERROR_CLASSIFICATIONS } from '../../src-electron/ai-core/network-policy.js'
import { parseTypewriterImageNodes, markdownImage, normalizeImageSource } from '../../src/features/typewriter/image-utils.js'
import { calculateHistoryPanelPosition } from '../../src/components/chat/history-position.js'

test('Preview.22 canonical transcript preserves tool calls and tool result IDs', () => {
  const input = toOpenAiMessages('sys', [
    { role: 'user', text: 'u' },
    { role: 'assistant', text: '', reasoning: 'r', toolCalls: [{ id: 'call_1', name: 'read', input: {} }] },
    { role: 'tool', results: [{ id: 'call_1', name: 'read', output: 'done' }] },
  ], { thinking: 'enabled' })
  assert.equal(input[2].tool_calls[0].id, 'call_1')
  assert.equal(input[2].tool_calls[0].function.name, 'read')
  assert.equal(input[2].reasoning_content, 'r')
  assert.equal(input[3].tool_call_id, 'call_1')
})

test('Preview.22 rejects an orphan tool result before provider', () => {
  assert.throws(() => validateCanonicalMessages([
    { role: 'user', content: 'u' },
    { role: 'tool', content: 'bad', tool_call_id: 'missing' },
  ]), (error) => error instanceof TranscriptError && error.details.path === 'messages[1].tool_call_id')
})

test('422 retains safe parameter diagnostics and is never labelled network', () => {
  const error = annotateNetworkError(new Error('provider body'), {
    provider: 'deepseek', requestId: 'req-22', phase: 'response', status: 422,
    providerCode: 'invalid_request_error', providerParam: 'messages[3].tool_call_id',
  })
  assert.equal(error.classification, NETWORK_ERROR_CLASSIFICATIONS.MODEL_REQUEST)
  assert.match(safeNetworkErrorSummary(error), /参数无效/)
  assert.match(safeNetworkErrorSummary(error), /messages\[3\]\.tool_call_id/)
  assert.doesNotMatch(safeNetworkErrorSummary(error), /网络连接/) 
  assert.equal(error.diagnostic.providerCode, 'invalid_request_error')
})

test('Typewriter image metadata is persisted in standard Markdown title and unsafe URLs are blocked', () => {
  const markdown = markdownImage('cover', 'friday-asset://note-assets/note-1/cover.png', { width: 240, align: 'right', shadow: 0.4 })
  const [image] = parseTypewriterImageNodes(`intro\n${markdown}`)
  assert.equal(image.width, 240)
  assert.equal(image.align, 'right')
  assert.equal(image.light.shadow, 0.4)
  assert.equal(normalizeImageSource('file:///secret.png'), '')
  assert.equal(normalizeImageSource('https://example.com/a.png'), '')
})

test('History popup stays attached to its trigger when opening above', () => {
    const placement = calculateHistoryPanelPosition({ viewportWidth: 1000, viewportHeight: 700, triggerRect: { left: 960, top: 520, bottom: 544, right: 984 }, panelHeight: 280 })
  assert.equal(placement.below, false)
  assert.equal(placement.top, 234)
  assert.equal(placement.top + placement.height + 6, 520)
  assert.equal(placement.left, 658)
  })

  test('History popup aligns with the trigger instead of drifting to the opposite edge', () => {
    const placement = calculateHistoryPanelPosition({ viewportWidth: 1200, viewportHeight: 800, triggerRect: { left: 420, top: 120, right: 444, bottom: 144 } })
    assert.equal(placement.left, 420)
})
