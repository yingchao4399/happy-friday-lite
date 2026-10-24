import { app, BrowserWindow, ipcMain } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import http from 'node:http'
import { setDataDir, saveConfig } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import { registerClipboardCommands, stopClipboardCapture, clipboardToNote, updateClipboardItem, getClipboardImage } from '../src-electron/clipboard.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-note-ui-'))
app.setPath('userData', path.join(directory, 'profile'))
app.on('window-all-closed', () => {})
let win, harnessDir, imageServer
const deadline = setTimeout(() => { console.error('剪贴板到笔记界面验收超时'); app.exit(1) }, 60_000)
const run = code => win.webContents.executeJavaScript(code)
async function until(code) { for (let i = 0; i < 100; i++) { if (await run(code)) return; await new Promise(resolve => setTimeout(resolve, 50)) } throw new Error('未达到状态: ' + code) }
const harness = `<!doctype html><html lang="zh"><meta charset="utf-8"><body><div id="app"></div><script type="module">
import { createApp, h, ref } from 'vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia } from 'pinia'
import { i18n } from '/src/i18n/index.js'
import NoteEditor from '/src/views/note/NoteEditor.vue'
import '/src/assets/styles/main.css'
const initial = await (await fetch('./note.json')).json()
const content = ref(initial.content)
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
createApp({ setup: () => () => h(NoteEditor, { modelValue: content.value, 'onUpdate:modelValue': value => { content.value = value; window.emittedNote = value } }) }).use(createPinia()).use(router).use(i18n).mount('#app')
</script><style>html,body,#app{height:100%;margin:0;background:var(--bg-primary)}</style></body></html>`
async function main() {
  try {
    setDataDir(directory); db.setDataDir(directory); await db.initDb()
    saveConfig({ language: 'zh-CN', clipboard: { captureEnabled: false, shortcutEnabled: false, captureRecordings: false } })
    const images = []
    for (const color of ['red', 'blue']) images.push('data:image/png;base64,' + (await sharp({ create: { width: 60, height: 40, channels: 4, background: color } }).png().toBuffer()).toString('base64'))
    const item = { id: 'rich-note', kind: 'html', plainText: '归档验收\n主动回忆与间隔复习', html: '<h2>归档验收</h2><p><strong>主动回忆</strong>与间隔复习</p><table><tr><th>日期</th><th>方法</th></tr><tr><td>第七天</td><td>闭卷自测</td></tr></table><p><img src="' + images[0] + '"></p><p><img src="' + images[1] + '"></p>', sensitivity: 'normal', sourceApp: 'Acceptance fixture', hash: 'rich-note-source', capturedAt: new Date().toISOString() }
    db.queryAllRaw('INSERT INTO clipboard_items VALUES (?,?,?,?)', [item.id, JSON.stringify(item), item.capturedAt, null])
    harnessDir = fs.mkdtempSync(path.join(root, '.clipboard-note-ui-probe-'))
    win = new BrowserWindow({ show: false, width: 1100, height: 850, webPreferences: { offscreen: true, backgroundThrottling: false, preload: path.join(root, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } })
    registerClipboardCommands(win)
    ipcMain.handle('kb-get-data-dir', () => null)
    const result = await clipboardToNote(item.id), note = db.getNote(result.noteId)
    fs.writeFileSync(path.join(harnessDir, 'index.html'), harness)
    fs.writeFileSync(path.join(harnessDir, 'note.json'), JSON.stringify(note))
    await win.loadURL(`http://127.0.0.1:5173/${path.basename(harnessDir)}/index.html`)
    await until('document.querySelectorAll(".tiptap img").length === 2 && [...document.querySelectorAll(".tiptap img")].every(image => image.naturalWidth === 60)')
    assert.equal(await run('document.querySelector(".tiptap [data-note-title]")?.textContent'), note.title)
    assert.equal(await run('document.querySelectorAll(".tiptap table").length'), 1)
    assert.ok(await run('document.querySelector(".tiptap strong")?.textContent.includes("主动回忆")'))
    await run(`(() => {const editor=document.querySelector('.tiptap'),last=editor.querySelector('p:last-child');editor.focus();const range=document.createRange();range.selectNodeContents(last);range.collapse(false);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.execCommand('insertText',false,' 编辑保存验收')})()`)
    await until('window.emittedNote?.includes("编辑保存验收")')
    const content = await run('window.emittedNote')
    assert.equal((content.match(/<img /g) || []).length, 2)
    assert.ok(content.includes('<table')); assert.ok(content.includes('<strong>主动回忆</strong>'))
    db.updateNote(note.id, note.title, content, note.contentText)
    fs.writeFileSync(path.join(harnessDir, 'note.json'), JSON.stringify(db.getNote(note.id)))
    await win.reload()
    await until('document.querySelectorAll(".tiptap img").length === 2 && document.querySelector(".tiptap").textContent.includes("编辑保存验收")')
    // 内容编辑后允许生成新快照；旧笔记保留。仅打开已有笔记不依赖源图片仍在。
    assert.equal((await clipboardToNote(item.id)).noteId, note.id)
    updateClipboardItem(item.id, { plainText: '新版本的学习资料', html: '<p>新版本的学习资料</p>', editContent: true })
    const updated = await clipboardToNote(item.id)
    assert.notEqual(updated.noteId, note.id); assert.equal(db.getNotes().length, 2)
    let requests = 0
    const png = Buffer.from(images[0].split(',')[1], 'base64')
    imageServer = http.createServer((_request, response) => { requests++; response.writeHead(200, { 'Content-Type': 'image/png' }); response.end(png) })
    await new Promise(resolve => imageServer.listen(0, '127.0.0.1', resolve))
    const url = 'http://127.0.0.1:' + imageServer.address().port + '/image.png'
    updateClipboardItem(item.id, { plainText: '外部图片独立快照', html: '<p>外部图片独立快照</p><p><img src="' + url + '"></p>', editContent: true })
    const unloaded = await clipboardToNote(item.id)
    assert.equal(requests, 0); assert.ok(unloaded.warnings.includes('CLIPBOARD_NOTE_IMAGE_NOT_LOADED'))
    assert.ok(!db.getNote(unloaded.noteId).content.includes('<img'))
    await getClipboardImage({ id: item.id, htmlIndex: 0, thumbnail: false, loadExternal: true })
    assert.equal(requests, 1)
    const loaded = await clipboardToNote(item.id)
    assert.notEqual(loaded.noteId, unloaded.noteId)
    assert.ok(db.getNote(loaded.noteId).content.includes('<img'))
    assert.ok(!db.getNote(unloaded.noteId).content.includes('<img'))
    assert.equal(requests, 1); assert.equal(db.getNotes().length, 4)
    fs.mkdirSync(path.join(root, 'app-data/diagnostics'), { recursive: true })
    fs.writeFileSync(path.join(root, 'app-data/diagnostics/clipboard-note-ui.png'), (await win.webContents.capturePage()).toPNG())
    console.log(JSON.stringify({ ok: true, realNoteEditor: true, actualImagesLoaded: 2, correctNoteTitle: true, tableAndFormatting: true, editSaveReload: true, existingNoteReopens: true, editedClipboardCreatesNewSnapshot: true, originalsRetained: true, externalImagesRequireExplicitLoad: true, loadedImagesCreateNewSnapshot: true }))
  } catch (error) { console.error(error); process.exitCode = 1 }
  finally { imageServer?.close(); clearTimeout(deadline); stopClipboardCapture(); db.closeDb(); if (win && !win.isDestroyed()) win.destroy(); if (harnessDir) removePathNoFollowSync(harnessDir, { root }); app.exit(process.exitCode || 0) }
}
app.whenReady().then(main)
