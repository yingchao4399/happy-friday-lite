import test from 'node:test'
import assert from 'node:assert/strict'
import { reactive, isProxy } from 'vue'
import { toIpcPayload } from '../../src/utils/ipcPayload.js'

test('嵌套响应式音频校对和资源请求可结构化克隆，原状态不变', () => {
  const texts = reactive(['第一段', '第二段'])
  const nested = reactive({ id: 'session', texts, metadata: reactive({ tags: reactive(['学习']) }) })
  assert.throws(() => structuredClone(nested))
  const payload = toIpcPayload(nested)
  assert.equal(isProxy(payload.texts), false)
  assert.deepEqual(structuredClone(payload), { id: 'session', texts: ['第一段', '第二段'], metadata: { tags: ['学习'] } })
  payload.texts.push('仅改变请求副本')
  assert.equal(texts.length, 2)
})

test('IPC 归一化保留二进制、集合、日期、共享引用和循环，不使用 JSON 丢失数据', () => {
  const bytes = new Uint8Array([0, 255, 12])
  const child = reactive({ count: 3 })
  const input = reactive({ bytes, createdAt: new Date('2026-10-24T00:00:00Z'), items: new Map([['value', child]]), selected: new Set([child]), first: child, second: child })
  input.self = input
  const payload = structuredClone(toIpcPayload(input))
  assert.deepEqual(payload.bytes, bytes)
  assert.equal(payload.createdAt.getUTCFullYear(), 2026)
  assert.equal(payload.items.get('value'), payload.first)
  assert.equal([...payload.selected][0], payload.first)
  assert.equal(payload.first, payload.second)
  assert.equal(payload.self, payload)
})
