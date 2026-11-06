import test from 'node:test'
import assert from 'node:assert/strict'
import { createOfficeAiServices, normalizeServiceConfig } from '../../src-electron/office/ai-services.js'

function fixture() {
  let config = {}
  const service = createOfficeAiServices({ readConfig: () => config, writeConfig: next => { config = next } })
  return { service, config: () => config }
}
test('配置落盘后公开状态没有密钥；空补丁保留旧密钥，显式空值清除', () => {
  const f = fixture()
  const first = f.service.saveSettings({ media: { enabled: true, provider: 'custom', providers: { custom: { apiKey: 'secret-value', imageModel: 'image-test', baseUrl: 'https://example.com/v1' } } } })
  assert.equal(JSON.stringify(first).includes('secret-value'), false)
  f.service.saveSettings({ media: { providers: { custom: { imageModel: 'new-image' } } } })
  assert.equal(f.config().media.providers.custom.apiKey, 'secret-value')
  f.service.saveSettings({ media: { providers: { custom: { apiKey: '' } } } })
  assert.equal(f.config().media.providers.custom.apiKey, '')
  assert.throws(() => normalizeServiceConfig({ media: { providers: { custom: { baseUrl: 'file:///secret' } } } }), { code: 'OFFICE_AI_CONFIG_INVALID' })
})
test('搜索使用固定上游合同，显式禁用云登录和环境密钥，不把错误当成零结果', async () => {
  const f = fixture()
  let seen
  f.service.configure({ webSearch: async (_query, _max, options) => { seen = options; return { method: 'duckduckgo', results: [] } } })
  const zero = await f.service.search('web', 'topic', 2)
  assert.equal(zero.method, 'duckduckgo')
  assert.deepEqual(zero.results, [])
  assert.equal(seen.useGsk, false)
  assert.equal(seen.serperKey, '')
  f.service.configure({ webSearch: async () => { throw new Error('provider secret') } })
  const failed = await f.service.search('web', 'topic', 2)
  assert.equal(failed.method, 'error')
  assert.equal(JSON.stringify(failed).includes('provider secret'), false)
})
test('生成图片只有有效配置才公开，临时引用只允许原文档读取，取消后不交付', async () => {
  const f = fixture()
  const bytes = new Uint8Array([137, 80, 78, 71])
  f.service.configure({ mediaCatalog: [{ id: 'custom', imageProtocol: 'openai-images' }], generateImage: async () => ({ bytes, mime: 'image/png' }) })
  assert.equal(f.service.capabilities().generateImage, false)
  f.service.saveSettings({ media: { enabled: true, provider: 'custom', providers: { custom: { apiKey: 'configured', imageModel: 'test', baseUrl: 'https://example.com/v1' } } } })
  assert.equal(f.service.capabilities().generateImage, true)
  const owner = { documentId: 'html-1', viewId: 'html-1' }
  const result = await f.service.generateImage({ prompt: 'draw a circle' }, owner)
  assert.match(result.url, /^friday-generated-image:/)
  assert.equal((await f.service.fetchImage(result.url, owner)).mime, 'image/png')
  await assert.rejects(f.service.fetchImage(result.url, { documentId: 'html-2', viewId: 'html-2' }), { code: 'OFFICE_AI_ASSET_NOT_OWNED' })
  const controller = new AbortController()
  f.service.configure({ generateImage: async () => { controller.abort(); return { bytes, mime: 'image/png' } } })
  await assert.rejects(f.service.generateImage({ prompt: 'draw' }, owner, { signal: controller.signal }))
})

test('媒体三种能力共用同一提供商凭证；本机重排公开状态始终隐藏密钥', () => {
  const f = fixture()
  f.service.saveSettings({ media: { imageProvider: 'qwen', analysisProvider: 'qwen', videoAnalysisProvider: 'qwen', providers: { qwen: { apiKey: 'shared-private-key', baseUrl: 'https://example.com', imageModel: 'image', analysisModel: 'vision' } } }, fileSearch: { rerank: true, keys: { openrouter: 'rerank-private-key' } } })
  f.service.saveSettings({ media: { providers: { qwen: { analysisModel: 'updated-vision' } } }, fileSearch: { endpoint: 'custom' } })
  const stored = f.config()
  assert.equal(stored.media.providers.qwen.apiKey, 'shared-private-key')
  assert.equal(stored.fileSearch.keys.openrouter, 'rerank-private-key')
  const visible = f.service.getSettings()
  assert.equal(visible.media.providers.qwen.apiKeyConfigured, true)
  assert.equal(visible.fileSearch.keysConfigured.openrouter, true)
  assert.doesNotMatch(JSON.stringify(visible), /shared-private-key|rerank-private-key/)
})

test('连接检查只测试临时草稿且分别报告未配置，不把认证探测当成生成成功', async () => {
  const f = fixture()
  let tested
  f.service.configure({ webSearch: async () => ({ method: 'duckduckgo', results: [] }), mediaCatalog: [{ id: 'qwen', imageProtocol: 'dashscope', defaultBaseUrl: 'https://example.com', defaultImageModel: 'image' }], testMedia: async (id, value) => { tested = { id, value }; return { ok: true } } })
  const result = await f.service.testSettings({ media: { imageProvider: 'qwen', providers: { qwen: { apiKey: 'draft-key' } } } })
  assert.equal(tested.id, 'qwen')
  assert.equal(tested.value.apiKey, 'draft-key')
  assert.equal(f.config().media, undefined)
  assert.equal(result.checks.find(check => check.kind === 'imageGeneration').ok, true)
  assert.equal(result.checks.find(check => check.kind === 'videoAnalysis').skipped, true)
  assert.doesNotMatch(JSON.stringify(result), /draft-key/)
  assert.equal(f.service.capabilities().generateImage, false)
})
