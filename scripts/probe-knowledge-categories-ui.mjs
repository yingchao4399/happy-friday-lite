import { app, BrowserWindow, ipcMain } from 'electron'
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
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-kb-ui-'))
app.setPath('userData', path.join(dataDir, 'profile'))
app.on('window-all-closed', () => {})
let win, harnessDir
let stage = 'initializing'
const deadline = setTimeout(() => { console.error('知识库分类界面验收超时'); app.exit(1) }, 60_000)
const harness = `<!doctype html><html lang="zh"><meta charset="utf-8"><body><div id="app"></div><script type="module">
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { i18n } from '/src/i18n/index.js'
import KnowledgeList from '/src/views/knowledge/KnowledgeList.vue'
import '/src/assets/styles/main.css'
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: KnowledgeList }] })
createApp(KnowledgeList).use(createPinia()).use(router).use(i18n).mount('#app')
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
  await run(`(() => { const node=document.querySelector(${JSON.stringify(selector)}); if(!node) throw new Error('缺少控件: ' + ${JSON.stringify(selector)}); node.click() })()`)
}

async function main() {
  try {
    setDataDir(dataDir); db.setDataDir(dataDir); await db.initDb()
    harnessDir = fs.mkdtempSync(path.join(root, '.kb-category-probe-'))
    fs.writeFileSync(path.join(harnessDir, 'index.html'), harness)
    win = new BrowserWindow({ show: false, width: 1080, height: 740, webPreferences: { offscreen: true, backgroundThrottling: false, preload: path.join(root, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } })
    registerCommands(win)
    ipcMain.handle('kb-watch-current-dir', () => ({ success: true }))
    await win.loadURL(`http://127.0.0.1:5173/${path.basename(harnessDir)}/index.html`)
    await until('document.querySelector(".kb-sidebar .category-group")')
    await click('button[title="新建分类"]')
    stage = 'creating first category'
    await until('document.querySelector(".new-folder-dialog input")')
    await run(`(() => { const input=document.querySelector('.new-folder-dialog input'); input.value='项目资料'; input.dispatchEvent(new Event('input',{bubbles:true})) })()`)
    await click('.new-folder-dialog .kb-btn-confirm')
    await until(`[...document.querySelectorAll('.kb-sidebar .category-name')].some(node => node.textContent === '项目资料')`)
    const created = await run(`window.electronAPI.invoke('kb-list-categories')`)
    assert.equal(created.data[0].name, '项目资料')
    const categoryId = created.data[0].id
    await run(`(() => { const row=[...document.querySelectorAll('.category-group')].find(node=>node.querySelector('.category-name')?.textContent==='项目资料'); row.querySelector('button[title="添加知识库"]').click() })()`)
    stage = 'creating knowledge base'
    await until('document.querySelector(".create-kb-dialog input")')
    await run(`(() => { const input=document.querySelector('.create-kb-dialog input'); input.value='工作文档'; input.dispatchEvent(new Event('input',{bubbles:true})) })()`)
    await click('.create-kb-dialog .kb-btn-confirm')
    await until(`[...document.querySelectorAll('.kb-item .item-name')].some(node => node.textContent === '工作文档')`)
    assert.equal(fs.existsSync(path.join(dataDir, 'knowledge', categoryId, '工作文档')), true)
    await run(`(() => { const row=[...document.querySelectorAll('.category-group')].find(node=>node.querySelector('.category-name')?.textContent==='项目资料'); row.querySelector('button[title="管理分类"]').click() })()`)
    stage = 'renaming category'
    await until(`[...document.querySelectorAll('.context-menu-item')].some(node=>node.textContent.includes('重命名分类'))`)
    await run(`[...document.querySelectorAll('.context-menu-item')].find(node=>node.textContent.includes('重命名分类')).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`)
    await until('document.querySelector(".new-folder-dialog input")')
    await run(`(() => { const input=document.querySelector('.new-folder-dialog input'); input.value='项目归档'; input.dispatchEvent(new Event('input',{bubbles:true})) })()`)
    await click('.new-folder-dialog .kb-btn-confirm')
    await until(`[...document.querySelectorAll('.kb-sidebar .category-name')].some(node => node.textContent === '项目归档')`)
    assert.equal((await run(`window.electronAPI.invoke('kb-list-categories')`)).data[0].id, categoryId)
    await click('button[title="新建分类"]')
    stage = 'creating second category'
    await until('document.querySelector(".new-folder-dialog input")')
    await run(`(() => { const input=document.querySelector('.new-folder-dialog input'); input.value='目标分类'; input.dispatchEvent(new Event('input',{bubbles:true})) })()`)
    await click('.new-folder-dialog .kb-btn-confirm')
    await until(`[...document.querySelectorAll('.kb-sidebar .category-name')].some(node => node.textContent === '目标分类')`)
    const targetId = (await run(`window.electronAPI.invoke('kb-list-categories')`)).data.find(item => item.name === '目标分类').id
    await run(`(() => { const row=[...document.querySelectorAll('.kb-item')].find(node=>node.querySelector('.item-name')?.textContent==='工作文档'); row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:140,clientY:240})) })()`)
    stage = 'opening move dialog'
    await until(`[...document.querySelectorAll('.context-menu-item')].some(node=>node.textContent.includes('移动到分类'))`)
    await run(`[...document.querySelectorAll('.context-menu-item')].find(node=>node.textContent.includes('移动到分类')).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`)
    await until('!!document.querySelector(".category-select")')
    await run(`(() => { const select=document.querySelector('.category-select'); select.value=${JSON.stringify(targetId)}; select.dispatchEvent(new Event('change',{bubbles:true})) })()`)
    await run(`document.querySelector('.build-index-footer button:last-child').click()`)
    stage = 'moving knowledge base'
    await until(`!document.querySelector('.category-select')`)
    assert.equal(fs.existsSync(path.join(dataDir, 'knowledge', targetId, '工作文档')), true)
    await run(`(() => { const row=[...document.querySelectorAll('.category-group')].find(node=>node.querySelector('.category-name')?.textContent==='项目归档'); row.querySelector('button[title="管理分类"]').click() })()`)
    await until(`[...document.querySelectorAll('.context-menu-item')].some(node=>node.textContent.includes('删除分类'))`)
    await run(`[...document.querySelectorAll('.context-menu-item')].find(node=>node.textContent.includes('删除分类')).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`)
    await until('!!document.querySelector(".dialog-card")')
    await click('.dialog-card .confirm-btn')
    await until(`![...document.querySelectorAll('.kb-sidebar .category-name')].some(node => node.textContent === '项目归档')`)
    const trash = await run(`window.electronAPI.invoke('trash-list')`)
    const deleted = trash.find(item => item.originalPath?.endsWith(categoryId))
    assert.ok(deleted)
    assert.equal(deleted.title, '项目归档')
    const restored = await run(`window.electronAPI.invoke('trash-restore', { ids: [${JSON.stringify(deleted.id)}] })`)
    assert.equal(restored.results[0].ok, true)
    await until(`[...document.querySelectorAll('.kb-sidebar .category-name')].some(node => node.textContent === '项目归档')`)
    fs.mkdirSync(path.join(root, 'app-data', 'diagnostics'), { recursive: true })
    fs.writeFileSync(path.join(root, 'app-data', 'diagnostics', 'knowledge-categories-ui.png'), (await win.webContents.capturePage()).toPNG())
    console.log(JSON.stringify({ ok: true, categoryCreate: true, knowledgeBaseCreate: true, rename: true, stableId: true, knowledgeBaseMove: true, categoryDeleteRestore: true }))
  } catch (error) { console.error(`Probe stage: ${stage}`, error); process.exitCode = 1 }
  finally {
    clearTimeout(deadline)
    db.closeDb()
    if (win && !win.isDestroyed()) win.destroy()
    if (harnessDir) removePathNoFollowSync(harnessDir, { root })
    try { removePathNoFollowSync(dataDir, { root: os.tmpdir() }) } catch { /* isolated temp profile */ }
    app.exit(process.exitCode || 0)
  }
}
app.whenReady().then(main)
