import { randomUUID } from 'node:crypto'
import { normalizeImageSearchResult, normalizeWebSearchResult, serviceError } from './ai-service-contract.js'
import { DECISION_ENDPOINTS, normalizeFileSearchPatch, publicFileSearchSettings } from './ai-file-search-settings.js'
import { loadOfficeMediaReferences } from './ai-media-loader.js'

export const SEARCH_PROVIDERS = ['parallel', 'serper', 'serply', 'searchapi', 'tavily', 'exa', 'firecrawl', 'keenable']
export const IMAGE_PROVIDERS = ['openai', 'gemini', 'doubao', 'glm', 'xai', 'qwen', 'minimax', 'stability', 'bfl', 'microsoft', 'custom']
export const MEDIA_PROVIDERS = ['genspark', ...IMAGE_PROVIDERS, 'deepseek']
const SEARCH_KEYS = Object.fromEntries(SEARCH_PROVIDERS.map(id => [id, `${id}Key`]))
const MAX_IMAGE_BYTES = 50 * 1024 * 1024
const GENERATED_PREFIX = 'friday-generated-image://'
const fault = (code, message) => serviceError(code, message)
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const cleanText = (value, max = 2000) => typeof value === 'string' ? value.trim().slice(0, max) : ''

function endpoint(value) {
  const text = cleanText(value, 4096)
  if (!text) return ''
  let url
  try { url = new URL(text) } catch { throw fault('OFFICE_AI_CONFIG_INVALID', '媒体 API 地址无效') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw fault('OFFICE_AI_CONFIG_INVALID', '媒体 API 地址必须为不含账号信息的 HTTP(S) 地址')
  }
  return text.replace(/\/+$/, '')
}

export function normalizeServiceConfig(input = {}, previous = {}) {
  const result = {
    search: { enabled: previous.search?.enabled !== false, provider: previous.search?.provider || 'parallel', providers: { ...previous.search?.providers } },
    media: { enabled: previous.media?.enabled === true, provider: previous.media?.provider || 'openai', providers: { ...previous.media?.providers } },
    fileSearch: normalizeFileSearchPatch(input.fileSearch, previous.fileSearch),
  }
  result.media.imageProvider = previous.media?.imageProvider || result.media.provider
  result.media.analysisProvider = previous.media?.analysisProvider || 'openai'
  result.media.videoAnalysisProvider = previous.media?.videoAnalysisProvider || 'gemini'
  for (const kind of ['search', 'media']) {
    const patch = input[kind]
    if (patch === undefined) continue
    if (!plain(patch)) throw fault('OFFICE_AI_CONFIG_INVALID', 'AI 服务设置必须为对象')
    const allowed = kind === 'search' ? ['genspark', ...SEARCH_PROVIDERS] : MEDIA_PROVIDERS
    if ('enabled' in patch) {
      if (typeof patch.enabled !== 'boolean') throw fault('OFFICE_AI_CONFIG_INVALID', 'AI 服务开关无效')
      result[kind].enabled = patch.enabled
    }
    if ('provider' in patch) {
      if (!allowed.includes(patch.provider)) throw fault('OFFICE_AI_CONFIG_INVALID', 'AI 服务提供商无效')
      result[kind].provider = patch.provider
      if (kind === 'media') result.media.imageProvider = patch.provider
    }
    if (kind === 'media') for (const field of ['imageProvider', 'analysisProvider', 'videoAnalysisProvider']) {
      if (field in patch) {
        if (!allowed.includes(patch[field])) throw fault('OFFICE_AI_CONFIG_INVALID', '媒体服务提供商无效')
        result.media[field] = patch[field]
      }
    }
    if (patch.providers !== undefined && !plain(patch.providers)) throw fault('OFFICE_AI_CONFIG_INVALID', 'AI 服务提供商设置无效')
    for (const [id, config] of Object.entries(patch.providers || {})) {
      if (!allowed.includes(id) || !plain(config)) throw fault('OFFICE_AI_CONFIG_INVALID', 'AI 服务提供商设置无效')
      const next = { ...(result[kind].providers[id] || {}) }
      if ('apiKey' in config) {
        if (typeof config.apiKey !== 'string' || config.apiKey.length > 8192) throw fault('OFFICE_AI_CONFIG_INVALID', 'API key 无效')
        next.apiKey = config.apiKey.trim()
      }
      if (kind !== 'search') {
        if ('baseUrl' in config) next.baseUrl = endpoint(config.baseUrl)
        if ('imageModel' in config) next.imageModel = cleanText(config.imageModel, 240)
        if ('analysisModel' in config) next.analysisModel = cleanText(config.analysisModel, 240)
      }
      result[kind].providers[id] = next
    }
  }
  result.media.provider = result.media.imageProvider
  return result
}

