import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'
import { load } from 'cheerio'
import { prepareClipboardAiContent, prepareClipboardNoteContent, sanitizeClipboardNoteHtml } from '../../src-electron/clipboard-note-content.js'
import { createClipboardAnalyzer, saveClipboardNote } from '../../src-electron/clipboard-ai.js'
import { clipboardDefaults } from '../../src-electron/clipboard-settings.js'
import * as db from '../../src-electron/db.js'

const dataUrl = 'data:image/png;base64,' + (await sharp({ create: { width: 4, height: 4, channels: 4, background: 'red' } }).png().toBuffer()).toString('base64')
const image = { dataUrl }
test('归档保留富文本表格、列表、代码、全部图片与文件来源，不自动加载外部图片', async () => {
  const calls = []
  const item = { id: 'one', kind: 'mixed', plainText: '', sourceApp: 'browser', html: '<h2>学习</h2><table><tr><td colspan="2">间隔复习</td></tr></table><ul><li>主动回忆</li></ul><pre><code>const x = 1\n</code></pre><img src="data:image/png;base64,AA=="><img src="https://example.invalid/image.png">', imagePaths: ['bitmap-one', 'bitmap-two'], filePaths: ['C:\\附件\\image.png', 'C:\\附件\\document.docx'] }
  const content = await prepareClipboardNoteContent(item, { getImage: async args => { calls.push(args); if (args.htmlIndex === 1) throw Object.assign(new Error('not loaded'), { code: 'CLIPBOARD_IMAGE_EXTERNAL_REQUIRED' }); return image } })
  const $ = load(content.html, null, false)
  assert.equal($('h2').text(), '学习'); assert.equal($('td').attr('colspan'), '2')
  assert.equal($('li').first().text(), '主动回忆'); assert.ok($('code').text().endsWith('\n'))
  assert.equal($('img').length, 4); assert.equal(content.images.length, 4)
  assert.ok(content.text.includes('间隔复习')); assert.ok(content.text.includes('主动回忆')); assert.ok(content.text.includes('document.docx'))
  assert.ok(content.html.includes('图片尚未载入')); assert.ok(content.html.includes('https://example.invalid/image.png'))
  assert.deepEqual(content.warnings, ['CLIPBOARD_NOTE_IMAGE_NOT_LOADED'])
  assert.ok(calls.every(args => args.thumbnail === false && !args.loadExternal))
})
test('归档移除脚本、事件、远程图片和非法链接；保留安全文本结构与颜色', () => {
  const html = sanitizeClipboardNoteHtml('<script>secret()</script><iframe src="https://bad.invalid"></iframe><div onclick="bad()"><a href="javascript:bad()">原文</a><img src="https://bad.invalid/a" onerror="bad()"><span style="color:#ff0000;background-image:url(https://bad.invalid);text-align:center">强调</span></div>')
  assert.ok(!/script|iframe|onclick|onerror|javascript:|bad.invalid/.test(html))
  assert.ok(html.includes('原文')); assert.ok(html.includes('color:#ff0000')); assert.ok(html.includes('text-align:center'))
})
test('归档预算、删除、过期和敏感内容受保护', async () => {
  for (const patch of [{ sensitivity: 'secret' }, { deletedAt: 'now' }, { expiresAt: '2000-01-01' }, { plainText: '验证码：123456' }]) {
    await assert.rejects(prepareClipboardNoteContent({ id: 'one', ...patch }, { getImage: async () => { throw new Error('must not read') } }), /SENSITIVE|UNAVAILABLE/)
  }
  await assert.rejects(prepareClipboardNoteContent({ id: 'one', html: '<img src="x">'.repeat(33) }, { getImage: async () => image }), /TOO_LARGE/)
  await assert.rejects(prepareClipboardNoteContent({ id: 'one', imagePath: 'bitmap' }, { getImage: async () => ({ dataUrl: 'data:image/png;base64,' + 'A'.repeat(12_000_001) }) }), /TOO_LARGE/)
})
test('富文本和多图笔记数据库重开后完整可读，保留来源与已加载图片，不重复插入', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-note-content-'))
  try {
    db.setDataDir(directory); await db.initDb()
    const item = { id: 'one', hash: 'content-one', html: '<p><strong>原文</strong><img src="x"><img src="y"></p>', capturedAt: new Date().toISOString(), sourceApp: 'Browser', parts: [{ sourceApp: 'Code', capturedAt: '2026-10-23' }] }
    const content = await prepareClipboardNoteContent(item, { getImage: async () => image })
    const note = saveClipboardNote(item, { ...content, title: '学习笔记', summary: '摘要', recognizedText: '两张图片的识别文字' })
    assert.equal(load(note.content)('img').length, 2); assert.ok(note.content.includes('<strong>原文</strong>'))
    assert.ok(note.content.includes('Browser')); assert.ok(note.content.includes('图片识别文字'))
    assert.equal(saveClipboardNote(item, { title: '重复' }).id, note.id)
    db.closeDb(); await db.initDb()
    assert.equal(db.getNote(note.id).content, note.content)
    const source = JSON.parse(db.queryAllRaw('SELECT anchor FROM note_resource_links')[0].anchor)
    assert.equal(source.sourceApp, 'Browser'); assert.equal(source.parts[0].sourceApp, 'Code')
  } finally { db.closeDb(); await fs.rm(directory, { recursive: true, force: true }) }
})
test('AI 对所有已加载图片先 OCR，任何敏感识别结果均不发往模型', async () => {
  const item = { id: 'one', kind: 'html', plainText: '学习资料' }, notes = []
  let modelCalls = 0, imageCalls = 0
  const options = { getItem: () => item, patchItem: (_id, patch) => Object.assign(item, patch), getSettings: () => ({ ...clipboardDefaults, aiEnabled: true }), getModel: () => ({ apiKey: 'fixture', baseUrl: 'http://fixture.invalid', modelName: 'fixture' }), notify() {}, prepareContent: async () => ({ html: '<p>学习资料</p>', text: '学习资料', images: [image, image] }), ocr: async () => ({ text: ++imageCalls === 2 ? '验证码：123456' : '间隔复习' }), complete: async () => { modelCalls++ }, saveNote: (_item, note) => notes.push(note) }
  assert.equal((await createClipboardAnalyzer(options).enqueue('one')).code, 'CLIPBOARD_AI_SENSITIVE')
  assert.equal(imageCalls, 2); assert.equal(modelCalls, 0); assert.equal(notes.length, 0)
})
test('AI 请求期间正文变化或条目变为隐私后拒绝保存旧结果', async () => {
  for (const privacy of [false, true]) {
    const item = { id: 'one', kind: 'text', plainText: '原始学习资料' }, notes = []
    let release
    const analyzer = createClipboardAnalyzer({ getItem: () => item, patchItem: (_id, patch) => Object.assign(item, patch), getSettings: () => ({ ...clipboardDefaults, aiEnabled: true }), getModel: () => ({ apiKey: 'fixture', baseUrl: 'http://fixture.invalid', modelName: 'fixture' }), notify() {}, complete: () => new Promise(resolve => { release = resolve }), saveNote: (_item, note) => { notes.push(note); return { id: 'note' } } })
    const pending = analyzer.enqueue('one')
    item.plainText = privacy ? '验证码：123456' : '已编辑的新资料'
    if (privacy) item.sensitivity = 'secret'
    release({ important: true, score: 1, title: '旧摘要', summary: '旧摘要', tags: [] })
    assert.equal((await pending).code, privacy ? 'CLIPBOARD_AI_SENSITIVE' : 'CLIPBOARD_AI_CONTENT_CHANGED')
    assert.equal(notes.length, 0)
  }
})

