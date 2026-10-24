import { app, BrowserWindow, screen } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function createClipboardPins(getMainWindow, getItem) {
  const windows = new Map()
  function find(sender) { return [...windows.values()].find(entry => entry.window.webContents === sender) }
  function resize(entry, expanded) {
    entry.expanded = expanded
    const bounds = entry.window.getBounds(), area = screen.getDisplayMatching(bounds).workArea
    const width = Math.min(area.width, expanded ? 620 : 340), height = Math.min(area.height, expanded ? 680 : 180)
    entry.window.setMinimumSize(expanded ? 360 : 280, expanded ? 320 : 140)
    entry.window.setBounds({ x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)), y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)), width, height })
  }
  return {
    async open(id, expanded = false) {
      const item = getItem(id)
      if (!item || item.deletedAt || item.expired) throw new Error('CLIPBOARD_PIN_UNAVAILABLE')
      const existing = windows.get(id)
      if (existing) { resize(existing, expanded); existing.window.webContents.send('clipboard-pin-changed'); existing.window.show(); existing.window.focus(); return { ok: true } }
      if (windows.size >= 12) throw new Error('CLIPBOARD_PIN_LIMIT')
      const window = new BrowserWindow({
        width: 340, height: 180, minWidth: 280, minHeight: 140, frame: false, show: false,
        alwaysOnTop: true, skipTaskbar: true, resizable: true, title: 'Friday Clipboard',
        webPreferences: { preload: path.join(root, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
      })
      const entry = { window, id, expanded: Boolean(expanded) }
      windows.set(id, entry)
      resize(entry, Boolean(expanded))
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', event => event.preventDefault())
      window.once('ready-to-show', () => window.show())
      window.on('closed', () => windows.delete(id))
      try {
        const hash = '/clipboard-pin/' + encodeURIComponent(id)
        const mainUrl = getMainWindow()?.webContents?.getURL() || ''
        if (!app.isPackaged && /^https?:\/\/(?:127[.]0[.]0[.]1|localhost):5173\//.test(mainUrl)) {
          const url = new URL(mainUrl); url.hash = hash; await window.loadURL(url.href)
        } else await window.loadFile(path.join(root, 'dist', 'index.html'), { hash })
      } catch (error) { window.destroy(); throw error }
      return { ok: true }
    },
    state(sender) {
      const entry = find(sender)
      if (!entry) throw new Error('CLIPBOARD_PIN_UNAVAILABLE')
      const item = getItem(entry.id)
      if (!item || item.deletedAt || item.expired) { entry.window.close(); return null }
      return { item, expanded: entry.expanded }
    },
    mode(sender, expanded) { const entry = find(sender); if (!entry || typeof expanded !== 'boolean') throw new Error('CLIPBOARD_PIN_UNAVAILABLE'); resize(entry, expanded); return { expanded } },
    close(sender) { find(sender)?.window.close(); return { ok: true } },
    refresh() { for (const entry of windows.values()) { const item = getItem(entry.id); if (!item || item.deletedAt || item.expired) entry.window.close(); else entry.window.webContents.send('clipboard-pin-changed') } },
    stop() { for (const entry of windows.values()) entry.window.destroy(); windows.clear() }
  }
}
