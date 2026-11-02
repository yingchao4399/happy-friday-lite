import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const executable = path.resolve(root, process.argv[2] || 'release/win-unpacked/Happy Friday Lite.exe')
const timeoutMs = 90_000
const fatalOutput = /Uncaught Exception:|FATAL ERROR:|does not provide an export named|Cannot find package|ReferenceError:|SyntaxError:/

if (!(await fs.stat(executable).catch(() => null))?.isFile()) {
  throw new Error(`Packaged application not found: ${executable}`)
}

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'happy-friday-startup-smoke-'))
const child = spawn(executable, [`--friday-data-dir=${dataDir}`, '--disable-gpu'], {
  cwd: path.dirname(executable),
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
let settled = false
let pageLoaded = false
let windowReady = false
let runtimeError = null
let timer

function collect(chunk) {
  output = (output + chunk.toString()).slice(-1024 * 1024)
  if (fatalOutput.test(output)) {
    runtimeError = new Error(`Fatal startup output detected:\n${output}`)
    finish(runtimeError)
  }
  if (output.includes('[Main] 主窗口页面加载完成')) pageLoaded = true
  if (output.includes('[Main] 主窗口 ready-to-show')) windowReady = true
  if (pageLoaded && windowReady) finish()
}

function finish(error) {
  if (settled) return
  settled = true
  clearTimeout(timer)
  error ? reject(error) : resolve()
}

let resolve
let reject
const startup = new Promise((res, rej) => { resolve = res; reject = rej })

child.stdout.on('data', collect)
child.stderr.on('data', collect)
child.once('error', error => finish(error))
child.once('exit', (code, signal) => {
  runtimeError ||= new Error(`Packaged application exited unexpectedly (code=${code}, signal=${signal}).\n${output}`)
  finish(runtimeError)
})

timer = setTimeout(() => finish(new Error(`Timed out waiting for the packaged main window.\n${output}`)), timeoutMs)

try {
  await startup
  await new Promise(resolve => setTimeout(resolve, 10_000))
  if (runtimeError) throw runtimeError
  console.log('[smoke-electron-startup] Main window rendered without startup exceptions.')
} finally {
  try {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 1500))
  try {
    await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  } catch (error) {
    console.warn(`[smoke-electron-startup] Could not remove temporary data directory: ${error.message}`)
  }
}
