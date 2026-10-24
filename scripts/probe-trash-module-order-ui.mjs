// 原版 Vue 组件、正式 preload/IPC 与临时数据验收。目录选择只替换原生对话框返回值。
import { app, BrowserWindow, dialog } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'
import { setDataDir, loadConfig, saveConfig } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import { deleteNoteToTrash, deleteResourceToTrash, recordClipboardDeletion, listTrashEntries } from '../src-electron/trash.js'
import { registerCommands } from '../src-electron/commands.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-trash-order-ui-'))
app.setPath('userData', path.join(dataDir, 'profile'))
app.on('window-all-closed', () => {})
let win, harnessDir
let stage = '初始化'
let pickedDirectory = ''
const originalOpenDialog = dialog.showOpenDialog
const deadline = setTimeout(() => { console.error('最近删除/模块排序验收超时: ' + stage); app.exit(1) }, 120_000)
const harness = '<!doctype html><html lang="zh"><meta charset="utf-8"><body><div id="app"></div><script type="module">' +
  "import { createApp,h } from 'vue';import { createPinia } from 'pinia';" +
  "import { createRouter,createMemoryHistory,RouterView } from 'vue-router';" +
  "import { i18n } from '/src/i18n/index.js';import { useAppStore } from '/src/store/index.js';" +
  "import SettingsModules from '/src/views/settings/SettingsModules.vue';import TrashView from '/src/views/trash/TrashView.vue';" +
  "import Sidebar from '/src/components/layout/Sidebar.vue';import '/src/assets/styles/main.css';" +
  "const router=createRouter({history:createMemoryHistory(),routes:[{path:'/',component:SettingsModules},{path:'/trash',component:TrashView}]});" +
  "const pinia=createPinia(),store=useAppStore(pinia),config=await window.electronAPI.invoke('get-config');store.setModuleOrder(config.moduleOrder);store.setSidebarModules(config.sidebarModules);" +
  "createApp({render:()=>h('div',{class:'probe-layout'},[h(Sidebar),h('main',{class:'probe-content'},[h(RouterView)])])}).use(pinia).use(router).use(i18n).mount('#app');" +
  "window.probeNavigate=path=>router.push(path);window.probeLanguage=value=>i18n.global.locale.value=value;window.probeReady=true;" +
  '</script><style>html,body,#app,.probe-layout{height:100%;margin:0}.probe-layout{display:flex}.probe-content{flex:1;min-width:0;height:100%;overflow:auto}</style></body></html>'
async function run(code) {
  try { return await win.webContents.executeJavaScript(code) }
  catch (error) { console.error('Renderer expression:', code); throw error }
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function reload() {
  const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve))
  win.reload()
  await loaded
}
async function until(code) {
  for (let i = 0; i < 150; i++) { if (await run(code)) return; await pause(50) }
  throw new Error(stage + ' 未达到界面状态: ' + code)
}
async function click(selector) {
  const result = await run('(() => {try {const node=document.querySelector(' + JSON.stringify(selector) + ');if(!node||node.disabled)throw new Error("控件不可用");node.click();return {ok:true}} catch(error) {return {ok:false,message:String(error),stack:error?.stack}}})()')
  if (!result.ok) throw new Error(result.stack || result.message)
}
async function clickText(selector, text) {
  await run('(() => {const node=[...document.querySelectorAll(' + JSON.stringify(selector) + ')].find(n=>n.textContent.trim()===' + JSON.stringify(text) + ');if(!node||node.disabled)throw new Error("文案控件不可用");node.click()})()')
}
async function input(selector, text) {
  await run('(() => {const node=document.querySelector(' + JSON.stringify(selector) + ');node.value=' + JSON.stringify(text) + ';node.dispatchEvent(new Event("input",{bubbles:true}))})()')
}
const rowSelector = title => '.trash-row:has(input[aria-label=' + JSON.stringify('选择 ' + title) + '])'
async function screenshot(name) {
  const directory = path.join(root, 'app-data', 'diagnostics')
  fs.mkdirSync(directory, { recursive: true })
  win.webContents.invalidate?.()
  await pause(180)
  fs.writeFileSync(path.join(directory, name + '.png'), (await win.webContents.capturePage()).toPNG())
}
function markClipboard(id, text, expired = false) {
  const stamp = new Date().toISOString()
  const item = { id, kind: expired ? 'secret' : 'text', plainText: expired ? 'enc:acceptance-fixture' : text, sensitivity: expired ? 'secret' : 'normal', capturedAt: stamp, deletedAt: stamp, expiresAt: expired ? new Date(0).toISOString() : null }
  db.queryAllRaw('INSERT INTO clipboard_items VALUES (?, ?, ?, ?)', [id, JSON.stringify(item), stamp, stamp])
  recordClipboardDeletion(item)
}
function notifyTrash() { win.webContents.send('trash-changed', {}) }

