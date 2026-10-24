// 真实独立 Electron 钉窗与正式 preload/IPC，测试窗口隐藏，不占用用户鼠标或系统剪贴板。
import electron from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'
import { setDataDir, saveConfig, loadConfig } from '../src-electron/config.js'
import { storeClipboardPng } from '../src-electron/clipboard-media.js'
import * as db from '../src-electron/db.js'

const root = fileURLToPath(new URL('../', import.meta.url))
if (!process.versions.electron) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-clipboard-pins-'))
  try {
    const env = { ...process.env, FRIDAY_CLIPBOARD_PINS_PROBE: directory }; delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(electron, [fileURLToPath(import.meta.url)], { env, stdio: 'inherit' })
    process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)) })
  } finally { removePathNoFollowSync(directory, { root: os.tmpdir() }) }
  process.exit(process.exitCode || 0)
}
const { app, BrowserWindow, ipcMain, screen } = electron
const { registerClipboardCommands, stopClipboardCapture, updateClipboardItem, deleteClipboardItems, getClipboardImage, saveClipboardImage } = await import('../src-electron/clipboard.js')
const data = process.env.FRIDAY_CLIPBOARD_PINS_PROBE
assert.ok(data && path.basename(data).startsWith('friday-clipboard-pins-'))
app.setPath('userData', path.join(data, 'profile'))
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.on('window-all-closed', () => {})
app.on('browser-window-created', (_event, window) => { window.show = () => {}; window.focus = () => {}; window.webContents.on('render-process-gone', (_event, details) => console.error('钉窗渲染进程退出', details.reason)) })
let main, harnessDir
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const run = (window, code) => window.webContents.executeJavaScript(code, true)
async function until(check, label) {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) { if (await check()) return; await sleep(50) }
  throw new Error('钉窗验收超时: ' + label)
}
async function click(window, label) {
  await run(window, `(()=>{const button=[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===${JSON.stringify(label)} || node.title===${JSON.stringify(label)});if(!button||button.disabled)throw new Error('按钮不可用');button.click()})()`)
}
const state = window => run(window, `window.electronAPI.invoke('clipboard-pin-state')`)
const itemById = id => JSON.parse(db.queryAllRaw('SELECT payload FROM clipboard_items WHERE id=?', [id])[0].payload)
async function open(id, expanded = false) {
  await run(main, `window.electronAPI.invoke('clipboard-pin-open',{id:${JSON.stringify(id)},expanded:${expanded}})`)
  const window = BrowserWindow.getAllWindows().find(window => window !== main && window.webContents.getURL().includes('/clipboard-pin/' + id))
  assert.ok(window)
  await until(() => run(window, 'Boolean(document.querySelector(".pin-meta"))'), '钉窗载入')
  return window
}
async function menu(window) {
  await run(window, `document.querySelector('main').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:90}))`)
  await until(() => run(window, 'Boolean(document.querySelector("[role=menu]"))'), '原右键菜单')
}

