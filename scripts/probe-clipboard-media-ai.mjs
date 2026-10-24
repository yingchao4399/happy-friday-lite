// 仅发送合成学习材料；仅读现有模型配置，密钥留内存，不写测试目录、日志或安装资源。
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import AdmZip from 'adm-zip'
import * as db from '../src-electron/db.js'
import { setDataDir } from '../src-electron/config.js'
import { createClipboardAnalyzer, classifyClipboardWithModel } from '../src-electron/clipboard-ai.js'
import { prepareClipboardAiContent } from '../src-electron/clipboard-note-content.js'
import { clipboardDefaults } from '../src-electron/clipboard-settings.js'
import { removePathNoFollow } from '../src-electron/fs-safe.js'

const run = promisify(execFile)
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-clipboard-media-ai-'))
const sourcePath = process.argv.find(arg => arg.startsWith('--config='))?.slice(9) || path.join(process.env.APPDATA, 'happy-friday-lite', 'config.json')
let analyzer
try {
  const config = JSON.parse(await fs.readFile(sourcePath, 'utf8'))
  const model = (config.customModels || []).find(item => item.id === config.selectedModelId && item.apiKey && item.baseUrl && item.modelName)
    || (config.customModels || []).find(item => item.apiKey && item.baseUrl && item.modelName)
  assert.ok(model, '需要已配置的聊天模型')
  setDataDir(directory); db.setDataDir(directory); await db.initDb()
  const material = '间隔复习与主动回忆学习法。学习当天先闭卷回答问题，再对照原文纠错。第三天和第七天再次复习，将错误分为概念混淆、事实遗漏和推理步骤。下一轮重点复习薄弱点，记录日期、来源和掌握情况。'
  const docx = path.join(directory, '间隔复习资料.docx'), audio = path.join(directory, '主动回忆课程.wav')
  const zip = new AdmZip()
  zip.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'))
  zip.addFile('_rels/.rels', Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'))
  zip.addFile('word/document.xml', Buffer.from('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' + material + '</w:t></w:r></w:p></w:body></w:document>'))
  zip.writeZip(docx)
  const speechScript = path.join(directory, 'speech.ps1')
  await fs.writeFile(speechScript, '\uFEFFparam([string]$OutputPath)\n$ErrorActionPreference="Stop"\nAdd-Type -AssemblyName System.Speech\n$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer\ntry { $speaker.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::NotSet, [System.Speech.Synthesis.VoiceAge]::NotSet, 0, [Globalization.CultureInfo]::GetCultureInfo("zh-CN")); $speaker.SetOutputToWaveFile($OutputPath); $speaker.Speak("' + material + '") } finally { $speaker.Dispose() }', 'utf8')
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', speechScript, '-OutputPath', audio], { windowsHide: true, timeout: 45000, maxBuffer: 4096 })
  const items = new Map(), hashes = new Map(), phases = [], results = []
  for (const [kind, file] of [['file', docx], ['audio', audio]]) {
    const hash = crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')
    hashes.set(file, hash)
    items.set(kind, { id: kind, kind, filePaths: [file], plainText: '', sensitivity: 'normal', hash, sourceApp: 'Synthetic acceptance fixture', capturedAt: new Date().toISOString() })
  }
  let calls = 0
  analyzer = createClipboardAnalyzer({
    getItem: id => items.get(id), patchItem: (id, patch) => Object.assign(items.get(id), patch),
    getSettings: () => ({ ...clipboardDefaults, aiEnabled: true, aiThreshold: 0.6, language: 'zh-CN', aiInstructions: '保存有步骤和时间安排的学习方法、复习计划与课程知识。' }),
    getModel: () => model,
    prepareContent: (item, options) => prepareClipboardAiContent(item, options),
    complete: (...args) => { calls++; return classifyClipboardWithModel(...args) },
    notify: event => phases.push({ id: event.id, status: event.status, code: event.code })
  })
  for (const item of items.values()) {
    const result = await analyzer.enqueue(item.id, false)
    assert.equal(result.status, 'saved', result.code || '合成学习材料未达到归档阈值')
    const note = db.getNote(result.noteId)
    assert.ok(note.contentText.includes('Synthetic acceptance fixture'))
    assert.ok(note.content.includes(path.basename(item.filePaths[0])))
    assert.ok(/复习|学习|回忆|闭卷/.test(note.contentText))
    assert.ok(note.content.includes('<pre>'))
    results.push({ kind: item.kind, saved: true, sourcePreserved: true, originalTextPreserved: true })
  }
  assert.equal(calls, 2)
  assert.ok(phases.some(value => value.id === 'audio' && value.status === 'transcribing'))
  await assert.rejects(fs.access(path.join(directory, 'media-transcripts.json')))
  for (const [file, hash] of hashes) assert.equal(crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'), hash)
  db.closeDb(); await db.initDb(); assert.equal(db.getNotes().length, 2)
  const report = { ok: true, syntheticContentOnly: true, realModelRequests: calls, actualWindowsSpeech: true, untranscribedAudioAutomaticallyTranscribed: true, unknownSensitivityTranscriptNotCached: true, sourceFilesUnchanged: true, databaseReopened: true, results, phases: [...new Set(phases.map(value => value.status))] }
  await fs.mkdir('app-data/diagnostics', { recursive: true })
  await fs.writeFile('app-data/diagnostics/clipboard-media-ai-real.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.code || 'CLIPBOARD_MEDIA_AI_PROBE_FAILED', assertion: error.code === 'ERR_ASSERTION' ? error.message : undefined }))
  process.exitCode = 1
} finally { analyzer?.stop(); db.closeDb(); await removePathNoFollow(directory, { root: os.tmpdir() }) }
