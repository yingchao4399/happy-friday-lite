import { app, BrowserWindow, Tray, Menu, nativeImage, screen, globalShortcut } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWindowsPasteAdapter } from './windows-paste.js'
import { createClipboardSequence } from './clipboard-sequence.js'
import zh from '../src/i18n/locales/zh-CN/clipboard.json' with { type: 'json' }
import en from '../src/i18n/locales/en-US/clipboard.json' with { type: 'json' }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const queueShortcut = 'CommandOrControl+Alt+Shift+V'
const fail = code => Object.assign(new Error(code), { code })

// 目标窗口身份只留在主进程；浮窗和队列都不能指定任意系统窗口。
export function createClipboardDesktop({ getMainWindow, getItem, listItems, useItem, getSettings, setSettings, getLanguage, adapterFactory = createWindowsPasteAdapter, createWindow = options => new BrowserWindow(options) }) {
  let quick = null, tray = null, monitor = null, adapter = null, lastTarget = null, target = null, armed = false, started = false, quitting = false, sending = false
  const text = key => (getLanguage() === 'en-US' ? en : zh)[key]
  const valid = value => Boolean(adapter?.valid(value))
  const state = () => ({ target: { available: valid(target), label: valid(target) ? target.label : '' }, queue: { ...sequence.state(), armed, shortcut: queueShortcut }, supported: Boolean(adapter), trayAvailable: Boolean(tray && !tray.isDestroyed()) })
  function disarm() { if (armed) globalShortcut.unregister(queueShortcut); armed = false }
  function notify() {
    if (!sequence.state().active || sequence.state().paused) disarm()
    if (quick && !quick.isDestroyed()) quick.webContents.send('clipboard-desktop-changed', state())
    const main = getMainWindow(); if (main && !main.isDestroyed()) main.webContents.send('clipboard-desktop-changed', state())
  }
  const sequence = createClipboardSequence({ getItem, changed: notify, paste: (id, value, cancelled) => paste(id, false, value, cancelled) })
  async function paste(id, confirmSensitive = false, value = target, cancelled = () => false) {
    if (!adapter) throw fail('CLIPBOARD_PASTE_UNSUPPORTED')
    if (sending) throw fail('CLIPBOARD_QUEUE_BUSY')
    sending = true
    try { return await adapter.paste(value, () => useItem(id, { confirmSensitive }), { hide: () => quick?.hide(), cancelled }) }
    finally { sending = false }
  }
  function captureTarget() {
    const current = adapter?.capture()
    if (current) lastTarget = current
    return current || (adapter?.ownForeground() && valid(lastTarget) ? lastTarget : null)
  }
  async function show(preserve = false) {
    if (!adapter) { try { adapter = adapterFactory() } catch {} }
    // 活动队列锁定原目标，打开浮窗不能悄悄改成另一个应用。
    if (!preserve && !sequence.state().active) target = captureTarget()
    if (!quick || quick.isDestroyed()) {
      const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
      quick = createWindow({ width: Math.min(520, area.width), height: Math.min(660, area.height), minWidth: 340, minHeight: 360, frame: false, show: false, title: text('quickTitle'), skipTaskbar: true, alwaysOnTop: true,
        webPreferences: { preload: path.join(root, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
      const window = quick
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', event => event.preventDefault())
      window.on('page-title-updated', event => event.preventDefault())
      window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide() } })
      window.on('closed', () => { if (quick === window) quick = null })
      try {
        const mainUrl = getMainWindow()?.webContents.getURL() || ''
        if (!app.isPackaged && /^https?:\/\/(?:127[.]0[.]0[.]1|localhost):5173\//.test(mainUrl)) { const url = new URL(mainUrl); url.hash = '/clipboard-quick'; await window.loadURL(url.href) }
        else await window.loadFile(path.join(root, 'dist/index.html'), { hash: '/clipboard-quick' })
      } catch (error) { window.destroy(); throw error }
    }
    quick.show(); quick.focus(); notify(); return state()
  }
  function full(noteId) {
    quick?.hide()
    const main = getMainWindow()
    if (main && !main.isDestroyed()) { if (main.isMinimized()) main.restore(); main.show(); main.focus(); main.webContents.send('clipboard-hotkey', { noteId: typeof noteId === 'string' ? noteId : undefined }) }
    return { ok: true }
  }
  async function next() {
    try { return await sequence.next(target) }
    catch (error) { if (error.code === 'CLIPBOARD_QUEUE_BUSY') throw error; disarm(); if (!quitting && sequence.state().active) { sequence.pause(true); await show(true) } throw error }
  }
  function menu() {
    if (!tray) return
    const recent = listItems().filter(item => item.sensitivity !== 'secret' && !item.expired).slice(0, 6)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: text('quickTitle'), click: () => show(true).catch(() => full()) },
      { label: text('openManager'), click: full },
      { type: 'separator' },
      ...recent.map(item => ({ label: String(item.plainText || item.filePaths?.[0] || text('image')).replace(/[\r\n&]/g, ' ').slice(0, 48), click: () => { try { useItem(item.id, {}) } catch { full() } } })),
      { type: 'separator' },
      { label: text('captureEnabled'), type: 'checkbox', checked: getSettings().captureEnabled, click: item => { try { setSettings({ ...getSettings(), captureEnabled: item.checked }) } catch { full() } } },
      { label: text('quitApp'), click: () => app.quit() }
    ]))
  }
  function applySettings() {
    if (!started) return
    if (!getSettings().trayEnabled) { tray?.destroy(); tray = null; return }
    if (!tray) {
      const image = nativeImage.createFromPath(path.join(root, 'build/icons/icon.png')).resize({ width: 20, height: 20 })
      if (image.isEmpty()) throw fail('CLIPBOARD_TRAY_UNAVAILABLE')
      tray = new Tray(image); tray.setToolTip(text('title'))
      tray.on('click', () => { if (!sequence.state().active) target = valid(lastTarget) ? lastTarget : null; show(true).catch(() => full()) })
      tray.on('right-click', () => { if (!sequence.state().active) target = valid(lastTarget) ? lastTarget : null; menu() })
    }
    menu()
  }
  const closing = event => { if (!quitting && tray && getSettings().closeToTray) { event.preventDefault(); getMainWindow()?.hide() } }
  const quittingApp = () => { quitting = true; disarm() }
  return {
    state, show, full, hide() { quick?.hide(); return { ok: true } },
    paste(id, confirmed) { if (sequence.state().active) throw fail('CLIPBOARD_QUEUE_BUSY'); return paste(id, confirmed) },
    start() {
      if (started) return
      started = true
      try { adapter = adapterFactory() } catch {}
      monitor = setInterval(() => { const value = adapter?.capture(); if (value) lastTarget = value }, 350); monitor.unref()
      getMainWindow()?.on('close', closing); app.on('before-quit', quittingApp)
      applySettings()
    },
    applySettings,
    send(channel, payload) { if (quick && !quick.isDestroyed()) quick.webContents.send(channel, payload); if (channel === 'clipboard-item-added' || channel === 'clipboard-settings-changed') menu() },
    async startQueue(ids) {
      const nextTarget = captureTarget()
      if (!valid(nextTarget)) throw fail('CLIPBOARD_PASTE_TARGET_MISSING')
      sequence.start(ids); disarm(); target = nextTarget
      return show(true)
    },
    next,
    pause(value) { if (value) disarm(); return sequence.pause(value) },
    skip() { return sequence.skip() },
    cancel() { disarm(); return sequence.cancel() },
    arm(value) {
      if (typeof value !== 'boolean') throw fail('CLIPBOARD_QUEUE_INVALID')
      if (!value) { disarm(); notify(); return state() }
      if (!sequence.state().active || sequence.state().paused || !valid(target)) throw fail('CLIPBOARD_PASTE_TARGET_MISSING')
      if (!armed && !globalShortcut.register(queueShortcut, () => { next().catch(() => {}) })) throw fail('CLIPBOARD_SHORTCUT_UNAVAILABLE')
      armed = true; notify(); return state()
    },
    stop() {
      quitting = true; disarm(); sequence.cancel(); clearInterval(monitor); monitor = null
      getMainWindow()?.removeListener('close', closing); app.removeListener('before-quit', quittingApp)
      quick?.destroy(); quick = null; tray?.destroy(); tray = null; started = false
    }
  }
}
