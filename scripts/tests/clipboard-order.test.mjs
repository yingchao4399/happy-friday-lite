import test from 'node:test'
import assert from 'node:assert/strict'
import { compareClipboardOrder, reorderClipboardItems } from '../../src-electron/clipboard-order.js'

const item = (id, options = {}) => ({ id, capturedAt: `2026-01-0${id.charCodeAt(0) - 96}T00:00:00.000Z`, pinned: false, ...options })

test('clipboard order keeps pinned items first and falls back to capture time', () => {
  const values = [item('a'), item('b', { pinned: true }), item('c', { manualOrder: Date.parse('2026-01-03T00:00:00.000Z') }), item('d', { manualOrder: Date.parse('2026-01-04T00:00:00.000Z') })]
  assert.deepEqual(values.sort(compareClipboardOrder).map(value => value.id), ['b', 'd', 'c', 'a'])
})

test('dragging before and after a target persists a stable manual order', () => {
  const values = [item('a'), item('b'), item('c')]
  const base = Date.parse('2026-10-23T00:00:00.000Z')
  const first = reorderClipboardItems(values, 'c', 'a', false, () => base)
  assert.deepEqual(first.orderedIds, ['b', 'c', 'a'])
  assert.deepEqual(values.sort(compareClipboardOrder).map(value => value.id), first.orderedIds)

  const second = reorderClipboardItems(values, 'c', 'a', true, () => base + 100)
  assert.deepEqual(second.orderedIds, ['b', 'a', 'c'])
  assert.deepEqual(values.sort(compareClipboardOrder).map(value => value.id), second.orderedIds)
  assert.equal(new Set(values.map(value => value.manualOrder)).size, values.length)
})

test('reordering cannot cross pinned groups or move deleted records', () => {
  const values = [item('a'), item('b', { pinned: true }), item('c', { deletedAt: '2026-01-01T00:00:00.000Z' })]
  assert.throws(() => reorderClipboardItems(values, 'a', 'b'), error => error.code === 'CLIPBOARD_ORDER_INVALID')
  assert.throws(() => reorderClipboardItems(values, 'a', 'c'), error => error.code === 'CLIPBOARD_ORDER_INVALID')
  assert.throws(() => reorderClipboardItems(values, 'missing', 'a'), error => error.code === 'CLIPBOARD_ORDER_INVALID')
})

test('dropping an item onto itself leaves its order unchanged', () => {
  const values = [item('a'), item('b')]
  const before = values.map(value => ({ ...value }))
  const result = reorderClipboardItems(values, 'a', 'a', true, () => 999)
  assert.equal(result.changed, false)
  assert.deepEqual(result.orderedIds, ['b', 'a'])
  assert.deepEqual(values, before)
})
