import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setDataDir } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'
import zlib from 'node:zlib'

const originalConfig = process.argv.find(arg => arg.startsWith('--config='))?.slice(9) || path.join(process.env.APPDATA || '', 'happy-friday-lite', 'config.json')
const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-dsh-web-ui-'))
app.setPath('userData', path.join(isolated, 'profile'))
app.on('window-all-closed', () => {})


async function until(check, label, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return true
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error(`DSH_PROBE_TIMEOUT: ${label}`)
}

// 只接受持久化 assistant/message，用户提示和侧栏标题不能当作模型回答。
function assistantReply(token) {
  function matched(value) {
    if (!value || typeof value !== 'object') return false
    if (value.type === 'assistant/message') {
      const content = value.data?.message?.content
      return Array.isArray(content) && content.some(part => part.type === 'text' && part.text?.trim() === token)
    }
    return Object.values(value).some(child => child && typeof child === 'object' && matched(child))
  }
  function visit(directory) {
    if (!fs.existsSync(directory)) return false
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const filename = path.join(directory, entry.name)
      if (entry.isDirectory()) { if (visit(filename)) return true }
      else if (/\.jsonl(?:\.zstd)?$/.test(entry.name)) {
        try {
          const bytes = fs.readFileSync(filename)
          // DSH 每次 append 都写独立 Zstd frame。Node 的同步解压只消费
          // 一个 frame，必须按 bytesWritten 继续读取后面的真实消息。
          let text = ''
          if (filename.endsWith('.zstd')) {
            for (let offset = 0; offset < bytes.length;) {
              const decoded = zlib.zstdDecompressSync(bytes.subarray(offset), { info: true })
              if (!decoded.engine.bytesWritten) break
              offset += decoded.engine.bytesWritten
              text += decoded.buffer.toString('utf8')
            }
          } else text = bytes.toString('utf8')
          if (text.split('\n').filter(Boolean).some(line => matched(JSON.parse(line)))) return true
        } catch { /* 正在写入的尾行或压缩帧稍后重读。 */ }
      }
    }
    return false
  }
  return visit(path.join(isolated, 'deepseek-harness', 'home', 'sessions'))
}

