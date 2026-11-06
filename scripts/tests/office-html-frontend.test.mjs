import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {
  OFFICE_TAB_RE,
  OFFICE_TYPE_EXTENSIONS,
  defaultOfficeEditorCapabilities,
  normalizeOfficeEditorCapabilities,
  officeEditorPath,
  officeTypeFromPath,
  openOfficeHtmlFile,
  closeOfficeEditorTab,
} from '../../src/views/office/officeTypes.js'
import { OFFICE_EDITOR_REGISTRY } from '../../src-electron/office/editor-registry.js'
import { resolveEditorType } from '../../src-electron/office/office-files.js'

const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')

test('HTML 标签、路由和扩展名遵守宿主合同，未知 view 不可导航', () => {
  assert.deepEqual('office-html-12'.match(OFFICE_TAB_RE)?.slice(1), ['html', '12'])
  assert.equal(officeEditorPath('html-12'), '/office/html/12')
  for (const value of ['html-../1', 'html-1/path', 'html-x', 'other-1', null, {}]) assert.equal(officeEditorPath(value), null)
  assert.equal(officeTypeFromPath('D:\\中文 文件夹\\活动.HTM'), 'html')
  assert.equal(officeTypeFromPath('/tmp/example.html'), 'html')
  assert.equal(officeTypeFromPath('/tmp/example.xhtml'), null)
  for (const [id, extensions] of Object.entries(OFFICE_TYPE_EXTENSIONS)) {
    assert.deepEqual(extensions.map(ext => `.${ext}`), [...OFFICE_EDITOR_REGISTRY.find(editor => editor.id === id).extensions])
  }
})

test('HTML 能力缺失、格式错误和旧版 operation 目录均保持关闭', () => {
  assert.equal(defaultOfficeEditorCapabilities().html.available, false)
  for (const payload of [undefined, null, [], {}, { editors: [] }, [{ operationId: 'office.document.create', available: true }], { editors: [{ id: 'html', available: 'true' }] }]) {
    assert.equal(normalizeOfficeEditorCapabilities(payload).html.available, false)
  }
  assert.equal(normalizeOfficeEditorCapabilities({ editors: [{ id: 'html', enabled: false, available: true }] }).html.available, true)
  assert.equal(normalizeOfficeEditorCapabilities({ editors: [{ id: 'docs', available: false }] }).docs.available, false)
})

test('显式编辑每次重查能力，不因旧按钮状态打开被禁用的 HTML', async () => {
  const calls = []
  const blocked = await openOfficeHtmlFile('D:\\活动.htm', async (channel, args) => {
    calls.push({ channel, args })
    return { editors: [{ id: 'html', available: false, reasonCode: 'FULL_APP_PARITY_PENDING' }] }
  })
  assert.equal(blocked.success, false)
  assert.deepEqual(calls.map(call => call.channel), ['office-get-editor-capabilities'])
  let invoked = false
  assert.equal((await openOfficeHtmlFile('/tmp/other.pdf', async () => { invoked = true })).success, false)
  assert.equal(invoked, false)
  await assert.rejects(openOfficeHtmlFile('/tmp/example.html', async () => { throw new Error('host down') }), /host down/)
})

test('实验能力可用时显式打开 HTML，拒绝错误编辑器的回执', async () => {
  const calls = []
  const invoke = async (channel, args) => {
    calls.push({ channel, args })
    return channel === 'office-get-editor-capabilities'
      ? { editors: [{ id: 'html', enabled: false, available: true }] }
      : { success: true, viewId: 'html-7', filePath: '/tmp/example.html' }
  }
  const result = await openOfficeHtmlFile('/tmp/example.html', invoke)
  assert.equal(result.editorPath, '/office/html/7')
  assert.deepEqual(calls[1], { channel: 'office-open-file', args: { filePath: '/tmp/example.html' } })
  const mismatch = await openOfficeHtmlFile('/tmp/example.html', async channel => channel === 'office-get-editor-capabilities'
    ? { editors: [{ id: 'html', available: true }] } : { success: true, viewId: 'pdf-7' })
  assert.equal(mismatch.success, false)
})

test('HTML 保存取消、关闭失败和未知回执保留标签，关闭前不自动保存', async () => {
  for (const response of [false, undefined, null, { success: false }, { success: false, cancelled: true }]) {
    const calls = []
    assert.equal(await closeOfficeEditorTab('office-html-2', async (channel, args) => { calls.push({ channel, args }); return response }), false)
    assert.deepEqual(calls, [{ channel: 'office-close', args: { viewId: 'html-2' } }])
  }
  assert.equal(await closeOfficeEditorTab('office-html-2', async () => { throw new Error('save failed') }), false)
  assert.equal(await closeOfficeEditorTab('office-html-2', async () => true), true)
  assert.equal(await closeOfficeEditorTab('office-html-2', async () => ({ success: true })), true)
  const legacy = []
  assert.equal(await closeOfficeEditorTab('office-docs-1', async channel => { legacy.push(channel) }), true)
  assert.deepEqual(legacy, ['office-auto-save', 'office-close'])
})

