import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
import { ProjectStore } from '../../vendor/happyoffice/packages/project-store/src/store.ts'

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-html-history-store-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const store = new ProjectStore(directory)
  store.ensureDefaultProject()
  return { directory, store, reopen: () => new ProjectStore(directory) }
}

const messages = (store, ids) => store.loadChat(ids.projectId, ids.chatId).map(item => item.text)
const append = (store, ids, text) => store.appendChatMessage(ids.projectId, ids.chatId, { role: 'user', text }, { durable: true })

test('durable 首条用户消息立即落盘，无 assistant 时重建实例仍可恢复', t => {
  const { store, reopen } = fixture(t)
  const ids = store.resolveChatForUnsaved('unsaved-first-user')
  append(store, ids, '只发出问题还未收到回复')
  assert.deepEqual(messages(reopen(), ids), ['只发出问题还未收到回复'])
})

test('旧默认模式继续缓冲首条用户消息，assistant 到达再落盘', t => {
  const { store, reopen } = fixture(t)
  const ids = store.resolveChatForUnsaved('unsaved-legacy-buffer')
  store.appendChatMessage(ids.projectId, ids.chatId, { role: 'user', text: '旧请求' })
  assert.deepEqual(messages(reopen(), ids), [])
  store.appendChatMessage(ids.projectId, ids.chatId, { role: 'assistant', text: '旧回复' })
  assert.deepEqual(messages(reopen(), ids), ['旧请求', '旧回复'])
})

test('durable 同时落盘旧缓冲，写入失败明确拒绝且不丢缓冲', t => {
  const { store, directory, reopen } = fixture(t)
  const ids = store.resolveChatForUnsaved('unsaved-write-failure')
  store.appendChatMessage(ids.projectId, ids.chatId, { role: 'user', text: '已缓冲问题' })
  const conflict = path.join(directory, 'projects', ids.projectId, 'chats', `${ids.chatId}.jsonl`)
  fs.mkdirSync(conflict, { recursive: true })
  assert.throws(() => append(store, ids, '失败写入'), { code: 'OFFICE_HISTORY_WRITE_FAILED' })
  fs.rmdirSync(conflict)
  append(store, ids, '恢复后的问题')
  assert.deepEqual(messages(reopen(), ids), ['已缓冲问题', '恢复后的问题'])
})

test('多会话首存保留本次选中会话、完整历史和 primary 元数据', t => {
  const { store, reopen, directory } = fixture(t)
  const temp = 'unsaved-multiple'
  const first = store.resolveChatForUnsaved(temp)
  const second = store.createChatForFile(null, temp)
  const third = store.createChatForFile(null, temp)
  for (const [ids, text] of [[first, '第一会话'], [second, '第二会话'], [third, '第三会话']]) append(store, ids, text)
  store.updateChatForFile(null, temp, first.chatId, { title: '首会话标题', pinned: true })
  store.updateChatForFile(null, temp, second.chatId, { title: '当前选中会话' })
  store.selectChatForFile(null, temp, second.chatId)
  const filePath = path.join(directory, '已保存.html')
  const bound = store.rebindChatToFile(second.projectId, second.chatId, filePath)
  assert.equal(bound.chatId, second.chatId)
  const fresh = reopen()
  assert.deepEqual(fresh.resolveChatForFile(filePath), bound)
  const mappedFirst = { projectId: bound.projectId, chatId: ProjectStore.chatIdForFile(filePath) }
  assert.deepEqual(messages(fresh, mappedFirst), ['第一会话'])
  assert.deepEqual(messages(fresh, second), ['第二会话'])
  assert.deepEqual(messages(fresh, third), ['第三会话'])
  const chats = fresh.listChatsForFile(filePath)
  assert.deepEqual(new Set(chats.map(item => item.chatId)), new Set([mappedFirst.chatId, second.chatId, third.chatId]))
  const firstMeta = chats.find(item => item.chatId === mappedFirst.chatId)
  assert.equal(firstMeta.title, '首会话标题')
  assert.equal(firstMeta.pinned, true)
  assert.equal(chats.find(item => item.chatId === second.chatId).title, '当前选中会话')
})

