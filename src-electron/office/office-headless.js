/**
 * Headless 导出入口（移植自上游 apps/shell 的 --headless-export 机制）
 * ====================================================================
 *   <app binary> --headless-export <input> --to <format> --out <path> [--json]
 *
 * happyfriday-office CLI 的 pdf/docx/html 导出（convert / create --type pdf）
 * 需要宿主应用以隐藏窗口运行与 GUI 完全相同的渲染管线。CLI 会自动 spawn
 * 本应用二进制并携带上述参数；本模块在 app ready 前解析 argv，ready 后
 * 跳过所有常规初始化，仅执行一次导出并退出（退出码 0/1/2/3）。
 *
 * HTML/HTM 在实验预览版中使用独立固定来源的渲染器；Markdown 仍未开放。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { app, BrowserWindow, ipcMain } from 'electron'
import { assertOfficeBundle } from './bundle-contract.js'
import { isExperimentalHtmlEnabled, enablePackagedPreviewHtml } from './office-files.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const _require = createRequire(import.meta.url)

function officeRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'office')
    : path.resolve(__dirname, '..', '..', 'resources', 'office')
}

let officeUtils = null
try {
  officeUtils = _require(path.join(officeRoot(), 'main', 'office-utils.cjs'))
} catch { /* 产物缺失时视为普通启动 */ }

// 必须在 app ready 前完成：让编辑器模块在任何注册之前看到 headless 标记
let headlessArgv = { kind: 'none' }
if (officeUtils?.parseHeadlessExportArgv) {
  try {
    headlessArgv = officeUtils.parseHeadlessExportArgv(process.argv)
    if (headlessArgv.kind !== 'none') officeUtils.setHeadlessMode(true)
  } catch { /* 解析失败按普通启动处理 */ }
}

export function isHeadlessExportRun() {
  return headlessArgv.kind !== 'none'
}

async function loadBundle(editor) {
  const mod = await import(pathToFileURL(path.join(officeRoot(), 'main', `${editor}-main.cjs`)).href)
  return mod.default ?? mod
}

/** 与 office-host 相同的"重复注册时后注册者替换"兜底（隐藏窗口 renderer 需要多个编辑器 IPC 通道） */
function tolerateDuplicateIpcHandlers() {
  if (ipcMain.handle.__officePatched) return
  const rawHandle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, listener) => {
    try { ipcMain.removeHandler(channel) } catch { /* not registered */ }
    return rawHandle(channel, listener)
  }
  ipcMain.handle.__officePatched = true
}

function registerEditorIpc(bundles) {
  tolerateDuplicateIpcHandlers()
  const { docs, sheets, slides } = bundles
  try { docs?.registerAiIpc?.() } catch (e) { console.warn('[Office] docs registerAiIpc:', e.message) }
  try { docs?.registerProjectIpc?.() } catch (e) { console.warn('[Office] docs registerProjectIpc:', e.message) }
  try { docs?.registerDocsIpc?.() } catch (e) { console.warn('[Office] registerDocsIpc:', e.message) }
  try { sheets?.registerSheetsIpc?.() } catch (e) { console.warn('[Office] registerSheetsIpc:', e.message) }
  try { slides?.registerSlidesIpc?.() } catch (e) { console.warn('[Office] registerSlidesIpc:', e.message) }
}

function registerHtmlHeadlessServices() {
  // 单次 CLI 转换不读取用户凭证、创建聊天或写入应用数据库。
  const values = {
    'app:get-theme': 'light',
    'app:get-language': app.getLocale().startsWith('zh') ? 'zh' : 'en',
    'app:get-auto-save-default': { on: false, updatedAt: 0 },
    'app:get-ai-panel-prefs': { side: 'right', fontSize: 'default', customFontSize: 14, spellcheck: true },
    'ai:get-settings': { configured: false, provider: null, model: null, providers: {}, capabilities: {}, gskToolsEnabled: false, maxOutputTokens: 8192 },
    'ai:gsk-status': { loggedIn: false },
    'project:resolveChat': { projectId: 'headless', chatId: 'headless' },
    'project:loadChat': [],
    'project:appendChat': null,
    'project:rebindChat': null,
  }
  for (const [channel, value] of Object.entries(values)) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, event => {
      if (event.senderFrame !== event.sender.mainFrame) throw new Error('OFFICE_HTML_SENDER_INVALID')
      return value
    })
  }
}

/**
 * 执行一次 headless 导出并 app.exit。正常路径不会 return（进程已退出）。
 */
