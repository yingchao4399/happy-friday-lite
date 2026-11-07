import test from 'node:test'
import assert from 'node:assert/strict'
import { createHtmlProjectBoundary } from '../../src-electron/office/html-project-boundary.js'

test('同名不同路径的 HTML 不能解析或加载对方会话，真实绑定后读写可用', async () => {
  const sender = { mainFrame: {} }
  const entry = { type: 'html', filePath: '/folder-a/report.html' }
  const boundary = createHtmlProjectBoundary({ resolveEntry: value => value === sender ? entry : null })
  const event = { sender, senderFrame: sender.mainFrame }
  let calls = 0
  const resolve = boundary.wrap('project:resolveChat', async () => { calls++; return { projectId: 'p1', chatId: 'c1' } })
  await assert.rejects(resolve(event, { filePath: '/folder-b/report.html' }), { code: 'OFFICE_HTML_HISTORY_NOT_OWNED' })
  assert.equal(calls, 0)
  await resolve(event, { filePath: entry.filePath })
  const load = boundary.wrap('project:loadChat', async () => ['owned'])
  assert.deepEqual(await load(event, { projectId: 'p1', chatId: 'c1' }), ['owned'])
  await assert.rejects(load(event, { projectId: 'p2', chatId: 'c2' }), { code: 'OFFICE_HTML_HISTORY_NOT_OWNED' })
  await assert.rejects(load({ sender, senderFrame: {} }, { projectId: 'p1', chatId: 'c1' }), { code: 'OFFICE_HTML_HISTORY_NOT_OWNED' })
})

test('关闭或换文档后的异步解析结果失效', async () => {
  const sender = { mainFrame: {} }
  let entry = { type: 'html', filePath: '/folder/report.html' }
  const boundary = createHtmlProjectBoundary({ resolveEntry: () => entry })
  const resolve = boundary.wrap('project:resolveChat', async () => { entry = null; return { projectId: 'p1', chatId: 'c1' } })
  await assert.rejects(resolve({ sender, senderFrame: sender.mainFrame }, { filePath: entry.filePath }), { code: 'OFFICE_HTML_HISTORY_OWNER_CHANGED' })
})

function historyFixture(filePath = '/folder/report.html') {
  const sender = { mainFrame: {} }
  const entry = { type: 'html', filePath }
  const boundary = createHtmlProjectBoundary({ resolveEntry: value => value === sender ? entry : null })
  return { sender, entry, boundary, event: { sender, senderFrame: sender.mainFrame } }
}

test('历史列表、新建、选择和修改均限制在当前文档，未知通道拒绝', async () => {
  const f = historyFixture()
  let calls = 0
  for (const channel of ['project:listChatsForFile', 'project:createChat', 'project:selectChatForFile', 'project:updateChatForFile', 'project:deleteProject']) {
    const handler = f.boundary.wrap(channel, async () => { calls++; return [] })
    await assert.rejects(handler(f.event, { filePath: '/other/report.html', chatId: 'foreign' }), { code: 'OFFICE_HTML_HISTORY_NOT_OWNED' })
  }
  assert.equal(calls, 0)
})

test('新建与选择会话可授权回读，伪造其他会话在调用存储前被拒绝', async () => {
  const f = historyFixture()
  await f.boundary.wrap('project:resolveChat', async () => ({ projectId: 'p1', chatId: 'c1' }))(f.event, { filePath: f.entry.filePath })
  const list = f.boundary.wrap('project:listChatsForFile', async () => [{ chatId: 'c1' }, { chatId: 'c2' }])
  await list(f.event, { filePath: f.entry.filePath })
  let selected = 0
  const select = f.boundary.wrap('project:selectChatForFile', async (_event, request) => { selected++; return { projectId: 'p1', chatId: request.chatId } })
  await assert.rejects(select(f.event, { filePath: f.entry.filePath, chatId: 'foreign' }), { code: 'OFFICE_HTML_HISTORY_NOT_OWNED' })
  assert.equal(selected, 0)
  await select(f.event, { filePath: f.entry.filePath, chatId: 'c2' })
  const load = f.boundary.wrap('project:loadChat', async () => ['selected'])
  assert.deepEqual(await load(f.event, { projectId: 'p1', chatId: 'c2' }), ['selected'])
  await f.boundary.wrap('project:createChat', async () => ({ projectId: 'p1', chatId: 'c3' }))(f.event, { filePath: f.entry.filePath })
  assert.deepEqual(await load(f.event, { projectId: 'p1', chatId: 'c3' }), ['selected'])
})

test('未保存文档的历史组由宿主隔离，即使renderer复用tempId也不能串会话', async () => {
  const first = historyFixture(null)
  const second = historyFixture(null)
  const seen = []
  for (const f of [first, second]) {
    await f.boundary.wrap('project:resolveChat', async (_event, request) => {
      seen.push(request.tempChatId)
      return { projectId: 'default', chatId: request.tempChatId }
    })(f.event, { filePath: null, tempChatId: 'unsaved-identical' })
  }
  assert.notEqual(seen[0], seen[1])
  assert.notEqual(seen[0], 'unsaved-identical')
  const list = first.boundary.wrap('project:listChatsForFile', async () => [])
  await assert.rejects(list(first.event, { filePath: null, tempChatId: 'unsaved-other' }), { code: 'OFFICE_HTML_HISTORY_NOT_OWNED' })
  await assert.rejects(list(first.event, { filePath: 123, tempChatId: 'unsaved-identical' }), { code: 'OFFICE_HTML_HISTORY_NOT_OWNED' })
  await assert.rejects(list(first.event, { filePath: null, sessionId: 'foreign', tempChatId: 'unsaved-identical' }), { code: 'OFFICE_HTML_HISTORY_NOT_OWNED' })
})

