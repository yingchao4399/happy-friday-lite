import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { app, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { exportDocument, documentExportFormats } from './export-document.js'
import { exportSelectionText } from './export-selection.js'

const failure = (code, targetPath, message) => ({ ok: false, data: null, warnings: [], error: { code, message, path: targetPath, recoverable: true }, affectedResources: [], undo: null })

export function registerOfficeFileCommands({ findEntry, snapshot, openDocument, saveAsDocument, mainWindow, newDocument, closeDocument, notify, readSettings }) {
  const active = new Set()
  const controllers = new Map()
  const allowed = event => {
    const entry = findEntry(event.sender)
    if (!entry || event.sender.isDestroyed()) throw new Error('OFFICE_FILE_SENDER_INVALID')
    return entry
  }
  ipcMain.handle('office-file-current-snapshot', (event, request) => snapshot(allowed(event), request))
  ipcMain.handle('office-file-export-selection-text', async (event, request) => {
    let targetPath
    try {
      const entry = allowed(event)
      if (typeof request?.text !== 'string' || !request.text.trim() || request.text.length > 4 * 1024 * 1024) return failure('OFFICE_SELECTION_INVALID')
      const name = path.basename(entry.filePath || 'document').replace(/\.[^.]+$/, '')
      const selected = await dialog.showSaveDialog(mainWindow(), {
        defaultPath: path.join(entry.filePath ? path.dirname(entry.filePath) : app.getPath('documents'), `${name}-selection.txt`),
        filters: [{ name: 'TXT', extensions: ['txt'] }],
      })
      if (selected.canceled || !selected.filePath) return { ok: false, cancelled: true, error: null, warnings: [], affectedResources: [], undo: null }
      targetPath = selected.filePath
      const result = await exportSelectionText({ text: request.text, targetPath, sourcePath: entry.filePath })
      notify('resource-changed', { action: 'export-selection', path: targetPath, documentId: entry.viewId })
      return result
    } catch (error) { return failure(error.message || 'OFFICE_EXPORT_FAILED', targetPath) }
  })
  ipcMain.handle('office-file-cancel-export', event => {
    allowed(event)
    controllers.get(event.sender.id)?.abort()
    return { ok: true }
  })
  ipcMain.handle('office-file-export-snapshot', async (event, request) => {
    let entry, targetPath
    let ownsActive = false
    const taskId = crypto.randomUUID()
    try {
      entry = allowed(event)
      if (active.has(event.sender.id)) return failure('OFFICE_EXPORT_BUSY')
      if (!documentExportFormats[entry.type]?.includes(request?.format)) return failure('OFFICE_EXPORT_FORMAT_UNSUPPORTED')
      const bytes = request?.bytes
      if (!ArrayBuffer.isView(bytes) || !bytes.byteLength || bytes.byteLength > 256 * 1024 * 1024) return failure('OFFICE_EXPORT_SNAPSHOT_INVALID')
      if (request.html != null && (typeof request.html !== 'string' || request.html.length > 64 * 1024 * 1024)) return failure('OFFICE_EXPORT_TEXT_INVALID')
      if (request.plainText != null && (typeof request.plainText !== 'string' || request.plainText.length > 64 * 1024 * 1024)) return failure('OFFICE_EXPORT_TEXT_INVALID')
      if (request.pages != null && (!Array.isArray(request.pages) || request.pages.length > 500 || request.pages.reduce((sum, page) => sum + (typeof page?.pngBase64 === 'string' ? page.pngBase64.length : Infinity), 0) > 256 * 1024 * 1024)) return failure('OFFICE_HANDOUT_PAGES_INVALID')
      active.add(event.sender.id)
      ownsActive = true
      const format = request.format
      const name = path.basename(entry.filePath || 'document').replace(/\.[^.]+$/, '')
      const selected = await dialog.showSaveDialog(mainWindow(), {
        defaultPath: path.join(entry.filePath ? path.dirname(entry.filePath) : app.getPath('documents'), `${name}.${format}`),
        filters: [{ name: format.toUpperCase(), extensions: [format.split('.').at(-1)] }],
      })
      if (selected.canceled || !selected.filePath) return { ok: false, cancelled: true, error: null, warnings: [], affectedResources: [], undo: null }
      targetPath = selected.filePath
      const controller = new AbortController()
      controllers.set(event.sender.id, controller)
      const destroyed = () => controller.abort()
      event.sender.once('destroyed', destroyed)
      try {
        const result = await exportDocument({ kind: entry.type, format, bytes, html: request.html, plainText: request.plainText, pages: request.pages, sourcePath: entry.filePath, targetPath }, {
          signal: controller.signal,
          onProgress: progress => {
            if (!event.sender.isDestroyed()) event.sender.send('task-progress', { taskId, kind: 'office-export', documentId: entry.viewId, ...progress })
          },
        })
        notify('resource-changed', { action: 'export', path: targetPath, documentId: entry.viewId })
        return result
      } finally { event.sender.removeListener('destroyed', destroyed); controllers.delete(event.sender.id) }
    } catch (error) {
      const result = failure(error.message || 'OFFICE_EXPORT_FAILED', targetPath, error.detail)
      if (error.message === 'OFFICE_EXPORT_CANCELLED') result.cancelled = true
      if (!event.sender.isDestroyed()) event.sender.send('task-progress', { taskId, kind: 'office-export', stage: result.cancelled ? 'cancelled' : 'failed', error: result.error })
      return result
    } finally { if (ownsActive) active.delete(event.sender.id) }
  })

  ipcMain.handle('office-file-command', async (event, command) => {
    try {
      const entry = allowed(event)
      if (command === 'new') return { ok: (await newDocument(entry.type)).success === true }
      if (command === 'open') return { ok: (await openDocument()).success === true }
      if (command === 'saveAs') return saveAsDocument(entry)
      if (command === 'close') {
        // 先回复 IPC，再销毁调用方视图；取消关闭仍保持原文档。
        setImmediate(() => { closeDocument(entry.viewId).catch(() => {}) })
        return { ok: true }
      }
      if (command === 'default-apps') {
        if (process.platform !== 'win32') return failure('OFFICE_DEFAULT_APPS_UNAVAILABLE')
        await shell.openExternal('ms-settings:defaultapps')
        return { ok: true }
      }
      if (command !== 'information') return failure('OFFICE_FILE_COMMAND_INVALID')
      const file = entry.filePath
      const stat = file && fs.existsSync(file) ? fs.statSync(file) : null
      const language = app.getLocale().startsWith('zh')
      await dialog.showMessageBox(mainWindow(), {
        type: 'info', title: language ? '文档信息' : 'Document information',
        message: file ? path.basename(file) : language ? '未保存文档' : 'Untitled document',
        detail: [file || '', `${entry.type.toUpperCase()}${stat ? ` · ${stat.size.toLocaleString()} bytes` : ''}`, stat?.mtime.toLocaleString() || ''].filter(Boolean).join('\n'),
      })
      return { ok: true }
    } catch (error) { return failure(error.message) }
  })

  ipcMain.handle('office-file-preferences', (event, patch) => {
    allowed(event)
    let saved = readSettings()
    if (patch !== undefined) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['autoSaveDefault', 'theme'].includes(key))) throw new Error('OFFICE_PREFERENCES_INVALID')
      if (patch.autoSaveDefault !== undefined && typeof patch.autoSaveDefault !== 'boolean') throw new Error('OFFICE_PREFERENCES_INVALID')
      if (patch.theme !== undefined && !['light', 'dark', 'system'].includes(patch.theme)) throw new Error('OFFICE_PREFERENCES_INVALID')
      const next = { ...saved, ...patch, autoSaveDefaultUpdatedAt: Date.now() }
      const filename = path.join(app.getPath('userData'), 'app-settings.json')
      fs.mkdirSync(path.dirname(filename), { recursive: true })
      const temporary = filename + '.tmp'
      fs.writeFileSync(temporary, JSON.stringify(next, null, 2), 'utf8')
      fs.renameSync(temporary, filename)
      saved = next
      if (patch.theme !== undefined) { nativeTheme.themeSource = patch.theme; notify('app:theme-changed', patch.theme) }
      if (patch.autoSaveDefault !== undefined) notify('app:auto-save-default-changed', { on: patch.autoSaveDefault, updatedAt: next.autoSaveDefaultUpdatedAt })
    }
    return { autoSaveDefault: saved.autoSaveDefault === true, theme: ['light', 'dark'].includes(saved.theme) ? saved.theme : 'system' }
  })
}
