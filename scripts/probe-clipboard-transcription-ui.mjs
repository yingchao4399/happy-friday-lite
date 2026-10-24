// 隔离数据库 + 原版 Vue 设置/菜单 + 正式 preload/IPC；只使用合成录音和本机环回协议夹具。
import electron from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { setDataDir, saveConfig, loadConfig } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'

const root = fileURLToPath(new URL('../', import.meta.url))
if (!process.versions.electron) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-clipboard-transcription-ui-'))
  try {
    const env = { ...process.env, FRIDAY_CLIPBOARD_TRANSCRIPTION_PROBE: directory }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(electron, [fileURLToPath(import.meta.url)], { env, stdio: 'inherit' })
    process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)) })
  } finally { removePathNoFollowSync(directory, { root: os.tmpdir() }) }
  process.exit(process.exitCode || 0)
}
const { app, BrowserWindow } = electron
const { registerClipboardCommands, stopClipboardCapture } = await import('../src-electron/clipboard.js')
const data = process.env.FRIDAY_CLIPBOARD_TRANSCRIPTION_PROBE
assert.ok(data && path.basename(data).startsWith('friday-clipboard-transcription-ui-'), '必须由 Node 父进程启动以在 Electron 释放缓存后清理')
app.setPath('userData', path.join(data, 'profile'))
app.on('window-all-closed', () => {})
let win, harnessDir, server
const requests = []
const run = code => win.webContents.executeJavaScript(code, true)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(code, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (await run(code)) return; await sleep(50) }
  throw new Error('未达到界面状态: ' + code)
}
async function click(label, selector = 'document') {
  await run(`(() => {const button=[...${selector}.querySelectorAll('button')].find(node=>node.textContent.trim()===${JSON.stringify(label)});if(!button||button.disabled)throw new Error('按钮不可用');button.click()})()`)
}
async function openSettings() { await click('剪贴板设置'); await until('document.querySelector("[role=dialog] [aria-label=\\"音视频转写引擎\\"]")') }
async function openMenu(id) {
  await run(`(() => {const row=document.querySelector('[data-clipboard-id="${id}"]');row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:200,clientY:200}))})()`)
  await until('Boolean(document.querySelector("[role=menu]"))')
}

