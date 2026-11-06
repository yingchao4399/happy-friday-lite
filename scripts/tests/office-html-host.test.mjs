import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import { build } from 'esbuild'
import { resolveEditorType, isExperimentalHtmlEnabled, enablePackagedPreviewHtml } from '../../src-electron/office/office-files.js'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const hostPath = path.join(projectRoot, 'src-electron/office/office-host.js')
const stubModules = {
  'office-ai-bridge.js': 'export function registerOfficeAiBridge(options){ const r=globalThis.__officeHtmlHostTest; r.bridgeCalls++; if(options?.resolveOwner) r.aiOwnerOptions=options }',
  'config.js': 'export const getDataDir = () => globalThis.__officeHtmlHostTest.root; export const loadConfig = () => ({language:"en-US"})',
  'bundle-contract.js': `export const validateOfficeBundle = (...args) => globalThis.__officeHtmlHostTest.validateBundle(...args);
    export function assertOfficeBundle(...args) { const r=validateOfficeBundle(...args); if(!r.ok) throw Object.assign(new Error(r.code), {code:r.code}); return r }
    export const validateLoadedOfficeModule = (...args) => globalThis.__officeHtmlHostTest.validateModule(...args)`,
  'operation-catalog.js': 'export const findOfficeOperation = () => null; export const projectOfficeCapabilities = () => []',
  'operations.js': 'export const createOfficeOperationService = () => ({recover:async()=>{}, shutdown(){}})',
  'operation-tasks.js': 'export const getOfficeTaskLedger = () => ({})',
  'artifact-delivery.js': 'export const prepareOfficeTarget=()=>({}); export const officeFault=code=>Object.assign(new Error(code),{code}); export const sha256=()=>"digest"; export const validateDocx=()=>true',
  'converter-adapter.js': 'export const convertOfficePdfSnapshot=()=>{}',
  'document-selection.js': 'export const normalizeOfficeDocumentSelection=()=>null',
  'file-commands.js': 'export const registerOfficeFileCommands=()=>{}',
  'dock-overlay.js': `export const showOfficeDockOverlay=()=>{}; export const updateOfficeDockBounds=()=>{};
    export const hideOfficeDockOverlay=()=>{}; export const destroyOfficeDockOverlay=()=>{};
    export const isOfficeDockSender=()=>false; export const notifyOfficeDockOperation=()=>{}`,
  'note-resources.js': 'export const NOTE_ASSET_SCHEME="friday-note-asset"',
}
const built = await build({
  entryPoints: [hostPath], bundle: true, platform: 'node', format: 'esm', write: false,
  define: { 'import.meta.url': JSON.stringify(pathToFileURL(hostPath).href) },
  plugins: [{ name: 'host-runtime-boundaries', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => args.kind === 'dynamic-import' ? { path: args.path, external: true } : undefined)
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'host-test' }))
    builder.onResolve({ filter: /\.js$/ }, args => {
      const name = path.basename(args.path)
      if (stubModules[name]) return { path: name, namespace: 'host-test' }
    })
    builder.onLoad({ filter: /.*/, namespace: 'host-test' }, args => ({ contents: args.path === 'electron'
      ? 'export const {app,BrowserWindow,dialog,ipcMain,nativeTheme,shell,protocol}=globalThis.__officeHtmlHostTest.electron'
      : stubModules[args.path], loader: 'js' }))
  } }],
})

