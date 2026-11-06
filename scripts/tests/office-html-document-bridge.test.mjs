import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createHtmlDocumentBridge } from '../../src-electron/office/html-document-bridge.js'

function setup(t) {
  const ipc = new EventEmitter()
  const handlers = new Map()
  ipc.handle = (name, listener) => handlers.set(name, listener)
  ipc.removeHandler = name => handlers.delete(name)
  const sender = new EventEmitter()
  sender.mainFrame = {}
  sender.isDestroyed = () => false
  let message
  sender.send = (_channel, packet) => { message = packet }
  const bridge = createHtmlDocumentBridge(ipc)
  t.after(() => bridge.dispose())
  return { ipc, sender, handlers, bridge, message: () => message, event: () => ({ sender, senderFrame: sender.mainFrame }) }
}

test('响应绑定主 frame、原 sender 和唯一请求；越权回复不落入原请求', async t => {
  const f = setup(t)
  const result = f.bridge.request(f.sender, { kind: 'read' })
  const packet = { id: f.message().id, result: { revision: 3, source: '<p>authoritative</p>' } }
  f.ipc.emit('friday:html-document-result', { sender: {}, senderFrame: {} }, packet)
  f.ipc.emit('friday:html-document-result', { sender: f.sender, senderFrame: {} }, packet)
  f.ipc.emit('friday:html-document-result', f.event(), packet)
  assert.deepEqual(await result, packet.result)
})

test('Stop 在提交前撤销 lease，迟到提交及响应均失效', async t => {
  const f = setup(t)
  const controller = new AbortController()
  const result = f.bridge.request(f.sender, { kind: 'apply' }, { signal: controller.signal })
  const rejection = assert.rejects(result, { code: 'OFFICE_OPERATION_CANCELLED' })
  const id = f.message().id
  controller.abort()
  assert.equal(f.handlers.get('friday:html-document-commit')(f.event(), id), false)
  f.ipc.emit('friday:html-document-result', f.event(), { id, result: { ok: true } })
  await rejection
})

test('已获提交许可的原子写入保留真实结果；不能被迟到Stop改写为未执行', async t => {
  const f = setup(t)
  const controller = new AbortController()
  const result = f.bridge.request(f.sender, { kind: 'apply' }, { signal: controller.signal })
  const id = f.message().id
  assert.equal(f.handlers.get('friday:html-document-commit')({ sender: {}, senderFrame: {} }, id), false)
  assert.equal(f.handlers.get('friday:html-document-commit')(f.event(), id), true)
  controller.abort()
  f.ipc.emit('friday:html-document-result', f.event(), { id, result: { ok: true, revision: 4 } })
  assert.equal((await result).revision, 4)
})

test('关闭、超时和宿主退出释放等待者，错误不暴露任意异常正文', async t => {
  const f = setup(t)
  const closed = f.bridge.request(f.sender, { kind: 'read' })
  const checkClosed = assert.rejects(closed, { code: 'OFFICE_SOURCE_CHANGED' })
  f.sender.emit('destroyed')
  await checkClosed
  await assert.rejects(f.bridge.request(f.sender, { kind: 'read' }, { timeoutMs: 5 }), { code: 'OFFICE_HTML_OPERATION_TIMEOUT' })
  const failed = f.bridge.request(f.sender, { kind: 'read' })
  f.ipc.emit('friday:html-document-result', f.event(), { id: f.message().id, error: 'secret arbitrary source' })
  await assert.rejects(failed, { code: 'OFFICE_HTML_OPERATION_FAILED' })
})
