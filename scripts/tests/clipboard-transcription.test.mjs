import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { prepareClipboardAiContent } from '../../src-electron/clipboard-note-content.js'
import { createClipboardAnalyzer } from '../../src-electron/clipboard-ai.js'
import { clipboardDefaults, normalizeClipboardSettings } from '../../src-electron/clipboard-settings.js'
import { setDataDir, saveConfig } from '../../src-electron/config.js'
import { transcribeMedia } from '../../src-electron/rag/mediaTranscription.js'
import { removePathNoFollow } from '../../src-electron/fs-safe.js'

const model = { apiKey: 'fixture', baseUrl: 'http://fixture.invalid', modelName: 'fixture' }
const material = '间隔复习需要在第一天、第三天和一周后进行。先闭卷回答问题，再对照原文纠错。'
function fixture(extra = {}) {
  const item = { id: 'media', kind: 'audio', filePaths: ['C:\\fixture\\学习.wav'], sensitivity: 'normal' }, notes = [], phases = []
  const settings = { ...clipboardDefaults, aiEnabled: true }
  let calls = 0
  const analyzer = createClipboardAnalyzer({
    getItem: () => item, patchItem: (_id, value) => Object.assign(item, value), getSettings: () => settings,
    getModel: () => model, notify: value => phases.push(value),
    complete: async () => { calls++; return { important: true, score: 0.95, title: '复习安排', summary: '间隔复习与自测', tags: [] } },
    saveNote: (_item, note) => { notes.push(note); return { id: 'note' } }, ...extra
  })
  return { item, settings, notes, phases, analyzer, calls: () => calls }
}
const uncached = () => { throw new Error('not transcribed') }

test('未转写音视频自动调用本机引擎，保留正文和来源，只在内存识别未知敏感内容', async () => {
  const requests = []
  const f = fixture({ prepareContent: (item, options) => prepareClipboardAiContent(item, { ...options, readTranscript: uncached, transcribe: async (...args) => { requests.push(args); return { text: material, extraction: 'windows_speech' } } }) })
  assert.equal((await f.analyzer.enqueue('media')).status, 'saved')
  assert.equal(requests.length, 1); assert.equal(requests[0][1], 'windows-local')
  assert.equal(requests[0][2].aborted, false); assert.deepEqual(requests[0][3], { persist: false })
  assert.ok(f.notes[0].text.includes(material)); assert.ok(f.notes[0].html.includes('学习.wav'))
  assert.ok(f.phases.some(value => value.status === 'transcribing')); assert.equal(f.calls(), 1)
})

test('版本匹配的既有转写可复用；自选引擎只用于缺失转写，DeepSeek 不会被当作转写引擎', async () => {
  let transcriptions = 0
  const item = { id: 'video', kind: 'video', filePaths: ['C:\\fixture\\会议.mp4'] }
  const options = { readTranscript: () => ({ text: material }), transcribe: async () => { transcriptions++; throw new Error('不应重转写') } }
  assert.ok((await prepareClipboardAiContent(item, options)).text.includes(material)); assert.equal(transcriptions, 0)
  const requests = []
  await prepareClipboardAiContent(item, { readTranscript: uncached, transcriptionModelId: 'whisper-custom', transcribe: async (...args) => { requests.push(args); return { text: material } } })
  assert.equal(requests[0][1], 'whisper-custom')
})

test('转写识别出敏感内容后不调用分类模型、不保存笔记，也不继续转写其他媒体', async () => {
  let transcriptions = 0
  const f = fixture({ prepareContent: (item, options) => prepareClipboardAiContent(item, { ...options, readTranscript: uncached, transcribe: async (_file, _modelId, _signal, options) => { transcriptions++; assert.equal(options.persist, false); return { text: '验证码：123456' } } }) })
  f.item.filePaths.push('C:\\fixture\\第二段.wav')
  const result = await f.analyzer.enqueue('media')
  assert.equal(result.code, 'CLIPBOARD_AI_SENSITIVE'); assert.equal(transcriptions, 1)
  assert.equal(f.calls(), 0); assert.equal(f.notes.length, 0)
})

test('关闭自动归档会中止正在转写的任务，取消状态准确，手动识别不被误取消', async () => {
  let started, release
  const entered = new Promise(resolve => { started = resolve })
  const f = fixture({ prepareContent: (item, options) => prepareClipboardAiContent(item, { ...options, readTranscript: uncached, transcribe: (_file, _model, signal) => new Promise((resolve, reject) => { release = () => resolve({ text: material }); signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true }); started() }) }) })
  const pending = f.analyzer.enqueue('media')
  await entered; f.settings.aiEnabled = false; f.analyzer.cancelAutomatic()
  assert.equal((await pending).status, 'cancelled'); assert.equal(f.calls(), 0); assert.equal(f.notes.length, 0)
  const manual = f.analyzer.enqueue('media', false)
  while (f.item.ai.status !== 'transcribing') await new Promise(resolve => setTimeout(resolve, 1))
  f.analyzer.cancelAutomatic(); release()
  assert.equal((await manual).status, 'saved'); assert.equal(f.calls(), 1)
})

