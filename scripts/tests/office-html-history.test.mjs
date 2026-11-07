import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { transform } from 'esbuild'
import { transformHtmlHostSource } from '../office/html-host-adapter.mjs'
import { createHtmlHistorySession } from '../office/html-history-session.js'
import { createHtmlProjectBoundary } from '../../src-electron/office/html-project-boundary.js'

const read = file => fs.readFileSync(new URL('../../vendor/genoffice-html/' + file, import.meta.url), 'utf8')
const adapt = file => transformHtmlHostSource(read(file), '/' + file) ?? read(file)

test('固定 HTML 的真实适配结果提供 Friday 品牌、共享历史组件与四个历史 IPC', async () => {
  const panel = adapt('apps/html/src/renderer/ai/AiPanel.tsx')
  const ribbon = adapt('apps/html/src/renderer/components/Ribbon.tsx')
  const preload = adapt('apps/html/src/preload/index.ts')
  assert.equal(panel.includes('          Genspark\n'), false)
  assert.equal(ribbon.includes('<span>Genspark AI</span>'), false)
  assert.match(panel, /AiHistoryButton/)
  assert.match(panel, /\.createChat\(/)
  assert.match(panel, /fridayIcon/)
  for (const channel of ['listChatsForFile', 'createChat', 'selectChatForFile', 'updateChatForFile']) assert.ok(preload.includes(`project:${channel}`))
  for (const [code, loader] of [[panel, 'tsx'], [ribbon, 'tsx'], [preload, 'ts']]) await transform(code, { loader })
})

function fixture(overrides = {}, filePath = null) {
  const calls = []
  const loaded = []
  const errors = []
  const messages = new Map([['first', [{ role: 'user', text: 'old question' }, { role: 'assistant', text: 'old answer' }]]])
  let active = 'first'
  let count = 0
  const record = (name, args) => calls.push({ name, args })
  const ids = () => ({ projectId: 'default', chatId: active })
  const api = {
    async resolveChat(args) { record('resolve', args); return ids() },
    async appendChat(args) { record('append', args); messages.set(args.chatId, [...(messages.get(args.chatId) || []), { role: args.role, text: args.text }]) },
    async loadChat(args) { record('load', args); return messages.get(args.chatId) || [] },
    async listChatsForFile(args) { record('list', args); return [...messages.keys()].map(chatId => ({ chatId })) },
    async createChat(args) { record('create', args); active = 'new-' + ++count; messages.set(active, []); return ids() },
    async selectChatForFile(args) { record('select', args); active = args.chatId; return ids() },
    async updateChatForFile(args) { record('update', args); if (args.patch.deleted && args.chatId === active) active = 'first'; return ids() },
    async rebindChat(args) { record('rebind', args); return ids() },
    async copyChatsToFile(args) { record('copy', args); active = 'copied-' + active; return ids() },
    ...overrides,
  }
  let invalidations = 0
  const session = createHtmlHistorySession({ api, filePath, tempChatId: 'unsaved-fixture', onLoad: value => loaded.push(value), onError: error => errors.push(error.message), onInvalidate: () => invalidations++ })
  return { session, calls, loaded, errors, messages, invalidations: () => invalidations }
}

test('HTML 恢复与列表使用同一文档组，新聊天创建新持久化 id，旧消息保留', async () => {
  const f = fixture()
  await f.session.initialize()
  assert.equal(f.session.ready, true)
  assert.equal(f.loaded[0][0].text, 'old question')
  await f.session.listChats()
  await f.session.append({ role: 'user', text: 'before new chat' })
  await f.session.createChat()
  assert.equal(f.session.ids.chatId, 'new-1')
  assert.deepEqual(f.loaded.at(-1), [])
  await f.session.append({ role: 'user', text: 'new question' })
  assert.equal(f.messages.get('first').at(-1).text, 'before new chat')
  assert.deepEqual(f.messages.get('new-1'), [{ role: 'user', text: 'new question' }])
  await f.session.selectChat('first')
  assert.equal(f.session.ids.chatId, 'first')
  assert.equal(f.loaded.at(-1).at(-1).text, 'before new chat')
  assert.equal(f.invalidations(), 2)
  for (const call of f.calls.filter(call => ['resolve', 'list', 'create', 'select'].includes(call.name))) assert.equal(call.args.tempChatId, 'unsaved-fixture')
})

test('切换等待旧会话写入完成，延迟 append 不会写到新会话', async () => {
  let release
  const order = []
  const f = fixture({
    appendChat: args => new Promise(resolve => { order.push('append:' + args.chatId); release = resolve }),
    async createChat() { order.push('create'); return { projectId: 'default', chatId: 'second' } },
  })
  await f.session.initialize()
  const writing = f.session.append({ role: 'user', text: 'pending question' })
  const moving = f.session.createChat()
  await Promise.resolve()
  assert.deepEqual(order, ['append:first'])
  assert.equal(f.session.ready, false)
  release()
  await Promise.all([writing, moving])
  assert.deepEqual(order, ['append:first', 'create'])
  assert.equal(f.session.ids.chatId, 'second')
})

test('批次收尾微任务追加的消息在 append 兑现前持久化，无需下一次操作触发', async () => {
  const stored = []
  let followup
  let first = true
  const f = fixture({
    async appendChat(args) {
      stored.push(args.text)
      if (first) {
        first = false
        // 精确落在内部批次 resolve 与外层 drain 清理之间，模拟并发的流式完成。
        queueMicrotask(() => queueMicrotask(() => {
          followup = f.session.append({ role: 'assistant', text: 'last response' })
        }))
      }
    },
  })
  await f.session.initialize()
  await f.session.append({ role: 'user', text: 'question' })
  await followup
  assert.deepEqual(stored, ['question', 'last response'])
})

test('写入失败阻止新会话切换，待重试消息不静默丢弃', async () => {
  let failing = true
  const stored = []
  const f = fixture({ async appendChat(args) { if (failing) throw new Error('disk unavailable'); stored.push(args) } })
  await f.session.initialize()
  await assert.rejects(f.session.append({ role: 'user', text: 'keep me' }), /disk unavailable/)
  await assert.rejects(f.session.createChat(), /disk unavailable/)
  assert.equal(f.calls.some(call => call.name === 'create'), false)
  assert.equal(f.session.ids.chatId, 'first')
  assert.ok(f.errors.length > 0)
  failing = false
  await f.session.retry()
  assert.equal(stored.length, 1)
  assert.equal(stored[0].chatId, 'first')
  assert.equal(stored[0].text, 'keep me')
  assert.equal(f.session.ready, true)
})

test('未命名文档首存迁移当前新会话，已保存另存使用复制合同保留源记录', async () => {
  const f = fixture()
  await f.session.initialize()
  await f.session.createChat()
  await f.session.rebind('D:/saved.html')
  const rebind = f.calls.find(call => call.name === 'rebind')
  assert.equal(rebind.args.tempChatId, 'new-1')
  assert.equal(f.session.ids.chatId, 'new-1')
  await f.session.rebind('D:/copy.html')
  const copy = f.calls.find(call => call.name === 'copy')
  assert.deepEqual(copy.args, { sourceFilePath: 'D:/saved.html', currentChatId: 'new-1', newFilePath: 'D:/copy.html' })
  assert.equal(f.session.ids.chatId, 'copied-new-1')
  assert.equal(f.session.scope().filePath, 'D:/copy.html')
  assert.ok(f.messages.has('first'))
})

test('卸载后旧加载结果不会恢复到新面板；重入选择被拒绝', async () => {
  let release
  const f = fixture({ loadChat: () => new Promise(resolve => { release = resolve }) })
  const loading = f.session.initialize()
  await Promise.resolve()
  f.session.dispose()
  release([{ role: 'assistant', text: 'stale' }])
  await loading
  assert.deepEqual(f.loaded, [])
  assert.equal(f.session.ready, false)
  const g = fixture()
  await g.session.initialize()
  let selectRelease
  const h = fixture({ selectChatForFile: () => new Promise(resolve => { selectRelease = resolve }) })
  await h.session.initialize()
  const selecting = h.session.selectChat('other')
  await Promise.resolve()
  await assert.rejects(h.session.selectChat('another'), /HISTORY_BUSY/)
  selectRelease({ projectId: 'default', chatId: 'other' })
  await selecting
  assert.equal(h.session.ids.chatId, 'other')
})

test('删除当前会话按服务返回的新活动会话恢复，不清空原消息', async () => {
  const f = fixture()
  await f.session.initialize()
  await f.session.createChat()
  await f.session.updateChat('new-1', { title: 'named', pinned: true })
  assert.equal(f.session.ids.chatId, 'new-1')
  await f.session.updateChat('new-1', { deleted: true })
  assert.equal(f.session.ids.chatId, 'first')
  assert.equal(f.loaded.at(-1)[0].text, 'old question')
  assert.ok(f.messages.has('new-1'))
})

test('延迟会话更新期间拒绝切换和另存重入，旧更新不能把当前会话切回', async () => {
  let release
  const f = fixture({ updateChatForFile: () => new Promise(resolve => { release = resolve }) }, 'D:/original.html')
  await f.session.initialize()
  const updating = f.session.updateChat('first', { title: 'rename' })
  await Promise.resolve()
  await assert.rejects(f.session.selectChat('other'), /HISTORY_BUSY/)
  await assert.rejects(f.session.rebind('D:/copy.html'), /HISTORY_BUSY/)
  release({ projectId: 'default', chatId: 'first' })
  await updating
  await f.session.selectChat('other')
  assert.equal(f.session.ids.chatId, 'other')
  assert.equal(f.session.scope().filePath, 'D:/original.html')
})

test('另存完成后延迟旧文件列表不会交给历史弹层', async () => {
  let release
  let listStartedResolve
  const listStarted = new Promise(resolve => { listStartedResolve = resolve })
  const f = fixture({
    listChatsForFile: () => {
      listStartedResolve()
      return new Promise(resolve => { release = resolve })
    },
  }, 'D:/original.html')
  await f.session.initialize()
  const listing = f.session.listChats()
  // Wait for the API call itself to be entered. A single microtask is not a
  // sufficient synchronization point here: listChats() first awaits flush(),
  // whose already-resolved promise can add another microtask turn. Releasing
  // the gate earlier leaves `release` undefined and hides the stale-result
  // assertion behind an unhandled rejection.
  await listStarted
  await f.session.rebind('D:/copy.html')
  release([{ chatId: 'old-file-only' }])
  await assert.rejects(listing, /HISTORY_STALE/)
  assert.equal(f.session.scope().filePath, 'D:/copy.html')
})

for (const stage of ['resolve', 'load']) {
  test(`初始化 ${stage} 尚未完成时首存，以真实身份边界恢复新路径且不加载旧上下文`, async () => {
    const sender = { mainFrame: {} }
    const event = { sender, senderFrame: sender.mainFrame }
    const entry = { type: 'html', filePath: null }
    const boundary = createHtmlProjectBoundary({ resolveEntry: () => entry })
    const loaded = []
    const writes = []
    const paths = []
    let release
    let startedResolve
    const started = new Promise(resolve => { startedResolve = resolve })
    const pause = async () => {
      startedResolve()
      await new Promise(resolve => { release = resolve })
    }
    const resolve = boundary.wrap('project:resolveChat', async (_event, args) => {
      paths.push(args.filePath)
      if (stage === 'resolve' && !args.filePath) await pause()
      return { projectId: 'default', chatId: args.filePath ? 'saved-chat' : args.tempChatId }
    })
    const load = boundary.wrap('project:loadChat', async (_event, args) => {
      if (stage === 'load' && args.chatId !== 'saved-chat') await pause()
      return [{ role: 'assistant', text: args.chatId === 'saved-chat' ? 'saved-path history' : 'stale unsaved history' }]
    })
    const append = boundary.wrap('project:appendChat', async (_event, args) => { writes.push(args) })
    const session = createHtmlHistorySession({
      api: { resolveChat: args => resolve(event, args), loadChat: args => load(event, args), appendChat: args => append(event, args) },
      tempChatId: 'unsaved-first-save', onLoad: messages => loaded.push(messages),
    })
    const initializing = session.initialize()
    await started
    assert.equal(session.ready, false)
    await assert.rejects(session.append({ role: 'user', text: 'too early' }), /HISTORY_NOT_READY/)
    entry.filePath = 'D:/first-save.html'
    const binding = session.rebind(entry.filePath)
    assert.equal(session.ready, false)
    release()
    await Promise.all([initializing, binding])
    assert.equal(session.ready, true)
    assert.equal(session.scope().filePath, entry.filePath)
    assert.equal(session.ids.chatId, 'saved-chat')
    assert.deepEqual(paths, [null, entry.filePath])
    assert.deepEqual(loaded, [[{ role: 'assistant', text: 'saved-path history' }]])
    await session.append({ role: 'user', text: 'after first save' })
    assert.equal(writes.length, 1)
    assert.equal(writes[0].chatId, 'saved-chat')
    assert.equal(writes[0].durable, true)
    await session.retry()
    assert.equal(session.ready, true)
    assert.equal(paths.at(-1), entry.filePath)
  })
}