function publicConfig(config, catalog) {
  return {
    search: { ...config.search, providers: Object.fromEntries(Object.entries(config.search.providers).map(([id, value]) => [id, { apiKeyConfigured: Boolean(value.apiKey) }])) },
    media: { ...config.media, providers: Object.fromEntries(Object.entries(config.media.providers).map(([id, value]) => [id, { apiKeyConfigured: Boolean(value.apiKey), baseUrl: value.baseUrl || '', imageModel: value.imageModel || '', analysisModel: value.analysisModel || '' }])) },
    fileSearch: publicFileSearchSettings(config.fileSearch),
    catalog,
  }
}

function bounded(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(20, Math.max(1, Math.floor(number))) : fallback
}

/** 主进程持有服务配置与图片字节；编辑器只接收公开能力和绑定文档的临时引用。 */
export function createOfficeAiServices({ readConfig = () => ({}), writeConfig, normalizeImage, now = Date.now, uuid = randomUUID } = {}) {
  let providers = {}
  const images = new Map()
  const catalog = () => ({
    decisionEndpoints: DECISION_ENDPOINTS,
    search: ['genspark', ...SEARCH_PROVIDERS].map(id => ({ id, label: id === 'genspark' ? 'Genspark / Free fallback' : id, keyOptional: ['genspark', 'parallel', 'keenable'].includes(id) })),
    media: MEDIA_PROVIDERS.map(id => {
      const item = (providers.mediaCatalog || []).find(value => value.id === id) || {}
      return { id, label: item.label || id, defaultBaseUrl: item.defaultBaseUrl || '', defaultImageModel: item.defaultImageModel || '', imageModels: item.imageModels || [],
        defaultAnalysisModel: item.defaultAnalysisModel || '', analysisModels: item.analysisModels || [], imageProtocol: item.imageProtocol || null, analysisProtocol: item.analysisProtocol || null, videoAnalysis: item.videoAnalysis === true }
    }),
  })
  const config = () => normalizeServiceConfig(readConfig())
  const sweep = () => { for (const [id, image] of images) if (now() - image.created > 10 * 60_000) images.delete(id) }
  const ownerKey = owner => {
    if (!owner || typeof owner.documentId !== 'string' || typeof owner.viewId !== 'string' || !owner.documentId || !owner.viewId) throw fault('OFFICE_AI_OWNER_UNAVAILABLE', '无法确认当前文档身份')
    return JSON.stringify([owner.documentId, owner.viewId])
  }
  const assertActive = signal => { if (signal?.aborted) throw signal.reason || fault('OFFICE_AI_REQUEST_CANCELLED', '请求已取消') }
  const imageConfig = current => {
    if (!current.media.enabled) throw fault('OFFICE_AI_MEDIA_NOT_CONFIGURED', '请在设置的 AI 工具中配置生图、媒体与搜索')
    const id = current.media.provider
    if (id === 'genspark') throw fault('OFFICE_AI_MEDIA_NOT_CONFIGURED', '当前主机尚未接入 Genspark 托管账户，请在生图、媒体与搜索中选择 API 提供商')
    const saved = current.media.providers[id] || {}
    const meta = (providers.mediaCatalog || []).find(item => item.id === id && item.imageProtocol)
    if (!meta || typeof providers.generateImage !== 'function') throw fault('OFFICE_AI_MEDIA_UNAVAILABLE', '当前安装包未加载图片服务')
    if (!saved.apiKey || (id === 'custom' && (!saved.baseUrl || !saved.imageModel))) throw fault('OFFICE_AI_MEDIA_NOT_CONFIGURED', 'Office 图片服务缺少 API key、地址或模型')
    return { id, config: { apiKey: saved.apiKey, baseUrl: saved.baseUrl || meta.defaultBaseUrl, imageModel: saved.imageModel || meta.defaultImageModel, analysisModel: '' } }
  }
  const analysisConfig = (current, video) => {
    if (!current.media.enabled) throw fault('OFFICE_AI_MEDIA_NOT_CONFIGURED', '请在设置的 AI 工具中配置生图、媒体与搜索服务')
    const id = current.media[video ? 'videoAnalysisProvider' : 'analysisProvider']
    const saved = current.media.providers[id] || {}
    const meta = (providers.mediaCatalog || []).find(item => item.id === id && item.analysisProtocol && (!video || item.videoAnalysis))
    if (id === 'genspark') throw fault('OFFICE_AI_MEDIA_NOT_CONFIGURED', '当前宿主未接入 Genspark 账户，请在 AI 工具中选择 API 服务商')
    if (!meta || typeof providers.analyzeMedia !== 'function') throw fault('OFFICE_AI_MEDIA_UNAVAILABLE', '当前安装包未加载所选媒体解析服务')
    if (!saved.apiKey || (id === 'custom' && (!saved.baseUrl || !saved.analysisModel))) throw fault('OFFICE_AI_MEDIA_NOT_CONFIGURED', '媒体解析服务缺少 API key、地址或模型')
    return { id, config: { apiKey: saved.apiKey, baseUrl: saved.baseUrl || meta.defaultBaseUrl, imageModel: saved.imageModel || meta.defaultImageModel, analysisModel: saved.analysisModel || meta.defaultAnalysisModel } }
  }
  return {
    configure(next) {
      if (!plain(next)) throw new TypeError('Office AI 服务实现无效')
      providers = { ...providers, ...next }
    },
    getSettings() { return publicConfig(config(), catalog()) },
    saveSettings(patch) {
      if (typeof writeConfig !== 'function') throw fault('OFFICE_AI_CONFIG_READ_ONLY', '当前环境无法保存 AI 服务配置')
      const next = normalizeServiceConfig(patch, config())
      writeConfig(next)
      return publicConfig(config(), catalog())
    },
    async testSettings(patch = {}, { signal } = {}) {
      const candidate = normalizeServiceConfig(patch, config())
      const checks = []
      const probe = createOfficeAiServices({ readConfig: () => candidate })
      probe.configure(providers)
      if (candidate.search.enabled) {
        const result = await probe.search('web', 'GenOffice', 1, { signal })
        checks.push({ kind: 'search', ok: result.method !== 'error' })
      }
      for (const [kind, field] of [['imageGeneration', 'imageProvider'], ['imageAnalysis', 'analysisProvider'], ['videoAnalysis', 'videoAnalysisProvider']]) {
        const id = candidate.media[field]
        const saved = candidate.media.providers[id] || {}
        if (id === 'genspark' || !saved.apiKey) { checks.push({ kind, ok: false, skipped: true }); continue }
        const meta = (providers.mediaCatalog || []).find(item => item.id === id)
        if (!meta || typeof providers.testMedia !== 'function') { checks.push({ kind, ok: false }); continue }
        try {
          const result = await providers.testMedia(id, { apiKey: saved.apiKey, baseUrl: saved.baseUrl || meta.defaultBaseUrl, imageModel: saved.imageModel || meta.defaultImageModel, analysisModel: saved.analysisModel || meta.defaultAnalysisModel }, signal)
          checks.push({ kind, ok: result?.ok === true })
        } catch { checks.push({ kind, ok: false }) }
      }
      if (candidate.fileSearch.rerank) {
        try { const result = await providers.probeDecision?.(candidate.fileSearch); checks.push({ kind: 'localSearch', ok: result?.ok === true }) }
        catch { checks.push({ kind: 'localSearch', ok: false }) }
      }
      return { ok: checks.some(item => !item.skipped) && checks.filter(item => !item.skipped).every(item => item.ok), checks }
    },
    capabilities() {
      const current = config()
      let generateImage = false
      try { imageConfig(current); generateImage = true } catch { /* 仅配置有效且实现存在时才启用 */ }
      let analyzeImage = false, analyzeVideo = false
      try { analysisConfig(current, false); analyzeImage = true } catch { /* 配置无效不声明可用 */ }
      try { analysisConfig(current, true); analyzeVideo = true } catch { /* 配置无效不声明可用 */ }
      return { webSearch: current.search.enabled && typeof providers.webSearch === 'function', imageSearch: current.search.enabled && typeof providers.imageSearch === 'function', generateImage, analyzeImage, analyzeVideo }
    },
    async analyzeMedia(input, owner, { signal, senderId } = {}) {
      const identity = ownerKey(owner)
      if (!Number.isSafeInteger(senderId) || senderId < 1) throw fault('OFFICE_AI_SENDER_INVALID', '无法确认媒体附件授权')
      const requirements = cleanText(input?.requirements, 20_000)
      if (!requirements) throw fault('OFFICE_AI_MEDIA_INPUT_INVALID', '媒体解析要求不能为空')
      const media = await loadOfficeMediaReferences(input?.mediaUrls, {
        signal,
        readGrantedMedia: typeof providers.readGrantedMedia === 'function' ? (file, maxBytes) => providers.readGrantedMedia(senderId, file, maxBytes) : undefined,
        fetchRemote: providers.fetchImage,
        readBodyCapped: providers.readBodyCapped,
        readGenerated: token => {
          sweep()
          const image = images.get(token)
          if (!image || image.owner !== identity) throw fault('OFFICE_AI_ASSET_NOT_OWNED', '图片不属于当前文档或已过期')
          return image
        },
      })
      assertActive(signal)
      const selected = analysisConfig(config(), media.some(item => !item.mime.startsWith('image/')))
      const text = await providers.analyzeMedia(selected.id, selected.config, { media, requirements }, signal)
      assertActive(signal)
      if (typeof text !== 'string' || !text.trim()) throw fault('OFFICE_AI_MEDIA_RESPONSE_INVALID', '媒体解析服务未返回有效内容')
      return { text: text.slice(0, 200_000) }
    },
    async search(kind, query, maxResults, { signal } = {}) {
      const project = kind === 'image' ? normalizeImageSearchResult : normalizeWebSearchResult
      const current = config()
      const text = cleanText(query, 500)
      if (!text) return project(fault('OFFICE_AI_QUERY_EMPTY', '搜索关键词不能为空'))
      if (!current.search.enabled) return project(fault('OFFICE_AI_SEARCH_DISABLED', 'Office 联网搜索已关闭，请在模型设置中启用'))
      const fn = kind === 'image' ? providers.imageSearch : providers.webSearch
      if (typeof fn !== 'function') return project(fault('OFFICE_AI_SEARCH_UNAVAILABLE', '当前安装包未加载搜索服务'))
      const options = { useGsk: false, prefer: current.search.provider }
      // 显式传空值，禁止意外使用本机环境变量中的其他项目密钥。
      for (const id of SEARCH_PROVIDERS) options[SEARCH_KEYS[id]] = current.search.providers[id]?.apiKey || ''
      assertActive(signal)
      try {
        const result = await fn(text, bounded(maxResults, kind === 'image' ? 8 : 6), options)
        assertActive(signal)
        return project(result)
      } catch (error) {
        assertActive(signal)
        return project(fault('OFFICE_AI_SEARCH_FAILED', '联网搜索服务请求失败，请检查网络与服务配置'))
      }
    },
    async generateImage(input, owner, { signal } = {}) {
      const identity = ownerKey(owner)
      const prompt = cleanText(input?.prompt, 20_000)
      if (!prompt) throw fault('OFFICE_AI_PROMPT_EMPTY', '图片描述不能为空')
      if (input?.references || input?.image) throw fault('OFFICE_AI_MEDIA_INPUT_INVALID', '图片参考文件需经过附件授权后读取')
      const selected = imageConfig(config())
      assertActive(signal)
      let image = await providers.generateImage(selected.id, selected.config, { prompt, ...(input?.aspectRatio ? { aspectRatio: cleanText(input.aspectRatio, 20) } : {}) }, signal)
      assertActive(signal)
      if (typeof normalizeImage === 'function') image = await normalizeImage(image)
      if (!(image?.bytes instanceof Uint8Array) || !image.bytes.byteLength || image.bytes.byteLength > MAX_IMAGE_BYTES || !['image/png', 'image/jpeg', 'image/gif'].includes(image.mime)) throw fault('OFFICE_AI_IMAGE_INVALID', '图片服务未返回有效的 PNG、JPEG 或 GIF 图片')
      assertActive(signal)
      sweep()
      // 内存资源总量受限；绝不把可任意读取的磁盘路径发给 renderer。
      let total = [...images.values()].reduce((sum, value) => sum + value.bytes.byteLength, 0)
      for (const [id, value] of images) {
        if (images.size < 32 && total + image.bytes.byteLength <= 100 * 1024 * 1024) break
        images.delete(id); total -= value.bytes.byteLength
      }
      const token = `${GENERATED_PREFIX}${uuid()}`
      images.set(token, { bytes: Uint8Array.from(image.bytes), mime: image.mime, owner: identity, created: now() })
      return { url: token }
    },
    async fetchImage(url, owner, { signal } = {}) {
      const identity = ownerKey(owner)
      assertActive(signal)
      if (typeof url !== 'string' || url.length > 4096) return null
      sweep()
      let image
      if (url.startsWith(GENERATED_PREFIX)) {
        const stored = images.get(url)
        if (!stored || stored.owner !== identity) throw fault('OFFICE_AI_ASSET_NOT_OWNED', '图片不属于当前文档或已过期')
        image = stored
      } else {
        if (!/^https?:\/\//i.test(url) || typeof providers.fetchImage !== 'function' || typeof providers.readBodyCapped !== 'function') return null
        const response = await providers.fetchImage(url)
        assertActive(signal)
        if (!response?.ok) return null
        const bytes = await providers.readBodyCapped(response, MAX_IMAGE_BYTES)
        assertActive(signal)
        image = { bytes, mime: response.headers.get('content-type')?.split(';')[0] || '' }
        if (typeof normalizeImage === 'function') image = await normalizeImage(image)
      }
      assertActive(signal)
      if (!['image/png', 'image/jpeg', 'image/gif'].includes(image?.mime)) return null
      return { base64: Buffer.from(image.bytes).toString('base64'), mime: image.mime }
    },
  }
}
