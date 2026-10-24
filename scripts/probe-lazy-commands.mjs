import { app, BrowserWindow, ipcMain } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { setDataDir } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import { registerCommands } from '../src-electron/commands.js'
import { installIpcCapabilityGateway } from '../src-electron/agent/ipcGateway.js'
import { closeLazyAgentConnections, stopLazyHarness } from '../src-electron/lazy-agent-commands.js'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-lazy-commands-'))
app.setPath('userData', path.join(data, 'profile'))
let win
installIpcCapabilityGateway(ipcMain, () => win)

async function main() {
  let ok = false
  const timeout = setTimeout(() => app.exit(1), 90000)
  try {
    setDataDir(data); db.setDataDir(data); await db.initDb()
    win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, preload: path.join(root, 'preload.cjs') } })
    registerCommands(win)
    await win.loadURL('data:text/html,<html><body>Lazy commands acceptance</body></html>')
    const run = code => win.webContents.executeJavaScript(code)
    // 未使用 DSH 时保存设置必须仍能完成，不提前拉起 sidecar。
    await run('window.electronAPI.invoke("get-config").then(c=>window.electronAPI.invoke("save-config", c))')
    const [tools, memories] = await Promise.all([
      run('window.electronAPI.invoke("agent-list-tools")'),
      run('window.electronAPI.invoke("agent-list-memories")'),
    ])
    assert.ok(Array.isArray(tools) && tools.some(tool => !tool.name.startsWith('app_') && tool.requireApproval))
    assert.ok(Array.isArray(memories))
    const status = await run('window.electronAPI.invoke("harness-status")')
    assert.equal(status.status, 'idle')
    await run('window.electronAPI.invoke("harness-sync-config")')
    const audit = db.queryAllRaw('SELECT count(*) AS n FROM agent_tool_logs')[0]
    assert.ok(audit.n >= 6, '按需加载仍必须经过实际能力审计入口')
    console.log(JSON.stringify({ ok: true, toolCount: tools.length, harness: status.status, auditRows: audit.n, sandbox: win.webContents.getLastWebPreferences().sandbox }))
    ok = true
  } catch (error) { console.error(error.stack) }
  finally {
    clearTimeout(timeout)
    await stopLazyHarness(); await closeLazyAgentConnections()
    if (win && !win.isDestroyed()) win.destroy()
    db.closeDb()
    try { removePathNoFollowSync(data, { root: os.tmpdir() }) } catch {}
    app.exit(ok ? 0 : 1)
  }
}
app.whenReady().then(main)