function officeIpcHarness({ experimental = false } = {}) {
  const handlers = new Map()
  const calls = []
  const mainSender = {}
  const source = read('src-electron/office/office-ipc.js')
    .replace(/^import[\s\S]*?from\s*'[^']+'\s*$/gm, '')
    .replace('export function registerOfficeIpc', 'function registerOfficeIpc')
  const context = {
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    isOfficeAvailable: () => true,
    isOfficeMainSender: sender => sender === mainSender,
    isOfficeDockSender: () => false,
    isExperimentalHtmlEnabled: () => experimental,
    resolveEditorType,
    openOfficeFile: (...args) => { calls.push({ action: 'open', args }); return { success: true, viewId: 'html-3' } },
    newOfficeDocument: (...args) => { calls.push({ action: 'new', args }); return { success: true, viewId: 'html-3' } },
    closeOfficeFile: () => false,
    openOfficeFileDialog: () => ({ success: true }),
  }
  vm.runInNewContext(`${source}\nregisterOfficeIpc()`, context)
  return { handlers, calls, event: { sender: mainSender } }
}

test('产品 IPC 默认拒绝 HTML，实验模式仅主窗口可以显式创建和打开', () => {
  const disabled = officeIpcHarness()
  assert.equal(disabled.handlers.get('office-open-file')(disabled.event, { filePath: '/tmp/a.html' }).success, false)
  assert.equal(disabled.handlers.get('office-new')(disabled.event, { type: 'html' }).success, false)
  assert.deepEqual(disabled.calls, [])
  const enabled = officeIpcHarness({ experimental: true })
  assert.equal(enabled.handlers.get('office-open-file')(enabled.event, { filePath: '/tmp/a.HTM' }).success, true)
  assert.equal(enabled.handlers.get('office-new')(enabled.event, { type: 'html', name: '活动' }).success, true)
  assert.equal(enabled.calls.length, 2)
  for (const [channel, payload] of [['office-open-file', { filePath: '/tmp/a.html' }], ['office-new', { type: 'html' }], ['office-close', { viewId: 'html-3' }], ['office-open-dialog', {}]]) {
    assert.throws(() => enabled.handlers.get(channel)({ sender: {} }, payload), /OFFICE_COMMAND_OWNER_REQUIRED/)
  }
  assert.equal(enabled.handlers.get('office-close')(enabled.event, { viewId: 'html-3' }), false)
})

test('HTML 会话恢复重开真实视图并对齐新 id，拒绝时不恢复虚假普通标签', async () => {
  const savedTab = { id: 'office-html-1', path: '/office/html', fullPath: '/office/html/1', officeFilePath: 'D:\\活动.htm' }
  const source = read('src/utils/tabSession.js')
    .replace(/^import .*? from '@\/store';$/m, 'const { useTabStore, useKnowledgeStore } = globalThis.__fridayHtmlSessionTest;')
    .replace(/^import .*? from '@\/services\/electron';$/m, 'const { electronService } = globalThis.__fridayHtmlSessionTest;')
    .replace("'../views/office/officeTypes.js'", JSON.stringify(new URL('../../src/views/office/officeTypes.js', import.meta.url).href))
  try {
    for (const succeeds of [true, false]) {
      const calls = []
      const store = { openedTabs: [], restoreTabs(tabs, active) { this.openedTabs = tabs; this.activeTabId = active } }
      globalThis.__fridayHtmlSessionTest = {
        useTabStore: () => store,
        useKnowledgeStore: () => ({}),
        electronService: { invoke: async (channel, args) => {
          calls.push({ channel, args })
          if (channel === 'session-get') return { tabs: [{ ...savedTab }], activeTabId: savedTab.id }
          if (channel === 'kb-path-exists') return true
          if (channel === 'office-open-file') return succeeds ? { success: true, viewId: 'html-9' } : { success: false }
        } },
      }
      const session = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${succeeds}`)
      const routes = []
      const result = await session.restoreSession({ isReady: async () => {}, replace: async route => routes.push(route) })
      assert.equal(result, succeeds)
      assert.equal(calls.filter(call => call.channel === 'office-open-file').length, 1)
      if (succeeds) {
        assert.equal(store.openedTabs[0].id, 'office-html-9')
        assert.equal(store.openedTabs[0].officeFilePath, savedTab.officeFilePath)
        assert.deepEqual(routes, ['/office/html/9'])
      } else assert.equal(store.openedTabs.length, 0)
    }
  } finally { delete globalThis.__fridayHtmlSessionTest }
})

test('新增 HTML 用户文案中英均可解析', () => {
  const keys = ['html', 'aiHtml', 'editWithAiHtml', 'openingHtml', 'htmlEditUnavailable', 'checkingEditor', 'editorUnavailable', 'openFailed', 'newHtml', 'filterHtml']
  for (const locale of ['zh-CN', 'en-US']) {
    const messages = JSON.parse(read(`src/i18n/locales/${locale}/office.json`))
    for (const key of keys) assert.equal(typeof messages[key], 'string')
  }
})
