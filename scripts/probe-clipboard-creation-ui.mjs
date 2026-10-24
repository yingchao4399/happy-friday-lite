import { app, BrowserWindow, clipboard, nativeImage } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import { setDataDir, saveConfig } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import { registerClipboardCommands, stopClipboardCapture, listClipboardItems, getClipboardOrganization } from '../src-electron/clipboard.js'
import { startShareServer, stopShareServer } from '../src-electron/shareServer.js'

// 隐藏的独立 Chromium 渲染测试，不操作用户窗口或系统剪贴板。
const root = fileURLToPath(new URL('../', import.meta.url))
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-creation-ui-'))
app.setPath('userData', path.join(data, 'profile'))
app.on('window-all-closed', () => {})
let win, harnessDir
const clipboardMethods = Object.fromEntries(['write', 'writeText', 'writeImage', 'readText', 'readHTML', 'readImage'].map(key => [key, clipboard[key]]))
// 此探针只检查创建/多选/合并状态；不改动或读取用户系统剪贴板。
Object.assign(clipboard, { write() {}, writeText() {}, writeImage() {}, readText: () => '', readHTML: () => '', readImage: () => nativeImage.createEmpty() })
const deadline = setTimeout(() => { console.error('剪贴板创建界面验收超时'); app.exit(1) }, 90_000)

const harness = `<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="app"></div><script type="module">
import { createApp } from 'vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import { i18n } from '/src/i18n/index.js'
import ClipboardView from '/src/views/clipboard/ClipboardView.vue'
import '/src/assets/styles/main.css'
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: ClipboardView }] })
createApp(ClipboardView).use(router).use(i18n).mount('#app')
window.creationI18n = i18n
window.creationReady = true
</script><style>html,body,#app{height:100%;width:100%;margin:0}</style></body></html>`

