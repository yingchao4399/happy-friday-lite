import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setDataDir } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'

const originalConfig = process.argv.find(arg => arg.startsWith('--config='))?.slice(9) || path.join(process.env.APPDATA || '', 'happy-friday-lite', 'config.json')
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-dsh-startup-'))
app.setPath('userData', path.join(isolated, 'profile'))
app.on('window-all-closed', () => {})

async function main() {
  let window
  let stopHarnessSidecar = async () => {}
  try {
    const harness = await import('../src-electron/harness/index.js')
    const { registerHarnessCommands, startHarnessSidecar } = harness
    stopHarnessSidecar = harness.stopHarnessSidecar
    const config = JSON.parse(fs.readFileSync(originalConfig, 'utf8'))
    const model = (config.customModels || []).find(item => item.id === config.selectedModelId && item.apiKey && item.baseUrl && item.modelName)
    if (!model) throw new Error('已选模型配置不完整')
    fs.writeFileSync(path.join(isolated, 'config.json'), JSON.stringify(config), { mode: 0o600 })
    setDataDir(isolated)
    db.setDataDir(isolated)
    await db.initDb()
    window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    registerHarnessCommands(window)
    const result = await startHarnessSidecar()
    console.log(JSON.stringify({ ok: result.status === 'ready', status: result.status, stage: result.stage, timings: result.timings, toolCount: result.toolCount, error: result.status === 'ready' ? null : result.error, logPath: result.logPath }))
    if (result.status !== 'ready') process.exitCode = 1
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error.code || 'HARNESS_PROBE_FAILED', message: error.message }))
    process.exitCode = 1
  } finally {
    await stopHarnessSidecar().catch(() => {})
    db.closeDb()
    if (window && !window.isDestroyed()) window.destroy()
    try { removePathNoFollowSync(isolated, { root: os.tmpdir() }) } catch { /* Windows may still hold the Electron profile briefly. */ }
    app.exit(process.exitCode || 0)
  }
}

app.whenReady().then(main)