test('首存到已有历史的目标时保留旧目标与全部临时会话，当前选中不回退', t => {
  const { store, reopen, directory } = fixture(t)
  const filePath = path.join(directory, '已有目标.html')
  const target = store.resolveChatForFile(filePath)
  append(store, target, '目标原记录')
  store.updateChatForFile(filePath, undefined, target.chatId, { title: '目标旧标题', pinned: true })
  const temp = 'unsaved-existing-target'
  const first = store.resolveChatForUnsaved(temp)
  const second = store.createChatForFile(null, temp)
  append(store, first, '临时第一会话')
  append(store, second, '临时第二会话')
  const bound = store.rebindChatToFile(second.projectId, second.chatId, filePath)
  assert.equal(bound.chatId, second.chatId)
  const fresh = reopen()
  assert.equal(fresh.resolveChatForFile(filePath).chatId, second.chatId)
  assert.deepEqual(messages(fresh, target), ['目标原记录'])
  assert.deepEqual(messages(fresh, first), ['临时第一会话'])
  assert.deepEqual(messages(fresh, second), ['临时第二会话'])
  const chats = fresh.listChatsForFile(filePath)
  assert.deepEqual(new Set(chats.map(item => item.chatId)), new Set([target.chatId, first.chatId, second.chatId]))
  assert.equal(chats.find(item => item.chatId === target.chatId).title, '目标旧标题')
})

test('首存时调用者选中 primary 仍映射到文件稳定 ID 并保留元数据', t => {
  const { store, reopen, directory } = fixture(t)
  const temp = 'unsaved-selected-primary'
  const first = store.resolveChatForUnsaved(temp)
  const second = store.createChatForFile(null, temp)
  append(store, first, '首会话')
  append(store, second, '旁支会话')
  store.updateChatForFile(null, temp, first.chatId, { title: '首会话', pinned: true })
  store.selectChatForFile(null, temp, first.chatId)
  const filePath = path.join(directory, '首会话保存.html')
  const bound = store.rebindChatToFile(first.projectId, first.chatId, filePath)
  assert.equal(bound.chatId, ProjectStore.chatIdForFile(filePath))
  const fresh = reopen()
  assert.equal(fresh.resolveChatForFile(filePath).chatId, bound.chatId)
  assert.equal(fresh.listChatsForFile(filePath).find(item => item.chatId === bound.chatId).pinned, true)
  assert.deepEqual(messages(fresh, second), ['旁支会话'])
})

test('已落盘文档重命名后完整会话组和当前选中均保持', t => {
  const { store, reopen, directory } = fixture(t)
  const oldPath = path.join(directory, '旧名.html')
  const newPath = path.join(directory, '新名.html')
  const first = store.resolveChatForFile(oldPath)
  const second = store.createChatForFile(oldPath)
  append(store, first, '旧记录一')
  append(store, second, '旧记录二')
  store.updateChatForFile(oldPath, undefined, first.chatId, { title: '历史一', pinned: true })
  store.fileRenamed(oldPath, newPath)
  const fresh = reopen()
  assert.deepEqual(fresh.resolveChatForFile(newPath), second)
  assert.deepEqual(new Set(fresh.listChatsForFile(newPath).map(item => item.chatId)), new Set([first.chatId, second.chatId]))
  assert.deepEqual(messages(fresh, first), ['旧记录一'])
  assert.deepEqual(messages(fresh, second), ['旧记录二'])
  assert.equal(fresh.listChatsForFile(newPath).find(item => item.chatId === first.chatId).pinned, true)
})

