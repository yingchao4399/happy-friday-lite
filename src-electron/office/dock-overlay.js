import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app, WebContentsView } from 'electron'
import { officeDockBounds } from './dock-overlay-layout.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const VIEW_ID = /^(docs|sheets|slides|pdf)-\d+$/

let mainWindow = null
let dockView = null
let workspaceBounds = null
let currentViewId = null
let expanded = false
let panelHeight = 0
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
  const bounds = officeDockBounds(workspaceBounds, { expanded, panelHeight })
  if (!bounds) {
    dockView.setVisible(false)
    return
  }
  dockView.setBounds(bounds)
  dockView.setVisible(Boolean(currentViewId))
}

function ensureDockView(viewId) {
  if (dockView && !dockView.webContents.isDestroyed()) return
  dockView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: true,
      preload: path.join(root, 'preload-office-dock.cjs')
    }
  })
  dockView.setBackgroundColor('#0000')
  dockView.setVisible(false)
  dockView.setBounds({ x: 0, y: 0, width: 1, height: 1 })
  mainWindow.contentView.addChildView(dockView)
  loaded = false
  dockView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  dockView.webContents.once('did-finish-load', () => {
    loaded = true
    if (currentViewId && currentViewId !== viewId) syncRoute(currentViewId)
    applyBounds()
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
  ensureDockView(viewId)
  // Office WebContentsView 可能后于 Dock 添加；重复添加可将 Dock 提到最前。
  mainWindow.contentView.addChildView(dockView)
  if (changed) syncRoute(viewId)
  applyBounds()
}

export function updateOfficeDockBounds(bounds) {
  workspaceBounds = bounds
  applyBounds()
}

export function setOfficeDockExpanded(nextExpanded, nextPanelHeight = 0) {
  expanded = nextExpanded === true
  panelHeight = expanded && Number.isFinite(nextPanelHeight) ? nextPanelHeight : 0
  applyBounds()
  return { expanded }
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
