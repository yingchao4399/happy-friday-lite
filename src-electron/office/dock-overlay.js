import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app, WebContentsView } from 'electron'
import { officeDockBounds, moveOfficeDockPosition, resizeOfficeDockPosition } from './dock-overlay-layout.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const VIEW_ID = /^(docs|sheets|slides|pdf)-\d+$/

let mainWindow = null
let dockView = null
let workspaceBounds = null
let currentViewId = null
let expanded = false
let panelHeight = 0
// Position is relative to the Office content workspace. Keeping it in the
// main process lets a WebContentsView move outside its original bottom-right
// 48px rectangle while still leaving transparent areas click-through.
let position = null
let loaded = false

function routeHash(viewId) {
  return `#/office/${viewId.replace('-', '/')}?__officeDock=1`
}

function dockUrl(viewId) {
  const devServer = process.env.VITE_DEV_SERVER_URL || process.env.FRIDA_VITE_DEV_SERVER_URL
  if (!app.isPackaged && devServer) return `${devServer.replace(/\/$/, '')}/${routeHash(viewId)}`
  const bundledIndex = path.join(root, 'dist', 'index.html')
  if (app.isPackaged || fs.existsSync(bundledIndex)) return `${pathToFileURL(bundledIndex).href}${routeHash(viewId)}`
  return `http://localhost:5173/${routeHash(viewId)}`
}

function hasFridayShell(window) {
  const url = window.webContents.getURL()
  const bundled = pathToFileURL(path.join(root, 'dist', 'index.html')).href
  return url.startsWith(bundled) || url.startsWith('http://localhost:5173/')
}

function applyBounds() {
  if (!dockView || !mainWindow || mainWindow.isDestroyed()) return
  const bounds = officeDockBounds(workspaceBounds, { expanded, panelHeight, position })
  if (!bounds) {
    dockView.setVisible(false)
    return
  }
  // Chromium reports a zero-sized viewport for a hidden WebContentsView at
  // high DPI. Make it visible before applying the real bounds so fixed
  // positioning and ResizeObserver get a valid CSS viewport.
  dockView.setVisible(Boolean(currentViewId))
  dockView.setBounds(bounds)
}

function ensureDockView(viewId, initialBounds = null) {
  if (dockView && !dockView.webContents.isDestroyed()) return
  dockView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // The overlay is interactive even while the Office WebContentsView is
      // not the focused editor. Background throttling can leave its CSS
      // viewport at 0×0 at 150% DPI, which makes the trigger unclickable.
      backgroundThrottling: false,
      preload: path.join(root, 'preload-office-dock.cjs')
    }
  })
  dockView.setBackgroundColor('#0000')
  // Keep the view visible while its first document is created. Loading a
  // hidden child view at high DPI can permanently freeze Chromium's viewport
  // at 0×0; the parent still controls the actual clickable rectangle.
  dockView.setVisible(Boolean(currentViewId))
  dockView.setBounds(initialBounds || { x: 0, y: 0, width: 1, height: 1 })
  mainWindow.contentView.addChildView(dockView)
  loaded = false
  dockView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  dockView.webContents.once('did-finish-load', () => {
    loaded = true
    if (currentViewId && currentViewId !== viewId) syncRoute(currentViewId)
    // Let Chromium commit the initial non-zero layout viewport before the
    // collapsed 48-DIP rectangle is applied. Without this handoff, high-DPI
    // WebContentsView instances can remain at innerWidth=0 for their lifetime.
    dockView.setVisible(Boolean(currentViewId))
    setTimeout(() => applyBounds(), 120)
  })
  dockView.webContents.once('render-process-gone', () => {
    hideOfficeDockOverlay()
    // 崩溃后保留 Office 编辑器，下一次进入 Office 再建立 Dock。
    destroyOfficeDockOverlay()
  })
  dockView.webContents.loadURL(dockUrl(viewId)).catch(error => {
    console.warn('[Office Dock] load failed:', error?.message || 'unknown')
    hideOfficeDockOverlay()
  })
}

function syncRoute(viewId) {
  if (!loaded || !dockView || dockView.webContents.isDestroyed()) return
  const hash = routeHash(viewId)
  dockView.webContents.executeJavaScript(`window.location.hash = ${JSON.stringify(hash)}`).catch(() => {})
}

export function showOfficeDockOverlay(window, viewId, bounds) {
  if (!window || window.isDestroyed() || !VIEW_ID.test(viewId) || !hasFridayShell(window)) return
  mainWindow = window
  workspaceBounds = bounds
  const changed = currentViewId !== viewId
  currentViewId = viewId
  // Give Chromium a real layout viewport during the first navigation. A
  // 48-DIP hidden view can report innerWidth=0 at 150% DPI and never recover
  // after the first resize. The view is immediately reduced to the collapsed
  // trigger rectangle by applyBounds once the document is ready.
  const initialBounds = officeDockBounds(workspaceBounds, { expanded: true, panelHeight: 360, position })
  ensureDockView(viewId, initialBounds)
  // Office WebContentsView 可能后于 Dock 添加；重复添加可将 Dock 提到最前。
  mainWindow.contentView.addChildView(dockView)
  if (changed) syncRoute(viewId)
  if (loaded) applyBounds()
}

export function updateOfficeDockBounds(bounds) {
  workspaceBounds = bounds
  applyBounds()
}

export function setOfficeDockExpanded(nextExpanded, nextPanelHeight = 0) {
  const before = officeDockBounds(workspaceBounds, { expanded, panelHeight, position })
  expanded = nextExpanded === true
  panelHeight = expanded && Number.isFinite(nextPanelHeight) ? nextPanelHeight : 0
  if (position) position = resizeOfficeDockPosition(workspaceBounds, before, { expanded, panelHeight, position })
  applyBounds()
  return { expanded }
}

export function moveOfficeDock(dx = 0, dy = 0) {
  const x = Number(dx)
  const y = Number(dy)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { success: false }
  position = moveOfficeDockPosition(workspaceBounds, { expanded, panelHeight, position }, x, y)
  if (!position) return { success: false }
  applyBounds()
  return { success: true, position: { ...position } }
}

export function setOfficeDockPosition(next = {}) {
  const x = Number(next.x)
  const y = Number(next.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { success: false }
  position = { x, y }
  applyBounds()
  return { success: true, position: { ...position } }
}

export function hideOfficeDockOverlay() {
  currentViewId = null
  if (dockView && !dockView.webContents.isDestroyed()) dockView.setVisible(false)
}

export function isOfficeDockSender(sender) {
  return Boolean(dockView && !dockView.webContents.isDestroyed() && dockView.webContents === sender)
}

export function openFridayFromOfficeDock() {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  mainWindow.webContents.send('office-dock-open-friday')
  return true
}

export function destroyOfficeDockOverlay() {
  const view = dockView
  dockView = null
  currentViewId = null
  loaded = false
  expanded = false
  panelHeight = 0
  if (!view) return
  try { mainWindow?.contentView?.removeChildView(view) } catch { /* 窗口可能已销毁 */ }
  if (!view.webContents.isDestroyed()) {
    try { view.webContents.close({ waitForBeforeUnload: false }) } catch { /* 已销毁 */ }
  }
}
