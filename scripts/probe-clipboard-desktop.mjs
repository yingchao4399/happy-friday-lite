import { app, BrowserWindow, ipcMain } from 'electron'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createClipboardDesktop } from '../src-electron/clipboard-desktop.js'
import { createWindowsPasteAdapter } from '../src-electron/windows-paste.js'

// 使用假的目标/发送适配器和隐藏的真实渲染窗口，不对用户前台或系统剪贴板执行写入。
const root = fileURLToPath(new URL('../', import.meta.url))
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-desktop-probe-'))
app.setPath('userData', path.join(data, 'profile'))
app.on('window-all-closed', () => {})
const deadline = setTimeout(() => { console.error('浮窗验收超时'); app.exit(1) }, 90_000)
let controller, quick
const now = new Date().toISOString()
const items = [{ id: 'one', kind: 'text', plainText: '第一条\n' + '长内容预览。'.repeat(80), sourceApp: 'Notepad', capturedAt: now, sensitivity: 'normal' },
  { id: 'two', kind: 'code', plainText: 'const answer = 42', sourceApp: 'Code', capturedAt: now, sensitivity: 'normal' },
  { id: 'secret', kind: 'secret', plainText: '', sourceApp: 'Browser', capturedAt: now, sensitivity: 'secret' }]
