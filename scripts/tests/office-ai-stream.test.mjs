import test from 'node:test'
import assert from 'node:assert/strict'
import {
  finalizeOfficeToolCalls,
  mergeOfficeToolDelta,
  mergeToolName,
  normalizeOfficeStopReason,
} from '../../src-electron/office/office-ai-stream.js'

test('Office bridge accepts fragment and cumulative tool deltas', () => {
  assert.equal(mergeOfficeToolDelta('', '{"start"'), '{"start"')
  assert.equal(mergeOfficeToolDelta('{"start"', '{"start":1}'), '{"start":1}')
  assert.equal(mergeOfficeToolDelta('{"start":1}', '{"start":1}'), '{"start":1}')
  assert.equal(mergeToolName('read_', 'read_pages'), 'read_pages')
  assert.equal(mergeToolName('read_', 'pages'), 'read_pages')
  const calls = new Map([[0, { id: 'c1', name: 'read_pages', args: mergeOfficeToolDelta('{"start":', '{"start":1}') }]])
  const [parsed] = finalizeOfficeToolCalls(calls, 'tool_calls')
  assert.deepEqual(parsed.input, { start: 1 })
  assert.equal(parsed.inputError, undefined)
})

test('Office bridge marks a max-token cut-off as truncated', () => {
  const calls = new Map([[0, { id: 'c1', name: 'read_pages', args: '{"start":1' }]])
  const [call] = finalizeOfficeToolCalls(calls, normalizeOfficeStopReason('length'))
  assert.equal(call.truncated, true)
  assert.match(call.inputError, /invalid tool input JSON/)
})