test('HTML消息要求真实落盘；首存重绑定后旧授权撤销，演示视图拒绝历史', async () => {
  const f = historyFixture(null)
  const ids = await f.boundary.wrap('project:resolveChat', async (_event, request) => ({ projectId: 'default', chatId: request.tempChatId }))(f.event, { filePath: null, tempChatId: 'unsaved-ui' })
  let seen
  await f.boundary.wrap('project:appendChat', async (_event, request) => { seen = request })(f.event, { ...ids, role: 'user', text: 'fixture', durable: false })
  assert.equal(seen.durable, true)
  f.entry.filePath = '/saved/report.html'
  const rebind = f.boundary.wrap('project:rebindChat', async () => ({ projectId: 'p1', chatId: 'saved-chat' }))
  await assert.rejects(rebind(f.event, { projectId: ids.projectId, tempChatId: ids.chatId, newFilePath: '/other/file.html' }), { code: 'OFFICE_HTML_HISTORY_NOT_OWNED' })
  await rebind(f.event, { projectId: ids.projectId, tempChatId: ids.chatId, newFilePath: f.entry.filePath })
  const load = f.boundary.wrap('project:loadChat', async () => [])
  await assert.rejects(load(f.event, ids), { code: 'OFFICE_HTML_HISTORY_NOT_OWNED' })
  await load(f.event, { projectId: 'p1', chatId: 'saved-chat' })
  f.entry.presentation = true
  await assert.rejects(load(f.event, { projectId: 'p1', chatId: 'saved-chat' }), { code: 'OFFICE_HTML_HISTORY_NOT_OWNED' })
})

test('同一视图首存/另存不否定已落盘消息回执，旧路径读取与未知会话仍被拒绝', async () => {
  const f = historyFixture('/original/report.html')
  const ids = { projectId: 'p1', chatId: 'c1' }
  await f.boundary.wrap('project:resolveChat', async () => ids)(f.event, { filePath: f.entry.filePath })
  let release
  const stored = []
  const append = f.boundary.wrap('project:appendChat', async (_event, request) => {
    stored.push(request)
    await new Promise(resolve => { release = resolve })
    return { saved: true }
  })
  const writing = append(f.event, { ...ids, role: 'user', text: 'save overlaps this write' })
  f.entry.filePath = '/saved/copy.html'
  release()
  assert.deepEqual(await writing, { saved: true })
  assert.equal(stored.length, 1)
  assert.equal(stored[0].durable, true)
  const load = f.boundary.wrap('project:loadChat', async () => ['old path'])
  await assert.rejects(load(f.event, ids), { code: 'OFFICE_HTML_HISTORY_NOT_OWNED' })
  await assert.rejects(append(f.event, { ...ids, chatId: 'foreign', text: 'not owned' }), { code: 'OFFICE_HTML_HISTORY_NOT_OWNED' })
  assert.equal(stored.length, 1)
})

test('写入期间换成另一视图 entry 时仍拒绝旧回执', async () => {
  const sender = { mainFrame: {} }
  let entry = { type: 'html', filePath: '/original/report.html' }
  const boundary = createHtmlProjectBoundary({ resolveEntry: () => entry })
  const event = { sender, senderFrame: sender.mainFrame }
  const ids = { projectId: 'p1', chatId: 'c1' }
  await boundary.wrap('project:resolveChat', async () => ids)(event, { filePath: entry.filePath })
  let release
  const append = boundary.wrap('project:appendChat', async () => new Promise(resolve => { release = resolve }))
  const writing = append(event, { ...ids, role: 'user', text: 'old entry' })
  entry = { type: 'html', filePath: '/other/report.html' }
  release()
  await assert.rejects(writing, { code: 'OFFICE_HTML_HISTORY_OWNER_CHANGED' })
})

test('另存只允许从已授权源组派生到当前文档路径，拒绝任意源和目标', async () => {
  const f = historyFixture('/original/report.html')
  await f.boundary.wrap('project:resolveChat', async () => ({ projectId: 'p1', chatId: 'c1' }))(f.event, { filePath: f.entry.filePath })
  f.entry.filePath = '/saved/copy.html'
  let seen
  const copy = f.boundary.wrap('project:copyChatsToFile', async (_event, request) => { seen = request; return { projectId: 'p2', chatId: 'copied-chat' } })
  const request = { sourceFilePath: '/original/report.html', currentChatId: 'c1', newFilePath: f.entry.filePath }
  await assert.rejects(copy(f.event, { ...request, sourceFilePath: '/foreign/report.html' }), { code: 'OFFICE_HTML_HISTORY_NOT_OWNED' })
  await assert.rejects(copy(f.event, { ...request, currentChatId: 'foreign' }), { code: 'OFFICE_HTML_HISTORY_NOT_OWNED' })
  await assert.rejects(copy(f.event, { ...request, newFilePath: '/foreign/copy.html' }), { code: 'OFFICE_HTML_HISTORY_NOT_OWNED' })
  await copy(f.event, request)
  assert.deepEqual(seen, request)
  const load = f.boundary.wrap('project:loadChat', async () => ['copied'])
  assert.deepEqual(await load(f.event, { projectId: 'p2', chatId: 'copied-chat' }), ['copied'])
  await assert.rejects(load(f.event, { projectId: 'p1', chatId: 'c1' }), { code: 'OFFICE_HTML_HISTORY_NOT_OWNED' })
})