async function run(code) { return win.webContents.executeJavaScript(code) }
async function until(code) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await run(code)) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('未达到界面状态: ' + code)
}
async function click(text, scope = 'document') {
  await run(`(() => { const button = [...${scope}.querySelectorAll('button')].find(n => n.textContent.trim() === ${JSON.stringify(text)}); if (!button || button.disabled) throw new Error('按钮不可用: ' + ${JSON.stringify(text)}); button.click() })()`)
}
async function fill(selector, value) {
  await run(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) throw new Error('缺少输入框'); node.value = ${JSON.stringify(value)}; node.dispatchEvent(new Event('input', { bubbles: true })) })()`)
}
async function visibleButton(text, scope = 'document') {
  assert.equal(await run(`(() => { const n = [...${scope}.querySelectorAll('button')].find(n => n.textContent.trim() === ${JSON.stringify(text)}); if (!n) return false; const r = n.getBoundingClientRect(); return r.width > 20 && r.height > 15 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight })()`), true, '按钮应完整可见: ' + text)
}

async function main() {
try {
  setDataDir(data); db.setDataDir(data); await db.initDb()
  saveConfig({ clipboard: { captureEnabled: false, captureRecordings: false, shortcutEnabled: false } })
  // 先运行 npm run dev；临时入口交给相同 Vite 编译真实组件。
  harnessDir = fs.mkdtempSync(path.join(root, '.clipboard-ui-probe-'))
  fs.writeFileSync(path.join(harnessDir, 'index.html'), harness)
  win = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { offscreen: true, backgroundThrottling: false, preload: path.join(root, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } })
  registerClipboardCommands(win)
  const url = `http://localhost:5173/${path.basename(harnessDir)}/index.html`
  await win.loadURL(url)
  await until('window.creationReady && document.querySelector(".organization-bar")')

  for (const [type, label, value] of [['categories', '新建分类', '创建验收分类'], ['tags', '新建标签', '创建验收标签']]) {
    await visibleButton(label, 'document.querySelector(".create-group-actions")')
    await click(label, 'document.querySelector(".create-group-actions")')
    await until('document.querySelector(".new-group input")')
    await visibleButton(label, 'document.querySelector("[role=dialog]")')
    await fill('.new-group input', value)
    await click(label, 'document.querySelector("[role=dialog]")')
    await until(`document.querySelector('.created-feedback')?.textContent.includes(${JSON.stringify(value)})`)
    assert.ok(getClipboardOrganization()[type].includes(value))
    // 重名必须保留表单并显示错误，不得假装创建成功。
    await fill('.new-group input', value)
    await click(label, 'document.querySelector("[role=dialog]")')
    await until('document.querySelector("[role=dialog] .friday-notice.error") || document.querySelector("[role=dialog]").textContent.includes("已存在")')
    await click('关闭', 'document.querySelector("[role=dialog] footer")')
    await until('!document.querySelector("[role=dialog]")')
  }

  // 原有筛选即使不匹配新条目，保存常用语后也必须直接看到它。
  await fill('input[type=search]', '不会匹配新常用语的筛选')
  await click('新建常用语', 'document.querySelector(".create-group-actions")')
  await until('document.querySelector("textarea")')
  let phrase = '你好，资料已整理，请查收。'
  await fill('textarea', phrase)
  await click('保存', 'document.querySelector("[role=dialog] footer")')
  await until(`!document.querySelector('[role=dialog]') && [...document.querySelectorAll('.clipboard-preview')].some(n=>n.textContent === ${JSON.stringify(phrase)})`)
  assert.equal(await run('document.querySelector("input[type=search]").value'), '')
  assert.ok(listClipboardItems({ view: 'phrases' }).some(n => n.plainText === phrase))
  await run('document.querySelector(".clipboard-row .clipboard-actions button:last-child").click()')
  await until('document.querySelector("[role=menu]")')
  await click('编辑常用语', 'document.querySelector("[role=menu]")')
  await until('document.querySelector("textarea")')
  phrase = '你好，资料已更新，请查收。'
  await fill('textarea', phrase)
  await fill('.field input', '创建验收分类')
  await fill('.tag-entry input', '创建验收标签')
  await click('添加', 'document.querySelector("[role=dialog]")')
  await click('保存', 'document.querySelector("[role=dialog] footer")')
  await until(`!document.querySelector('[role=dialog]') && [...document.querySelectorAll('.clipboard-preview')].some(n=>n.textContent === ${JSON.stringify(phrase)})`)
  const edited = listClipboardItems({ view: 'phrases' }).find(n => n.plainText === phrase)
  assert.deepEqual(edited.tags, ['创建验收标签'])
  assert.equal(edited.category, '创建验收分类')
  await click('剪贴板设置')
  await until('document.querySelector(".setting-row")')
  await click('保存', 'document.querySelector("[role=dialog] footer")')
  await until('!document.querySelector("[role=dialog]")')
  await win.loadURL(url)
  await until(`window.creationReady && [...document.querySelectorAll('.clipboard-preview')].some(n=>n.textContent === ${JSON.stringify(phrase)})`)
  // 大量分类时，滚动列表也不能把创建入口带走；检查窄窗口。
  for (let i = 0; i < 30; i++) await run(`window.electronAPI.invoke('clipboard-group-manage', { type:'categories', action:'create', name:'布局验收${i}' })`)
  await click('刷新')
  for (const width of [1280, 640, 420]) {
    win.setContentSize(width, 620)
    await visibleButton('新建常用语', 'document.querySelector(".create-group-actions")')
    await visibleButton('新建分类', 'document.querySelector(".create-group-actions")')
    await visibleButton('新建标签', 'document.querySelector(".create-group-actions")')
    await click('新建分类', 'document.querySelector(".create-group-actions")')
    await until('document.querySelector(".new-group input")')
    await visibleButton('新建分类', 'document.querySelector("[role=dialog]")')
    await run('document.querySelector(".dialog-body").scrollTop = 10000')
    await visibleButton('新建分类', 'document.querySelector("[role=dialog]")')
    await click('关闭', 'document.querySelector("[role=dialog] footer")')
    await until('!document.querySelector("[role=dialog]")')
  }
  db.closeDb(); await db.initDb()
  assert.ok(listClipboardItems({ view: 'phrases' }).some(n => n.plainText === phrase))
  assert.ok(getClipboardOrganization().tags.includes('创建验收标签'))
  // 次要筛选按需展开，折叠后仍显示可单独移除的已选条件。
  assert.equal(await run('Boolean(document.querySelector(".date-filters"))'), false)
  await click('筛选', 'document.querySelector(".organization-bar")')
  await until('document.querySelector(".group-filters")')
  await run('document.querySelector(".group-filters .dropdown-trigger").click()')
  await click('创建验收分类', 'document.querySelector(".group-filters [role=listbox]")')
  await until('!document.querySelector(".group-filters [role=listbox]")')
  await run('document.querySelectorAll(".group-filters .dropdown-trigger")[1].click()')
  await click('创建验收标签', 'document.querySelector(".group-filters>label:last-child [role=listbox]")')
  await fill('.date-filters label:first-child input', '2020-01-01')
  await fill('.date-filters label:last-child input', '2030-01-01')
  await run('document.querySelector(".filter-toggle").click()')
  await until('document.querySelectorAll(".filter-summary button").length === 4')
  await run('document.querySelector(".filter-summary button").click()')
  await until('document.querySelectorAll(".filter-summary button").length === 3')
  await run('document.querySelector(".filter-toggle").click()')
  await click('清除分类、标签和日期筛选')
  await until('!document.querySelector(".filter-count")')
  await click('筛选', 'document.querySelector(".organization-bar")')
  win.setContentSize(1000, 800)
  const one = await run(`window.electronAPI.invoke('clipboard-phrase-create', {text:'批量验收 第一条',category:'原分类',tags:['原标签']})`)
  const two = await run(`window.electronAPI.invoke('clipboard-phrase-create', {text:'批量验收 第二条'})`)
  const outside = await run(`window.electronAPI.invoke('clipboard-phrase-create', {text:'不属于当前筛选结果'})`)
  await fill('input[type=search]', '批量验收')
  await until('document.querySelectorAll(".clipboard-row").length === 2')
  await click('多选', 'document.querySelector(".create-group-actions")')
  await until('document.querySelectorAll(".row-checkbox").length === 2')
  await run('document.querySelector(".row-checkbox").click()')
  await until('document.querySelector(".selection-count").textContent.includes("1")')
  await run('document.querySelectorAll(".row-checkbox")[1].dispatchEvent(new MouseEvent("click", {bubbles:true,shiftKey:true}))')
  await until('document.querySelector(".selection-count").textContent.includes("2")')
  assert.equal(await run('!!document.querySelector("[role=dialog]")'), false, '选择时不能误打开详情')
  await run('document.querySelector(".row-icon").dispatchEvent(new MouseEvent("click",{bubbles:true}))')
  await until('document.querySelector(".selection-count").textContent.includes("1")')
  assert.equal(await run('!!document.querySelector("[role=dialog]")'), false, '多选时图标和缩略内容的点击应选择条目')
  await click('取消全选', 'document.querySelector(".selection-bar")')
  assert.equal(await run('(() => {const e=new KeyboardEvent("keydown",{key:"a",ctrlKey:true,bubbles:true,cancelable:true});document.querySelector("input[type=search]").dispatchEvent(e);return e.defaultPrevented})()'), false, '输入框中的 Ctrl+A 保持文字全选语义')
  await run('document.querySelector(".clipboard-row").dispatchEvent(new KeyboardEvent("keydown",{key:"a",ctrlKey:true,bubbles:true,cancelable:true}))')
  await until('document.querySelector(".selection-count").textContent.includes("2")')
  for (const width of [1280, 640, 420]) {
    win.setContentSize(width, 800)
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    assert.equal(await run('Boolean(document.querySelector(".batch-actions"))'), false, '未展开时保留记录阅读空间')
    assert.equal(await run('document.querySelector(".clipboard-row").getBoundingClientRect().top < innerHeight / 2'), true, '默认多选模式首条记录应在首屏上半部')
    for (const theme of ['light', 'dark']) {
      await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
      await run('Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished))')
      fs.writeFileSync(path.join(root, 'app-data', 'diagnostics', 'clipboard-density-' + width + '-' + theme + '.png'), (await win.webContents.capturePage()).toPNG())
    }
    await click('更多操作', 'document.querySelector(".selection-bar")')
    for (const button of ['取消全选', '取消收藏', '编辑分类和标签', '合并复制', '批量删除']) await visibleButton(button, 'document.querySelector(".selection-bar")')
    const target = path.join(root, 'app-data', 'diagnostics', 'clipboard-multiselect-' + width + '.png')
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, (await win.webContents.capturePage()).toPNG())
    await click('更多操作', 'document.querySelector(".selection-bar")')
  }
  await run('window.creationI18n.global.locale.value="en-US"')
  await until('document.querySelector(".page-title").textContent === "Clipboard"')
  await run('document.querySelector(".clipboard-page").scrollTop=0;window.scrollTo(0,0)')
  await run('Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished))')
  for (const label of ['New phrase', 'New category', 'New tag', 'Done selecting']) await visibleButton(label, 'document.querySelector(".create-group-actions")')
  for (const label of ['Deselect all', 'More actions']) await visibleButton(label, 'document.querySelector(".selection-bar")')
  assert.equal(await run('document.querySelector(".clipboard-row").getBoundingClientRect().top < innerHeight * .6'), true, '英文窄窗口仍保留首屏记录')
  fs.writeFileSync(path.join(root, 'app-data', 'diagnostics', 'clipboard-density-420-en-dark.png'), (await win.webContents.capturePage()).toPNG())
  await run('window.creationI18n.global.locale.value="zh-CN"')
  await until('document.querySelector(".page-title").textContent === "剪贴板"')
  win.setContentSize(1000, 800)
  await click('更多操作', 'document.querySelector(".selection-bar")')
  await click('取消收藏', 'document.querySelector(".selection-bar")')
  await until('document.querySelector(".selection-count").textContent.includes("0")')
  assert.equal(listClipboardItems().find(item => item.id === one.id).favorite, false)
  assert.equal(listClipboardItems().find(item => item.id === outside.id).favorite, true, '全选仅作用于当前筛选结果')
  await run('document.querySelector(".select-all input").click()')
  await click('编辑分类和标签', 'document.querySelector(".selection-bar")')
  await until('document.querySelector("[role=dialog] .tag-entry")')
  await fill('.field input', '批量分类')
  await fill('.tag-entry input', '新增标签')
  await click('保存', 'document.querySelector("[role=dialog] footer")')
  await until('!document.querySelector("[role=dialog]")')
  assert.deepEqual(listClipboardItems().find(item => item.id === one.id).tags, ['原标签', '新增标签'])
  assert.equal(listClipboardItems().find(item => item.id === two.id).category, '批量分类')
  await run('document.querySelector(".select-all input").click()')
  await click('批量删除', 'document.querySelector(".selection-bar")')
  await until('document.querySelector("[role=dialog]")')
  await click('取消', 'document.querySelector("[role=dialog] footer")')
  assert.ok(listClipboardItems().some(item => item.id === one.id))
  await click('批量删除', 'document.querySelector(".selection-bar")')
  await until('document.querySelector("[role=dialog]")')
  await click('删除', 'document.querySelector("[role=dialog] footer")')
  await until('!document.querySelector("[role=dialog]") && document.querySelectorAll(".clipboard-row").length === 0')
  assert.equal(listClipboardItems().some(item => item.id === one.id || item.id === two.id), false)
  assert.equal(db.queryAllRaw("SELECT id FROM trash_entries WHERE kind='clipboard'").length, 2)
  await assert.rejects(run(`window.electronAPI.invoke('clipboard-batch', {ids:[${JSON.stringify(outside.id)},'missing-id'],action:'unfavorite'})`), /BATCH_STALE/)
  assert.equal(listClipboardItems().find(item => item.id === outside.id).favorite, true, '失效选择不能产生部分写入')
  const limit = await run(`window.electronAPI.invoke('clipboard-phrase-create',{text:'标签上限验收',tags:Array.from({length:20},(_,i)=>'标签'+i)})`)
  await assert.rejects(run(`window.electronAPI.invoke('clipboard-batch',{ids:[${JSON.stringify(outside.id)},${JSON.stringify(limit.id)}],action:'organize',patch:{category:'不应写入',tags:['额外标签']}})`), /TAG_LIMIT/)
  assert.equal(listClipboardItems().find(item => item.id === outside.id).category, '')
  const merged = await run(`window.electronAPI.invoke('clipboard-batch',{ids:[${JSON.stringify(outside.id)},${JSON.stringify(limit.id)}],action:'merge'})`)
  assert.equal(merged.parts.length, 2); assert.equal(merged.sourceApp, 'friday-merge')
  assert.ok(listClipboardItems().some(item => item.id === outside.id), '合并保留原条目')
  await click('完成多选', 'document.querySelector(".create-group-actions")')
  await fill('input[type=search]', '')

  // 真实 IPC、worker、分享 HTTP、二维码图像与撤销流程。
  const folder = path.join(data, '二维码 中文文件夹')
  fs.mkdirSync(folder); fs.writeFileSync(path.join(folder, '笔记.txt'), '真实 Electron worker 打包内容')
  const folderItem = { id:'folder-share-ui', kind:'folder', plainText:'', html:'', filePaths:[folder], imagePaths:[], capturedAt:new Date().toISOString(), sourceApp:'fixture', hash:'folder-share-fixture', tags:[], sensitivity:'normal' }
  db.queryAllRaw('INSERT INTO clipboard_items VALUES (?, ?, ?, ?)', [folderItem.id, JSON.stringify(folderItem), folderItem.capturedAt, null])
  await startShareServer()
  await click('刷新')
  await until('document.body.textContent.includes("二维码 中文文件夹")')
  await run(`(() => {const row=[...document.querySelectorAll('.clipboard-row')].find(n=>n.textContent.includes('二维码 中文文件夹'));row.querySelector('button[aria-label="生成二维码"]').click()})()`)
  await until('document.querySelector(".qr-image")?.naturalWidth > 0 && document.querySelector(".qr-url")?.textContent')
  const shareUrl = await run('document.querySelector(".qr-url").textContent')
  const localUrl = new URL(shareUrl); localUrl.hostname = '127.0.0.1'
  assert.ok((await (await fetch(localUrl)).text()).includes('.zip'))
  const archive = new AdmZip(Buffer.from(await (await fetch(localUrl.href + '/file/0?download=1')).arrayBuffer()))
  assert.equal(archive.readAsText('二维码 中文文件夹/笔记.txt'), '真实 Electron worker 打包内容')
  const screenshot = await win.webContents.capturePage()
  fs.mkdirSync(path.join(root, 'app-data', 'diagnostics'), { recursive:true })
  fs.writeFileSync(path.join(root, 'app-data', 'diagnostics', 'clipboard-folder-qr-ui.png'), screenshot.toPNG())
  await click('停止分享', 'document.querySelector("[role=dialog] footer")')
  await until('document.querySelector("[role=dialog]").textContent.includes("分享已停止") && !document.querySelector(".qr-image")')
  assert.equal((await fetch(localUrl)).status, 404)
  await click('重新生成', 'document.querySelector("[role=dialog]")')
  await until('document.querySelector(".qr-image")?.naturalWidth > 0')
  assert.notEqual(await run('document.querySelector(".qr-url").textContent'), shareUrl)
  await click('关闭', 'document.querySelector("[role=dialog] footer")')
  win.webContents.send('capability-error', { stage:'clipboard-recording', code:'CLIPBOARD_RECORDING_DIRECTORY_MISSING' })
  await until('document.querySelector(".page-notice")?.parentElement.textContent.includes("录屏保存目录不存在")')
  console.log(JSON.stringify({ ok: true, realPreloadAndIPC: true, phraseCreation: true, phraseEditWithTags: true, settingsSave: true, groupsCreation: true, duplicateFeedback: true, reloadPersistence: true, filteredCreation: true, widths: [1280, 640, 420], themes: ['light', 'dark'], compactToolbar: true, firstRecordUpperHalf: true, explicitCreationButtons: true, filterSummary: true, filterRemoval: true, fixedCreateFooter: true, multiSelect: true, filteredSelectAll:true, shiftSelect:true, keyboardSelectAll:true, batchFavorite:true, batchTags:true, batchDeleteAndTrash:true, atomicBatchFailure:true, mergeKeepsOriginals:true, folderQR:true, electronArchiveWorker:true, revokeShare:true, recordingFailureNotice:true }))
} catch (error) { console.error(error); if (win && !win.isDestroyed()) console.error(await run('JSON.stringify({text:document.body.innerText,query:document.querySelector("input[type=search]")?.value})')); process.exitCode = 1 }
finally {
  Object.assign(clipboard, clipboardMethods)
  clearTimeout(deadline); stopShareServer(); stopClipboardCapture(); db.closeDb()
  if (win && !win.isDestroyed()) win.destroy()
  if (harnessDir && path.dirname(harnessDir) === path.resolve(root)) removePathNoFollowSync(harnessDir, { root })
  app.exit(process.exitCode || 0)
}
}
app.whenReady().then(main)
