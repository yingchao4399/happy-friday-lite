import { app, ipcMain } from 'electron'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import pty from 'node-pty'
import crypto from 'node:crypto'

const sessions = new Map()

function sessionId() {
  return crypto.randomUUID()
}

function resolveShell(requested) {
  if (process.platform === 'win32') {
    const comspec = process.env.ComSpec || process.env.COMSPEC || 'powershell.exe'
    if (typeof requested === 'string' && /^(powershell|pwsh|cmd)(\.exe)?$/i.test(requested)) {
      return requested
    }
    return comspec
  }
  const shell = process.env.SHELL || '/bin/sh'
  return typeof requested === 'string' && requested.startsWith('/') ? requested : shell
}

function safeCwd(value) {
  if (typeof value !== 'string' || !value.trim()) return os.homedir()
  return path.resolve(value)
}

function send(mainWindow, channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(channel, payload)
}

export function registerTypewriterTerminalCommands(mainWindow) {
  ipcMain.handle('typewriter-terminal-create', (_event, args = {}) => {
    const id = sessionId()
    const shell = resolveShell(args.shell)
    const cwd = safeCwd(args.cwd)
    const cols = Math.max(20, Math.min(400, Number(args.cols) || 120))
    const rows = Math.max(5, Math.min(200, Number(args.rows) || 36))
    const env = { ...process.env, ...(args.env && typeof args.env === 'object' ? args.env : {}) }
    const ptyProcess = pty.spawn(shell, process.platform === 'win32' && /powershell|pwsh/i.test(shell) ? ['-NoLogo'] : [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env,
      useConpty: process.platform === 'win32'
    })
    const record = { id, pty: ptyProcess, createdAt: Date.now() }
    sessions.set(id, record)
    ptyProcess.onData(data => send(mainWindow, 'typewriter-terminal-data', { sessionId: id, data }))
    ptyProcess.onExit(({ exitCode, signal }) => {
      sessions.delete(id)
      send(mainWindow, 'typewriter-terminal-exit', { sessionId: id, exitCode, signal })
    })
    return { success: true, sessionId: id, shell, cwd }
  })

  ipcMain.handle('typewriter-terminal-write', (_event, args = {}) => {
    const record = sessions.get(args.sessionId)
    if (!record || typeof args.data !== 'string') return { success: false, error: 'Terminal session not found' }
    record.pty.write(args.data)
    return { success: true }
  })

  ipcMain.handle('typewriter-terminal-resize', (_event, args = {}) => {
    const record = sessions.get(args.sessionId)
    if (!record) return { success: false, error: 'Terminal session not found' }
    const cols = Math.max(20, Math.min(400, Number(args.cols) || 120))
    const rows = Math.max(5, Math.min(200, Number(args.rows) || 36))
    record.pty.resize(cols, rows)
    return { success: true, cols, rows }
  })

  ipcMain.handle('typewriter-terminal-kill', (_event, args = {}) => {
    const record = sessions.get(args.sessionId)
    if (!record) return { success: true }
    try { record.pty.kill() } catch {}
    sessions.delete(args.sessionId)
    return { success: true }
  })

  ipcMain.handle('typewriter-terminal-list', () => {
    return [...sessions.values()].map(record => ({ id: record.id, createdAt: record.createdAt }))
  })

  ipcMain.handle('typewriter-file-save', async (_event, args = {}) => {
    const filePath = typeof args.filePath === 'string' ? path.resolve(args.filePath) : ''
    if (!filePath || typeof args.content !== 'string') return { success: false, error: 'Invalid file payload' }
    try {
      await fs.writeFile(filePath, args.content, 'utf8')
      return { success: true, filePath }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  app.on('before-quit', () => {
    for (const record of sessions.values()) {
      try { record.pty.kill() } catch {}
    }
    sessions.clear()
  })
}
