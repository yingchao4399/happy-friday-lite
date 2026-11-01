import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const root = process.cwd()
const batch = process.argv[2] || 'dock'
const scaleArg = process.argv.find(value => value.startsWith('--scale='))
const scale = scaleArg ? Number(scaleArg.slice('--scale='.length)) : 1
const port = 9460 + Math.round(scale * 10)
const executable = process.env.FRIDAY_PACKAGED_EXECUTABLE || path.join(root, 'release', 'win-unpacked', 'Happy Friday Lite.exe')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), `friday-packaged-dock-${batch}-`))
const log = fs.openSync(path.join(root, 'artifacts', `packaged-dock-${batch}.log`), 'w')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(executable, [`--friday-data-dir=${profile}`, `--remote-debugging-port=${port}`, ...(scale !== 1 ? [`--force-device-scale-factor=${scale}`] : [])], { env, stdio: ['ignore', log, log], windowsHide: true })
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const pending = new Map()
let socket
let sequence = 0
const report = { batch, scale, ok: false, checks: [], profile }
let lastPages = []

async function rpc(method, params = {}) {
  const id = ++sequence
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout`)) }, 45_000)
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const value = await rpc('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text)
  return value.result?.value
}
async function until(expression, timeout = 90_000) {
  for (const end = Date.now() + timeout; Date.now() < end;) {
    if (await evaluate(expression)) return
    await pause(150)
  }
  throw new Error(`timeout: ${expression}`)
}
async function click(selector) {
  const point = await evaluate(`(() => { const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r && {x:r.x+r.width/2,y:r.y+r.height/2} })()`)
  assert.ok(point, `找不到可点击元素 ${selector}`)
  await rpc('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
  await rpc('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
}
async function key(key, code, virtualKey, modifiers = 0) {
  for (const type of ['keyDown', 'keyUp']) await rpc('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: virtualKey, modifiers })
}

try {
  let target
  for (const end = Date.now() + 90_000; Date.now() < end;) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      lastPages = pages.map(page => ({ type: page.type, url: page.url, title: page.title }))
      target = pages.find(page => page.type === 'page' && (page.url.includes('index.html') || page.url.startsWith('file:')))
      if (target) break
    } catch { /* wait for packaged Chromium */ }
    await pause(250)
  }
  assert.ok(target, 'packaged renderer did not start')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    const task = pending.get(message.id)
    if (!task) return
    pending.delete(message.id)
    message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result)
  }
  await until('Boolean(document.querySelector(".app-container"))')
  await evaluate("location.hash='#/friday'")
  await until('Boolean(document.querySelector(".agent-dock-trigger"))')
  await rpc('Page.bringToFront')
  await click('.agent-dock-trigger')
  await until('Boolean(document.querySelector(".agent-dock-panel"))')
  const state = await evaluate(`(() => {
    const panel = document.querySelector('.agent-dock-panel')
    const history = panel?.querySelector('.scoped-history-toggle')
    const create = panel?.querySelector('.agent-dock-small-button')
    const input = panel?.querySelector('textarea')
    const send = panel?.querySelector('form button[type="submit"]')
    const rect = panel?.getBoundingClientRect()
    return { viewport:{width:innerWidth,height:innerHeight}, panel: Boolean(panel), history: Boolean(history), create: Boolean(create), input: Boolean(input), sendDisabled: Boolean(send?.disabled), rect: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null }
  })()`)
  assert.equal(state.panel, true)
  assert.equal(state.history, true)
  assert.equal(state.create, true)
  assert.equal(state.input, true)
  assert.equal(state.sendDisabled, true)
  assert.ok(state.rect && state.rect.left >= 0 && state.rect.top >= 0 && state.rect.right <= state.viewport.width && state.rect.bottom <= state.viewport.height)
  report.viewport = state.viewport
  report.checks.push('安装版 Dock 展开、历史、新建、输入框和边界')
  await click('.agent-dock-small-button')
  await pause(250)
  const session = await evaluate("window.electronAPI.invoke('get_sessions',{scope:'dock',scopeKey:'global'}).then(v=>Array.isArray(v)?v:[])")
  assert.ok(session.length >= 1)
  await click('.scoped-history-toggle')
  await until('Boolean(document.querySelector(".scoped-history-panel"))')
  const historyState = await evaluate(`(() => {
    const trigger = document.querySelector('.scoped-history-toggle').getBoundingClientRect()
    const panel = document.querySelector('.scoped-history-panel').getBoundingClientRect()
    return { viewport:{width:innerWidth,height:innerHeight}, trigger: { left: trigger.left, right: trigger.right, top: trigger.top, bottom: trigger.bottom }, panel: { left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom }, text: document.querySelector('.scoped-history-panel').textContent }
  })()`)
  assert.match(historyState.text, /会话历史|Conversation history/i)
  assert.ok(historyState.panel.left >= 0 && historyState.panel.top >= 0 && historyState.panel.right <= historyState.viewport.width && historyState.panel.bottom <= historyState.viewport.height)
  const horizontalGap = Math.max(0, historyState.panel.left-historyState.trigger.right,historyState.trigger.left-historyState.panel.right)
  const verticalGap = Math.max(0, historyState.panel.top-historyState.trigger.bottom,historyState.trigger.top-historyState.panel.bottom)
  assert.ok(horizontalGap <= 16 && verticalGap <= 16, '历史面板必须紧邻触发按钮')
  report.historyBounds = historyState
  report.checks.push('安装版历史弹窗加载、可见且锚定在历史按钮附近')
  await until('document.activeElement?.matches(".scoped-history-search input")')
  await key('Escape', 'Escape', 27)
  await until('!document.querySelector(".scoped-history-panel")')
  assert.ok(await evaluate('document.activeElement?.matches(".scoped-history-toggle")'), 'Esc 后焦点必须归还历史按钮')
  await click('.agent-dock-panel textarea')
  await rpc('Input.imeSetComposition', { text:'中文组合', selectionStart:4, selectionEnd:4 })
  await rpc('Input.insertText', {text:'安装版中文 Dock 测试'})
  const inputState = await evaluate('({ value: document.querySelector(".agent-dock-panel textarea")?.value, disabled: document.querySelector(".agent-dock-panel form button[type=submit]")?.disabled })')
  assert.equal(inputState.value, '安装版中文 Dock 测试')
  assert.equal(inputState.disabled, false)
  report.checks.push('安装版 Dock 中文输入后发送按钮启用')
  for (let index=0; index<30; index++) {
    await key('a','KeyA',65,2)
    const text = index%2 ? `English keyboard ${index}` : `中文键盘输入 ${index}`
    await rpc('Input.insertText',{text})
    assert.equal(await evaluate('document.querySelector(".agent-dock-panel textarea").value'), text)
  }
  report.checks.push('30 次中英文 Chromium 输入无丢字、IME 组合提交、Esc 焦点恢复')
  report.ok = true
} catch (error) {
  report.error = error.stack || String(error)
  if (!report.ok && lastPages.length) report.pages = lastPages
  process.exitCode = 1
} finally {
  fs.writeFileSync(path.join(root, 'artifacts', `packaged-dock-${batch}-report.json`), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
  if (socket?.readyState === 1) { await rpc('Browser.close').catch(() => {}); socket.close() }
  if (!child.killed) setTimeout(() => child.kill(), 5000).unref()
  fs.closeSync(log)
}
