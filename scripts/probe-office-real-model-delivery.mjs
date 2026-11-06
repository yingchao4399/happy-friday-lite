// 真实模型 + PDF AiPanel 原工具循环。仅发送自生成材料；模型配置只读并仅驻留内存。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import { officeProbeRuntime } from './lib/office-probe-runtime.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const filename = fileURLToPath(import.meta.url)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const fault = (code, detail = null) => Object.assign(new Error(code), { code, detail })

export function parseRealModelProbeArguments(args, appData = process.env.APPDATA) {
  let configFile = appData ? path.join(appData, 'happy-friday-lite', 'config.json') : null
  let explicitConfig = false
  const runtimeArgs = []
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--config' || argument.startsWith('--config=')) {
      if (explicitConfig) throw fault('OFFICE_REAL_MODEL_ARGUMENT_REPEATED')
      explicitConfig = true
      const value = argument === '--config' ? args[++index] : argument.slice('--config='.length)
      if (!value || !path.isAbsolute(value) || value.includes('\0')) throw fault('OFFICE_REAL_MODEL_CONFIG_ABSOLUTE_REQUIRED')
      configFile = path.resolve(value)
    } else runtimeArgs.push(argument)
  }
  return { configFile, runtimeArgs }
}

export function readConfiguredModel(configFile) {
  let config
  try { config = JSON.parse(fs.readFileSync(configFile, 'utf8')) } catch { throw fault('MODEL_REQUIRED') }
  const models = Array.isArray(config?.customModels) ? config.customModels : []
  const usable = model => model && ['apiKey', 'modelName'].every(key => typeof model[key] === 'string' && model[key].trim()) &&
    typeof (model.baseUrl || model.modelUrl) === 'string' && (model.baseUrl || model.modelUrl).trim()
  const model = models.find(item => item?.id === config.selectedModelId && usable(item)) || models.find(usable)
  if (!model) throw fault('MODEL_REQUIRED')
  return { model: { ...model, baseUrl: model.baseUrl || model.modelUrl }, configHash: hash(fs.readFileSync(configFile)),
    selection: { selectedConfiguredModel: model.id === config.selectedModelId, modelFingerprint: hash(`${model.provider || 'custom'}\0${model.modelName}`).slice(0, 16), credentialStorage: 'memory-only', source: 'existing-user-config-read-only' } }
}

export function safeModelFailure(chunk = {}) {
  const codes = new Set(['auth', 'provider', 'parameter', 'timeout', 'network', 'overloaded', 'transcript'])
  const diagnostic = chunk.diagnostic || {}
  return { code: 'MODEL_EXTERNAL_FAILURE', errorCode: codes.has(chunk.errorCode) ? chunk.errorCode : 'unspecified',
    ...(Number.isInteger(diagnostic.status) && diagnostic.status >= 100 && diagnostic.status <= 599 ? { httpStatus: diagnostic.status } : {}),
    ...(['connect', 'response', 'stream'].includes(diagnostic.phase) ? { phase: diagnostic.phase } : {}) }
}

export function isProbeArtifactContained(directory, artifactPath) {
  try {
    const root = fs.realpathSync.native(directory)
    const file = fs.realpathSync.native(artifactPath)
    const relative = path.relative(root, file)
    return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  } catch { return false }
}

function writeReport(file, report) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n')
}

