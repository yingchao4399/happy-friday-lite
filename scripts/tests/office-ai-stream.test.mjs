import test from 'node:test'
import assert from 'node:assert/strict'
import {
  finalizeOfficeToolCalls,
  mergeOfficeToolDelta,
  mergeToolName,
  normalizeOfficeStopReason,
} from '../../src-electron/office/office-ai-stream.js'

test('嵌套澄清工具的正常增量保留每个字符并解析为原参数', () => {
  const expected = { questions: [{ id: 'audience', label: 'Audience?', options: ['Consumer', 'Business'] }] }
  const fragments = ['{"questions":[', '{', '"id":"audience","label":"Audience?","options":["Consumer","Business"]', '}', ']', '}']
  const args = fragments.reduce((previous, fragment) => mergeOfficeToolDelta(previous, fragment), '')
  assert.equal(args, JSON.stringify(expected))
  const [call] = finalizeOfficeToolCalls(new Map([[0, { id: 'clarify', name: 'ask_clarification', args }]]), 'tool_calls')
  assert.deepEqual(call.input, expected)
  assert.equal(call.inputError, undefined)
})

test('重复数字、文字、结构分隔符及转义 Unicode 不会被去重', () => {
  for (const expected of [
    { value: 111, label: '好好', nested: { empty: {} } },
    { html: '<p title="同同">\\\\路\\径\n好好😀😀</p>', quotes: '\"\"', backslashes: '\\\\' },
  ]) {
    const source = JSON.stringify(expected)
    // 逐 UTF-16 字符分片也必须重建相同字符串，包括成对代理项。
    const args = source.split('').reduce((previous, fragment) => mergeOfficeToolDelta(previous, fragment), '')
    assert.equal(args, source)
    assert.deepEqual(JSON.parse(args), expected)
  }
})

test('参数累计快照只有显式模式才启用，不能从内容猜测', () => {
  assert.equal(mergeOfficeToolDelta('{"start":', '{"start":1}'), '{"start":{"start":1}')
  const options = { mode: 'cumulative' }
  assert.equal(mergeOfficeToolDelta('', '{"start"', options), '{"start"')
  assert.equal(mergeOfficeToolDelta('{"start"', '{"start":1}', options), '{"start":1}')
  assert.equal(mergeOfficeToolDelta('{"start":1}', '{"start":1}', options), '{"start":1}')
  assert.equal(mergeOfficeToolDelta('{"start":1}', '{"start"', options), '{"start":1}')
  assert.throws(() => mergeOfficeToolDelta('{"start":1}', '{"other":2}', options), { code: 'OFFICE_AI_ARGUMENT_SNAPSHOT_INVALID' })
  assert.throws(() => mergeOfficeToolDelta('', '{}', { mode: 'guess' }), { code: 'OFFICE_AI_ARGUMENT_MODE_INVALID' })
})

test('工具名称使用独立声明的增量或累计模式，不复用参数重叠猜测', () => {
  assert.equal(mergeToolName('read_', 'pages'), 'read_pages')
  assert.equal(mergeToolName('a', 'a'), 'aa')
  assert.equal(mergeToolName('read_', 'read_pages', { mode: 'cumulative' }), 'read_pages')
  assert.equal(mergeToolName('read_pages', 'read_pages', { mode: 'cumulative' }), 'read_pages')
  assert.throws(() => mergeToolName('read_pages', 'write_document', { mode: 'cumulative' }), { code: 'OFFICE_AI_NAME_SNAPSHOT_INVALID' })
  assert.throws(() => mergeToolName('', 'read_pages', { mode: 'guess' }), { code: 'OFFICE_AI_NAME_MODE_INVALID' })
})

test('空增量不改缓存，交错工具调用按 index 隔离并稳定排序', () => {
  assert.equal(mergeOfficeToolDelta('{', ''), '{')
  assert.equal(mergeOfficeToolDelta('', ''), '')
  const pending = new Map()
  for (const [index, name, fragment] of [[1, 'second', '{"value":'], [0, 'first', '{"label":"'], [1, 'second', '1'], [0, 'first', '好'], [1, 'second', '1'], [0, 'first', '好'], [1, 'second', '}'], [0, 'first', '"}']]) {
    const call = pending.get(index) || { id: `call-${index}`, name, args: '' }
    call.args = mergeOfficeToolDelta(call.args, fragment)
    pending.set(index, call)
  }
  const calls = finalizeOfficeToolCalls(pending, 'tool_calls')
  assert.deepEqual(calls.map(call => [call.id, call.name, call.input]), [
    ['call-0', 'first', { label: '好好' }],
    ['call-1', 'second', { value: 11 }],
  ])
  assert.equal(calls.some(call => call.inputError || call.truncated), false)
})

test('Office bridge marks a max-token cut-off as truncated', () => {
  const calls = new Map([[0, { id: 'c1', name: 'read_pages', args: '{"start":1' }]])
  const [call] = finalizeOfficeToolCalls(calls, normalizeOfficeStopReason('length'))
  assert.equal(call.truncated, true)
  assert.match(call.inputError, /invalid tool input JSON/)
})

test('截断仅标记最后工具且无参数工具保持空对象，正常停止不伪造截断', () => {
  const pending = new Map([
    [2, { id: 'c2', name: 'write_document', args: '{"html":"<p>' }],
    [0, { id: 'c0', name: 'inspect', args: '' }],
  ])
  const calls = finalizeOfficeToolCalls(pending, normalizeOfficeStopReason('length'))
  assert.deepEqual(calls[0].input, {})
  assert.equal(calls[0].truncated, undefined)
  assert.equal(calls[1].truncated, true)
  assert.match(calls[1].inputError, /invalid tool input JSON/)
  assert.equal(finalizeOfficeToolCalls(pending, 'tool_calls').some(call => call.truncated), false)
})