let current = { id: 'controlled-target', label: 'Controlled Test App' }, changedTarget = false, rejectInput = false
const writes = [], sends = []
let settings = { trayEnabled: false, closeToTray: false, captureEnabled: false }, hidden = 0
const adapter = {
  capture: () => current, valid: target => target?.id === 'controlled-target', ownForeground: () => true,
  async paste(target, write, { cancelled, hide }) {
    if (changedTarget || target?.id !== 'controlled-target') throw Object.assign(new Error('CLIPBOARD_PASTE_TARGET_CHANGED'), { code: 'CLIPBOARD_PASTE_TARGET_CHANGED' })
    if (cancelled()) throw new Error('cancelled')
    await write()
    if (rejectInput) throw Object.assign(new Error('CLIPBOARD_PASTE_INPUT_DENIED'), { code: 'CLIPBOARD_PASTE_INPUT_DENIED' })
    hide(); sends.push(target.id); return { ok: true, inputSent: true }
  }
}
async function run(code) { return quick.webContents.executeJavaScript(code) }
async function until(code) {
  for (let i = 0; i < 100; i++) { if (await run(code)) return; await new Promise(resolve => setTimeout(resolve, 40)) }
  throw new Error('未达到状态: ' + code)
}
async function click(label, scope = 'document') {
  await run(`(() => { const b = [...${scope}.querySelectorAll('button')].find(n => n.textContent.trim() === ${JSON.stringify(label)}); if (!b || b.disabled) throw new Error('按钮不可用: ' + ${JSON.stringify(label)}); b.click() })()`)
}
async function main() {
  try {
    // 实际装载 Windows API，限只读检查，验证 Koffi 声明可以在本机初始化。
    const native = createWindowsPasteAdapter()
    if (process.platform === 'win32') { assert.ok(native); assert.equal(typeof native.ownForeground(), 'boolean'); native.capture() }
    const mainWindow = Object.assign(new EventEmitter(), { webContents: { getURL: () => 'http://127.0.0.1:5173/', send() {} }, isDestroyed: () => false, hide() { hidden++ }, show() {}, focus() {}, isMinimized: () => false })
    controller = createClipboardDesktop({
      getMainWindow: () => mainWindow, getItem: id => items.find(item => item.id === id), listItems: () => items,
      useItem: (id, options) => { if (id === 'secret' && !options.confirmSensitive) throw new Error('confirm required'); writes.push(id); return { ok: true } },
      getSettings: () => settings, setSettings() {}, getLanguage: () => 'zh-CN', adapterFactory: () => adapter,
      createWindow(options) { quick = new BrowserWindow({ ...options, show: false, webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } }); quick.show = () => {}; quick.focus = () => {}; return quick }
    })
    ipcMain.handle('get-config', () => ({ language: 'zh-CN' }))
    ipcMain.handle('clipboard-list', (_event, args) => items.filter(item => !args?.query || item.sensitivity !== 'secret' && `${item.plainText} ${item.sourceApp}`.toLowerCase().includes(args.query.toLowerCase())))
    ipcMain.handle('clipboard-desktop-state', () => controller.state())
    ipcMain.handle('clipboard-quick-hide', () => controller.hide())
    ipcMain.handle('clipboard-quick-full', () => controller.full())
    ipcMain.handle('clipboard-paste', (_event, args) => controller.paste(args.id, args.confirmSensitive))
    ipcMain.handle('clipboard-use', (_event, args) => { writes.push(args.id); return { ok: true } })
    ipcMain.handle('clipboard-queue-next', () => controller.next())
    ipcMain.handle('clipboard-queue-pause', (_event, args) => controller.pause(args.paused))
    ipcMain.handle('clipboard-queue-skip', () => controller.skip())
    ipcMain.handle('clipboard-queue-cancel', () => controller.cancel())
    ipcMain.handle('clipboard-queue-arm', (_event, args) => controller.arm(args.enabled))
    await controller.show()
    await until('document.querySelectorAll(".quick-row").length === 3 && document.querySelector(".quick-target").textContent.includes("Controlled Test App")')
    await click('粘贴到此应用', 'document.querySelector(".quick-row")')
    await until('!document.querySelector("main").getAttribute("aria-busy") || document.querySelector("main").getAttribute("aria-busy") === "false"')
    assert.deepEqual(writes, ['one']); assert.equal(sends.length, 1)
    await click('粘贴到此应用', 'document.querySelectorAll(".quick-row")[2]')
    await until('document.querySelector("[role=dialog]")?.textContent.includes("Controlled Test App")')
    assert.equal(sends.length, 1, '隐私条目未确认不能发送')
    await click('取消', 'document.querySelector("[role=dialog]")')
    await controller.startQueue(['one', 'two'])
    await until('document.querySelector(".queue-panel")?.textContent.includes("1 / 2")')
    // 队列在运行时禁止单条插入，避免改变正在发送的格式。
    assert.throws(() => controller.paste('two'), /BUSY/)
    changedTarget = true
    await click('粘贴下一条', 'document.querySelector(".queue-panel")')
    await until('document.querySelector("[role=alert]")?.textContent.includes("前台应用已变化")')
    assert.equal(controller.state().queue.position, 0); assert.equal(controller.state().queue.paused, true); assert.equal(controller.state().queue.armed, false)
    changedTarget = false
    await click('继续', 'document.querySelector(".queue-panel")')
    await until('!document.querySelector(".queue-panel button").disabled')
    await click('粘贴下一条', 'document.querySelector(".queue-panel")')
    await until('document.querySelector(".queue-panel")?.textContent.includes("2 / 2")')
    rejectInput = true
    await assert.rejects(controller.next(), /INPUT_DENIED/)
    assert.equal(controller.state().queue.position, 1)
    rejectInput = false; controller.pause(false); await controller.next()
    assert.equal(controller.state().queue.active, false)
    await assert.rejects(controller.startQueue(['one', 'secret']), /SENSITIVE/)
    assert.equal(controller.state().queue.active, false)
    await controller.startQueue(['one', 'two']); controller.pause(true)
    assert.equal(controller.state().queue.paused, true)
    controller.skip(); assert.equal(controller.state().queue.position, 1)
    controller.cancel(); assert.equal(controller.state().queue.total, 0)
    // 右键菜单与详情复用真实组件。
    await run(`document.querySelector('.quick-row').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 80, clientY: 200 }))`)
    await until('document.querySelector("[role=menu]")?.textContent.includes("复制")')
    await run(`document.querySelector('.context-menu-overlay').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`)
    await until('!document.querySelector("[role=menu]")')
    for (const width of [520, 360]) {
      quick.setSize(width, 660)
      await new Promise(resolve => setTimeout(resolve, 300))
      assert.equal(await run('document.documentElement.scrollWidth <= innerWidth'), true)
      const image = await quick.webContents.capturePage()
      fs.mkdirSync(path.join(root, 'app-data/diagnostics'), { recursive: true })
      fs.writeFileSync(path.join(root, `app-data/diagnostics/clipboard-quick-${width}.png`), image.toPNG())
    }
    controller.start()
    assert.equal(controller.state().trayAvailable, false)
    settings = { ...settings, trayEnabled: true, closeToTray: true }; controller.applySettings()
    assert.equal(controller.state().trayAvailable, true)
    let prevented = false
    mainWindow.emit('close', { preventDefault() { prevented = true } })
    assert.equal(prevented, true); assert.equal(hidden, 1)
    settings = { ...settings, trayEnabled: false }; controller.applySettings()
    assert.equal(controller.state().trayAvailable, false)
    prevented = false; mainWindow.emit('close', { preventDefault() { prevented = true } }); assert.equal(prevented, false)
    console.log(JSON.stringify({ ok: true, realRenderer: true, nativeReadOnlyInit: true, mockedSendOnly: true, explicitPaste: true, sensitiveConfirmation: true, targetChangeStops: true, failedSendRetainsPosition: true, queuePauseSkipCancel: true, contextMenu: true, narrowLayout: true, nativeTrayCreatedAndDestroyed: true, closeToTrayRequiresLiveTray: true }))
  } catch (error) { console.error(error); process.exitCode = 1 }
  finally { clearTimeout(deadline); controller?.stop(); quick?.destroy(); try { removePathNoFollowSync(data, { root: os.tmpdir() }) } catch {} app.exit(process.exitCode || 0) }
}
app.whenReady().then(main)