async function main() {
  let host, harness, workspacePath
  let stopHarnessSidecar = async () => {}
  const deadline = setTimeout(() => { process.exitCode = 1; stopHarnessSidecar().finally(() => app.exit(1)) }, 180000)
  try {
    // Import the DSH host only after Electron is ready so a missing transitive
    // package is caught by this probe and still runs the cleanup path.
    const harnessApi = await import('../src-electron/harness/index.js')
    const { registerHarnessCommands, startHarnessSidecar } = harnessApi
    stopHarnessSidecar = harnessApi.stopHarnessSidecar
    const config = JSON.parse(fs.readFileSync(originalConfig, 'utf8'))
    const model = (config.customModels || []).find(item => item.id === config.selectedModelId && item.apiKey && item.baseUrl && item.modelName)
    if (!model) throw new Error('No complete selected model configuration')
    fs.writeFileSync(path.join(isolated, 'config.json'), JSON.stringify(config), { mode: 0o600 })
    setDataDir(isolated); db.setDataDir(isolated); await db.initDb()
    // Keep the fixture under the user's home so the native directory picker
    // can select it through its normal folder list, exactly as a user does.
    workspacePath = fs.mkdtempSync(path.join(os.homedir(), 'friday-dsh-probe-'))
    host = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    registerHarnessCommands(host)
    const status = await startHarnessSidecar()
    if (status.status !== 'ready' || !status.url) throw new Error(`Harness not ready: ${status.stage || status.status}`)
    harness = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { sandbox: true } })
    const failures = []
    harness.webContents.on('did-fail-load', (_event, code, description, url) => failures.push({ code, description, url: url.split('?')[0] }))
    await harness.loadURL(status.url)
    await new Promise(resolve => setTimeout(resolve, 1800))
    const before = await harness.webContents.executeJavaScript(`(() => ({
      title: document.title,
      ready: document.readyState,
      text: document.body.innerText.slice(0, 3000),
      inputs: [...document.querySelectorAll('textarea,input,[contenteditable="true"],[role="textbox"]')].map(el => ({ tag: el.tagName, type: el.getAttribute('type'), role: el.getAttribute('role'), placeholder: el.getAttribute('placeholder'), ariaLabel: el.getAttribute('aria-label'), value: el.value || el.innerText || '' })),
      buttons: [...document.querySelectorAll('button')].map(el => ({ label: el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText?.trim(), disabled: el.disabled })).filter(el => el.label).slice(0, 50),
      frames: document.querySelectorAll('iframe').length
    }))()`, true)
    const workspace = await harness.webContents.executeJavaScript(`(() => { const el = document.querySelector('[role="textbox"][aria-label="选择工作区"]'); if (el) el.click(); return Boolean(el) })()`, true)
    if (workspace) await new Promise(resolve => setTimeout(resolve, 500))
    const editPath = false
    let pickerPathFields = []
    await new Promise(resolve => setTimeout(resolve, 200))
    pickerPathFields = await harness.webContents.executeJavaScript(`(() => [...document.querySelectorAll('[role="dialog"] input,[role="dialog"] textarea,[role="dialog"] [contenteditable="true"],[role="dialog"] [role="textbox"]')].map(el => ({ tag: el.tagName, role: el.getAttribute('role'), type: el.getAttribute('type'), placeholder: el.getAttribute('placeholder'), ariaLabel: el.getAttribute('aria-label'), value: el.value || el.innerText || '' })))()`, true)
    const folderClicked = await harness.webContents.executeJavaScript(`(() => { const d=document.querySelector('[role="dialog"]'); const el=[...(d?.querySelectorAll('button')||[])].find(n => (n.innerText||'').trim() === ${JSON.stringify(path.basename(workspacePath))}); if(el) el.click(); return Boolean(el) })()`, true)
    if (folderClicked) await new Promise(resolve => setTimeout(resolve, 200))
    const afterWorkspaceClick = await harness.webContents.executeJavaScript(`({
      fields: [...document.querySelectorAll('textarea,input,[contenteditable="true"],[role="textbox"]')].map(el => ({ tag: el.tagName, type: el.getAttribute('type'), role: el.getAttribute('role'), placeholder: el.getAttribute('placeholder'), ariaLabel: el.getAttribute('aria-label'), className: String(el.className || ''), valueLength: String(el.value || el.innerText || '').length })),
      dialogs: [...document.querySelectorAll('[role="dialog"],dialog')].map(el => ({ role: el.getAttribute('role'), className: String(el.className || ''), fieldCount: el.querySelectorAll('input,textarea,[contenteditable="true"]').length, buttonCount: el.querySelectorAll('button').length })),
      actionLabels: [...document.querySelectorAll('button')].map(el => el.getAttribute('aria-label') || el.getAttribute('title')).filter(Boolean),
      dialogLabels: [...document.querySelectorAll('[role="dialog"] button')].map(el => ({ text: (el.innerText||'').trim(), aria: el.getAttribute('aria-label'), disabled: el.disabled })).slice(-8)
    })`, true)
    const openWorkspace = await harness.webContents.executeJavaScript(`(() => { const d=document.querySelector('[role="dialog"]'); const el=[...(d?.querySelectorAll('button')||[])].find(n => ['打开','Open'].includes((n.innerText||'').trim())); if(el&&!el.disabled) el.click(); return Boolean(el&&!el.disabled) })()`, true)
    if (openWorkspace) await new Promise(resolve => setTimeout(resolve, 1000))
    await until(() => harness.webContents.executeJavaScript(`(() => {
      const editor = document.querySelector('[contenteditable="true"][role="textbox"]')
      if (editor) editor.focus()
      return Boolean(editor)
    })()`, true), 'editable-composer')
    const probeToken = 'FRIDAY_DSH_PROBE_63CF'
    harness.webContents.focus()
    await harness.webContents.insertText(`请只输出 ${probeToken}。不要调用任何工具，不要访问文件，不要执行命令。`)
    await until(() => harness.webContents.executeJavaScript(`(() => { const el=document.querySelector('button[aria-label="发送消息"]'); return Boolean(el&&!el.disabled) })()`, true), 'send-enabled')
    await harness.webContents.executeJavaScript(`document.querySelector('button[aria-label="发送消息"]').click()`, true)
    const sent = { ok: true }
    await until(() => assistantReply(probeToken), 'persisted-assistant-reply', 90000)
    const reply = { ok: true, persistedAssistantMessage: true }
    const composer = { editable: true }
    console.log(JSON.stringify({ ok: status.status === 'ready' && before.ready === 'complete' && failures.length === 0 && workspace && openWorkspace && sent.ok && reply.ok, status: status.status, model: status.model, toolCount: status.toolCount, timings: status.timings, webTitle: before.title, readyState: before.ready, workspaceSelectorFound: workspace, editPath, pickerPathFields, openWorkspace, composer, sent, reply, failures }))
    if (!sent.ok || !reply.ok) process.exitCode = 1
    if (before.ready !== 'complete' || failures.length) process.exitCode = 1
  } catch (error) {
    console.error(JSON.stringify({ ok: false, message: error.message }))
    process.exitCode = 1
  } finally {
    clearTimeout(deadline)
    await stopHarnessSidecar().catch(() => {})
    db.closeDb()
    if (harness && !harness.isDestroyed()) harness.destroy()
    if (host && !host.isDestroyed()) host.destroy()
    try { removePathNoFollowSync(isolated, { root: os.tmpdir() }) } catch { /* Electron may still hold its temporary profile. */ }
    try { workspacePath && removePathNoFollowSync(workspacePath, { root: os.homedir() }) } catch { /* fixture cleanup */ }
    app.exit(process.exitCode || 0)
  }
}

app.whenReady().then(main).catch(error => {
  console.error(JSON.stringify({ ok: false, message: error.message }))
  process.exitCode = 1
  app.exit(1)
})
