// 真实 NoteEditor 媒体验收：点击预览、打开文件和打开所在位置，并检查 IPC 参数。
import { app, BrowserWindow, ipcMain } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-media-'))
app.setPath('userData', path.join(temp, 'profile'))
app.on('window-all-closed', () => {})
let win, harnessDir
let openedFile = null, openedLocation = null
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const run = code => win.webContents.executeJavaScript(code, true)
async function until(code) { for (let i = 0; i < 240; i++) { if (await run(code)) return; await pause(50) } throw new Error('媒体验收超时: ' + code) }
async function click(selector) {
  const point = await run(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e)throw new Error('找不到控件'); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)} })()`)
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point }); win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point }); await pause(220)
}

async function main() {
  let ok = false
  const timer = setTimeout(() => app.exit(1), 180000)
  try {
    harnessDir = fs.mkdtempSync(path.join(root, 'note-media-probe-'))
    const videoPath = path.join(harnessDir, '示例视频.mp4'), audioPath = path.join(harnessDir, '示例音频.mp3')
    fs.writeFileSync(videoPath, Buffer.from('not-a-real-video'))
    fs.writeFileSync(audioPath, Buffer.from('not-a-real-audio'))
    const content = `<h1 data-note-title="true">媒体验收</h1><video data-note-video="true" src="${`file://${videoPath.replaceAll('\\', '/')}`}" title="示例视频"></video><audio data-note-audio="true" src="${`file://${audioPath.replaceAll('\\', '/')}`}" title="示例音频"></audio>`
    fs.writeFileSync(path.join(harnessDir, 'note.json'), JSON.stringify({ content }))
    fs.writeFileSync(path.join(harnessDir, 'index.html'), `<!doctype html><html lang="zh"><meta charset="utf-8"><body><div id="app"></div><script type="module">
import { createApp,h,ref } from 'vue'
import { createPinia } from 'pinia'
import { createRouter,createMemoryHistory } from 'vue-router'
import { i18n } from '/src/i18n/index.js'
import NoteEditor from '/src/views/note/NoteEditor.vue'
import '/src/assets/styles/main.css'
async function mount(){const initial=await window.electronAPI.invoke('get_note',{noteId:'probe'}),content=ref(initial.content);window.emittedNote=initial.content;const router=createRouter({history:createMemoryHistory(),routes:[{path:'/',component:{render:()=>null}}]});createApp({setup:()=>()=>h(NoteEditor,{modelValue:content.value,'onUpdate:modelValue':value=>{content.value=value;window.emittedNote=value}})}).use(createPinia()).use(router).use(i18n).mount('#app')}
mount()
</script><style>html,body,#app{height:100%;margin:0;background:var(--bg-primary)}</style></body></html>`)
    ipcMain.handle('kb-get-data-dir', () => null)
    ipcMain.handle('get_note', () => JSON.parse(fs.readFileSync(path.join(harnessDir, 'note.json'), 'utf8')))
    ipcMain.handle('kb-open-file-external', (_event, args) => { openedFile = args?.filePath; return true })
    ipcMain.handle('kb-open-in-explorer', (_event, args) => { openedLocation = args?.path; return true })
    win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { offscreen: true, backgroundThrottling: false, preload: path.join(root, 'preload.cjs'), contextIsolation: true } })
    const { build } = await import('vite')
    const site = path.join(harnessDir, 'site')
    await build({ configFile: path.join(root, 'vite.config.js'), build: { outDir: site, emptyOutDir: true, rollupOptions: { input: path.join(harnessDir, 'index.html') } } })
    const entry = fs.readdirSync(site, { recursive: true }).find(file => file.endsWith('index.html'))
    await win.loadFile(path.join(site, entry))
    await until('document.querySelectorAll(".note-media-node").length===2')
    assert.equal(await run('document.querySelectorAll(".note-media-tools button").length'), 6)
    await click('.note-media-node:nth-of-type(1) .note-media-tools button:nth-child(1)')
    await until('Boolean(document.querySelector(".note-media-preview-overlay"))')
    assert.equal(await run('document.querySelector(".note-media-preview-title").textContent'), '示例视频')
    await click('.note-media-preview-close')
    await click('.note-media-node:nth-of-type(1) .note-media-tools button:nth-child(2)')
    await pause(100); assert.match(openedFile || '', /示例视频\.mp4$/)
    await click('.note-media-node:nth-of-type(1) .note-media-tools button:nth-child(3)')
    await pause(100); assert.match(openedLocation || '', /示例视频\.mp4$/)
    await click('.note-media-node:nth-of-type(2) .note-media-tools button:nth-child(1)')
    await until('Boolean(document.querySelector(".note-media-preview-overlay"))')
    assert.equal(await run('document.querySelector(".note-media-preview-title").textContent'), '示例音频')
    await click('.note-media-preview-close')
    const report = { ok: true, mediaNodes: ['video', 'audio'], preview: true, openFile: openedFile, openLocation: openedLocation, controls: true, generatedAt: new Date().toISOString() }
    fs.mkdirSync(path.join(root, 'app-data/diagnostics'), { recursive: true })
    fs.writeFileSync(path.join(root, 'app-data/diagnostics/note-media.json'), JSON.stringify(report, null, 2))
    fs.writeFileSync(path.join(root, 'app-data/diagnostics/note-media.png'), (await win.webContents.capturePage()).toPNG())
    console.log(JSON.stringify(report)); ok = true
  } catch (error) {
    console.error(error.stack)
    if (win && !win.isDestroyed()) fs.writeFileSync(path.join(root, 'app-data/diagnostics/note-media-failure.png'), (await win.webContents.capturePage()).toPNG())
  } finally {
    clearTimeout(timer); if (win && !win.isDestroyed()) win.destroy(); if (harnessDir) removePathNoFollowSync(harnessDir, { root }); app.exit(ok ? 0 : 1)
  }
}
app.whenReady().then(main)
