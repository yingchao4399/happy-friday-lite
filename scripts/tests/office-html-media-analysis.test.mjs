import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { open } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build, transform } from 'esbuild'
import { createOfficeAiServices } from '../../src-electron/office/ai-services.js'
import { loadOfficeMediaReferences, sniffOfficeMedia } from '../../src-electron/office/ai-media-loader.js'
import { transformHtmlMainSource } from '../office/html-main-adapter.mjs'

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
const mp4 = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0])
const url = bytes => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`
const owner = { documentId: 'document-a', viewId: 'html-1' }

test('媒体按实际字节分流，图片/视频模型共享同厂商凭证且未配置不声明可用', async () => {
  let stored = {}, seen
  const service = createOfficeAiServices({ readConfig: () => stored, writeConfig: value => { stored = value } })
  service.configure({ mediaCatalog: [{ id: 'custom', analysisProtocol: 'openai-chat', videoAnalysis: true }], analyzeMedia: async (...args) => { seen = args; return 'recognized' } })
  assert.equal(service.capabilities().analyzeImage, false)
  service.saveSettings({ media: { enabled: true, analysisProvider: 'custom', videoAnalysisProvider: 'custom', providers: { custom: { apiKey: 'private-key', baseUrl: 'https://example.com/v1', analysisModel: 'vision-model' } } } })
  assert.equal(service.capabilities().analyzeImage, true)
  assert.equal(service.capabilities().analyzeVideo, true)
  assert.deepEqual(await service.analyzeMedia({ mediaUrls: [url(png)], requirements: 'describe' }, owner, { senderId: 1 }), { text: 'recognized' })
  assert.equal(seen[0], 'custom')
  assert.equal(seen[1].apiKey, 'private-key')
  assert.equal(seen[2].media[0].mime, 'image/png')
  await service.analyzeMedia({ mediaUrls: [url(mp4)], requirements: 'describe video' }, owner, { senderId: 1 })
  assert.equal(seen[2].media[0].mime, 'video/mp4', '不得相信 data URL 自报的 image/png')
  assert.equal(JSON.stringify(service.getSettings()).includes('private-key'), false)
  await assert.rejects(service.analyzeMedia({ mediaUrls: [url(png)], requirements: 'describe' }, owner), { code: 'OFFICE_AI_SENDER_INVALID' })
})

test('媒体读取拒绝任意 file URL/相对路径/伪装文本/超额批次，取消后不上传', async () => {
  const options = { limits: { items: 2, itemBytes: 24, totalBytes: 24 } }
  assert.equal(sniffOfficeMedia(Buffer.from('secret stored as picture.png')), null)
  for (const refs of [['file:///etc/password.png'], ['relative.png'], [url(Buffer.from('secret text'))], [url(png), url(png), url(png)]]) {
    await assert.rejects(loadOfficeMediaReferences(refs, options))
  }
  await assert.rejects(loadOfficeMediaReferences([url(png), url(png)], { limits: { items: 2, itemBytes: 24, totalBytes: 20 } }), { code: 'OFFICE_AI_MEDIA_INPUT_INVALID' })
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  let calls = 0
  await assert.rejects(loadOfficeMediaReferences(['https://example.com/image.png'], { ...options, signal: controller.signal, fetchRemote: () => { calls++ } }), /cancelled/)
  assert.equal(calls, 0)
})

test('远程引用只经注入的 SSRF 下载器并由累计剩余预算限制响应', async () => {
  let count = 0, cap
  const media = await loadOfficeMediaReferences(['https://example.com/image.png'], {
    fetchRemote: async () => { count++; return { ok: true } },
    readBodyCapped: async (_response, max) => { cap = max; return png },
    limits: { items: 2, itemBytes: 20, totalBytes: 16 },
  })
  assert.equal(count, 1)
  assert.equal(cap, 16)
  assert.equal(media[0].mime, 'image/png')
  await assert.rejects(loadOfficeMediaReferences(['https://example.com/image.png'], { fetchRemote: async () => null, readBodyCapped: async () => png }), { code: 'OFFICE_AI_MEDIA_DOWNLOAD_FAILED' })
})

test('媒体分析绑定生成图所属文档，取消后的供应商结果不交付', async () => {
  const controller = new AbortController()
  const service = createOfficeAiServices({ readConfig: () => ({ media: { enabled: true, imageProvider: 'custom', analysisProvider: 'custom', providers: { custom: { apiKey: 'key', baseUrl: 'https://example.com', imageModel: 'image', analysisModel: 'vision' } } } }) })
  service.configure({ mediaCatalog: [{ id: 'custom', imageProtocol: 'openai-images', analysisProtocol: 'openai-chat' }], generateImage: async () => ({ bytes: png, mime: 'image/png' }), analyzeMedia: async () => { controller.abort(new Error('stop')); return 'late text' } })
  const image = await service.generateImage({ prompt: 'circle' }, owner)
  await assert.rejects(service.analyzeMedia({ mediaUrls: [image.url], requirements: 'describe' }, { ...owner, documentId: 'another' }, { senderId: 1 }), { code: 'OFFICE_AI_ASSET_NOT_OWNED' })
  await assert.rejects(service.analyzeMedia({ mediaUrls: [image.url], requirements: 'describe' }, owner, { senderId: 1, signal: controller.signal }), /stop/)
})

test('真实适配器的附件读取只接收当前 sender 授权快照，跨文档/修改后的文件均拒绝', async () => {
  const original = fs.readFileSync(new URL('../../vendor/genoffice-html/apps/html/src/main/html-main.ts', import.meta.url), 'utf8')
  const result = transformHtmlMainSource(original, '/apps/html/src/main/html-main.ts')
  const start = result.indexOf('const fridayHtmlViews =')
  const end = result.indexOf('function fridayAssetBaseForDocument', start)
  assert.ok(start > 0 && end > start)
  const fixture = result.slice(start, end) + `\nexport function grant(senderId, file) { fridayHtmlViews.add(senderId); const canonical = fridayPath(file); fridayAttachmentGrants.set(senderId, new Map([[canonical, fridayAttachmentState(canonical)]])) }\nexport function close(senderId) { fridayHtmlViews.delete(senderId); fridayAttachmentGrants.delete(senderId) }`
  const compiled = await transform(fixture, { loader: 'ts', format: 'iife', globalName: 'fixture' })
  const context = vm.createContext({ Buffer, process, statSync: fs.statSync, realpathSync: fs.realpathSync, basename: path.basename, open, webContents: { fromId: () => ({ isDestroyed: () => false }) }, presentOwnerByWc: new Map() })
  vm.runInContext(compiled.code, context)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-media-grant-'))
  const file = path.join(dir, 'picture.png')
  try {
    fs.writeFileSync(file, png)
    context.fixture.grant(1, file)
    assert.deepEqual([...((await context.fixture.htmlAiReadGrantedMedia(1, file, 32)).bytes)], [...png])
    await assert.rejects(context.fixture.htmlAiReadGrantedMedia(2, file, 32), /NOT_GRANTED/)
    fs.appendFileSync(file, 'changed')
    await assert.rejects(context.fixture.htmlAiReadGrantedMedia(1, file, 32), /NOT_GRANTED/)
    context.fixture.grant(1, file)
    context.fixture.close(1)
    await assert.rejects(context.fixture.htmlAiReadGrantedMedia(1, file, 32), /NOT_GRANTED/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('实际媒体 IPC 拒绝 iframe，绑定原 sender；关闭/换文档/Stop 均不交付迟到结果', async () => {
  const handlers = new Map()
  let stored = {}, response, release
  const mainFrame = {}
  const sender = Object.assign(new EventEmitter(), { id: 1101, mainFrame, isDestroyed: () => false })
  let selectedOwner = { ...owner }
  const runtime = {
    app: { getPath: () => os.tmpdir() }, net: {}, webContents: { getAllWebContents: () => [] },
    ipcMain: { handle: (channel, listener) => handlers.set(channel, listener), removeHandler: channel => handlers.delete(channel) },
    read: () => stored, write: value => { stored = value },
  }
  globalThis.__officeMediaBridgeTest = runtime
  const stubs = {
    'ai-service-settings-store.js': 'export const readOfficeAiServiceSettings=()=>globalThis.__officeMediaBridgeTest.read(); export const writeOfficeAiServiceSettings=value=>globalThis.__officeMediaBridgeTest.write(value)',
    'ai-inference-adapter.js': 'export const createAiChatCapabilityInvoker=()=>()=>{}',
    'registry.js': 'export const executeCapability=()=>{}',
    'skills.js': 'export const getSkillDir=()=>"";export const listSkills=()=>[]',
    'network-policy.js': 'export const NETWORK_ERROR_CLASSIFICATIONS={};export const annotateNetworkError=e=>e;export const classifyNetworkError=()=>"";export const fetchWithFiniteRetry=()=>{};export const safeNetworkErrorSummary=()=>""',
  }
  try {
    const built = await build({ entryPoints: [fileURLToPath(new URL('../../src-electron/office/office-ai-bridge.js', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{ name: 'media-test-boundaries', setup(builder) {
      builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'media-test' }))
      builder.onResolve({ filter: /\.js$/ }, args => stubs[path.basename(args.path)] ? { path: path.basename(args.path), namespace: 'media-test' } : undefined)
      builder.onLoad({ filter: /.*/, namespace: 'media-test' }, args => ({ contents: args.path === 'electron' ? 'export const {app,ipcMain,net,webContents}=globalThis.__officeMediaBridgeTest' : stubs[args.path], loader: 'js' }))
    } }] })
    const bridge = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
    bridge.registerOfficeAiBridge({ resolveOwner: value => value === sender ? selectedOwner : null, isModelSettingsSender: value => value === sender, services: {
      mediaCatalog: [{ id: 'custom', analysisProtocol: 'openai-chat', videoAnalysis: true }],
      analyzeMedia: async () => response,
    } })
    const event = { sender, senderFrame: mainFrame }
    handlers.get('office-ai-services-save')(event, { media: { enabled: true, analysisProvider: 'custom', providers: { custom: { apiKey: 'private', baseUrl: 'https://example.com/v1', analysisModel: 'vision' } } } })
    const input = { mediaUrls: [url(png)], requirements: 'describe' }
    assert.throws(() => handlers.get('ai:analyze-media')({ sender, senderFrame: {} }, input), { code: 'OFFICE_AI_SENDER_INVALID' })
    response = 'recognized'
    assert.deepEqual(await handlers.get('ai:analyze-media')(event, input), { text: 'recognized' })
    response = new Promise(resolve => { release = resolve })
    const stale = handlers.get('ai:analyze-media')(event, input)
    await new Promise(resolve => setImmediate(resolve))
    selectedOwner = { documentId: 'replacement', viewId: 'html-1' }
    release('stale text')
    await assert.rejects(stale, { code: 'OFFICE_AI_OWNER_CHANGED' })
    response = new Promise(resolve => { release = resolve })
    const stopped = handlers.get('ai:analyze-media')(event, input)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(handlers.get('ai:services-cancel')(event).cancelled, 1)
    release('stopped text')
    await assert.rejects(stopped, { code: 'OFFICE_AI_REQUEST_CANCELLED' })
    response = new Promise(resolve => { release = resolve })
    const closed = handlers.get('ai:analyze-media')(event, input)
    await new Promise(resolve => setImmediate(resolve))
    sender.emit('destroyed')
    release('closed text')
    await assert.rejects(closed, { code: 'OFFICE_AI_SENDER_DESTROYED' })
  } finally { delete globalThis.__officeMediaBridgeTest }
})
