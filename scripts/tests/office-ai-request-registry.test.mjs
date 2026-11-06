import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createOfficeAiRequestRegistry } from '../../src-electron/office/ai-request-registry.js'

test('服务 Stop 只取消原 sender 的服务请求，不取消其他文档或推理流', () => {
  const first = sender(101)
  const second = sender(102)
  const registry = createOfficeAiRequestRegistry({ resolveOwner: value => ({ documentId: 'document-' + value.id, viewId: 'view-' + value.id }) })
  const own = registry.begin({ sender: first, requestId: 'office-image:1', parameters: {} }).lease
  const other = registry.begin({ sender: second, requestId: 'office-image:1', parameters: {} }).lease
  const stream = registry.begin({ sender: first, requestId: 'stream:1', parameters: {} }).lease
  assert.equal(registry.cancelServices(first).cancelled, 1)
  assert.equal(own.signal.aborted, true)
  assert.equal(other.signal.aborted, false)
  assert.equal(stream.signal.aborted, false)
  registry.dispose()
})

function sender(id = 1) {
  const value = new EventEmitter()
  value.id = id
  value.destroyed = false
  value.isDestroyed = () => value.destroyed
  value.sent = []
  value.send = chunk => value.sent.push(chunk)
  value.destroy = () => { value.destroyed = true; value.emit('destroyed') }
  return value
}

function setup() {
  const owners = new Map()
  const sent = []
  const registry = createOfficeAiRequestRegistry({
    resolveOwner: current => owners.get(current),
    deliver: (current, chunk) => { current.send(chunk); sent.push({ current, chunk }) },
    now: (() => { let value = 1000; return () => value++ })(),
    terminalTtlMs: 100,
  })
  return { registry, owners, sent }
}

test('duplicate request identity is idempotent but parameter conflicts are rejected', () => {
  const { registry, owners } = setup()
  const view = sender(1)
  owners.set(view, { documentId: 'doc-1', viewId: 'view-1' })
  const first = registry.begin({ sender: view, requestId: 'r1', parameters: { a: 1, b: 'x' } })
  const duplicate = registry.begin({ sender: view, requestId: 'r1', parameters: { b: 'x', a: 1 } })
  assert.equal(duplicate.reused, true)
  assert.equal(duplicate.lease, first.lease)
  assert.throws(() => registry.begin({ sender: view, requestId: 'r1', parameters: { a: 2 } }), /OFFICE_AI_REQUEST_CONFLICT/)
  first.lease.finish('completed', { type: 'done', text: 'ok' })
  assert.equal(view.sent.length, 1)
})

test('cancel and sender destruction prevent late chunks from reaching the renderer', () => {
  const { registry, owners } = setup()
  const view = sender(2)
  owners.set(view, { documentId: 'doc-2', viewId: 'view-2' })
  const { lease } = registry.begin({ sender: view, requestId: 'r2', parameters: {} })
  assert.deepEqual(registry.cancel({ sender: view, requestId: 'r2' }), { cancelled: true, status: 'cancelled' })
  assert.equal(lease.emit({ type: 'delta', text: 'late' }), false)
  assert.equal(view.sent.length, 1)

  const second = registry.begin({ sender: view, requestId: 'r3', parameters: {} })
  view.destroy()
  assert.equal(second.lease.emit({ type: 'delta', text: 'after destroy' }), false)
  assert.equal(registry.snapshot().some(entry => entry.status === 'active'), false)
})

test('owner changes cancel the request and reject cross-document writes', () => {
  const { registry, owners } = setup()
  const view = sender(3)
  owners.set(view, { documentId: 'doc-3', viewId: 'view-3' })
  const { lease } = registry.begin({ sender: view, requestId: 'r3', parameters: { q: 'x' } })
  owners.set(view, { documentId: 'doc-other', viewId: 'view-other' })
  assert.equal(lease.emit({ type: 'delta', text: 'must not leak' }), false)
  assert.equal(registry.snapshot().length, 0)
  assert.throws(() => registry.cancel({ sender: view, requestId: 'r3' }), /NOT_OWNED/)
})

test('sender IDs are not sufficient to take over an active request', () => {
  const { registry, owners } = setup()
  const first = sender(4)
  const second = sender(4)
  owners.set(first, { documentId: 'doc-4', viewId: 'view-4' })
  owners.set(second, { documentId: 'doc-4', viewId: 'view-4' })
  registry.begin({ sender: first, requestId: 'same', parameters: {} })
  assert.throws(() => registry.begin({ sender: second, requestId: 'same', parameters: {} }), /NOT_OWNED/)
})

