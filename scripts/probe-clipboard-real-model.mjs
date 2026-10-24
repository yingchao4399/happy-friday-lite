import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { load } from 'cheerio'
import * as db from '../src-electron/db.js'
import { createClipboardAnalyzer, classifyClipboardWithModel } from '../src-electron/clipboard-ai.js'
import { prepareClipboardNoteContent } from '../src-electron/clipboard-note-content.js'
import { readClipboardImage, storeClipboardPng } from '../src-electron/clipboard-media.js'
import { clipboardDefaults } from '../src-electron/clipboard-settings.js'
import { recognizeImage } from '../src-electron/rag/imageOcr.js'

// 仅读取现有模型配置；密钥只留内存，不复制到测试目录，不输出地址/密钥或响应正文。仅发送合成学习材料。
const configPath = process.argv.find(arg => arg.startsWith('--config='))?.slice(9) || path.join(process.env.APPDATA, 'happy-friday-lite', 'config.json')
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-real-model-'))
let analyzer
try {
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'))
  const model = (config.customModels || []).find(model => model.id === config.selectedModelId && model.apiKey && model.baseUrl && model.modelName) || (config.customModels || []).find(model => model.apiKey && model.baseUrl && model.modelName)
  if (!model) throw Object.assign(new Error('model missing'), { code: 'CLIPBOARD_AI_MODEL_REQUIRED' })
  db.setDataDir(directory); await db.initDb()
  const media = path.join(directory, 'clipboard-media'), items = new Map(), events = []
  const text = '间隔复习与主动回忆学习法：学习后第一天、第三天、第七天分别复习。每轮先闭卷回答问题，再对照原文纠错。将错误归类到概念混淆、事实遗漏和推理步骤，下一轮重点复习薄弱点。学习计划中记录日期、材料来源和掌握情况，避免只重复阅读而不检验理解。'
  const rich = { id: 'rich', kind: 'html', plainText: text, html: '<h2>间隔复习与主动回忆</h2><p><strong>' + text + '</strong></p><table><tr><th>时间</th><th>任务</th></tr><tr><td>第七天</td><td>闭卷自测与纠错</td></tr></table>', sensitivity: 'normal', sourceApp: 'Acceptance fixture', capturedAt: new Date().toISOString(), hash: crypto.randomUUID() }
  const files = []
  for (const lines of [['Spaced repetition and active recall', 'Review after 1, 3 and 7 days.', 'Test yourself before reading notes.'], ['Learning plan and error review', 'Record sources, questions and mistakes.', 'Focus the next review on weak concepts.']]) {
    const svg = '<svg width="1100" height="250" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/>' + lines.map((line, i) => `<text x="35" y="${60 + i * 65}" font-family="Arial" font-size="38" fill="black">${line}</text>`).join('') + '</svg>'
    files.push((await storeClipboardPng(await sharp(Buffer.from(svg)).png().toBuffer(), media)).imagePath)
  }
  const picture = { id: 'pictures', kind: 'image', plainText: '', imagePath: files[0], imagePaths: files, sensitivity: 'normal', sourceApp: 'Acceptance fixture', capturedAt: new Date().toISOString(), hash: crypto.randomUUID() }
  const secret = { id: 'private', kind: 'text', plainText: '验证码：123456', sensitivity: 'normal' }
  for (const item of [rich, picture, secret]) items.set(item.id, item)
  let calls = 0, ocrCalls = 0
  const getImage = args => { const item = items.get(args.id); return readClipboardImage({ ...item, imagePath: item.imagePaths?.[args.index || 0] || item.imagePath }, media, { thumbnail: false }) }
  analyzer = createClipboardAnalyzer({
    getItem: id => items.get(id), patchItem: (id, patch) => Object.assign(items.get(id), patch),
    getSettings: () => ({ ...clipboardDefaults, aiEnabled: true, aiThreshold: 0.6, language: 'zh-CN', aiInstructions: '保存有可执行步骤的学习方法、复习安排和纠错方法。' }),
    getModel: () => model,
    prepareContent: item => prepareClipboardNoteContent(item, { getImage }),
    ocr: async image => { ocrCalls++; const temporary = path.join(directory, 'ocr-' + crypto.randomUUID() + '.png'); try { await fs.writeFile(temporary, Buffer.from(image.dataUrl.split(',')[1], 'base64')); return await recognizeImage(temporary) } finally { await fs.rm(temporary, { force: true }) } },
    complete: (...args) => { calls++; return classifyClipboardWithModel(...args) },
    notify: event => events.push({ status: event.status, code: event.code })
  })
  for (const item of [rich, picture]) {
    const result = await analyzer.enqueue(item.id)
    assert.equal(result.status, 'saved', result.code || '模型未认定材料达到归档阈值')
    const note = db.getNote(result.noteId)
    assert.ok(note.contentText.includes('Acceptance fixture'))
    if (item === rich) { assert.ok(note.content.includes('<strong>')); assert.equal(load(note.content)('table').length, 1) }
    else { assert.equal(load(note.content)('img').length, 2); assert.ok(/Spaced|repetition|Review/i.test(note.contentText)); assert.ok(note.content.includes('图片识别文字')) }
  }
  assert.equal((await analyzer.enqueue('private')).code, 'CLIPBOARD_AI_SENSITIVE')
  assert.equal(calls, 2); assert.equal(ocrCalls, 2)
  assert.equal(db.getNotes().length, 2)
  db.closeDb(); await db.initDb(); assert.equal(db.getNotes().length, 2)
  const report = { ok: true, configuredModel: model.modelName, syntheticContentOnly: true, realRequests: calls, realWindowsOCR: ocrCalls, richNotePreserved: true, allImagesPreserved: true, sensitiveBlockedBeforeNetwork: true, databaseReopened: true, phases: [...new Set(events.map(event => event.status))] }
  await fs.mkdir('app-data/diagnostics', { recursive: true })
  await fs.writeFile('app-data/diagnostics/clipboard-real-model.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.code || 'CLIPBOARD_REAL_MODEL_ACCEPTANCE_FAILED', assertion: error.code === 'ERR_ASSERTION' ? error.message : undefined }))
  process.exitCode = 1
} finally { analyzer?.stop(); db.closeDb(); await fs.rm(directory, { recursive: true, force: true }) }
