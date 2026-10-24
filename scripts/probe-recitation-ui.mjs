// 使用合成中文录音、真实 Vue 页面/preload/IPC/本机语音引擎，完全隔离用户数据。
import { app, BrowserWindow, ipcMain } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { setDataDir } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import { importRecitationAudio, listRecitations, listRecitationModels, transcribeRecitation, reanalyzeRecitation, correctRecitationTranscript, readRecitationAudio } from '../src-electron/recitation.js'
import { registerRecitationCommands } from '../src-electron/recitation-ipc.js'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-recitation-ui-'))
app.setPath('userData', path.join(data, 'profile'))
app.on('window-all-closed', () => {})
const text = JSON.parse(fs.readFileSync(path.join(root, 'src', 'i18n', 'locales', 'zh-CN', 'recitation.json'), 'utf8'))
const reference = ['今天我们学习如何保护环境。', '每天阅读可以增加知识。', '运动可以帮助我们保持健康。']
let win, harnessDir
const run = code => win.webContents.executeJavaScript(code, true)
async function until(check, label) {
  for (let index = 0; index < 400; index++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)) }
  throw new Error('背诵验收超时: ' + label)
}
async function click(label) {
  await run(`(() => { const button=[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(label)});if(!button || button.disabled)throw new Error('按钮不可用');button.click(); })()`)
}
async function fill(selector, value, index = 0) {
  await run(`(() => { const field=document.querySelectorAll(${JSON.stringify(selector)})[${index}];field.value=${JSON.stringify(value)};field.dispatchEvent(new Event('input',{bubbles:true})); })()`)
}

