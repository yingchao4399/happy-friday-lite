import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const fatalOutput = /Uncaught Exception:|FATAL ERROR:|does not provide an export named|Cannot find package|ReferenceError:|SyntaxError:|No handler registered|Attempted to register a second handler|Failed to register IPC commands|ERR_FILE_NOT_FOUND|主窗口页面加载失败|安装页面加载失败/i

export function hasFatalStartupOutput(output) {
  return fatalOutput.test(output)
}

export function hasStartupCompleted(output) {
  return output.includes('[Main] 主窗口页面加载完成') &&
    output.includes('[Main] 主窗口 ready-to-show') &&
    output.includes('[Main] ✅ IPC commands registered successfully')
}

export function validateIpcResults(results) {
  assert.ok(Array.isArray(results['clipboard-list']), 'clipboard-list 必须返回数组')
  assert.equal(typeof results['clipboard-settings-get']?.captureEnabled, 'boolean', '剪贴板设置未正常返回')
  assert.ok(Array.isArray(results['recitation-list']), 'recitation-list 必须返回数组')
  const python = results['python-status']
  assert.equal(typeof python?.available, 'boolean', 'Python 状态未正常返回')
  assert.ok(python.path === null || typeof python.path === 'string', 'Python 路径无效')
  assert.ok(python.version === null || typeof python.version === 'string', 'Python 版本无效')
  // 无 Python 的构建机器允许返回明确的不可用状态，但不能吞掉 IPC 异常。
  if (!python.available) assert.equal(typeof python.reason, 'string', 'Python 不可用时必须返回原因')
  const rag = results['rag-get-kb-summary']
  assert.equal(rag?.success, true, `知识库摘要失败: ${rag?.error || '无返回值'}`)
  assert.ok(rag.summary && typeof rag.summary === 'object' && Object.keys(rag.summary).length > 0, '知识库摘要为空')
  for (const summary of Object.values(rag.summary)) {
    for (const key of ['total', 'success', 'pending', 'processing', 'failed', 'vectorCount']) {
      assert.ok(Number.isInteger(summary[key]) && summary[key] >= 0, `知识库摘要 ${key} 无效`)
    }
  }
}

async function connectCdp(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  let sequence = 0
  const rejectPending = error => {
    for (const task of pending.values()) {
      clearTimeout(task.timer)
      task.reject(error)
    }
    pending.clear()
  }
  socket.addEventListener('close', () => rejectPending(new Error('CDP 连接意外关闭')))
  socket.addEventListener('error', () => rejectPending(new Error('CDP 连接失败')))
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('连接 CDP 超时')) }, 5_000)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('连接 CDP 失败')) }, { once: true })
  })
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    const task = pending.get(message.id)
    if (!task) return
    pending.delete(message.id)
    clearTimeout(task.timer)
    message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result)
  })
  const evaluate = async expression => {
    const result = await new Promise((resolve, reject) => {
      const id = ++sequence
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('渲染进程 IPC 验证超时')) }, 25_000)
      pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result?.value
  }
  return { evaluate, close: () => { rejectPending(new Error('CDP 验证结束')); socket.close() } }
}

export async function smokeElectronStartup(executable, { timeoutMs = 90_000 } = {}) {
  if (!(await fs.stat(executable).catch(() => null))?.isFile()) throw new Error(`Packaged application not found: ${executable}`)
  if (typeof WebSocket !== 'function') throw new Error('CDP 冒烟验证需要 Node.js 22 或更新版本')

  // Chromium 分配随机调试端口，数据目录不读取或修改用户保存的目录指针。
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'happy-friday-startup-smoke-'))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(executable, [`--friday-data-dir=${dataDir}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--disable-gpu'], {
    cwd: path.dirname(executable), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  let runtimeError = null
  let stopping = false
  let cdp
  const deadline = Date.now() + timeoutMs
  const collect = chunk => {
    output = (output + chunk.toString()).slice(-1024 * 1024)
    if (hasFatalStartupOutput(output)) runtimeError ||= new Error(`Fatal startup output detected:\n${output}`)
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  child.once('error', error => { runtimeError ||= error })
  child.once('exit', (code, signal) => {
    if (!stopping) runtimeError ||= new Error(`Packaged application exited unexpectedly (code=${code}, signal=${signal}).\n${output}`)
  })
  const waitFor = async (predicate, description) => {
    while (Date.now() < deadline) {
      if (runtimeError) throw runtimeError
      const value = await predicate()
      if (runtimeError) throw runtimeError
      if (value) return value
      await pause(100)
    }
    throw new Error(`Timed out waiting for ${description}.\n${output}`)
  }

  try {
    // 日志只能证明启动阶段结束；随后仍须从真实渲染进程验证 preload 和 handler。
    await waitFor(() => hasStartupCompleted(output), 'the packaged main window and IPC registration')
    const port = await waitFor(() => output.match(/DevTools listening on ws:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)\//)?.[1], 'the random CDP port')
    const page = await waitFor(async () => {
      let response
      try { response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2_000) }) } catch { return null }
      if (!response.ok) throw new Error(`CDP target 列表请求失败: ${response.status}`)
      const pages = await response.json()
      return pages.find(item => item.type === 'page' && /\/dist\/index\.html(?:[?#]|$)/.test(item.url))
    }, 'the packaged renderer CDP target')
    cdp = await connectCdp(page.webSocketDebuggerUrl)
    await waitFor(() => cdp.evaluate('Boolean(document.querySelector(".app-container") && window.electronAPI && typeof window.electronAPI.invoke === "function")'), 'Vue and the preload IPC bridge')
    const results = await cdp.evaluate(`(async () => {
      const results = {}
      for (const [channel, args] of [
        ['clipboard-list', { limit: 1, compact: true }],
        ['clipboard-settings-get'], ['recitation-list'], ['python-status'], ['rag-get-kb-summary', {}]
      ]) results[channel] = await window.electronAPI.invoke(channel, args)
      return results
    })()`)
    validateIpcResults(results)
    // 保留原有观察期，捕获延迟后台初始化和渲染进程调用触发的错误。
    for (let i = 0; i < 100; i++) {
      if (runtimeError) throw runtimeError
      await pause(100)
    }
    if (runtimeError) throw runtimeError
    console.log('[smoke-electron-startup] 主窗口、preload 及剪贴板/背诵/Python/知识库 IPC 验证通过。')
  } finally {
    stopping = true
    cdp?.close()
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
        else child.kill('SIGKILL')
      } catch {}
    }
    await pause(1500)
    // 仅删除本次 mkdtemp 创建的目录，绝不对用户目录执行清理。
    assert.equal(path.dirname(dataDir), path.resolve(os.tmpdir()))
    assert.ok(path.basename(dataDir).startsWith('happy-friday-startup-smoke-'))
    await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  }
}

// Windows 工作区可能通过目录联接访问，比较真实路径以免直接执行被误判为 import。
const invokedPath = process.argv[1] && await fs.realpath(process.argv[1]).catch(() => null)
if (invokedPath && invokedPath === await fs.realpath(fileURLToPath(import.meta.url))) {
  const executable = path.resolve(root, process.argv[2] || 'release/win-unpacked/Happy Friday Lite.exe')
  await smokeElectronStartup(executable)
}
