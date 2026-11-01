import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

// 仅替换宿主 IPC 导入；测试运行真实 store 的竞态与范围处理。
const bundled = await build({
  entryPoints: ['src/services/conversationStore.js'], bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'test-ipc-host', setup(builder) {
    builder.onResolve({ filter: /^\.\/electron$/ }, () => ({ path: 'electron', namespace: 'test-host' }))
    builder.onLoad({ filter: /.*/, namespace: 'test-host' }, () => ({ contents: 'export const electronService = { invoke() { throw new Error("Unexpected host IPC") } }' }))
  } }]
})
const { createConversationStore } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'))

test('100 delayed history selections always retain the last choice in each scope', async () => {
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const requests = []
    const store = createConversationStore((channel, args) => new Promise(resolve => requests.push({ channel, args, resolve })))
    const scope = { scope: 'note-agent', scopeKey: 'note:a' }
    const loads = ['A', 'B', 'C'].map(id => store.load(id, scope))
    // C 最先完成；随后旧的 B/A 回来，不能覆盖 C。
    for (const id of ['C', 'B', 'A']) for (const request of requests.filter(request => request.args.sessionId === id)) request.resolve(request.channel === 'get_session' ? { id } : [{ content: id }])
    const results = await Promise.all(loads)
    assert.equal(results[0].stale, true)
    assert.equal(results[1].stale, true)
    assert.equal(results[2].session.id, 'C')
    assert.equal(results[2].messages[0].content, 'C')
  }
})

test('new conversation invalidates pending selection and persists explicit agent metadata', async () => {
  const pending = []
  let created
  const store = createConversationStore((channel, args) => {
    if (channel === 'create_session') { created = args; return Promise.resolve({ ...args, id: 'new' }) }
    return new Promise(resolve => pending.push({ channel, resolve }))
  })
  const scope = { scope: 'dock', scopeKey: 'global' }
  const old = store.load('old', scope)
  const next = await store.create({ ...scope, agentId: 'researcher', modelId: 'test-model' })
  for (const request of pending) request.resolve(request.channel === 'get_session' ? { id: 'old' } : [])
  assert.equal((await old).stale, true)
  assert.equal(next.id, 'new')
  assert.equal(created.scope, 'dock')
  assert.equal(created.scopeKey, 'global')
  assert.equal(created.agentId, 'researcher')
  assert.equal(created.modelId, 'test-model')
})

test('parallel selection epochs are independent for different resources', async () => {
  const pending = []
  const store = createConversationStore((channel, args) => new Promise(resolve => pending.push({ channel, args, resolve })))
  const first = store.load('a', { scope: 'knowledge', scopeKey: 'kb:a' })
  const second = store.load('b', { scope: 'knowledge', scopeKey: 'kb:b' })
  for (const request of pending) request.resolve(request.channel === 'get_session' ? { id: request.args.sessionId } : [])
  assert.equal((await first).session.id, 'a')
  assert.equal((await second).session.id, 'b')
})