test('真实 project:appendChat handler 把 durable 合同传给存储并传播写入失败', t => {
  const { store, directory, reopen } = fixture(t)
  const source = fs.readFileSync(new URL('../../vendor/happyoffice/apps/docs/src/main/docs-main.ts', import.meta.url), 'utf8')
  const start = source.indexOf('  /** Append a message */')
  const end = source.indexOf('  /** Read history */', start)
  assert.ok(start >= 0 && end > start)
  let handler
  const code = transformSync(source.slice(start, end), { loader: 'ts', format: 'cjs' }).code
  vm.runInNewContext(code, {
    ipcMain: { handle: (channel, listener) => { assert.equal(channel, 'project:appendChat'); handler = listener } },
    getProjectStore: () => store,
  })
  const ids = store.resolveChatForUnsaved('unsaved-handler')
  handler({}, { ...ids, role: 'user', text: '通过主进程落盘', durable: true })
  assert.deepEqual(messages(reopen(), ids), ['通过主进程落盘'])
  const other = store.resolveChatForUnsaved('unsaved-handler-failure')
  const conflict = path.join(directory, 'projects', other.projectId, 'chats', `${other.chatId}.jsonl`)
  fs.mkdirSync(conflict, { recursive: true })
  assert.throws(() => handler({}, { ...other, role: 'user', text: '应报错', durable: true }), { code: 'OFFICE_HISTORY_WRITE_FAILED' })
})

test('另存完整复制历史组为新 ID，保留选中、元数据和原始 JSONL 全部内容', t => {
  const { store, directory, reopen } = fixture(t)
  const sourcePath = path.join(directory, '源文档.html')
  const targetPath = path.join(directory, '另存文档.html')
  const first = store.resolveChatForFile(sourcePath)
  const second = store.createChatForFile(sourcePath)
  append(store, first, '首会话内容')
  append(store, second, '当前会话内容')
  store.updateChatForFile(sourcePath, undefined, first.chatId, { title: '置顶历史', pinned: true })
  const firstFile = path.join(directory, 'projects', first.projectId, 'chats', `${first.chatId}.jsonl`)
  // 原始历史超过常规 loadChat 上限，复制应完整保留每一行。
  const raw = Array.from({ length: 10_020 }, (_, seq) => JSON.stringify({ seq, ts: '2026-11-07T00:00:00.000Z', role: 'user', text: `原始记录-${seq}` }) + '\n').join('')
  fs.mkdirSync(path.dirname(firstFile), { recursive: true })
  fs.writeFileSync(firstFile, raw, 'utf8')
  const sourceIndex = store.listChatsForFile(sourcePath)
  const copy = store.copyChatsToFile(sourcePath, second.chatId, targetPath)
  assert.notEqual(copy.chatId, first.chatId)
  assert.notEqual(copy.chatId, second.chatId)
  assert.match(copy.chatId, /^chat-[0-9a-f-]+$/)
  const fresh = reopen()
  assert.deepEqual(fresh.resolveChatForFile(sourcePath), second)
  assert.deepEqual(fresh.resolveChatForFile(targetPath), copy)
  assert.equal(fs.readFileSync(firstFile, 'utf8'), raw)
  assert.deepEqual(messages(fresh, second), ['当前会话内容'])
  const targetChats = fresh.listChatsForFile(targetPath)
  assert.equal(targetChats.length, 2)
  const copiedFirst = targetChats.find(item => item.title === '置顶历史')
  assert.ok(copiedFirst)
  assert.equal(copiedFirst.pinned, true)
  const copiedFirstFile = path.join(directory, 'projects', copy.projectId, 'chats', `${copiedFirst.chatId}.jsonl`)
  assert.equal(fs.readFileSync(copiedFirstFile, 'utf8'), raw)
  assert.deepEqual(messages(fresh, copy), ['当前会话内容'])
  assert.deepEqual(fresh.listChatsForFile(sourcePath), sourceIndex)
})

test('另存到已有目标保留目标全部旧历史，副本组独立且选中对应会话', t => {
  const { store, directory, reopen } = fixture(t)
  const sourcePath = path.join(directory, '源文件.html')
  const targetPath = path.join(directory, '已有文件.html')
  const source = store.resolveChatForFile(sourcePath)
  const selected = store.createChatForFile(sourcePath)
  append(store, source, '源主会话')
  append(store, selected, '源选中会话')
  const target = store.resolveChatForFile(targetPath)
  append(store, target, '目标旧主会话')
  const targetSecond = store.createChatForFile(targetPath)
  append(store, targetSecond, '目标旧第二会话')
  const copied = store.copyChatsToFile(sourcePath, selected.chatId, targetPath)
  const fresh = reopen()
  assert.equal(fresh.resolveChatForFile(targetPath).chatId, copied.chatId)
  assert.equal(fresh.resolveChatForFile(sourcePath).chatId, selected.chatId)
  const targetIds = fresh.listChatsForFile(targetPath).map(item => item.chatId)
  assert.equal(targetIds.length, 4)
  assert.ok(targetIds.includes(target.chatId))
  assert.ok(targetIds.includes(targetSecond.chatId))
  assert.ok(!targetIds.includes(source.chatId) && !targetIds.includes(selected.chatId))
  for (const [ids, expected] of [[source, '源主会话'], [selected, '源选中会话'], [target, '目标旧主会话'], [targetSecond, '目标旧第二会话'], [copied, '源选中会话']]) {
    assert.deepEqual(messages(fresh, ids), [expected])
  }
})