app.whenReady().then(async () => {
  let ok = false
  const deadline = setTimeout(() => app.exit(1), 150000)
  try {
    setDataDir(data); db.setDataDir(data); await db.initDb()
    registerRecitationCommands(ipcMain)
    const source = fs.readFileSync(path.join(root, 'app-data', 'diagnostics', 'recitation-speech-source.log'), 'utf8').match(/PROBE_AUDIO=([^\r\n]+)/)?.[1].trim()
    assert.ok(source && path.basename(path.dirname(source)).startsWith('friday-speech-probe-'), '只接收本任务生成的合成语音')
    // .NET 常返回长路径，Node TMP 可能使用 ADMINI~1；比较目录身份，不能误判为不同位置。
    const actualParent = fs.statSync(path.dirname(path.dirname(source)))
    const expectedParent = fs.statSync(os.tmpdir())
    assert.ok(actualParent.dev === expectedParent.dev && actualParent.ino === expectedParent.ino, '合成语音必须位于本机临时目录')
    const audio = path.join(data, '背诵校对验收.wav')
    fs.copyFileSync(source, audio)
    harnessDir = fs.mkdtempSync(path.join(root, '.recitation-ui-probe-'))
    fs.writeFileSync(path.join(harnessDir, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app"></div><script type="module">
      import { createApp } from 'vue'; import { i18n } from '/src/i18n/index.js'; import RecitationView from '/src/views/recitation/RecitationView.vue'; import '/src/assets/styles/main.css';
      createApp(RecitationView).use(i18n).mount('#app');window.recitationReady=true;
    </script><style>html,body,#app{height:100%;margin:0}</style></body></html>`)
    win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { offscreen: true, preload: path.join(root, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
    const url = `http://127.0.0.1:5173/${path.basename(harnessDir)}/index.html`
    await win.loadURL(url)
    await until(() => run('window.recitationReady && Boolean(document.querySelector("input[type=file]"))'), '上传入口')
    win.webContents.debugger.attach('1.3')
    const document = await win.webContents.debugger.sendCommand('DOM.getDocument')
    const input = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: document.root.nodeId, selector: 'input[type=file]' })
    await win.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [audio] })
    win.webContents.debugger.detach()
    await until(() => listRecitations().length === 1 && run('Boolean(document.querySelector("audio"))'), '实际文件导入')
    await until(() => run('document.querySelector("audio")?.readyState>=1'), '受管音频元数据解码')
    await run(`(async()=>{const audio=document.querySelector('audio');audio.muted=true;await audio.play();})()`)
    await until(() => run('document.querySelector("audio").currentTime>0'), '播放时钟实际推进')
    const media = await run(`(()=>{const audio=document.querySelector('audio');const value={duration:audio.duration,currentTime:audio.currentTime,blob:audio.currentSrc.startsWith('blob:')};audio.pause();return value;})()`)
    assert.ok(media.duration > 9 && media.duration < 12 && media.currentTime > 0 && media.blob, JSON.stringify(media))
    await click(text.transcribe)
    await until(() => listRecitations()[0]?.status === 'analyzed' && run('Boolean(document.querySelector(".analysis-rows"))'), '真实本机转写及分析')
    const initial = listRecitations()[0]
    assert.equal(initial.segments.length, 3)
    assert.equal(initial.rawTranscript, initial.transcript)
    assert.equal(initial.analysis.alignment, null)
    assert.equal(initial.analysis.repetitionCount, null)
    assert.deepEqual(new Set(initial.study.questions.map(question => question.type)), new Set(['blank', 'choice', 'recall']))
    for (const segment of initial.segments) assert.ok(segment.start >= 0 && segment.end > segment.start && segment.end <= media.duration && segment.confidence >= 0 && segment.confidence <= 1)
    await click(text.transcriptTab)
    await fill('.reference-field textarea', reference.join(''))
    await click(text.correctTranscript)
    for (const [index, value] of reference.entries()) await fill('.correction-text', value, index)
    await click(text.saveCorrection)
    await until(() => listRecitations()[0].transcript === reference.join('\n') && run('!document.querySelector(".correction-text")'), '人工校对保存')
    const saved = listRecitations()[0]
    assert.equal(saved.analysis.alignment.accuracy, 1)
    assert.equal(saved.rawTranscript, initial.rawTranscript)
    assert.deepEqual(saved.rawSegments, initial.rawSegments)
    assert.deepEqual(saved.segments.map(segment => [segment.start, segment.end, segment.confidence]), initial.segments.map(segment => [segment.start, segment.end, segment.confidence]))
    await run(`document.querySelector('.original-transcript summary').click()`)
    assert.equal(await run('document.querySelector(".original-transcript .transcript").textContent'), initial.rawTranscript)
    fs.writeFileSync(path.join(root, 'app-data', 'diagnostics', 'recitation-transcript-correction-ui.png'), (await win.webContents.capturePage()).toPNG())
    await click(text.correctTranscript)
    await fill('.correction-text', '应当取消的校对内容')
    await click(text.cancelCorrection)
    assert.equal(listRecitations()[0].transcript, saved.transcript)
    await click(text.practiceTab)
    await until(() => run('document.querySelectorAll(".exercise").length>=6'), '来源练习')
    const index = saved.study.questions.findIndex(question => question.source.start > 5)
    assert.ok(index >= 0)
    const seekTime = saved.study.questions[index].source.start
    await run(`document.querySelectorAll('.exercise')[${index}].querySelector('button').click()`)
    await until(() => run(`document.querySelector('audio').currentTime>=${seekTime} && !document.querySelector('audio').paused`), '练习回跳原音频')
    await run(`document.querySelector('audio').pause()`)
    await click(text.analysisTab)
    fs.writeFileSync(path.join(root, 'app-data', 'diagnostics', 'recitation-analysis-ui.png'), (await win.webContents.capturePage()).toPNG())
    db.closeDb(); await db.initDb()
    await win.reload()
    await until(() => run('Boolean(document.querySelector(".session-row"))'), '重新打开数据库和页面')
    await run(`document.querySelector('.session-row').click()`)
    await until(() => run('Boolean(document.querySelector("audio"))'), '恢复音频')
    assert.equal(listRecitations()[0].transcript, saved.transcript)
    assert.equal(listRecitations()[0].rawTranscript, initial.rawTranscript)
    const stable = listRecitations()[0]
    await click(text.transcribe)
    await click(text.cancelTranscription)
    await until(() => listRecitations()[0].status === 'error' && run('!document.querySelector(".task-progress")'), '取消转写阶段')
    assert.equal(listRecitations()[0].transcript, stable.transcript)
    assert.equal(listRecitations()[0].rawTranscript, stable.rawTranscript)
    assert.equal(listRecitations()[0].error, 'MEDIA_TRANSCRIPTION_CANCELLED')
    win.setSize(640, 850)
    await click(text.correctTranscript)
    assert.equal(await run(`(()=>{const field=document.querySelector('.correction-text').getBoundingClientRect();return field.left>=0&&field.right<=innerWidth})()`), true)
    await click(text.cancelCorrection)
    ok = true
    console.log(JSON.stringify({ ok, actualFileInput: true, secureManagedPlayback: true, realWindowsSpeech: true, timestampConfidence: true, noFakeAccuracyOrRepetitions: true, threeQuestionTypes: true, correctionPreservesRaw: true, cancelPreservesSaved: true, questionSeeksAudio: true, databaseAndPageReopened: true, cancelTranscriptionKeepsPriorResult: true, productionIPC: true, narrowLayout: true }))
  } catch (error) { console.error(error.stack); if (win && !win.isDestroyed()) console.error(await run('document.body.innerText.slice(-600)')) }
  finally {
    clearTimeout(deadline); db.closeDb(); if (win && !win.isDestroyed()) win.destroy()
    if (harnessDir) removePathNoFollowSync(harnessDir, { root })
    try { removePathNoFollowSync(data, { root: os.tmpdir() }) } catch {}
    app.exit(ok ? 0 : 1)
  }
})