async function main() {
  let ok = false
  try {
    setDataDir(dataDir); db.setDataDir(dataDir); await db.initDb()
    const config = loadConfig(); config.moduleOrder = ['harness', 'note']; saveConfig(config)
    harnessDir = fs.mkdtempSync(path.join(root, '.trash-order-probe-'))
    fs.writeFileSync(path.join(harnessDir, 'index.html'), harness)
    win = new BrowserWindow({ show: false, width: 1100, height: 820, webPreferences: { offscreen: true, backgroundThrottling: false, preload: path.join(root, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } })
    registerCommands(win)
    dialog.showOpenDialog = async () => pickedDirectory ? { canceled: false, filePaths: [pickedDirectory] } : { canceled: true, filePaths: [] }
    const url = 'http://127.0.0.1:5173/' + path.basename(harnessDir) + '/index.html'
    await win.loadURL(url)
    await until('window.probeReady && document.querySelectorAll(".module-order-row").length===9')
    const names = () => run('[...document.querySelectorAll(".module-order-label")].map(n=>n.textContent)')
    assert.deepEqual((await names()).slice(0, 3), ['DeepSeek Harness', '笔记', '绘图'])
    // 不完整旧顺序会按稳定默认位置追加新模块。
    assert.deepEqual((await names()).slice(-2), ['背诵分析', '剪贴板'])
    stage = 'Office 模块显隐与准确计数'
    assert.equal(await run('document.querySelector(".preview-count").textContent.includes("11/11")'), true)
    await click('.preview-item-office')
    await until(`!document.querySelector('.sidebar-menu a[href="/office"]')`)
    assert.equal(loadConfig().sidebarModules.office, false)
    assert.equal(await run('document.querySelector(".preview-count").textContent.includes("10/11")'), true)
    await reload()
    await until('window.probeReady && document.querySelector(".preview-item-office")?.classList.contains("off")')
    assert.equal(await run(`!!document.querySelector('.sidebar-menu a[href="/office"]')`), false)
    await click('.preview-actions button')
    await until(`document.querySelector('.sidebar-menu a[href="/office"]') && document.querySelector('.preview-count').textContent.includes('11/11')`)
    assert.equal(loadConfig().sidebarModules.office, true)
    stage = '键盘调整模块顺序'
    win.webContents.focus()
    await run('document.querySelector(".module-order-row button:last-child").focus()')
    assert.equal(await run('document.activeElement===document.querySelector(".module-order-row button:last-child")'), true)
    await run('window.probeKeys=[];for(const type of ["keydown","keyup","click"])document.addEventListener(type,event=>window.probeKeys.push({type:event.type,key:event.key,target:event.target.className}),true)')
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' })
    await pause(100)
    console.log(JSON.stringify({ moduleKeyboardEvents: await run('window.probeKeys') }))
    await until('document.querySelector(".module-order-label").textContent==="笔记"')
    assert.equal(loadConfig().moduleOrder[0], 'note')
    assert.deepEqual(db.queryAllRaw('SELECT moduleId FROM module_order ORDER BY position').map(row => row.moduleId), loadConfig().moduleOrder)
    const movedOrder = [...loadConfig().moduleOrder]
    stage = '拖拽模块事件和持久化'
    await run('(() => {const rows=document.querySelectorAll(".module-order-row"),handle=rows[2].querySelector(".drag-handle"),data=new DataTransfer();handle.dispatchEvent(new DragEvent("dragstart",{bubbles:true,dataTransfer:data}));rows[0].dispatchEvent(new DragEvent("drop",{bubbles:true,dataTransfer:data}));handle.dispatchEvent(new DragEvent("dragend",{bubbles:true,dataTransfer:data}))})()')
    await until('document.querySelector(".module-order-label").textContent==="绘图"')
    assert.equal(loadConfig().moduleOrder[0], 'drawing')
    assert.notDeepEqual(loadConfig().moduleOrder, movedOrder)
    const savedOrder = [...loadConfig().moduleOrder]
    await reload()
    await until('window.probeReady && document.querySelector(".module-order-label")?.textContent==="绘图"')
    assert.deepEqual(await run('[...document.querySelectorAll(".sidebar-menu a")].map(n=>n.getAttribute("href"))'), savedOrder.map(id => '/' + id))
    await run('window.probeLanguage("en-US")')
    await until('document.querySelector(".module-order-label")?.textContent==="Drawing"')
    assert.deepEqual(loadConfig().moduleOrder, savedOrder)
    stage = '模块顺序参数保护'
    assert.equal(await run('window.electronAPI.invoke("module-order-save",{ids:["笔记"]}).then(()=>false,()=>true)'), true)
    assert.deepEqual(loadConfig().moduleOrder, savedOrder)
    await run('window.probeLanguage("zh-CN")')
    await click('.module-order-panel .setting-row > button')
    await until('document.querySelector(".module-order-label")?.textContent==="笔记"')
    assert.deepEqual(loadConfig().moduleOrder, [])
    assert.deepEqual(db.queryAllRaw('SELECT * FROM module_order'), [])
    await screenshot('module-order-light')

    stage = '最近删除夹具'
    const note = db.createNote(null, null, '待恢复笔记')
    db.updateNote(note.id, note.title, '<p>保留原笔记正文</p>', '保留原笔记正文')
    db.setNotePinned(note.id, true)
    const kb = path.join(dataDir, 'knowledge', 'personal', '验收知识库')
    fs.mkdirSync(kb, { recursive: true })
    const reference = path.join(kb, 'note.note')
    fs.writeFileSync(reference, JSON.stringify({ noteId: note.id, title: note.title }))
    deleteNoteToTrash(note.id)
    const oldBook = db.createNotebook('删除的笔记本')
    const orphan = db.createNote(null, oldBook.id, '原位置缺失笔记')
    db.updateNote(orphan.id, orphan.title, '<p>需要新位置</p>', '需要新位置')
    deleteNoteToTrash(orphan.id)
    db.deleteNotebook(oldBook.id)
    db.queryAllRaw('UPDATE notes SET notebookId = ? WHERE id = ?', [oldBook.id, orphan.id])
    const folder = path.join(kb, '待恢复资料')
    fs.mkdirSync(folder)
    fs.writeFileSync(path.join(folder, '内容.txt'), '文件夹正文')
    deleteResourceToTrash(folder)
    markClipboard('clip-normal', '待恢复剪贴板')
    markClipboard('clip-expired', '', true)
    await run('window.probeNavigate("/trash")')
    await until('document.querySelectorAll(".trash-row").length===5')
    assert.equal(await run('document.querySelector(".trash-row:has(.row-meta span:last-child) .row-actions button")!==null'), true)
    assert.equal(await run('[...document.querySelectorAll(".trash-row")].find(n=>n.textContent.includes("已过期，无法恢复")).querySelector(".row-actions button").disabled'), true)
    stage = '搜索与类型过滤'
    await input('.search-box input', '待恢复笔记')
    await until('document.querySelectorAll(".trash-row").length===1')
    await click('.search-box button')
    await until('document.querySelectorAll(".trash-row").length===5')
    await click('.filter-bar .dropdown-trigger')
    await clickText('.filter-bar [role=option]', '知识库资源')
    await until('document.querySelectorAll(".trash-row").length===1')
    assert.equal(await run('document.querySelector(".trash-row h2").textContent'), '待恢复资料')
    await click('.filter-bar .dropdown-trigger')
    await clickText('.filter-bar [role=option]', '全部类型')
    await until('document.querySelectorAll(".trash-row").length===5')
    await screenshot('trash-list-light')
    stage = '三类型批量恢复'
    for (const title of ['待恢复笔记', '待恢复资料', '待恢复剪贴板']) await click(rowSelector(title) + ' > input')
    await click('.batch-bar button:not(.danger)')
    await until('document.querySelectorAll(".trash-row").length===2')
    assert.equal(db.getNote(note.id).contentText, '保留原笔记正文')
    assert.equal(db.getNote(note.id).isPinned, true)
    assert.ok(fs.existsSync(reference))
    assert.equal(fs.readFileSync(path.join(folder, '内容.txt'), 'utf8'), '文件夹正文')
    assert.equal(db.queryAllRaw('SELECT deletedAt FROM clipboard_items WHERE id = ?', ['clip-normal'])[0].deletedAt, null)
    stage = '原位置缺失确认与取消'
    await click(rowSelector('原位置缺失笔记') + ' .row-actions button')
    await until('document.querySelector("[role=dialog]")')
    await click('[role=dialog] footer button:first-child')
    await until('!document.querySelector("[role=dialog]")')
    assert.equal(db.getNote(orphan.id), null)
    await click(rowSelector('原位置缺失笔记') + ' .row-actions button')
    await until('document.querySelector("[role=dialog]")')
    await click('[role=dialog] footer button:last-child')
    await until('document.querySelectorAll(".trash-row").length===1')
    assert.equal(db.getNote(orphan.id).notebookId, null)
    stage = '冲突目标和恢复到其他位置'
    deleteResourceToTrash(folder)
    fs.mkdirSync(folder)
    fs.writeFileSync(path.join(folder, '原目标.txt'), '不能覆盖')
    notifyTrash()
    await until('document.querySelectorAll(".trash-row").length===2')
    await click(rowSelector('待恢复资料') + ' .row-actions button')
    await until('document.querySelector("[role=status]")?.textContent.includes("目标已有同名资源")')
    assert.equal(fs.readFileSync(path.join(folder, '原目标.txt'), 'utf8'), '不能覆盖')
    pickedDirectory = path.join(dataDir, 'alternate'); fs.mkdirSync(pickedDirectory)
    await click(rowSelector('待恢复资料') + ' button[title="恢复到其他位置"]')
    await until('document.querySelectorAll(".trash-row").length===1')
    assert.equal(fs.readFileSync(path.join(pickedDirectory, '待恢复资料', '内容.txt'), 'utf8'), '文件夹正文')
    stage = '导出副本和永久删除确认'
    deleteNoteToTrash(note.id); notifyTrash()
    await until('document.querySelectorAll(".trash-row").length===2')
    await click(rowSelector('待恢复笔记') + ' button[title="导出副本"]')
    await until('document.querySelector("[role=status]")?.textContent.includes("已导出到")')
    assert.equal(fs.readFileSync(path.join(pickedDirectory, '待恢复笔记.txt'), 'utf8'), '保留原笔记正文')
    await click(rowSelector('待恢复笔记') + ' button[title="永久删除"]')
    await until('document.querySelector("[role=dialog]")')
    await click('[role=dialog] footer button:first-child')
    await until('!document.querySelector("[role=dialog]")')
    assert.ok(listTrashEntries().some(row => row.resourceId === note.id))
    win.setSize(640, 720)
    await run('document.documentElement.setAttribute("data-theme","dark");document.body.setAttribute("data-theme","dark")')
    await screenshot('trash-list-dark-narrow')
    assert.equal(await run('[...document.querySelectorAll(".trash-row")].every(n=>n.getBoundingClientRect().right<=innerWidth+1)'), true)
    await click('.history-header > button')
    await until('document.querySelector("[role=dialog]")')
    await click('[role=dialog] footer button:last-child')
    await until('document.querySelectorAll(".trash-row").length===0')
    assert.equal(listTrashEntries().length, 0)
    assert.equal(db.queryAllRaw('SELECT * FROM notes WHERE id = ?', [note.id]).length, 0)
    const audit = fs.readFileSync(path.join(dataDir, 'recently-deleted', 'audit.jsonl'), 'utf8')
    assert.equal(audit.includes('保留原笔记正文'), false)
    assert.equal(audit.split('\n').filter(line => line.includes('permanent-delete-completed')).length, 2)
    console.log(JSON.stringify({ ok: true, realPreloadIPC: true, officeModuleToggleReload: true, accurateModuleCount: true, moduleKeyboard: true, moduleDragEvents: true, orderReloadAndLanguage: true, stableIds: true, newModulesAppended: true, resetOrder: true, trashSearchAndKind: true, batchRestoreThreeTypes: true, missingNotebookConfirmCancel: true, conflictProtected: true, alternativeTarget: true, exportCopy: true, permanentCancelAndEmptyAll: true, auditWithoutBody: true, narrowDark: true, directoryPickerStubbed: true }))
    ok = true
  } catch (error) { console.error('阶段: ' + stage); console.error(error) }
  finally {
    clearTimeout(deadline)
    dialog.showOpenDialog = originalOpenDialog
    db.closeDb()
    if (win && !win.isDestroyed()) win.destroy()
    if (harnessDir) removePathNoFollowSync(harnessDir, { root })
    try { removePathNoFollowSync(dataDir, { root: os.tmpdir() }) } catch { /* Chromium 退出后释放 profile。 */ }
    app.exit(ok ? 0 : 1)
  }
}
app.whenReady().then(main)
