import test from 'node:test'
import assert from 'node:assert/strict'
import { auditText, AUDIT_TEXT_LIMIT } from '../../src-electron/agent/audit-summary.js'

test('OCR 图片参数、工具正文和二进制审计不复制原始内容', () => {
  const image = 'data:image/png;base64,' + 'A'.repeat(4 * 1024 * 1024)
  const args = { args: [{ image, page: 2 }], token: 'do-not-store', binary: Buffer.alloc(1024 * 1024) }
  const result = auditText(args)
  assert.ok(result.length < AUDIT_TEXT_LIMIT)
  assert.ok(!result.includes('AAAA'))
  assert.ok(!result.includes('do-not-store'))
  assert.match(result, /bytes/)
  const ui = auditText({ args: [{ text: '私有正文', image }] }, { metadataOnly: true })
  assert.equal(ui, '{"type":"object"}')
})

test('循环、深对象、海量成员和访问器不会造成审计溢出或改变业务对象', () => {
  const input = { count: 1, list: Array(100000).fill('value') }
  input.self = input
  Object.defineProperty(input, 'toJSON', { enumerable: true, get() { throw new Error('must not invoke') } })
  const text = auditText(input)
  assert.match(text, /circular/)
  assert.match(text, /accessor/)
  assert.ok(text.length <= AUDIT_TEXT_LIMIT)
  assert.equal(input.list.length, 100000)
  assert.equal(auditText('x'.repeat(4000000)), '{"type":"string","length":4000000}')
})
