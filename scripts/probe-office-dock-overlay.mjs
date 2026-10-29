import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(filename), '..')

if (!process.versions.electron) {
  const require = createRequire(import.meta.url)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [filename], { cwd: root, env, windowsHide: true, stdio: 'inherit' })
  const deadline = setTimeout(() => child.kill('SIGKILL'), 90_000)
  process.exitCode = await new Promise(resolve => {
    child.once('error', () => resolve(1))
    child.once('exit', code => resolve(code ?? 1))
  })
  clearTimeout(deadline)
} else {
  const { app, BrowserWindow, webContents } = await import('electron')
  const { setDataDir } = await import('../src-electron/config.js')
  const db = await import('../src-electron/db.js')
  const { registerCommands } = await import('../src-electron/commands.js')
  const { initOfficeSession } = await import('../src-electron/office/office-session.js')
  const { registerOfficeIpc } = await import('../src-electron/office/office-ipc.js')
  const { openOfficeFile, hideAllOfficeViews, setOfficeContentBounds, shutdownOfficeHost } = await import('../src-electron/office/office-host.js')
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-office-dock-'))
  const fixture = path.join(root, 'vendor/happyoffice/fixtures/generated/kitchen-sink.docx')
  app.setPath('userData', path.join(data, 'profile'))
  app.on('window-all-closed', () => {})
  let win
  let succeeded = false

  async function waitFor(check, name) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const value = await check()
      if (value) return value
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`Office Dock did not reach ${name}`)
  }

  app.whenReady().then(async () => {
    try {
      assert.equal(fs.existsSync(fixture), true)
      setDataDir(data)
      db.setDataDir(data)
      await db.initDb()
      win = new BrowserWindow({
        show: false,
        width: 1200,
        height: 800,
        webPreferences: {
          preload: path.join(root, 'preload.cjs'),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true
        }
      })
      registerCommands(win)
      assert.equal(await initOfficeSession(win), true)
      registerOfficeIpc()
      await win.loadFile(path.join(root, 'dist/index.html'))
      setOfficeContentBounds({ x: 250, y: 50, width: 900, height: 680 })
      const opened = await openOfficeFile(fixture)
      assert.equal(opened.success, true)

      const dockContents = await waitFor(() => webContents.getAllWebContents().find(contents => contents.getURL().includes('__officeDock=1')), 'overlay content')
      await waitFor(() => dockContents.executeJavaScript('Boolean(document.querySelector(".agent-dock-trigger"))'), 'trigger')
      const dockView = win.contentView.children.find(view => view.webContents === dockContents)
      assert.ok(dockView)
      assert.deepEqual(dockView.getBounds(), { x: 1080, y: 660, width: 48, height: 48 })
      assert.equal(win.contentView.children.at(-1), dockView)

      await dockContents.executeJavaScript('document.querySelector(".agent-dock-trigger").click()')
      await waitFor(() => dockView.getBounds().width > 48 && dockContents.executeJavaScript('Boolean(document.querySelector(".agent-dock-panel"))'), 'expanded panel')
      const expandedBounds = dockView.getBounds()
      assert.ok(expandedBounds.width <= 360 && expandedBounds.height <= 580)
      assert.equal(win.contentView.children.at(-1), dockView)

      hideAllOfficeViews()
      assert.equal(dockView.getVisible(), false)
      succeeded = true
      console.log(JSON.stringify({ ok: true, viewId: opened.viewId, collapsed: { x: 1080, y: 660, width: 48, height: 48 }, expanded: expandedBounds }))
    } catch (error) {
      console.error(error.stack)
    } finally {
      shutdownOfficeHost()
      db.closeDb()
      if (win && !win.isDestroyed()) win.destroy()
      app.exit(succeeded ? 0 : 1)
    }
  }).catch(error => { console.error(error); app.exit(1) })
}