async function fixture(t, { experimental = true, bundleFailure = null, moduleFailure = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-html-host-'))
  const originalGate = process.env.FRIDAY_OFFICE_EXPERIMENTAL_HTML
  const originalResources = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
  if (experimental) process.env.FRIDAY_OFFICE_EXPERIMENTAL_HTML = '1'
  else delete process.env.FRIDAY_OFFICE_EXPERIMENTAL_HTML
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: root })
  const handlers = new Map()
  const runtime = {
    root, handlers, views: [], messages: [], bridgeCalls: 0, projectIpcCalls: 0, privilegedCalls: [], bundleChecks: [], moduleChecks: [],
    createCount: 0, closeAllowed: false, dirty: true, currentPath: null, savedHooks: null,
    validateBundle(_root, options) {
      runtime.bundleChecks.push(options)
      return { ok: !bundleFailure, code: bundleFailure }
    },
    validateModule(editor, _module, options) {
      runtime.moduleChecks.push({ editor, ...options })
      return { ok: !moduleFailure, code: moduleFailure }
    },
    createView(filePath) {
      runtime.createCount++
      runtime.currentPath = filePath
      const wc = new EventEmitter()
      Object.assign(wc, { id: runtime.createCount, destroyed: false, isDestroyed() { return this.destroyed },
        send() {}, setBackgroundThrottling() {}, close() { this.destroyed = true }, focus() {},
        getURL() { return this.url || 'genoffice-app://html/index.html?mode=tab' },
        isLoading: () => false,
      })
      const view = { webContents: wc, setVisible() {}, setBounds() {} }
      runtime.views.push(view)
      return view
    },
    electron: {
      app: { isPackaged: true, getPath: () => root, getLocale: () => 'en-US' },
      BrowserWindow: class {}, dialog: {}, nativeTheme: {}, shell: {},
      ipcMain: Object.assign(new EventEmitter(), { handle: (channel, handler) => handlers.set(channel, handler), removeHandler: channel => handlers.delete(channel) }),
      protocol: { registerSchemesAsPrivileged: schemes => runtime.privilegedCalls.push(schemes) },
    },
  }
  globalThis.__officeHtmlHostTest = runtime
  const main = path.join(root, 'office/main')
  fs.mkdirSync(main, { recursive: true })
  fs.writeFileSync(path.join(main, 'docs-main.cjs'), 'module.exports={registerProjectIpc(){globalThis.__officeHtmlHostTest.projectIpcCalls++}}\n')
  fs.writeFileSync(path.join(main, 'office-utils.cjs'), `module.exports={installRendererProtocol(roots){globalThis.__officeHtmlHostTest.roots=roots},recordRecentFile(){}}`)
  fs.writeFileSync(path.join(main, 'html-main.cjs'), `const r=globalThis.__officeHtmlHostTest;
    module.exports={
      configureHtmlRuntime: p=>{r.htmlPaths=p},setHtmlUiLang:lang=>{r.lang=lang},setHtmlHeadlessMode:on=>{r.headless=on},
      setHtmlFileSavedHook:hook=>{r.savedHook=hook},setHtmlProvisionalTitleHook:()=>{},setHtmlPresentHooks:hooks=>{r.presentHooks=hooks},
      createHtmlView:file=>r.createView(file),createHtmlPresentView:()=>r.createView(r.currentPath),
      htmlIsDirty:()=>r.dirty,htmlFilePath:()=>r.currentPath,htmlReadText:async()=>r.source||'<!doctype html><html></html>',
      requestHtmlClose:async()=>r.closeAllowed,
      requestHtmlSave:async wc=>{r.dirty=false;r.currentPath=require('node:path').join(r.root,'saved.html');require('node:fs').writeFileSync(r.currentPath,'saved');r.savedHook(wc,r.currentPath);return true}
    }`)
  const win = new EventEmitter()
  const removed = []
  Object.assign(win, { isDestroyed: () => false, webContents: { send(...args) { runtime.messages.push(args) }, focus() {} },
    contentView: { addChildView() {}, removeChildView: view => removed.push(view) },
    getContentBounds: () => ({ width: 1000, height: 800 }),
  })
  const host = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text + `\n//${root}`).toString('base64')}`)
  t.after(() => {
    host.shutdownOfficeHost()
    if (originalGate === undefined) delete process.env.FRIDAY_OFFICE_EXPERIMENTAL_HTML
    else process.env.FRIDAY_OFFICE_EXPERIMENTAL_HTML = originalGate
    if (originalResources) Object.defineProperty(process, 'resourcesPath', originalResources)
    else delete process.resourcesPath
    delete globalThis.__officeHtmlHostTest
    fs.rmSync(root, { recursive: true, force: true })
  })
  assert.equal(await host.initOfficeHost(win), true)
  return { host, runtime, win, removed, root }
}

test('默认文件关联不会被实验开关或 HTML 扩展名自动开放', () => {
  assert.equal(isExperimentalHtmlEnabled({}), false)
  assert.equal(isExperimentalHtmlEnabled({ FRIDAY_OFFICE_EXPERIMENTAL_HTML: 'true' }), false)
  assert.equal(isExperimentalHtmlEnabled({ FRIDAY_OFFICE_EXPERIMENTAL_HTML: '1' }), true)
  assert.equal(resolveEditorType('C:/file.HTML'), null)
  assert.equal(resolveEditorType('C:/file.HTM', { experimentalHtml: true }), 'html')
  assert.equal(resolveEditorType('C:/file.pdf', { experimentalHtml: true }), 'pdf')

  const packagedPreview = {}
  assert.equal(enablePackagedPreviewHtml({ isPackaged: true, appVersion: '3.0.9-preview.37', environment: packagedPreview }), true)
  assert.equal(packagedPreview.FRIDAY_OFFICE_EXPERIMENTAL_HTML, '1')
  const packagedStable = {}
  assert.equal(enablePackagedPreviewHtml({ isPackaged: true, appVersion: '3.0.9', environment: packagedStable }), false)
  assert.equal(packagedStable.FRIDAY_OFFICE_EXPERIMENTAL_HTML, undefined)
  const unpackagedPreview = {}
  assert.equal(enablePackagedPreviewHtml({ isPackaged: false, appVersion: '3.0.9-preview.37', environment: unpackagedPreview }), false)
})

test('关闭实验开关时宿主拒绝 HTML 新建/打开且不加载模块', async t => {
  const { host, runtime } = await fixture(t, { experimental: false })
  const row = (await host.getOfficeEditorCapabilities()).editors.find(editor => editor.id === 'html')
  assert.deepEqual(row, { id: 'html', enabled: false, available: false, reasonCode: 'OFFICE_EXPERIMENTAL_DISABLED' })
  assert.equal((await host.newOfficeDocument('html')).success, false)
  assert.equal((await host.openOfficeFile('C:/file.html')).success, false)
  assert.equal(runtime.createCount, 0)
  assert.equal(runtime.roots.html, undefined)
})

test('HTML 入口只有合同与实际模块配置成功后可用，能力 IPC 验证调用者', async t => {
  const { host, runtime, win } = await fixture(t)
  const reply = await runtime.handlers.get('office-get-editor-capabilities')({ sender: win.webContents })
  assert.deepEqual(reply.editors.find(editor => editor.id === 'html'), { id: 'html', enabled: false, available: true, reasonCode: null })
  assert.deepEqual(host.getOfficeLoadedEditors(), ['html'])
  assert.equal(runtime.createCount, 0)
  assert.equal(runtime.lang, 'en')
  assert.equal(runtime.headless, false)
  assert.equal(runtime.projectIpcCalls, 1)
  assert.equal(runtime.htmlPaths.rendererFile, path.join(runtime.root, 'office/html/renderer/index.html'))
  assert.equal(runtime.roots.html, path.join(runtime.root, 'office/html/renderer'))
  assert.ok(runtime.bundleChecks.filter(options => options.editor === 'html').every(options => options.allowExperimental === true))
  assert.ok(runtime.moduleChecks.some(options => options.editor === 'html' && options.allowExperimental === true))
  assert.throws(() => runtime.handlers.get('office-get-editor-capabilities')({ sender: {} }), /OFFICE_SENDER_INVALID/)
  assert.equal(runtime.privilegedCalls.length, 1)
  const schemes = runtime.privilegedCalls[0]
  assert.equal(new Set(schemes.map(item => item.scheme)).size, schemes.length)
  for (const scheme of ['genoffice-app', 'html-preview', 'html-asset']) assert.equal(schemes.some(item => item.scheme === scheme && item.privileges.secure), true)
})

test('构建缺失或模块合同失败不会把实验 HTML 报为可用', async t => {
  const { host, runtime } = await fixture(t, { moduleFailure: 'OFFICE_REQUIRED_HOOK_MISSING' })
  const row = (await host.getOfficeEditorCapabilities()).editors.find(editor => editor.id === 'html')
  assert.equal(row.available, false)
  assert.equal(row.reasonCode, 'OFFICE_REQUIRED_HOOK_MISSING')
  assert.deepEqual(host.getOfficeLoadedEditors(), [])
  assert.equal(runtime.htmlPaths, undefined)
})

test('HTML 保存后同步路径；取消关闭保留视图，确认后才移除并销毁', async t => {
  const { host, runtime, removed } = await fixture(t)
  const opened = await host.newOfficeDocument('html', undefined, 'HTML lifecycle')
  assert.equal(opened.success, true)
  assert.equal(path.extname(opened.filePath), '.html')
  assert.ok(fs.readFileSync(opened.filePath, 'utf8').startsWith('<!doctype html>'))
  assert.equal(await host.queryOfficeDirty(opened.viewId), true)
  assert.equal(await host.readOfficeHtmlSource(opened.viewId), '<!doctype html><html></html>')
  const view = runtime.views[0]
  assert.equal(await host.closeOfficeFile(opened.viewId), false)
  assert.equal(host.getOfficeState().length, 1)
  assert.equal(removed.length, 0)
  assert.equal(view.webContents.isDestroyed(), false)
  const saved = await host.autoSaveOfficeFile(opened.viewId)
  assert.equal(saved.success, true)
  assert.equal(saved.saved, true)
  assert.equal(host.getOfficeState()[0].filePath, runtime.currentPath)
  assert.equal(await host.queryOfficeDirty(opened.viewId), false)
  runtime.closeAllowed = true
  assert.equal(await host.closeOfficeFile(opened.viewId), true)
  assert.equal(host.getOfficeState().length, 0)
  assert.equal(removed.length, 1)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(view.webContents.isDestroyed(), true)
  assert.ok(runtime.bridgeCalls >= 3)
})

test('HTML 顶层导航被隔离，可信 Friday renderer 保留且 preview iframe 导航不受影响', async t => {
  const { host, runtime } = await fixture(t)
  const opened = await host.newOfficeDocument('html', undefined, 'navigation guard')
  assert.equal(opened.success, true)
  const view = runtime.views[0]

  let blocked = false
  view.webContents.emit('will-navigate', { preventDefault() { blocked = true } }, 'https://attacker.example/')
  assert.equal(blocked, true)

  blocked = false
  view.webContents.emit('will-navigate', { preventDefault() { blocked = true } }, 'genoffice-app://docs/index.html')
  assert.equal(blocked, true)

  blocked = false
  view.webContents.emit('will-navigate', { preventDefault() { blocked = true } }, 'genoffice-app://html/index.html?mode=tab')
  assert.equal(blocked, false)

  blocked = false
  view.webContents.emit('will-navigate', { isMainFrame: false, preventDefault() { blocked = true } }, 'html-preview://local/document.html')
  assert.equal(blocked, false)
})


test('资源校验失败时能力与打开同时拒绝，不能绕过 manifest 校验', async t => {
  const { host, runtime } = await fixture(t, { bundleFailure: 'OFFICE_RESOURCE_MISMATCH' })
  const row = (await host.getOfficeEditorCapabilities()).editors.find(editor => editor.id === 'html')
  assert.equal(row.available, false)
  assert.equal(row.reasonCode, 'OFFICE_RESOURCE_MISMATCH')
  assert.equal((await host.openOfficeFile(path.join(runtime.root, 'broken.html'))).success, false)
  assert.equal(runtime.createCount, 0)
})

test('显式打开 HTML 支持大小写扩展名并复用已有编辑视图', async t => {
  const { host, runtime } = await fixture(t)
  const filePath = path.join(runtime.root, 'source.HTM')
  fs.writeFileSync(filePath, '<p>real source</p>')
  const opened = await host.openOfficeFile(filePath)
  const again = await host.openOfficeFile(filePath)
  assert.equal(opened.success, true)
  assert.equal(opened.type, 'html')
  assert.equal(again.reused, true)
  assert.equal(again.viewId, opened.viewId)
  assert.equal(runtime.createCount, 1)
})

test('HTML 演示视图单独登记且关闭事件明确移除演示标签', async t => {
  const { host, runtime } = await fixture(t)
  const opened = await host.newOfficeDocument('html', undefined, 'presentation owner')
  const owner = runtime.views[0].webContents
  const identity = runtime.aiOwnerOptions.resolveOwner(owner)
  assert.equal(identity.viewId, opened.viewId)
  assert.match(identity.documentId, /^[a-f0-9-]{36}$/)
  assert.notEqual(identity.documentId, opened.viewId)
  assert.equal(runtime.aiOwnerOptions.resolveOwner({}), null)
  assert.equal(runtime.presentHooks.openTab(owner, 'Preview'), true)
  const presented = host.getOfficeState().find(entry => entry.presentation)
  assert.equal(presented.title, 'Preview')
  assert.equal(presented.filePath, opened.filePath)
  assert.equal(await host.queryOfficeDirty(presented.viewId), false)
  const reused = await host.openOfficeFile(opened.filePath)
  assert.equal(reused.viewId, opened.viewId)
  assert.equal(runtime.presentHooks.closeTab(runtime.views[1].webContents), true)
  assert.equal(host.getOfficeState().some(entry => entry.presentation), false)
  const event = runtime.messages.find(([channel, value]) => channel === 'office-view-closed' && value.viewId === presented.viewId)
  assert.equal(event[1].presentation, true)
})

test('复用路由 viewId 时生成新文档身份，旧文档操作不能覆盖新文档', async t => {
  const { host, runtime } = await fixture(t)
  const first = await host.newOfficeDocument('html', 'html-reused', 'first identity')
  const identity = runtime.aiOwnerOptions.resolveOwner(runtime.views[0].webContents).documentId
  runtime.closeAllowed = true
  assert.equal(await host.closeOfficeFile(first.viewId), true)
  const second = await host.newOfficeDocument('html', 'html-reused', 'second identity')
  const next = runtime.aiOwnerOptions.resolveOwner(runtime.views.at(-1).webContents).documentId
  assert.notEqual(identity, next)
  await assert.rejects(host.executeOfficeHtmlDocument({ documentId: identity, revision: 0, kind: 'replace', source: '<p>stale</p>' }, { resourceId: second.viewId }), { code: 'OFFICE_SOURCE_CHANGED' })
})