test('文件条目通过统一解析器进入 AI，保留来源并对不支持/缺失文件给出能力错误', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-clipboard-ai-file-'))
  try {
    const file = path.join(directory, '学习资料.txt')
    await fs.writeFile(file, '间隔复习需要在当天、三天后和一周后回顾。', 'utf8')
    const item = { id: 'file-one', kind: 'file', plainText: '', filePaths: [file], sourceApp: 'Explorer', capturedAt: new Date().toISOString(), sensitivity: 'normal' }
    let sentText = ''
    const notes = []
    const analyzer = createClipboardAnalyzer({
      getItem: () => item,
      patchItem: (_id, patch) => Object.assign(item, patch),
      getSettings: () => ({ ...clipboardDefaults, aiEnabled: true }),
      getModel: () => ({ apiKey: 'fixture', baseUrl: 'http://fixture.invalid', modelName: 'fixture' }),
      prepareContent: current => prepareClipboardAiContent(current, { getImage: async () => { throw new Error('图片读取不应发生') } }),
      notify() {},
      complete: async (_model, text) => { sentText = text; return { important: true, score: 0.95, title: '复习资料', summary: '复习计划', tags: [], category: '学习' } },
      saveNote: (_item, note) => { notes.push(note); return { id: 'file-note' } }
    })
    assert.equal((await analyzer.enqueue(item.id, false)).status, 'saved')
    assert.ok(sentText.includes('间隔复习需要'))
    assert.ok(notes[0].text.includes('学习资料.txt'))

    const unsupported = { ...item, id: 'binary', filePaths: [path.join(directory, 'data.bin')] }
    await fs.writeFile(unsupported.filePaths[0], Buffer.from([0, 1, 2, 3]))
    const unsupportedAnalyzer = createClipboardAnalyzer({
      getItem: () => unsupported, patchItem() {}, getSettings: () => ({ ...clipboardDefaults, aiEnabled: true }),
      getModel: () => ({ apiKey: 'fixture', baseUrl: 'http://fixture.invalid', modelName: 'fixture' }),
      prepareContent: current => prepareClipboardAiContent(current, { getImage: async () => { throw new Error('图片读取不应发生') } }), notify() {}, complete: async () => { throw new Error('不得请求模型') }
    })
    assert.equal((await unsupportedAnalyzer.enqueue(unsupported.id, false)).code, 'CLIPBOARD_AI_FILE_UNSUPPORTED')

    const missing = { ...item, id: 'missing', filePaths: [path.join(directory, 'missing.txt')] }
    const missingAnalyzer = createClipboardAnalyzer({
      getItem: () => missing, patchItem() {}, getSettings: () => ({ ...clipboardDefaults, aiEnabled: true }),
      getModel: () => ({ apiKey: 'fixture', baseUrl: 'http://fixture.invalid', modelName: 'fixture' }),
      prepareContent: current => prepareClipboardAiContent(current, { getImage: async () => { throw new Error('图片读取不应发生') } }), notify() {}, complete: async () => { throw new Error('不得请求模型') }
    })
    assert.equal((await missingAnalyzer.enqueue(missing.id, false)).code, 'CLIPBOARD_AI_FILE_MISSING')
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
