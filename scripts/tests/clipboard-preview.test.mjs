import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import sharp from 'sharp'
import { readClipboardImage } from '../../src-electron/clipboard-media.js'
import { clipboardDefaults, normalizeClipboardSettings, validateClipboardSettings, clipboardRetentionIds } from '../../src-electron/clipboard-settings.js'
import { clipboardGroupName, clipboardInView, clipboardOrganization } from '../../src-electron/clipboard-organization.js'
import { classifyClipboardWithModel, createClipboardAnalyzer, saveClipboardNote } from '../../src-electron/clipboard-ai.js'
import * as db from '../../src-electron/db.js'

test('图片按条目受控读取，缩略图限制尺寸，原图像素与中文路径正确', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-图片-'))
  try {
    const file = path.join(root, 'a'.repeat(64) + '.png')
    await sharp({ create: { width: 1600, height: 900, channels: 4, background: '#358ac0' } }).png().toFile(file)
    const item = { imagePath: file, sensitivity: 'normal' }
    const small = await readClipboardImage(item, root)
    const original = await readClipboardImage(item, root, { thumbnail: false })
    assert.equal(original.width, 1600); assert.equal(original.height, 900)
    assert.deepEqual(Buffer.from(original.dataUrl.split(',')[1], 'base64'), await fs.readFile(file))
    const metadata = await sharp(Buffer.from(small.dataUrl.split(',')[1], 'base64')).metadata()
    assert.ok(metadata.width <= 440 && metadata.height <= 240)
    for (const blocked of [null, { ...item, deletedAt: 'now' }, { ...item, sensitivity: 'secret' }, { ...item, expiresAt: '2000-01-01' }, { ...item, imagePath: path.join(root, '..', path.basename(file)) }]) await assert.rejects(readClipboardImage(blocked, root), { code: 'CLIPBOARD_IMAGE_UNAVAILABLE' })
    await fs.writeFile(file, 'broken image')
    await assert.rejects(readClipboardImage(item, root), { code: 'CLIPBOARD_IMAGE_INVALID' })
    await fs.rm(file)
    await assert.rejects(readClipboardImage(item, root), { code: 'CLIPBOARD_IMAGE_MISSING' })
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('剪贴板设置拒绝无效值，保留规则不清理置顶、收藏或常用语', () => {
  assert.deepEqual(normalizeClipboardSettings(), clipboardDefaults)
  assert.equal(validateClipboardSettings({ ...clipboardDefaults, captureEnabled: false }).captureEnabled, false)
  for (const patch of [{ maxItems: -1 }, { retentionDays: 999 }, { sensitiveMinutes: 120 }, { aiThreshold: 2 }, { shortcut: 'not-a-shortcut' }]) assert.throws(() => validateClipboardSettings({ ...clipboardDefaults, ...patch }), { code: 'CLIPBOARD_SETTINGS_INVALID' })
  const now = Date.now(), old = new Date(now - 86400000 * 40).toISOString()
  const items = [{ id: 'old', capturedAt: old }, { id: 'pin', pinned: true, capturedAt: old }, { id: 'fav', favorite: true, capturedAt: old }, { id: 'phrase', phrase: true, capturedAt: old }, { id: 'trash', deletedAt: 'now', capturedAt: old }]
  assert.deepEqual(clipboardRetentionIds(items, clipboardDefaults, now), ['old'])
  assert.deepEqual(clipboardRetentionIds(items, { ...clipboardDefaults, retentionDays: 0 }, now), [])
})

test('分类标签筛选隔离敏感数据，Windows 非法名称不能保存', () => {
  for (const name of ['a/b', 'a' + String.fromCharCode(92) + 'b', '', 'a'.repeat(41), 'a:b']) assert.throws(() => clipboardGroupName(name))
  const entry = { id: 'one', category: '学习', tags: ['公式'], phrase: true, favorite: true }
  const groups = clipboardOrganization([entry, { category: 'secret', tags: ['secret'], sensitivity: 'secret' }, { category: 'deleted', deletedAt: 'now' }])
  assert.deepEqual(groups, { categories: ['学习'], tags: ['公式'] })
  assert.equal(clipboardInView(entry, { view: 'phrases', tag: '公式', category: '学习' }), true)
  assert.equal(clipboardInView(entry, { category: '__uncategorized__' }), false)
  assert.equal(clipboardInView(entry, { view: 'pinned' }), false)
})

test('笔记保存保留原文、图片、来源与换行，重复来源不会重复创建', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-clipboard-note-'))
  db.setDataDir(root)
  try {
    await db.initDb()
    const book = db.createNotebook('剪贴板验收')
    const item = { id: 'one', hash: 'hash-one', capturedAt: new Date().toISOString() }
    const note = saveClipboardNote(item, { title: '验收', text: '<script>\n原文', summary: '摘要', notebookId: book.id })
    assert.ok(note.content.includes('&lt;script&gt;<br>原文'))
    assert.equal(note.notebookId, book.id)
    assert.equal(saveClipboardNote(item, { title: '重复', text: '重复' }).id, note.id)
    assert.equal(db.getNotes().length, 1)
    assert.equal(db.queryAllRaw('SELECT resourceUri FROM note_resource_links')[0].resourceUri, 'clipboard:hash-one')
    assert.throws(() => saveClipboardNote({ ...item, hash: 'new' }, { title: '无效位置', notebookId: 'missing' }), { code: 'CLIPBOARD_NOTEBOOK_MISSING' })
  } finally { db.closeDb(); await fs.rm(root, { recursive: true, force: true }) }
})

function analyzerFixture(overrides = {}) {
  const item = { id: 'one', kind: 'text', plainText: '学习时需要理解知识并定期复习。', sensitivity: 'normal' }, events = [], notes = []
  const options = {
    getItem: () => item, patchItem: (_id, patch) => Object.assign(item, patch),
    getSettings: () => ({ ...clipboardDefaults, aiEnabled: true }), getModel: () => ({ apiKey: 'fixture', baseUrl: 'http://fixture.invalid', modelName: 'fixture' }),
    getImage: async () => ({ dataUrl: 'data:image/png;base64,AA==' }), ocr: async () => ({ text: '识别文字' }),
    notify: event => events.push(event), complete: async () => ({ important: true, score: 0.95, title: '学习要点', summary: '定期复习', tags: ['学习'], category: '知识' }),
    saveNote: (_item, note) => { notes.push(note); return { id: 'note-one' } }, ...overrides
  }
  return { item, events, notes, analyzer: createClipboardAnalyzer(options) }
}

test('AI 重要内容自动保存，低重要性不生成笔记，敏感文字不发往模型', async () => {
  const fixture = analyzerFixture()
  assert.equal((await fixture.analyzer.enqueue('one')).status, 'saved')
  assert.equal(fixture.notes.length, 1); assert.equal(fixture.item.savedNoteId, 'note-one')
  assert.deepEqual(fixture.item.tags, ['学习'])
  const low = analyzerFixture({ complete: async () => ({ important: true, score: 0.5 }) })
  assert.equal((await low.analyzer.enqueue('one')).status, 'not-important'); assert.equal(low.notes.length, 0)
  let calls = 0
  const secret = analyzerFixture({ complete: async () => { calls++; throw new Error('must not call') } })
  secret.item.plainText = '验证码：123456'
  assert.equal((await secret.analyzer.enqueue('one')).code, 'CLIPBOARD_AI_SENSITIVE')
  assert.equal(calls, 0)
})

test('图片 OCR 后敏感过滤先于网络，配置缺失和删除竞争都有明确结果', async () => {
  let calls = 0
  const image = analyzerFixture({ ocr: async () => ({ text: 'password=private' }), complete: async () => { calls++ } })
  image.item.imagePath = 'image'; image.item.plainText = ''
  assert.equal((await image.analyzer.enqueue('one')).code, 'CLIPBOARD_AI_SENSITIVE'); assert.equal(calls, 0)
  const missing = analyzerFixture({ getModel: () => null })
  assert.equal((await missing.analyzer.enqueue('one')).code, 'CLIPBOARD_AI_MODEL_REQUIRED')
  let finish
  const removed = analyzerFixture({ complete: () => new Promise(resolve => { finish = resolve }) })
  const pending = removed.analyzer.enqueue('one'); removed.item.deletedAt = 'now'
  finish({ important: true, score: 1, title: '内容', summary: '内容', tags: [] })
  assert.equal((await pending).status, 'cancelled'); assert.equal(removed.notes.length, 0)
})

test('AI 关闭时取消在途任务，批量队列串行且同条目不重复调用', async () => {
  let release
  const fixture = analyzerFixture({ complete: (_m, _t, _s, signal) => new Promise((resolve, reject) => { release = resolve; signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))) }) })
  const pending = fixture.analyzer.enqueue('one')
  assert.equal((await fixture.analyzer.enqueue('one')).status, 'busy')
  fixture.analyzer.cancelAutomatic()
  assert.equal((await pending).status, 'cancelled'); assert.equal(fixture.notes.length, 0)
})

test('真实 HTTP 模型协议保留 JSON 用户内容，不把 API 错误正文或密钥返回界面', async () => {
  let requestBody, status = 200
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    requestBody = JSON.parse(Buffer.concat(chunks).toString())
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(status === 200 ? JSON.stringify({ choices: [{ message: { content: JSON.stringify({ important: true, score: 0.9, title: '标题', summary: '摘要', tags: ['知识'] }) } }] }) : 'secret API body')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const model = { baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1', apiKey: 'fixture-only', modelName: 'fixture' }
    const result = await classifyClipboardWithModel(model, '学习文字', clipboardDefaults)
    assert.equal(result.important, true)
    assert.equal(JSON.parse(requestBody.messages[1].content).clipboardText, '学习文字')
    status = 401
    await assert.rejects(classifyClipboardWithModel(model, '文字', clipboardDefaults), error => error.code === 'CLIPBOARD_AI_AUTH' && !error.message.includes('secret'))
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