test('转写期间条目变私密、被编辑或过期时拒绝后续模型调用和归档', async () => {
  for (const [patch, code] of [[{ sensitivity: 'secret' }, 'CLIPBOARD_AI_SENSITIVE'], [{ filePaths: ['C:\\fixture\\replacement.wav'] }, 'CLIPBOARD_AI_CONTENT_CHANGED'], [{ expiresAt: '2000-01-01' }, 'CLIPBOARD_AI_UNAVAILABLE']]) {
    let started, release
    const entered = new Promise(resolve => { started = resolve })
    const f = fixture({ prepareContent: (item, options) => prepareClipboardAiContent(item, { ...options, readTranscript: uncached, transcribe: async () => { started(); return new Promise(resolve => { release = resolve }) } }) })
    const pending = f.analyzer.enqueue('media')
    await entered; Object.assign(f.item, patch); release({ text: material })
    assert.equal((await pending).code, code); assert.equal(f.calls(), 0); assert.equal(f.notes.length, 0)
  }
})

test('转写错误不泄露服务正文或路径，语言包、模型、解码、大小和超时有可操作错误', async () => {
  for (const [source, target] of [['MEDIA_TRANSCRIPTION_CHAT_ONLY', 'CLIPBOARD_AI_TRANSCRIPTION_MODEL_REQUIRED'], ['MEDIA_TRANSCRIPTION_ENGINE_UNAVAILABLE', 'CLIPBOARD_AI_TRANSCRIPTION_ENGINE_UNAVAILABLE'], ['MEDIA_TRANSCRIPTION_TIMEOUT', 'CLIPBOARD_AI_TRANSCRIPTION_TIMEOUT'], ['MEDIA_TRANSCRIPTION_INVALID_AUDIO', 'CLIPBOARD_AI_TRANSCRIPTION_INVALID_AUDIO'], ['MEDIA_TRANSCRIPTION_SERVICE_FAILED', 'CLIPBOARD_AI_TRANSCRIPTION_SERVICE_FAILED'], ['MEDIA_TRANSCRIPTION_RESULT_INVALID', 'CLIPBOARD_AI_TRANSCRIPTION_INVALID_RESULT'], ['oversize', 'CLIPBOARD_AI_MEDIA_TOO_LARGE']]) {
    const f = fixture({ prepareContent: (item, options) => prepareClipboardAiContent(item, { ...options, readTranscript: uncached, transcribe: async () => { throw Object.assign(new Error(source === 'oversize' ? '25 MB secret' : 'secret service body'), { code: source }) } }) })
    const result = await f.analyzer.enqueue('media')
    assert.equal(result.code, target); assert.ok(!JSON.stringify(result).includes('secret')); assert.equal(f.calls(), 0)
  }
})

test('旧剪贴板设置自动补本机转写默认值，不继承聊天模型；明确选择可保留', () => {
  assert.equal(normalizeClipboardSettings({ aiModelId: 'deepseek' }).aiTranscriptionModelId, 'windows-local')
  assert.equal(normalizeClipboardSettings({ aiTranscriptionModelId: '' }).aiTranscriptionModelId, 'windows-local')
  assert.equal(normalizeClipboardSettings({ aiTranscriptionModelId: 'custom-whisper' }).aiTranscriptionModelId, 'custom-whisper')
})

test('真实转写 HTTP 协议支持禁用缓存；敏感转写只留内存，普通既有调用继续持久化', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-transcription-private-'))
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const value of req) chunks.push(value)
    assert.equal(req.url, '/v1/audio/transcriptions')
    assert.ok(Buffer.concat(chunks).includes(Buffer.from('name="file"')))
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ text: '验证码：123456', duration: 2, segments: [{ start: 0, end: 2, text: '验证码：123456', confidence: 0.9 }] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    setDataDir(directory)
    saveConfig({ customModels: [{ id: 'transcriber', apiKey: 'fixture-only', baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1', modelName: 'whisper-fixture' }] })
    const file = path.join(directory, 'fixture.wav'); await fs.writeFile(file, 'synthetic fixture')
    const result = await transcribeMedia(file, 'transcriber', undefined, { persist: false })
    assert.equal(result.text, '验证码：123456')
    await assert.rejects(fs.access(path.join(directory, 'media-transcripts.json')))
    await transcribeMedia(file, 'transcriber')
    assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'media-transcripts.json'), 'utf8'))[file].text, result.text)
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await removePathNoFollow(directory, { root: os.tmpdir() }) }
})
