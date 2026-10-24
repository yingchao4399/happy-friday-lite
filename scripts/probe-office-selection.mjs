import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'
import { fileURLToPath } from 'node:url'
import { setDataDir } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import { initOfficeSession } from '../src-electron/office/office-session.js'
import { registerOfficeIpc } from '../src-electron/office/office-ipc.js'
import { getOfficeDocumentSelection, shutdownOfficeHost, openOfficeFile } from '../src-electron/office/office-host.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-office-selection-'))
const fixture = path.join(root, 'vendor', 'happyoffice', 'fixtures', 'generated', 'kitchen-sink.docx')
let win
const deadline = setTimeout(() => { console.error('Office 选区探针超时'); app.exit(1) }, 90_000)
app.setPath('userData', path.join(dataDir, 'profile'))
app.on('window-all-closed', () => {})

async function waitFor(check, label) {
  for (let i = 0; i < 180; i += 1) {
    const value = await check()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`未达到 Office 状态: ${label}`)
}

async function main() {
  try {
    assert.equal(fs.existsSync(fixture), true, `fixture missing: ${fixture}`)
    setDataDir(dataDir)
    db.setDataDir(dataDir)
    await db.initDb()
    win = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { sandbox: true } })
    assert.equal(await initOfficeSession(win), true, 'Office Host 未就绪')
    registerOfficeIpc()
    const opened = await openOfficeFile(fixture)
    assert.equal(opened.success, true)
    const target = await waitFor(() => {
      const value = globalThis.__officeTarget
      return value
    }, '编辑器视图')
    const wc = target.webContents
    await waitFor(() => wc.executeJavaScript('Boolean(window.__aidocs?.editor)', true), 'Docs editor')
    await wc.executeJavaScript(`window.__aidocs.openPath(${JSON.stringify(fixture)})`, true)
    const textLength = await waitFor(() => wc.executeJavaScript('window.__aidocs.editor.state.doc.content.size > 2 ? window.__aidocs.editor.state.doc.content.size : 0', true), '已加载的 DOCX 正文')
    assert.ok(Number.isInteger(textLength) && textLength > 2, `DOCX 没有可选正文: ${textLength}`)
    await wc.executeJavaScript(`window.__aidocs.editor.commands.setTextSelection({ from: 1, to: ${Math.min(textLength, 12)} })`, true)
    const selection = await waitFor(() => getOfficeDocumentSelection(opened.viewId), '统一选区')
    assert.equal(selection.documentId, opened.viewId)
    assert.equal(selection.kind, 'docs')
    assert.equal(selection.canCopy, true)
    assert.equal(selection.canPaste, true)
    assert.ok(selection.text.length > 0)
    console.log(JSON.stringify({ ok: true, documentId: selection.documentId, kind: selection.kind, text: selection.text, range: selection.range, paragraph: selection.paragraph, canCopy: selection.canCopy, canPaste: selection.canPaste }))
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error.code || 'OFFICE_SELECTION_PROBE_FAILED', message: error.message }))
    process.exitCode = 1
  } finally {
    clearTimeout(deadline)
    try { await shutdownOfficeHost() } catch { /* isolated probe cleanup */ }
    db.closeDb()
    if (win && !win.isDestroyed()) win.destroy()
    try { removePathNoFollowSync(dataDir, { root: os.tmpdir() }) } catch { /* profile may still be closing */ }
    app.exit(process.exitCode || 0)
  }
}

// getOfficeUiTarget is intentionally read through the host after startup to avoid exposing
// renderer handles to the public IPC surface.
import { getOfficeUiTarget } from '../src-electron/office/office-host.js'
Object.defineProperty(globalThis, '__officeTarget', { get: getOfficeUiTarget })
app.whenReady().then(main)