app.whenReady().then(async () => {
  let ok = false
  const deadline = setTimeout(() => { console.error('钉窗全流程超时'); app.exit(1) }, 240000)
  try {
    setDataDir(data); db.setDataDir(data); await db.initDb()
    saveConfig({ language: 'zh-CN', clipboard: { captureEnabled: false, captureRecordings: false, shortcutEnabled: false, trayEnabled: false } })
    ipcMain.handle('get-config', () => loadConfig())
    const mediaDir = path.join(data, 'clipboard-media'); fs.mkdirSync(mediaDir)
    const { imagePath: png } = await storeClipboardPng(await sharp({ create: { width: 240, height: 120, channels: 4, background: '#3582a3' } }).png().toBuffer(), mediaDir)
    for (const item of [{ id: 'text', kind: 'text', plainText: '钉窗长内容验收\n' + '学习需要主动回忆，记录要点和出处。\n'.repeat(30), note: '初始备注' }, { id: 'image', kind: 'image', imagePath: png, imagePaths: [png], plainText: '' }]) {
      Object.assign(item, { sourceApp: 'Synthetic pin fixture', hash: item.id, capturedAt: new Date().toISOString(), sensitivity: 'normal', filePaths: [], tags: [] })
      db.queryAllRaw('INSERT INTO clipboard_items VALUES (?,?,?,?)', [item.id, JSON.stringify(item), item.capturedAt, null])
    }
    harnessDir = fs.mkdtempSync(path.join(root, '.clipboard-pins-probe-'))
    fs.writeFileSync(path.join(harnessDir, 'index.html'), `<!doctype html><html><meta charset="utf-8"><body><div id="app"></div><script type="module">
      import {createApp} from 'vue';import {i18n} from '/src/i18n/index.js';import ClipboardPinned from '/src/views/clipboard/ClipboardPinned.vue';import '/src/assets/styles/main.css';
      createApp(location.hash.startsWith('#/clipboard-pin/')?ClipboardPinned:{template:'<div>Pin probe host</div>'}).use(i18n).mount('#app');
      </script><style>html,body,#app{height:100%;margin:0}</style></html>`)
    main = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } })
    registerClipboardCommands(main)
    console.log('钉窗验收阶段：载入独立宿主')
    await main.loadURL('http://127.0.0.1:5173/' + path.basename(harnessDir) + '/index.html')
    console.log('钉窗验收阶段：打开缩略钉窗')
    const text = await open('text')
    // Windows 隐藏窗口不提供可验证的实际置顶状态，不能用构造参数替代原生验收。
    assert.equal((await state(text)).expanded, false)
    assert.ok(await run(text, 'document.querySelector(".compact-text").textContent.includes("钉窗长内容验收")'))
    assert.equal(await run(text, `getComputedStyle(document.querySelector('.pin-title')).webkitAppRegion`), 'drag')
    assert.equal(await run(text, `getComputedStyle(document.querySelector('.pin-title>div')).webkitAppRegion`), 'no-drag')
    const count = BrowserWindow.getAllWindows().length
    await open('text', true)
    console.log('钉窗验收阶段：复用并展开')
    assert.equal(BrowserWindow.getAllWindows().length, count, '同条目复用钉窗')
    assert.equal((await state(text)).expanded, true)
    await until(() => run(text, 'Boolean(document.querySelector(".expanded-text"))'), '复用钉窗的展开模式同步')
    await click(text, '缩略')
    await until(async () => (await state(text)).expanded === false, '收起')
    await menu(text)
    assert.equal((await state(text)).expanded, true, '缩略右键自动展开菜单')
    assert.equal(await run(text, 'document.querySelector("[role=menu]").textContent.includes("钉到屏幕")'), false, '已经钉到屏幕的窗口不显示无动作的重复钉窗命令')
    await click(text, '收藏')
    await until(() => itemById('text').favorite === true, '收藏持久化')
    await menu(text)
    await until(() => run(text, 'document.querySelector("[role=menu]")?.textContent.includes("取消收藏")'), '菜单同步最新收藏状态')
    await run(text, 'document.querySelector("[role=menu]").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))')
    await until(() => run(text, '!document.querySelector("[role=menu]")'), 'Esc关闭菜单')
    updateClipboardItem('text', { note: '跨窗口更新后的备注' })
    await until(() => run(text, 'document.querySelector(".memo")?.textContent.includes("跨窗口更新")'), '条目变化自动刷新')
    const area = screen.getDisplayMatching(text.getBounds()).workArea
    text.setPosition(area.x + area.width - 80, area.y + area.height - 60)
    await click(text, '缩略')
    await click(text, '展开')
    const bounds = text.getBounds()
    assert.ok(bounds.x >= area.x && bounds.y >= area.y && bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height, '展开后保留在屏幕工作区内')
    const image = await open('image')
    await until(() => run(image, 'document.querySelector(".pin-thumbnail img")?.naturalWidth>0'), '真实图片缩略图')
    // 延迟旧缩略图响应，再从另一窗口保存新图，确保旧异步请求不能覆盖新状态。
    let entered, release
    const oldRequest = new Promise(resolve => { entered = resolve })
    let delayNext = true
    ipcMain.removeHandler('clipboard-image')
    ipcMain.handle('clipboard-image', async (_event, args) => {
      const result = await getClipboardImage(args)
      if (delayNext) { delayNext = false; entered(); await new Promise(resolve => { release = resolve }) }
      return result
    })
    const oldImage = await getClipboardImage({ id: 'image', thumbnail: false })
    updateClipboardItem('image', { note: '触发旧缩略图请求' })
    await oldRequest
    const newPng = 'data:image/png;base64,' + (await sharp({ create: { width: 240, height: 120, channels: 4, background: '#cc3421' } }).png().toBuffer()).toString('base64')
    await saveClipboardImage({ id: 'image', dataUrl: newPng, baseHash: oldImage.contentHash })
    await until(() => run(image, `document.querySelector('.pin-thumbnail img')?.src===${JSON.stringify(newPng)}`), '新图片先刷新')
    release(); await sleep(150)
    assert.equal(await run(image, 'document.querySelector(".pin-thumbnail img").src'), newPng, '旧缩略图不得覆盖新图')
    await run(image, 'document.querySelector(".pin-thumbnail").click()')
    await until(() => run(image, 'document.querySelector(".image-entry .thumbnail img")?.naturalWidth>0'), '图片展开后原预览组件')
    await click(text, '剪贴板内容')
    await until(() => run(text, 'Boolean(document.querySelector("[role=dialog]"))'), '详情弹窗')
    const field = await run(text, 'document.querySelector(".memo-field textarea").value')
    assert.equal(field, '跨窗口更新后的备注')
    await run(text, `document.documentElement.setAttribute('data-theme','dark')`)
    await sleep(350)
    const dialogBounds = await run(text, `(()=>{const dialog=document.querySelector('[role=dialog]'),r=dialog.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,background:getComputedStyle(dialog).backgroundColor}})()`)
    assert.ok(dialogBounds.left >= 0 && dialogBounds.right <= dialogBounds.width && dialogBounds.top >= 0 && dialogBounds.bottom <= dialogBounds.height)
    assert.notEqual(dialogBounds.background, 'rgb(255, 255, 255)')
    text.webContents.debugger.attach('1.3')
    const screenshot = await text.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true })
    text.webContents.debugger.detach()
    fs.writeFileSync(path.join(root, 'app-data/diagnostics/clipboard-pin-detail-dark.png'), Buffer.from(screenshot.data, 'base64'))
    deleteClipboardItems(['text'])
    await until(() => text.isDestroyed(), '原条目删除后关闭钉窗')
    await run(image, `window.electronAPI.invoke('clipboard-pin-close')`).catch(() => {})
    await until(() => image.isDestroyed(), '关闭图像钉窗')
    assert.equal(BrowserWindow.getAllWindows().length, 1)
    console.log(JSON.stringify({ ok: true, realVuePreloadIPC: true, actualIndependentWindows: true, hiddenWindows: true, nativeDragRegionConfigured: true, collapsedExpandedReuseSynced: true, compactContextMenu: true, favoritePersisted: true, escape: true, crossWindowRefresh: true, workAreaBounds: true, actualImageThumbnail: true, staleThumbnailBlocked: true, detailMemoAndDark: true, deletionClosesWindow: true, noWindowLeak: true, actualAlwaysOnTop: 'not-verified', physicalMouseDrag: false }))
    ok = true
  } catch (error) { console.error(error) }
  finally {
    clearTimeout(deadline); stopClipboardCapture(); db.closeDb()
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.destroy()
    if (harnessDir) removePathNoFollowSync(harnessDir, { root })
    app.exit(ok ? 0 : 1)
  }
})