async function main() {
  const { configFile, runtimeArgs } = parseRealModelProbeArguments(process.argv.slice(2))
  const runtime = officeProbeRuntime(root, runtimeArgs)
  const reportFile = runtime.reportFile || path.join(root, 'artifacts', 'office-real-model-delivery-report.json')
  let configured
  try { configured = readConfiguredModel(configFile) } catch {
    writeReport(reportFile, { ok: false, checkedAt: new Date().toISOString(), code: 'MODEL_REQUIRED', modelContacted: false,
      coverage: '未配置可用 custom model，未运行外部请求或模拟成功。' })
    process.stdout.write(JSON.stringify({ ok: false, code: 'MODEL_REQUIRED' }) + '\n')
    if (process.versions.electron) (await import('electron')).app.exit(1)
    else process.exitCode = 1
    return
  }
  if (!process.versions.electron) {
    const { spawn } = await import('node:child_process')
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const launchedAt = Date.now()
    const child = spawn(createRequire(import.meta.url)('electron'), [filename, ...process.argv.slice(2)], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    // 产品日志可能含 provider URL；原始 stdout/stderr 既不转发也不落盘。
    child.stdout.resume()
    child.stderr.resume()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill() }, 420000)
    const status = await new Promise(resolve => { child.once('error', () => resolve(1)); child.once('exit', code => resolve(code ?? 1)) })
    clearTimeout(timer)
    if (timedOut || !fs.existsSync(reportFile) || fs.statSync(reportFile).mtimeMs < launchedAt) writeReport(reportFile, { ok: false, checkedAt: new Date().toISOString(), code: timedOut ? 'OFFICE_REAL_MODEL_PROCESS_TIMEOUT' : 'OFFICE_REAL_MODEL_CHILD_FAILED' })
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'))
    process.stdout.write(JSON.stringify({ ok: report.ok, code: report.code || null, error: report.error || null, steps: report.steps?.map(step => ({ name: step.name, ok: step.ok, code: step.code || null })) || [], reportFile }) + '\n')
    process.exitCode = status
    return
  }

  // 仅隔离验收进程禁用原始产品日志，防止模型选择日志暴露 endpoint。
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) console[method] = () => {}
  const { app, BrowserWindow, ipcMain, dialog } = await import('electron')
  runtime.configure(app)
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-office-real-model-'))
  app.setPath('userData', path.join(directory, 'profile'))
  app.on('window-all-closed', () => {})
  const report = { ok: false, checkedAt: new Date().toISOString(), mode: 'real-model-pdf-ai-panel', model: configured.selection,
    runtime: { ...runtime.evidence(), limitation: '真实模型与原 PDF AiPanel 工具循环；主窗口和原生审批由隔离 harness 驱动，不覆盖 Core 自由规划、安装器交互或复杂 PDF 质量。' },
    isolatedDataDir: directory, syntheticInputOnly: true, modelConfigurationCopiedToDisk: false, sourceConfigUnchanged: null,
    approvals: [], saveDialogStubs: 0, coreFreePlanning: { tested: false, reason: '本探针只覆盖 PDF AiPanel；未将确定性 Core fixture 当作真实模型自由规划。' }, steps: [] }
  let db
  let host
  let win
  let source
  let sourceHash
  const originalMessageBox = dialog.showMessageBox
  const originalSaveDialog = dialog.showSaveDialog
  try {
    db = await runtime.load('src-electron/db.js')
    const { setDataDir } = await runtime.load('src-electron/config.js')
    setDataDir(directory)
    db.setDataDir(directory)
    await db.initDb()
    // 普通应用由聚合入口注册；隔离 harness 显式加载同一个真实能力定义。
    await runtime.load('src-electron/agent/tools/builtin/aiChat.js')
    host = await runtime.load('src-electron/office/office-host.js')
    const { setOfficeAiModel } = await runtime.load('src-electron/office/office-ai-bridge.js')
    const { getOfficeTaskLedger } = await runtime.load('src-electron/office/operation-tasks.js')
    const { validateDocx } = await runtime.load('src-electron/office/artifact-delivery.js')
    const ledger = await getOfficeTaskLedger()
    const context = { actor: 'user:local', spaceId: 'friday' }
    ipcMain.handle('project:resolveChat', () => null)
    await app.whenReady()
    win = new BrowserWindow({ show: false, width: 1280, height: 950, webPreferences: { sandbox: true } })
    dialog.showMessageBox = async (_parent, options) => {
      const tool = /office_document_(create|convert)/.exec(options?.detail || '')?.[0]
      if (!tool) throw fault('OFFICE_REAL_MODEL_UNEXPECTED_DIALOG')
      report.approvals.push({ tool, decision: 'approved', nativeDialogStubbed: true, registryApprovalRequested: true })
      return { response: 1 }
    }
    dialog.showSaveDialog = async () => {
      report.saveDialogStubs++
      return { canceled: false, filePath: path.join(directory, `save-dialog-${report.saveDialogStubs}.docx`) }
    }
    if (!await host.initOfficeHost(win)) throw fault('OFFICE_REAL_MODEL_HOST_UNAVAILABLE')
    setOfficeAiModel(configured.model)
    host.setOfficeContentBounds({ x: 0, y: 0, width: 1280, height: 900 })
    const require = createRequire(path.join(root, 'vendor/happyoffice/apps/pdf/package.json'))
    const pdf = await require('pdf-lib').PDFDocument.create()
    const page = pdf.addPage()
    page.drawText('FRIDAY_REAL_MODEL_PDF_6248', { x: 45, y: 750, size: 16 })
    page.drawText('Synthetic report: Revenue 120 units. Cost 80 units. Profit 40 units.', { x: 45, y: 720, size: 11 })
    page.drawText('This generated fixture contains no private or personal information.', { x: 45, y: 695, size: 11 })
    source = path.join(directory, 'synthetic-source.pdf')
    fs.writeFileSync(source, await pdf.save())
    sourceHash = hash(fs.readFileSync(source))
    const opened = await host.openOfficeFile(source)
    if (!opened.success) throw fault('OFFICE_REAL_MODEL_PDF_OPEN_FAILED')
    const wc = host.getOfficeUiTarget().webContents
    const wait = async (predicate, timeoutMs, code) => {
      const until = Date.now() + timeoutMs
      while (Date.now() < until) { if (await predicate()) return; await pause(150) }
      throw fault(code)
    }
    await wait(() => wc.executeJavaScript('Boolean(window.pdfApi?.onAiStream && document.querySelector(".rb-big.ai-entry"))'), 30000, 'OFFICE_REAL_MODEL_RENDERER_NOT_READY')
    await wc.executeJavaScript(`(() => {
      window.__officeRealModelProbe = { requests: [], tools: [], errors: [], events: 0 };
      window.pdfApi.onAiStream(chunk => {
        const p = window.__officeRealModelProbe; p.events++;
        if (chunk.requestId && !p.requests.includes(chunk.requestId)) p.requests.push(chunk.requestId);
        if (chunk.type === 'tool-call') p.tools.push(String(chunk.toolCall?.name || ''));
        if (chunk.type === 'error') p.errors.push({ errorCode: chunk.errorCode, diagnostic: { status: chunk.diagnostic?.status, phase: chunk.diagnostic?.phase } });
      });
      if (!document.querySelector('.copilot textarea')) document.querySelector('.rb-big.ai-entry').click();
      return true;
    })()`)
    await wait(() => wc.executeJavaScript('Boolean(document.querySelector(".copilot textarea"))'), 10000, 'OFFICE_REAL_MODEL_COMPOSER_MISSING')

    const verifyArtifact = record => {
      const artifact = record?.result?.data?.artifact
      if (!artifact?.persisted || !artifact.validation?.valid || !artifact.path || !isProbeArtifactContained(directory, artifact.path)) throw fault('OFFICE_REAL_MODEL_ARTIFACT_INVALID')
      const bytes = fs.readFileSync(artifact.path)
      if (hash(bytes) !== artifact.sha256 || !validateDocx(bytes).valid) throw fault('OFFICE_REAL_MODEL_DOCX_READBACK_FAILED')
      const xml = new AdmZip(bytes).readAsText('word/document.xml')
      return { path: artifact.path, sha256: artifact.sha256, bytes: bytes.length, persisted: true, validation: { valid: true }, open: artifact.open,
        editableText: /<w:t[\s>]/.test(xml), plainText: xml.replace(/<[^>]*>/g, '') }
    }

    async function run(name, prompt, operationId, expectedTool, marker) {
      const step = { name, ok: false, entry: 'real PDF AiPanel textarea input + send button', prompt, expectedTool, operationId }
      report.steps.push(step)
      const before = await wc.executeJavaScript('structuredClone(window.__officeRealModelProbe)')
      const previous = new Set((await ledger.list(context)).map(record => record.taskId))
      await wc.executeJavaScript(`(() => { const textarea = document.querySelector('.copilot textarea');
        textarea.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, ${JSON.stringify(prompt)});
        textarea.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`)
      await wait(() => wc.executeJavaScript('Boolean(document.querySelector(".copilot .ai-send-btn:not(.ai-stop-btn):not(:disabled)"))'), 10000, 'OFFICE_REAL_MODEL_COMPOSER_INPUT_FAILED')
      await wc.executeJavaScript('document.querySelector(".copilot .ai-send-btn:not(.ai-stop-btn)").click(); true')
      let observedStart = false
      const deadline = Date.now() + 180000
      let probe
      let externalError
      while (Date.now() < deadline) {
        probe = await wc.executeJavaScript(`({ ...structuredClone(window.__officeRealModelProbe), busy: Boolean(document.querySelector('.copilot .ai-stop-btn')), panelError: Boolean(document.querySelector('.copilot .ai-msg-error')) })`)
        if (probe.busy || probe.requests.length > before.requests.length) observedStart = true
        if (probe.errors.length > before.errors.length) { externalError = safeModelFailure(probe.errors.at(-1)); break }
        if (observedStart && !probe.busy) break
        await pause(250)
      }
      step.modelRequests = (probe?.requests.length || 0) - before.requests.length
      step.modelSelectedTools = probe?.tools.slice(before.tools.length) || []
      step.transportUnmodified = true
      const record = (await ledger.list(context)).findLast(item => !previous.has(item.taskId) && item.operationId === operationId)
      if (record?.result?.data?.artifact?.persisted) {
        const artifact = verifyArtifact(record)
        step.markerFoundInDocxXml = artifact.plainText.includes(marker)
        delete artifact.plainText
        step.artifact = artifact
        step.taskId = record.taskId
      }
      step.sourceHashUnchanged = hash(fs.readFileSync(source)) === sourceHash
      if (externalError) { step.code = externalError.code; step.error = externalError; throw fault(externalError.code, externalError) }
      if (!observedStart || probe?.busy) throw fault('OFFICE_REAL_MODEL_RUN_TIMEOUT')
      if (probe?.panelError) throw fault('OFFICE_REAL_MODEL_PANEL_ERROR')
      if (!step.modelSelectedTools.includes(expectedTool)) throw fault('OFFICE_REAL_MODEL_WRONG_TOOL')
      if (!step.artifact || !step.markerFoundInDocxXml || !step.artifact.editableText) throw fault('OFFICE_REAL_MODEL_DELIVERY_NOT_VERIFIED')
      if (!step.sourceHashUnchanged) throw fault('OFFICE_REAL_MODEL_SOURCE_CHANGED')
      if (!report.approvals.some(approval => approval.tool === `office_document_${expectedTool === 'convert_document' ? 'convert' : 'create'}`)) throw fault('OFFICE_REAL_MODEL_APPROVAL_NOT_OBSERVED')
      step.ok = true
    }

    await run('natural language PDF to Word', '请把当前 PDF 转换为可编辑的 Word（.docx）文件并保存，保留全部文字，不修改源 PDF，不联网搜索。请实际完成转换后告诉我保存结果。', 'office.document.convert', 'convert_document', 'FRIDAY_REAL_MODEL_PDF_6248')
    await run('natural language authored content to Word', '请把以下合成内容整理为新建的 Word（.docx）文件并保存，标题为“合成内容验证”。正文原样保留标记 FRIDAY_REAL_MODEL_CONTENT_7391，并写明：收入120单位，成本80单位，利润40单位。请实际创建文件，不修改源 PDF，不联网搜索。', 'office.document.create', 'create_document', 'FRIDAY_REAL_MODEL_CONTENT_7391')
    report.ok = true
  } catch (error) {
    report.code = /^[A-Z][A-Z0-9_]+$/.test(error?.code || '') ? error.code : 'OFFICE_REAL_MODEL_PROBE_FAILED'
    report.error = error?.detail || { code: report.code }
    const current = report.steps.at(-1)
    if (current && !current.ok && !current.code) current.code = report.code
  } finally {
    try { report.sourceConfigUnchanged = hash(fs.readFileSync(configFile)) === configured.configHash } catch { report.sourceConfigUnchanged = false }
    if (source && fs.existsSync(source)) report.sourceHashUnchanged = hash(fs.readFileSync(source)) === sourceHash
    if (!report.sourceConfigUnchanged) { report.ok = false; report.code = 'OFFICE_REAL_MODEL_CONFIG_CHANGED' }
    dialog.showMessageBox = originalMessageBox
    dialog.showSaveDialog = originalSaveDialog
    writeReport(reportFile, report)
    try { host?.shutdownOfficeHost() } catch {}
    try { db?.closeDb() } catch {}
    if (win && !win.isDestroyed()) win.destroy()
    app.exit(report.ok ? 0 : 1)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === filename) {
  // Electron ready 等待主模块完成评估；不能在入口顶层 await 整个验收。
  void main().catch(async () => {
    // 只输出固定代码，原始异常可能含 provider endpoint。
    process.stdout.write(JSON.stringify({ ok: false, code: 'OFFICE_REAL_MODEL_INITIALIZATION_FAILED' }) + '\n')
    if (process.versions.electron) (await import('electron')).app.exit(1)
    else process.exitCode = 1
  })
}
