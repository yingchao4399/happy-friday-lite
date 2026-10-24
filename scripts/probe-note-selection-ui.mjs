import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'
import { fileURLToPath } from 'node:url'
import { setDataDir } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import { registerCommands } from '../src-electron/commands.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-note-selection-'))
app.setPath('userData', path.join(dataDir, 'profile'))
app.on('window-all-closed', () => {})
let win, harnessDir
const deadline = setTimeout(() => { console.error('笔记批量界面验收超时'); app.exit(1) }, 90_000)
const harness = `<!doctype html><html lang="zh"><meta charset="utf-8"><body><div id="app"></div><script type="module">
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { i18n } from '/src/i18n/index.js'
import NoteList from '/src/views/note/NoteList.vue'
import '/src/assets/styles/main.css'
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: NoteList }] })
createApp(NoteList).use(createPinia()).use(router).use(i18n).mount('#app')
</script><style>html,body,#app{height:100%;margin:0;background:var(--bg-primary)}</style></body></html>`
const run = code => win.webContents.executeJavaScript(code)
async function until(code) {
  for (let i = 0; i < 120; i++) {
    if (await run(code)) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('未达到界面状态: ' + code)
}
async function click(selector) {
  await run(`(() => { const node=document.querySelector(${JSON.stringify(selector)}); if(!node || node.disabled) throw new Error('控件不可用: ' + ${JSON.stringify(selector)}); node.click() })()`)
}

async function main() {
  try {
    setDataDir(dataDir); db.setDataDir(dataDir); await db.initDb()
    const notes = ['第一篇笔记', '第二篇笔记', '第三篇笔记'].map(title => {
      const note = db.createNote(null, null, title)
      db.updateNote(note.id, title, `<h1 data-note-title="true">${title}</h1><p>验收正文</p>`, '验收正文')
      return note
    })
    const notebook = db.createNotebook('归档笔记本')
    const kbDir = path.join(dataDir, 'knowledge', 'personal', '我的笔记')
    fs.mkdirSync(kbDir, { recursive: true })
    harnessDir = fs.mkdtempSync(path.join(root, '.note-selection-probe-'))
    fs.writeFileSync(path.join(harnessDir, 'index.html'), harness)
    win = new BrowserWindow({ show: false, width: 1120, height: 780, webPreferences: { offscreen: true, backgroundThrottling: false, preload: path.join(root, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } })
    registerCommands(win)
    await win.loadURL(`http://127.0.0.1:5173/${path.basename(harnessDir)}/index.html`)
    await until('document.querySelectorAll(".note-item").length === 3')

    // A real pointer hold on a sidebar row enters selection mode.
    await run(`(() => { const row=document.querySelector('.note-item'); row.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:80,clientY:150})); })()`)
    await until('document.querySelector(".note-selection-toolbar") && document.querySelectorAll(".note-select-check:checked").length === 1')
    await run(`document.querySelector('.note-item').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0}))`)
    await click('.note-selection-toolbar .selection-heading button')
    await until('!document.querySelector(".note-selection-toolbar")')

    await click('button[title="多选笔记"]')
    await until('document.querySelectorAll(".note-select-check").length === 3')
    await click('.note-select-check')
    await run(`document.querySelectorAll('.note-select-check')[1].click()`)
    await until('document.querySelectorAll(".note-select-check:checked").length === 2')
    await click('button[title="置顶或取消置顶选中笔记"]')
    await until('document.querySelectorAll(".note-item .note-pin-btn.active").length === 2')
    assert.equal(db.getNotes().filter(note => note.isPinned).length, 2)

    await click('button[title="全选或取消全选"]')
    await until('document.querySelectorAll(".note-select-check:checked").length === 3')
    await click('button[title="全选或取消全选"]')
    await until('document.querySelectorAll(".note-select-check:checked").length === 0')
    await click('.note-select-check')
    await run(`document.querySelectorAll('.note-select-check')[1].click()`)
    await click('.note-selection-toolbar .friday-select .dropdown-trigger')
    await until('document.querySelectorAll(".note-selection-toolbar [role=option]").length >= 2')
    await run(`[...document.querySelectorAll('.note-selection-toolbar [role=option]')].find(node => node.textContent.includes('归档笔记本')).click()`)
    await until('!document.querySelector(".note-selection-toolbar")')
    assert.equal(db.getNotes().filter(note => note.notebookId === notebook.id).length, 2)

    await click('button[title="多选笔记"]')
    await click('.note-select-check')
    await run(`document.querySelectorAll('.note-select-check')[1].click()`)
    await click('button[title="添加到知识库"]')
    await until('document.querySelector(".kb-dir-dialog .kb-item")')
    await click('.kb-dir-dialog .kb-item')
    await click('.kb-dir-dialog .btn-confirm')
    await until('!document.querySelector(".kb-dir-dialog")')
    assert.equal(fs.readdirSync(kbDir).filter(name => name.endsWith('.note')).length, 2)
    assert.equal(db.queryAllRaw('SELECT COUNT(*) AS count FROM note_resource_links WHERE resourceUri LIKE ?', ['knowledge:%'])[0].count, 2)

    await click('button[title="多选笔记"]')
    await click('button[title="全选或取消全选"]')
    await until('document.querySelectorAll(".note-select-check:checked").length === 3')
    fs.mkdirSync(path.join(root, 'app-data', 'diagnostics'), { recursive: true })
    win.webContents.invalidate?.()
    await new Promise(resolve => setTimeout(resolve, 200))
    fs.writeFileSync(path.join(root, 'app-data', 'diagnostics', 'note-selection-ui.png'), (await win.webContents.capturePage()).toPNG())
    await click('button[title="删除选中笔记"]')
    await until('document.querySelector("[role=dialog]")')
    await run(`document.querySelector('[role=dialog] footer button:last-child').click()`)
    await until('document.querySelectorAll(".note-item").length === 0')
    assert.equal(db.getNotes().length, 0)
    console.log(JSON.stringify({ ok: true, longPress: true, selectAll: true, batchPin: true, batchMove: true, batchKnowledge: true, batchDelete: true }))
  } catch (error) { console.error(error); process.exitCode = 1 }
  finally {
    clearTimeout(deadline)
    db.closeDb()
    if (win && !win.isDestroyed()) win.destroy()
    if (harnessDir) removePathNoFollowSync(harnessDir, { root })
    // Chromium may keep its profile files open until app.exit completes.
    try { removePathNoFollowSync(dataDir, { root: os.tmpdir() }) } catch { /* isolated temp profile */ }
    app.exit(process.exitCode || 0)
  }
}
app.whenReady().then(main)
