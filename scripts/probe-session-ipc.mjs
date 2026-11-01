import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
if (!process.versions.electron) {
  const require = createRequire(import.meta.url)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [fileURLToPath(import.meta.url)], { cwd: root, env, windowsHide: true, stdio: 'inherit' })
  process.exitCode = await new Promise(resolve => child.once('exit', code => resolve(code ?? 1)))
} else {
  const { app, BrowserWindow } = await import('electron')
  const { setDataDir } = await import('../src-electron/config.js')
  const db = await import('../src-electron/db.js')
  const { registerCommands } = await import('../src-electron/commands.js')
  const dataDir = process.env.FRIDAY_PROBE_DATA_DIR || path.join(root, 'app-data')
  app.setPath('userData', path.join(dataDir, 'probe-profile'))
  app.on('window-all-closed', () => {})
  app.whenReady().then(async () => {
    let win
    try {
      setDataDir(dataDir)
      db.setDataDir(dataDir)
      await db.initDb()
      win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, 'preload.cjs'), contextIsolation: true, sandbox: true } })
      registerCommands(win)
      await win.loadFile(path.join(root, 'dist/index.html'))
      const value = await win.webContents.executeJavaScript(`window.electronAPI.invoke('get_sessions', {scope:'dock', scopeKey:'global'}).then(value => ({ ok:true, isArray:Array.isArray(value), keys:value && typeof value === 'object' ? Object.keys(value) : [], count:Array.isArray(value) ? value.length : null })).catch(error => ({ ok:false, message:String(error?.message || error) }))`)
      console.log(JSON.stringify(value))
      db.closeDb()
      win.destroy()
      app.exit(value.ok ? 0 : 1)
    } catch (error) {
      console.error(error.stack)
      try { db.closeDb() } catch {}
      if (win && !win.isDestroyed()) win.destroy()
      app.exit(1)
    }
  })
}