export async function runHeadlessExportEntry() {
  if (!officeUtils) {
    process.stdout.write(JSON.stringify({ status: 'error', error: 'office runtime missing' }) + '\n')
    app.exit(3)
    return
  }
  const { HEADLESS_EXIT, formatHeadlessEnvelope, headlessExitCode } = officeUtils
  const json = headlessArgv.kind === 'ok' ? headlessArgv.request.json : headlessArgv.json

  const finish = async (outcome) => {
    try { (await import('./office-host.js')).shutdownOfficeHost?.() } catch { /* ignore */ }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.destroy()
    }
    // 管道写入是异步的，app.exit 可能截断 envelope，等待刷新（最多 2s）
    const line = formatHeadlessEnvelope(outcome, json) + '\n'
    await new Promise((resolve) => {
      const bail = setTimeout(resolve, 2000)
      process.stdout.write(line, () => { clearTimeout(bail); resolve() })
    })
    app.exit(headlessExitCode(outcome))
  }

  // ---- 参数与路径校验（移植自上游 apps/shell headless-export.ts）----
  let outcome
  if (headlessArgv.kind === 'error') {
    outcome = { ok: false, code: HEADLESS_EXIT.badArgs, message: headlessArgv.message }
    return finish(outcome)
  }

  const request = headlessArgv.request
  const input = path.resolve(request.input)
  if (!fs.existsSync(input) || !fs.statSync(input).isFile()) {
    return finish({ ok: false, code: HEADLESS_EXIT.inputError, message: `input file not found: ${input}` })
  }
  const module = officeUtils.headlessModuleFor(input)
  if (!module) {
    return finish({
      ok: false, code: HEADLESS_EXIT.inputError,
      message: `cannot export ${input} (supported inputs: .docx, .xlsx, .xlsm, .xls, .csv, .pptx)`,
    })
  }
  enablePackagedPreviewHtml({ isPackaged: app.isPackaged, appVersion: app.getVersion() })
  if (module === 'markdown' || (module === 'html' && !isExperimentalHtmlEnabled())) {
    return finish({
      ok: false, code: HEADLESS_EXIT.inputError,
      message: `exporting ${module} is not available in this app`,
    })
  }
  if (!officeUtils.HEADLESS_TARGETS[module].includes(request.targetFormat)) {
    return finish({
      ok: false, code: HEADLESS_EXIT.badArgs,
      message: `cannot export ${input} to ${request.targetFormat} (this input supports: ${officeUtils.HEADLESS_TARGETS[module].join(', ')})`,
    })
  }
  const outPath = path.resolve(request.outPath)
  if (!fs.existsSync(path.dirname(outPath))) {
    return finish({ ok: false, code: HEADLESS_EXIT.badArgs, message: `output directory does not exist: ${path.dirname(outPath)}` })
  }

  // ---- 隐藏窗口导出（与 GUI 相同的渲染管线）----
  try {
    const root = officeRoot()
    // 特权协议安装（registerSchemesAsPrivileged 已在 office-host 模块加载时完成）
    const roots = {}
    for (const editor of ['docs', 'sheets', 'slides', 'pdf', ...(module === 'html' ? ['html'] : [])]) {
      const renderer = path.join(root, editor, 'renderer')
      if (fs.existsSync(path.join(renderer, 'index.html'))) roots[editor] = renderer
    }
    officeUtils.installRendererProtocol(roots)

    const bundles = {}
    for (const editor of module === 'html' ? [] : ['docs', 'sheets', 'slides']) {
      try { bundles[editor] = await loadBundle(editor) } catch (e) {
        console.warn('[Office] headless load', editor, e.message)
      }
    }

    const docs = bundles.docs
    const sheets = bundles.sheets
    const slides = bundles.slides
    let html
    if (module === 'html') {
      const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'))
      assertOfficeBundle(root, { editor: 'html', expectedReleaseVersion: pkg.releaseVersion, allowExperimental: true })
      html = await loadBundle('html')
      // HTML 来自独立的上游依赖图，headless 状态与语言不能沿用旧 bundle 的单例。
      html.setHtmlHeadlessMode(true)
      html.setHtmlUiLang(app.getLocale().startsWith('zh') ? 'zh' : 'en')
      html.configureHtmlRuntime({ preloadPath: path.join(root, 'html', 'preload', 'index.js'), rendererFile: path.join(root, 'html', 'renderer', 'index.html') })
    }
    const sidecarPath = path.join(root, 'sheets', 'sidecar', process.platform === 'win32' ? 'xlsx-sidecar.exe' : 'xlsx-sidecar')
    if (docs) {
      docs.configureDocsRuntime({ preloadPath: path.join(root, 'docs', 'preload', 'index.js'), rendererFile: path.join(root, 'docs', 'renderer', 'index.html') })
    }
    if (sheets) {
      sheets.configureSheetsRuntime({
        preloadPath: path.join(root, 'sheets', 'preload', 'index.js'),
        rendererFile: path.join(root, 'sheets', 'renderer', 'index.html'),
        sidecarPath: fs.existsSync(sidecarPath) ? sidecarPath : undefined,
      })
    }
    if (slides) {
      slides.configureSlidesRuntime({
        preloadPath: path.join(root, 'slides', 'preload', 'index.js'),
        rendererFilePath: path.join(root, 'slides', 'renderer', 'index.html'),
      })
    }
    registerEditorIpc(bundles)
    if (module === 'html') registerHtmlHeadlessServices()

    if (module === 'docs') {
      if (!docs) throw new Error('docs editor unavailable')
      await docs.exportDocsHeadless(input, outPath, request.targetFormat)
    } else if (module === 'sheets') {
      if (!sheets) throw new Error('sheets editor unavailable')
      await sheets.exportSheetsPdfHeadless(input, outPath)
    } else if (module === 'slides') {
      if (!slides) throw new Error('slides editor unavailable')
      await slides.exportSlidesPdfHeadless(input, outPath)
    } else if (module === 'html') {
      await html.exportHtmlHeadless(input, outPath, request.targetFormat)
    }

    if (!fs.existsSync(outPath)) {
      throw new Error(`export reported success but wrote no file at ${outPath}`)
    }
    outcome = { ok: true, input, outPath }
  } catch (err) {
    outcome = { ok: false, code: HEADLESS_EXIT.conversionFailure, message: err instanceof Error ? err.message : String(err) }
  }
  return finish(outcome)
}
