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