app.whenReady().then(async () => {
  let ok = false
  const deadline = setTimeout(() => app.exit(1), 180000)
  try {
    setDataDir(data); db.setDataDir(data); await db.initDb()
    server = http.createServer(async (request, response) => {
      const chunks = []; for await (const chunk of request) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString())
      assert.equal(request.url, '/v1/chat/completions')
      const value = JSON.parse(body.messages[1].content).clipboardText
      assert.ok(value.includes('学习') || value.includes('复习'))
      requests.push(value)
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ important: true, score: 0.95, title: '学习资料归档', summary: '主动回忆与复习安排', tags: ['学习'], category: '学习' }) } }] }))
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const baseUrl = 'http://127.0.0.1:' + server.address().port + '/v1'
    saveConfig({ language: 'zh-CN', selectedModelId: 'chat', customModels: [
      { id: 'chat', name: 'DeepSeek 聊天夹具', modelName: 'deepseek-chat', apiKey: 'fixture-only', baseUrl },
      { id: 'transcriber', name: '兼容转写夹具', modelName: 'whisper-fixture', apiKey: 'fixture-only', baseUrl }
    ], clipboard: { captureEnabled: false, captureRecordings: false, shortcutEnabled: false, trayEnabled: false } })
    const source = fs.readFileSync(path.join(root, 'app-data/diagnostics/recitation-speech-source.log'), 'utf8').match(/PROBE_AUDIO=([^\r\n]+)/)?.[1].trim()
    assert.ok(source && path.basename(path.dirname(source)).startsWith('friday-speech-probe-'), '只读取任务生成的合成语音')
    const audio = path.join(data, '课程录音.wav'), document = path.join(data, '学习资料.txt')
    fs.copyFileSync(source, audio); fs.writeFileSync(document, '间隔复习：当天、第三天和第七天闭卷自测，再对照原文纠错。', 'utf8')
    const hashes = [audio, document].map(file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'))
    for (const [id, kind, file] of [['document', 'file', document], ['audio', 'audio', audio]]) {
      const item = { id, kind, filePaths: [file], plainText: '', sensitivity: 'normal', hash: id, sourceApp: 'Synthetic UI fixture', capturedAt: new Date().toISOString() }
      db.queryAllRaw('INSERT INTO clipboard_items VALUES (?,?,?,?)', [id, JSON.stringify(item), item.capturedAt, null])
    }
    harnessDir = fs.mkdtempSync(path.join(root, '.clipboard-transcription-ui-'))
    fs.writeFileSync(path.join(harnessDir, 'index.html'), `<!doctype html><html><meta charset="utf-8"><body><div id="app"></div><script type="module">
      import { createApp } from 'vue';import { createRouter,createMemoryHistory } from 'vue-router';import { i18n } from '/src/i18n/index.js';import ClipboardView from '/src/views/clipboard/ClipboardView.vue';import '/src/assets/styles/main.css';
      const router=createRouter({history:createMemoryHistory(),routes:[{path:'/',component:ClipboardView}]});createApp(ClipboardView).use(router).use(i18n).mount('#app');
      </script><style>html,body,#app{height:100%;margin:0}</style></body></html>`)
    win = new BrowserWindow({ show: false, width: 1100, height: 800, webPreferences: { offscreen: true, backgroundThrottling: false, preload: path.join(root, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } })
    registerClipboardCommands(win)
    await win.loadURL('http://127.0.0.1:5173/' + path.basename(harnessDir) + '/index.html')
    await until('document.querySelectorAll("[data-clipboard-id]").length===2')
    const options = await run(`window.electronAPI.invoke('clipboard-ai-options')`)
    assert.deepEqual(options.transcriptionModels.map(model => model.id), ['transcriber'])
    assert.ok(!JSON.stringify(options).includes('fixture-only'))
    await openSettings()
    assert.equal(await run('document.querySelector("[role=dialog] [aria-label=\\"音视频转写引擎\\"]").textContent.trim()'), 'Windows 本机语音')
    await run('document.querySelector("[role=dialog] [aria-label=\\"音视频转写引擎\\"]").click()')
    await until('document.querySelectorAll("[role=listbox][aria-label=\\"音视频转写引擎\\"] [role=option]").length===2')
    await click('兼容转写夹具', 'document.querySelector("[role=listbox][aria-label=\\"音视频转写引擎\\"]")')
    await click('保存', 'document.querySelector("[role=dialog] footer")')
    await until('!document.querySelector("[role=dialog]")')
    assert.equal(loadConfig().clipboard.aiTranscriptionModelId, 'transcriber')
    await openSettings()
    await run('document.querySelector("[role=dialog] [aria-label=\\"音视频转写引擎\\"]").click()')
    await click('Windows 本机语音', 'document.querySelector("[role=listbox][aria-label=\\"音视频转写引擎\\"]")')
    await click('保存', 'document.querySelector("[role=dialog] footer")')
    await until('!document.querySelector("[role=dialog]")')
    assert.equal(loadConfig().clipboard.aiTranscriptionModelId, 'windows-local')
    await assert.rejects(run(`(async()=>{const settings=await window.electronAPI.invoke('clipboard-settings-get');await window.electronAPI.invoke('clipboard-settings-save',{...settings,aiTranscriptionModelId:'chat'})})()`), /CLIPBOARD_AI_TRANSCRIPTION_MODEL_REQUIRED/)
    for (const id of ['document', 'audio']) {
      await openMenu(id)
      await click('AI 识别并归档', 'document.querySelector("[role=menu]")')
      await until(`document.querySelector('[data-clipboard-id="${id}"] .ai-state')?.textContent.includes('已保存到笔记')`, 120000)
      const stored = JSON.parse(db.queryAllRaw('SELECT payload FROM clipboard_items WHERE id=?', [id])[0].payload)
      assert.ok(db.getNote(stored.savedNoteId)?.content.includes('Synthetic UI fixture'))
    }
    assert.equal(requests.length, 2)
    assert.ok(requests[0].includes('第七天')); assert.ok(requests[1].includes('保护环境'))
    await assert.rejects(fs.promises.access(path.join(data, 'media-transcripts.json')))
    for (const [index, file] of [audio, document].entries()) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), hashes[index])
    await openSettings()
    win.setSize(640, 720)
    await run(`document.documentElement.setAttribute('data-theme','dark');document.querySelector('[role=dialog] [aria-label="音视频转写引擎"]').scrollIntoView({block:'center'})`)
    await sleep(250)
    const rect = await run(`(()=>{const node=document.querySelector('[role=dialog] [aria-label="音视频转写引擎"]'),r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}})()`)
    assert.ok(rect.left >= 0 && rect.right <= rect.width && rect.top >= 0 && rect.bottom <= rect.height)
    fs.writeFileSync(path.join(root, 'app-data/diagnostics/clipboard-transcription-settings-dark.png'), (await win.webContents.capturePage()).toPNG())
    console.log(JSON.stringify({ ok: true, realVuePreloadIPC: true, fileMenuAIAvailable: true, mediaMenuAutomaticTranscription: true, actualWindowsSpeech: true, protocolFixtureRequests: requests.length, modelSettingPersisted: true, chatModelFiltered: true, sensitiveCredentialsNotExposed: true, unknownTranscriptNotCached: true, sourceFilesUnchanged: true, narrowDarkSettingVisible: true }))
    ok = true
  } catch (error) { console.error(error) }
  finally {
    clearTimeout(deadline); server?.close(); stopClipboardCapture(); db.closeDb()
    if (win && !win.isDestroyed()) win.destroy()
    if (harnessDir) removePathNoFollowSync(harnessDir, { root })
    app.exit(ok ? 0 : 1)
  }
})