test('另存复制失败明确拒绝、不修改原会话或既有目标索引', t => {
  const { store, directory, reopen } = fixture(t)
  const sourcePath = path.join(directory, '源文件.html')
  const targetPath = path.join(directory, '目标文件.html')
  const source = store.resolveChatForFile(sourcePath)
  append(store, source, '源记录保留')
  const targetProject = store.createProject('复制失败验收')
  store.moveFileToProject(targetPath, targetProject.id)
  const target = store.resolveChatForFile(targetPath)
  const conflict = path.join(directory, 'projects', targetProject.id, 'chats')
  fs.writeFileSync(conflict, '路径冲突，禁止覆盖', 'utf8')
  const indexPath = path.join(directory, 'projects', 'index.json')
  const before = fs.readFileSync(indexPath, 'utf8')
  assert.throws(() => store.copyChatsToFile(sourcePath, source.chatId, targetPath), { code: 'OFFICE_HISTORY_COPY_FAILED' })
  assert.equal(fs.readFileSync(indexPath, 'utf8'), before)
  assert.equal(fs.readFileSync(conflict, 'utf8'), '路径冲突，禁止覆盖')
  const fresh = reopen()
  assert.deepEqual(fresh.resolveChatForFile(targetPath), target)
  assert.deepEqual(messages(fresh, source), ['源记录保留'])
})

test('另存拒绝不属于源文档的会话且相同路径为保留身份的空操作', t => {
  const { store, directory } = fixture(t)
  const sourcePath = path.join(directory, '源文件.html')
  const targetPath = path.join(directory, '目标文件.html')
  const source = store.resolveChatForFile(sourcePath)
  append(store, source, '源内容')
  const other = store.resolveChatForFile(targetPath)
  assert.throws(() => store.copyChatsToFile(sourcePath, other.chatId, targetPath), { code: 'OFFICE_HISTORY_CHAT_NOT_OWNED' })
  assert.deepEqual(store.copyChatsToFile(sourcePath, source.chatId, sourcePath), source)
  assert.equal(store.listChatsForFile(sourcePath).length, 1)
})

test('真实 project:copyChatsToFile handler 返回独立副本并保留源记录', t => {
  const { store, directory, reopen } = fixture(t)
  const source = fs.readFileSync(new URL('../../vendor/happyoffice/apps/docs/src/main/docs-main.ts', import.meta.url), 'utf8')
  const start = source.indexOf('  /** 复制文档会话组')
  const end = source.indexOf('\n}', start)
  assert.ok(start >= 0 && end > start)
  let handler
  vm.runInNewContext(transformSync(source.slice(start, end), { loader: 'ts', format: 'cjs' }).code, {
    ipcMain: { handle: (channel, listener) => { assert.equal(channel, 'project:copyChatsToFile'); handler = listener } },
    getProjectStore: () => store,
  })
  const sourceFilePath = path.join(directory, '主进程源.html')
  const newFilePath = path.join(directory, '主进程副本.html')
  const ids = store.resolveChatForFile(sourceFilePath)
  append(store, ids, '主进程副本验收')
  const copied = handler({}, { sourceFilePath, currentChatId: ids.chatId, newFilePath })
  assert.notEqual(copied.chatId, ids.chatId)
  assert.deepEqual(messages(reopen(), ids), ['主进程副本验收'])
  assert.deepEqual(messages(reopen(), copied), ['主进程副本验收'])
})
