import fs from 'fs'
import path from 'path'
import { randomUUID } from 'node:crypto'
import { app, ipcMain, net, webContents } from 'electron'
import { buildChatCompletionsUrl } from '../openaiUrl.js'
import { NETWORK_ERROR_CLASSIFICATIONS, annotateNetworkError, classifyNetworkError, fetchWithFiniteRetry, safeNetworkErrorSummary } from '../ai-core/network-policy.js'
import { executeCapability } from '../agent/tools/registry.js'
import { getSkillDir, listSkills } from '../agent/skills.js'
import { createAiChatCapabilityInvoker } from './ai-inference-adapter.js'
import { createOfficeAiRequestRegistry } from './ai-request-registry.js'
import { createOfficeAiServices } from './ai-services.js'
import { readOfficeAiServiceSettings, writeOfficeAiServiceSettings } from './ai-service-settings-store.js'
import {
  normalizeAiSettingsSnapshot,
  normalizeGskStatus,
  normalizeSkillText,
  normalizeSkillsList,
  normalizeSuggestedFileName,
} from './ai-service-contract.js'
import { toOpenAiMessages } from './canonical-transcript.js'
import {
  OFFICE_DEFAULT_MAX_OUTPUT_TOKENS,
  finalizeOfficeToolCalls,
  mergeOfficeToolDelta,
  mergeToolName,
  normalizeOfficeStopReason,
} from './office-ai-stream.js'

/**
 * Office 编辑器 AI 桥接：用 Friday 的模型层覆写编辑器注册的 ai:* IPC。
 * renderer（编辑器 AI 面板）协议不变（vendor packages/ai-provider/src/types.ts），
 * 仅由主进程把 ai:stream 等请求转发给本项目配置的模型。
 *
 * Agent 循环沿用 vendor 形态：main 只负责把模型的 tool-call 流式透传给
 * renderer，由 renderer 执行其注册的工具（文档编辑等）并把 {role:'tool',
 * results:[AgentToolResult]} 消息追加回传，循环续跑直至模型给出最终回复。
 *
 * 模型配置来自主窗口 renderer 的 localStorage（本项目模型设置存于 renderer），
 * 通过 office-set-ai-model 由 OfficeWorkspace 在挂载/切换模型时推送。
 */

const state = {
  model: null, // { baseUrl, apiKey, modelName, provider }
  resolveOwner: null,
  isModelSettingsSender: null,
  bridgeRegistered: false,
  openSettings: null,
  ensureServices: null,
}

const requests = createOfficeAiRequestRegistry({ resolveOwner: sender => state.resolveOwner?.(sender) })
const bridgeFault = code => Object.assign(new Error(code), { code })
const officeServices = createOfficeAiServices({
  readConfig: readOfficeAiServiceSettings,
  writeConfig: writeOfficeAiServiceSettings,
  // 统一转换为 HTML 保存与 DOCX 导出都支持的真实图片格式。
  async normalizeImage(image) {
    if (!(image?.bytes instanceof Uint8Array) || image.bytes.byteLength > 50 * 1024 * 1024) throw bridgeFault('OFFICE_AI_IMAGE_INVALID')
    const { default: sharp } = await import('sharp')
    const source = sharp(Buffer.from(image.bytes), { limitInputPixels: 50_000_000 })
    const metadata = await source.metadata()
    if (['png', 'jpeg', 'gif'].includes(metadata.format)) return { bytes: image.bytes, mime: `image/${metadata.format}` }
    if (!['webp', 'avif', 'heif'].includes(metadata.format)) throw bridgeFault('OFFICE_AI_IMAGE_INVALID')
    return { bytes: new Uint8Array(await source.png().toBuffer()), mime: 'image/png' }
  },
})

function assertSender(event, { modelSettings = false } = {}) {
  const sender = event?.sender
  if (!sender || sender.isDestroyed?.() !== false ||
    ('senderFrame' in event && (!event.senderFrame || event.senderFrame !== sender.mainFrame))) {
    throw bridgeFault('OFFICE_AI_SENDER_INVALID')
  }
  if (modelSettings) {
    if (state.isModelSettingsSender?.(sender) !== true) throw bridgeFault('OFFICE_AI_SENDER_INVALID')
  } else {
    const owner = state.resolveOwner?.(sender)
    if (!owner || typeof owner.documentId !== 'string' || !owner.documentId ||
      typeof owner.viewId !== 'string' || !owner.viewId) throw bridgeFault('OFFICE_AI_OWNER_UNAVAILABLE')
  }
  return sender
}

function notifyAiSettingsChanged() {
  for (const sender of webContents.getAllWebContents()) {
    try {
      if (!sender.isDestroyed() && state.resolveOwner?.(sender)) sender.send('ai:settings-changed')
    } catch { /* a view can close while settings change */ }
  }
}

/** 主窗口侧推送当前模型配置（OfficeWorkspace 挂载/模型切换时调用） */
export function setOfficeAiModel(model) {
  const baseUrl = model?.baseUrl || model?.modelUrl
  if (!model || !String(model.apiKey || '').trim() || !String(model.modelName || '').trim() || !String(baseUrl || '').trim()) {
    state.model = null
    console.warn('[Office AI] model configuration is incomplete', {
      hasApiKey: Boolean(model?.apiKey),
      hasModelName: Boolean(model?.modelName),
      hasBaseUrl: Boolean(baseUrl),
    })
    notifyAiSettingsChanged()
    return
  }
  state.model = {
    ...model,
    baseUrl: String(baseUrl).trim().replace(/\/+$/, ''),
    // Office tool loops default to the protocol-safe mode. Thinking is only
    // enabled when the caller explicitly proves the provider contract.
    thinking: model.thinking === 'enabled' && model.reasoningRoundTrip === true ? 'enabled' : 'disabled',
  }
  console.info('[Office AI] model selected:', state.model.provider || 'custom', state.model.modelName, state.model.baseUrl)
  notifyAiSettingsChanged()
}

/** 编辑器 renderer 读取的 AI 设置：只返回 Friday 当前真实生效的公开快照。 */
function fridaySettings() {
  const configured = Boolean(state.model)
  const provider = configured ? String(state.model.provider || 'custom') : null
  return normalizeAiSettingsSnapshot({
    hostMode: 'friday-managed',
    streamProtocolVersion: '1.1',
    provider,
    model: configured ? state.model.modelName : null,
    configured,
    providers: configured ? {
      [provider]: { configured: true, model: state.model.modelName, enabled: true },
    } : {},
    capabilities: {
      chat: configured,
      naming: configured,
      skills: true,
      ...officeServices.capabilities(),
    },
    // Friday does not prove a Genspark media session merely because chat is configured.
    gskToolsEnabled: false,
    maxOutputTokens: configured && Number.isSafeInteger(Number(state.model.maxOutputTokens))
      ? Number(state.model.maxOutputTokens)
      : 8192,
    updatedAt: Date.now(),
  })
}

function handle(channel, listener, options) {
  try { ipcMain.removeHandler(channel) } catch { /* not registered yet */ }
  ipcMain.handle(channel, (event, ...args) => {
    assertSender(event, options)
    return listener(event, ...args)
  })
}

function skillFileForName(name) {
  if (typeof name !== 'string' || !name.trim()) return null
  const skills = listSkills()
  const matches = skills.filter(skill => skill.name === name.trim())
  if (matches.length !== 1 || typeof matches[0].fileName !== 'string') return null
  const root = path.resolve(getSkillDir())
  const file = path.resolve(root, matches[0].fileName)
  const relative = path.relative(root, file)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return file
}

function extractSuggestedName(content) {
  const first = String(content || '')
    .split(/\r?\n/)
    .map(line => line.replace(/^```[a-z]*|```$/gi, '').replace(/^[-*#\d.)\s]+/, '').trim())
    .find(Boolean) || ''
  return first.replace(/^['"“”]+|['"“”]+$/g, '').trim()
}

async function suggestOfficeFileName(input, invocation) {
  const content = typeof input?.content === 'string' ? input.content.trim() : ''
  if (!content) return { ok: false, reason: 'empty-content' }
  if (!state.model) return { ok: false, reason: 'unavailable' }
  try {
    const { content: answer } = await invokeAiChat(
      toOpenAiMessages(
        'You name files. Return only one concise filename stem, without extension or explanation.',
        [{ role: 'user', text: content.slice(0, 4000) }],
      ),
      [],
      { ...invocation, actor: 'office-ai-naming', stream: true },
    )
    return normalizeSuggestedFileName({ ok: true, name: extractSuggestedName(answer) })
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

async function invokeForEditor(event, kind, parameters, invoke) {
  const requestId = `office-${kind}:${randomUUID()}`
  const { lease } = requests.begin({ sender: event.sender, requestId, parameters })
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(bridgeFault('OFFICE_AI_SERVICE_TIMEOUT')), kind === 'generate-image' ? 180000 : kind === 'analyze-media' ? 300000 : 45000)
  const signal = AbortSignal.any([lease.signal, timeout.signal])
  let aborted
  try {
    const cancelled = new Promise((_resolve, reject) => {
      aborted = () => reject(signal.reason || bridgeFault('OFFICE_AI_REQUEST_CANCELLED'))
      signal.addEventListener('abort', aborted, { once: true })
      if (signal.aborted) aborted()
    })
    const result = await Promise.race([invoke({ requestId, signal }), cancelled])
    if (!lease.finish('completed')) throw bridgeFault('OFFICE_AI_OWNER_CHANGED')
    return result
  } finally {
    clearTimeout(timer)
    if (aborted) signal.removeEventListener('abort', aborted)
    lease.finish('failed')
  }
}

export { toOpenAiMessages } from './canonical-transcript.js'

/** vendor AgentToolDef[] → OpenAI tools 定义 */
function toOpenAiTools(tools = []) {
  return tools
    .filter((t) => t?.name)
    .map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.inputSchema && Object.keys(t.inputSchema).length ? t.inputSchema : { type: 'object', properties: {} },
      },
    }))
}

const NORMALIZE_STOP = { tool_calls: 'tool_calls', length: 'max_tokens', max_tokens: 'max_tokens', stop: 'stop' }

export async function fridayStreamRequest(chatMessages, tools, { signal, onDelta, onReasoning, onUsage, requestId, maxTokens }) {
  const model = state.model
  const url = buildChatCompletionsUrl(model.baseUrl)
  const body = {
    model: model.modelName,
    messages: chatMessages,
    // The renderer advertises an 8192-token Office budget, but the old bridge
    // silently dropped it. On long PDF reads the provider could spend the
    // default completion budget and cut a tool JSON object in half.
    max_tokens: Number.isFinite(Number(maxTokens ?? model.maxOutputTokens))
      ? Math.max(256, Math.min(32768, Number(maxTokens ?? model.maxOutputTokens)))
      : OFFICE_DEFAULT_MAX_OUTPUT_TOKENS,
    stream: true,
    stream_options: { include_usage: true },
    thinking: { type: model.thinking === 'enabled' ? 'enabled' : 'disabled' },
  }
  if (tools.length) {
    body.tools = tools
    body.tool_choice = 'auto'
  }
  const controller = new AbortController()
  let timeout = null
  let timedOut = false
  let phase = 'connect'
  let reader = null
  const resetTimeout = () => {
    clearTimeout(timeout)
    timeout = setTimeout(() => {
      timedOut = true
      controller.abort(new Error('Office AI request timed out'))
    }, 45000)
  }
  const abort = () => controller.abort(signal.reason)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  resetTimeout()
  try {
    const response = await fetchWithFiniteRetry(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${model.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    }, {
      provider: model.provider,
      requestId,
      maxAttempts: 2,
      fetchImpl: (input, options) => net.fetch(input, options),
    })
    if (!response.ok) {
      let providerCode = ''
      let providerParam = ''
      let providerMessage = ''
      try {
        const raw = await response.text()
        const parsed = JSON.parse(raw)
        const detail = parsed?.error || parsed
        providerCode = String(detail?.code || detail?.type || '').slice(0, 80)
        providerParam = String(detail?.param || detail?.field || '').slice(0, 160)
        providerMessage = String(detail?.message || '').slice(0, 240)
      } catch { /* provider may return an empty/non-JSON body */ }
      throw annotateNetworkError(new Error(providerMessage || '模型请求失败'), {
        provider: model.provider, requestId, phase: 'response', status: response.status,
        providerCode, providerParam,
      })
    }

    phase = 'stream'
    reader = response.body?.getReader()
    if (!reader) throw new Error('AI response body is empty')
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let stopReason
    let sawDone = false
    const pendingCalls = new Map()
    const consumeLine = line => {
      const normalized = line.trim()
      if (!normalized.startsWith('data:')) return
      const payload = normalized.slice(5).trim()
      if (payload === '[DONE]') { sawDone = true; return }
      let parsed
      try { parsed = JSON.parse(payload) } catch { return }
      if (parsed.error) throw annotateNetworkError(new Error('AI provider returned a stream error'), {
        provider: model.provider, requestId, phase: 'stream',
        classification: NETWORK_ERROR_CLASSIFICATIONS.MODEL_REQUEST,
      })
      if (parsed.usage && typeof parsed.usage === 'object') {
        const usage = {}
        if (Number.isSafeInteger(parsed.usage.prompt_tokens) && parsed.usage.prompt_tokens >= 0) usage.inputTokens = parsed.usage.prompt_tokens
        if (Number.isSafeInteger(parsed.usage.completion_tokens) && parsed.usage.completion_tokens >= 0) usage.outputTokens = parsed.usage.completion_tokens
        if (Object.keys(usage).length) onUsage?.(usage)
      }
      const choice = parsed.choices?.[0]
      const delta = choice?.delta
      if (delta?.reasoning_content) onReasoning?.(delta.reasoning_content)
      if (delta?.content) { content += delta.content; onDelta?.(delta.content) }
      if (Array.isArray(delta?.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const index = Number.isInteger(tc.index) ? tc.index : 0
          const current = pendingCalls.get(index) || { id: '', name: '', args: '' }
          if (tc.id) current.id = tc.id
          // 标准接口按增量追加；特殊累计协议必须由模型适配配置显式声明。
          if (tc.function?.name) current.name = mergeToolName(current.name, tc.function.name, { mode: model.toolStreamMode?.names || 'delta' })
          if (tc.function?.arguments) current.args = mergeOfficeToolDelta(current.args, tc.function.arguments, { mode: model.toolStreamMode?.arguments || 'delta' })
          pendingCalls.set(index, current)
        }
      }
      if (choice?.finish_reason) stopReason = normalizeOfficeStopReason(NORMALIZE_STOP[choice.finish_reason] || choice.finish_reason)
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      resetTimeout()
      buffer += decoder.decode(value, { stream: true })
      let index
      while ((index = buffer.indexOf('\n')) >= 0) {
        consumeLine(buffer.slice(0, index))
        buffer = buffer.slice(index + 1)
      }
      if (buffer.length > 8 * 1024 * 1024) throw new Error('AI stream line exceeds limit')
    }
    buffer += decoder.decode()
    if (buffer.trim()) consumeLine(buffer)
    if (!sawDone && !stopReason) {
      throw annotateNetworkError(new Error('AI stream ended before completion'), {
        provider: model.provider, requestId, phase: 'stream',
        classification: NETWORK_ERROR_CLASSIFICATIONS.STREAM_INTERRUPTED,
      })
    }
    const toolCalls = finalizeOfficeToolCalls(pendingCalls, stopReason)
    const argumentLengths = new Map([...pendingCalls.values()].map((pending) => [pending.id, pending.args.length]))
    for (const call of toolCalls) {
      if (call.inputError || call.truncated) {
        console.warn('[Office AI] tool call arguments unusable', {
          name: call.name,
          argumentLength: argumentLengths.get(call.id) || 0,
          truncated: Boolean(call.truncated),
          stopReason: stopReason || null,
        })
      }
    }
    return { content, toolCalls, stopReason }
  } catch (error) {
    if (signal?.aborted) throw error
    if (timedOut) throw annotateNetworkError(new Error('模型请求超时'), {
      provider: model.provider, requestId, phase,
      classification: NETWORK_ERROR_CLASSIFICATIONS.TIMEOUT,
    })
    if (error?.diagnostic) throw error
    throw annotateNetworkError(error, { provider: model.provider, requestId, phase })
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
    reader?.releaseLock()
  }
}

const invokeAiChat = createAiChatCapabilityInvoker(executeCapability, fridayStreamRequest)

async function runFridayStream(request, send) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw bridgeFault('OFFICE_AI_PARAMETERS_INVALID')
  const { requestId, sessionId, system, messages, tools, maxTokens } = request
  if (sessionId !== undefined && (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200)) throw bridgeFault('OFFICE_AI_PARAMETERS_INVALID')
  if (maxTokens !== undefined && (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 32768)) throw bridgeFault('OFFICE_AI_PARAMETERS_INVALID')
  const { lease, reused } = requests.begin({ sender: send.sender, requestId, parameters: request })
  if (reused) return
  const sendSafe = chunk => lease.emit({ ...chunk, protocolVersion: '1.1', hostMode: 'friday-managed', provider: state.model?.provider || 'custom' })
  if (!state.model) {
    sendSafe({
      requestId,
      type: 'error',
      error: 'Friday 模型未配置，请在本项目设置中添加模型',
      // Configuration errors must not be translated into the renderer's
      // generic connectivity message.  That message is reserved for an
      // actual transport failure and otherwise hides the selected model
      // problem (especially when Office opens before settings are synced).
      errorCode: 'provider',
      recovery: 'model-settings',
    })
    return
  }
  const t0 = Date.now()
  const ping = setInterval(() => sendSafe({ requestId, type: 'ping' }), 5000)
  const stopPing = () => clearInterval(ping)
  lease.signal.addEventListener('abort', stopPing, { once: true })
  try {
    const { content, toolCalls, stopReason } = await invokeAiChat(
      toOpenAiMessages(system, messages, { thinking: state.model?.thinking }),
      toOpenAiTools(tools),
      {
        actor: 'office-ai',
        requestId,
        threadId: sessionId || requestId,
        maxTokens,
        stream: true,
        signal: lease.signal,
        onDelta: (text) => sendSafe({ requestId, type: 'delta', text }),
        onReasoning: (text) => sendSafe({ requestId, type: 'reasoning', text }),
        onUsage: usage => sendSafe({ requestId, type: 'usage', usage }),
      },
    )
    // 透传工具调用：renderer 执行后以 {role:'tool', results} 回传续跑 agent 循环
    for (const tc of toolCalls) {
      sendSafe({ requestId, type: 'tool-call', toolCall: tc })
    }
    if (!content && toolCalls.length && !stopReason) {
      sendSafe({ requestId, type: 'done', stopReason: 'tool_calls' })
    } else {
      sendSafe({ requestId, type: 'done', stopReason: stopReason || 'stop' })
    }
  } catch (err) {
    if (!lease.signal.aborted) {
      const classification = err?.classification || classifyNetworkError(err)
      console.warn('[Office AI] stream error:', classification, `(${Date.now() - t0}ms)`)
      const errorCode = err?.code === 'TRANSCRIPT_INVALID' ? 'transcript'
        : classification === NETWORK_ERROR_CLASSIFICATIONS.AUTH ? 'auth'
        : classification === NETWORK_ERROR_CLASSIFICATIONS.MODEL_REQUEST ? 'parameter'
        : classification === NETWORK_ERROR_CLASSIFICATIONS.TIMEOUT ? 'timeout'
        : [NETWORK_ERROR_CLASSIFICATIONS.DNS_CONNECTION, NETWORK_ERROR_CLASSIFICATIONS.PROXY, NETWORK_ERROR_CLASSIFICATIONS.TLS].includes(classification) ? 'network'
          : [NETWORK_ERROR_CLASSIFICATIONS.RATE_LIMIT, NETWORK_ERROR_CLASSIFICATIONS.SERVER].includes(classification) ? 'overloaded' : undefined
      sendSafe({ requestId, type: 'error', error: safeNetworkErrorSummary(err), errorCode,
        recovery: ['auth', 'provider'].includes(errorCode) ? 'model-settings' : 'retry', diagnostic: err?.diagnostic || undefined })
    }
  } finally {
    clearInterval(ping)
    lease.signal.removeEventListener('abort', stopPing)
    lease.finish('completed')
  }
}

/**
 * 注册 Office AI IPC。
 *
 * OfficeWorkspace 在编辑器 bundle 懒加载前就可能推送模型配置，所以
 * `office-set-ai-model` 需要在 Office Host 初始化阶段先可用。编辑器 bundle
 * 加载后会再次以 force 模式注册，让 Friday 覆盖上游同名 ai:* 通道。
 */
export function registerOfficeAiBridge({ force = false, resolveOwner, isModelSettingsSender, services, openSettings, ensureServices } = {}) {
  if (ensureServices !== undefined) state.ensureServices = ensureServices
  if (openSettings !== undefined) state.openSettings = openSettings
  if (services !== undefined) officeServices.configure(services)
  if (resolveOwner !== undefined) {
    if (typeof resolveOwner !== 'function') throw new TypeError('Office AI owner resolver must be a function')
    state.resolveOwner = resolveOwner
  }
  if (isModelSettingsSender !== undefined) {
    if (typeof isModelSettingsSender !== 'function') throw new TypeError('Office AI model settings sender resolver must be a function')
    state.isModelSettingsSender = isModelSettingsSender
  }
  if (state.bridgeRegistered && !force) return

  handle('office-set-ai-model', (_e, model) => {
    setOfficeAiModel(model)
    return { success: true }
  }, { modelSettings: true })

  handle('office-ai-services-get', async () => { await state.ensureServices?.(); return officeServices.getSettings() }, { modelSettings: true })
  handle('office-ai-services-save', (_event, patch) => {
    const result = officeServices.saveSettings(patch)
    notifyAiSettingsChanged()
    return result
  }, { modelSettings: true })
  handle('office-ai-services-test', async (_event, input) => {
    await state.ensureServices?.()
    if (input?.kind === 'all') return officeServices.testSettings(input.patch, { signal: AbortSignal.timeout(45000) })
    if (input?.kind !== 'search') return { ok: false, error: 'OFFICE_AI_TEST_KIND_INVALID' }
    const result = await officeServices.search('web', 'GenOffice', 1)
    return result.method === 'error' ? { ok: false, error: result.error } : { ok: true, method: result.method, count: result.results.length }
  }, { modelSettings: true })

  handle('ai:get-settings', () => fridaySettings())
  // Model credentials are owned by Friday's settings surface and are never
  // accepted from an editor renderer. Return the post-commit snapshot so the
  // caller cannot mistake an echo for a persisted setting.
  handle('ai:set-settings', () => fridaySettings())
  handle('ai:open-model-settings', () => state.openSettings?.('model'))
  handle('ai:open-skills-settings', () => state.openSettings?.('skills'))
  // A configured Friday model is not evidence of a Genspark login session.
  handle('ai:gsk-status', () => normalizeGskStatus({ loggedIn: false, reason: 'friday-managed-provider' }))
  handle('ai:gsk-login', () => ({}))
  handle('ai:codex-models', () => ({
    models: [state.model?.modelName || 'Friday'],
    defaultModel: state.model?.modelName || 'Friday',
  }))

  handle('ai:stream', (event, request) => runFridayStream(request, event))
  handle('ai:stream-cancel', (event, requestId) => requests.cancel({ sender: event.sender, requestId }))
  handle('ai:services-cancel', event => requests.cancelServices(event.sender))

  handle('ai:chat', (event, request) => invokeForEditor(event, 'chat', request, async invocation => {
    const { system, user } = request ?? {}
    if (!state.model) return { ok: false, error: 'Friday 模型未配置，请在本项目设置中添加模型' }
    try {
      const { content } = await invokeAiChat(
        toOpenAiMessages(system, [{ role: 'user', text: String(user ?? '') }], { thinking: state.model?.thinking }),
        [],
        { ...invocation, actor: 'office-ai', stream: true },
      )
      return { ok: true, content }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  }))

  // 搜索、媒体和图片下载共用宿主 owner lease，结果只交回原文档。
  handle('ai:web-search', (event, query, maxResults) => invokeForEditor(event, 'web-search', { query, maxResults },
    invocation => officeServices.search('web', query, maxResults, invocation)))
  handle('ai:image-search', (event, query, maxResults) => invokeForEditor(event, 'image-search', { query, maxResults },
    invocation => officeServices.search('image', query, maxResults, invocation)))
  for (const channel of ['ai:fetch-image', 'html:fetch-image']) {
    handle(channel, (event, url) => invokeForEditor(event, 'fetch-image', { url },
      invocation => officeServices.fetchImage(url, state.resolveOwner(event.sender), invocation)))
  }
  handle('ai:search-test', (event) => invokeForEditor(event, 'search-test', {}, async invocation => {
    const result = await officeServices.search('web', 'GenOffice', 1, invocation)
    return result.method === 'error' ? { ok: false, error: result.error } : { ok: true, method: result.method }
  }))
  handle('ai:media-test', event => invokeForEditor(event, 'media-test', {}, async invocation => {
    await state.ensureServices?.()
    return officeServices.testSettings({}, invocation)
  }))

  const imageGenChannels = ['ai:generate-image', 'html:ai-generate-image', 'docs:ai-generate-image', 'sheets:ai-generate-image']
  for (const ch of imageGenChannels) {
    handle(ch, (event, input) => invokeForEditor(event, 'generate-image', input, async invocation => {
      try { return await officeServices.generateImage(input, state.resolveOwner(event.sender), invocation) }
      catch (error) {
        if (invocation.signal.aborted) throw error
        return { error: String(error?.code || '').startsWith('OFFICE_AI_') ? error.message : '图片生成服务请求失败，请检查模型设置、额度与网络' }
      }
    }))
  }
  handle('ai:analyze-media', (event, input) => invokeForEditor(event, 'analyze-media', input, async invocation => {
    try { return await officeServices.analyzeMedia(input, state.resolveOwner(event.sender), { ...invocation, senderId: event.sender.id }) }
    catch (error) {
      if (invocation.signal.aborted) throw error
      return { error: String(error?.code || '').startsWith('OFFICE_AI_') ? error.code : 'OFFICE_AI_MEDIA_REQUEST_FAILED' }
    }
  }))

  // HTML shell compatibility channels. Skills are read from Friday's own
  // managed inventory and never from a renderer-supplied arbitrary path.
  handle('ai:skills-list', () => normalizeSkillsList(listSkills()))
  handle('ai:skill-text', (_event, name) => {
    const file = skillFileForName(name)
    if (!file) throw Object.assign(new Error('OFFICE_AI_SKILL_NOT_FOUND'), { code: 'OFFICE_AI_SKILL_NOT_FOUND' })
    let stat
    try { stat = fs.statSync(file) } catch { throw Object.assign(new Error('OFFICE_AI_SKILL_NOT_FOUND'), { code: 'OFFICE_AI_SKILL_NOT_FOUND' }) }
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) {
      throw Object.assign(new Error('OFFICE_AI_SKILL_TOO_LARGE'), { code: 'OFFICE_AI_SKILL_TOO_LARGE' })
    }
    return normalizeSkillText(fs.readFileSync(file, 'utf8'))
  })
  handle('ai:suggest-file-name', (event, input) => invokeForEditor(event, 'naming', input,
    invocation => suggestOfficeFileName(input, invocation)))

  // —— AI 面板偏好（左侧/右侧等）：上游由 shell 主进程注册，这里由 Friday 接管 ——
  registerAiPanelPrefsIpc()

  state.bridgeRegistered = true
  console.log('[Office] AI bridge registered: Friday takes over ai:* channels')
}

// ---- AI 面板偏好（镜像 vendor packages/ui ai-panel-prefs 归一化规则） ----

const AI_PANEL_PREFS_FILE = () => path.join(app.getPath('userData'), 'office-ai-panel-prefs.json')

let cachedAiPanelPrefs = null

function normalizeAiPanelPrefs(raw) {
  const obj = raw !== null && typeof raw === 'object' ? raw : {}
  const clampPx = (v) => {
    const n = typeof v === 'string' ? Number(v) : v
    if (typeof n !== 'number' || !Number.isFinite(n)) return null
    return Math.min(32, Math.max(10, Math.round(n)))
  }
  return {
    side: obj.side === 'right' ? 'right' : 'left',
    fontSize: ['default', 'large', 'xlarge', 'custom'].includes(obj.fontSize)
      ? obj.fontSize
      : 'default',
    customFontSize: clampPx(obj.customFontSize) ?? 14,
    spellcheck: typeof obj.spellcheck === 'boolean' ? obj.spellcheck : true,
  }
}

function currentAiPanelPrefs() {
  if (cachedAiPanelPrefs) return cachedAiPanelPrefs
  try {
    cachedAiPanelPrefs = normalizeAiPanelPrefs(JSON.parse(fs.readFileSync(AI_PANEL_PREFS_FILE(), 'utf8')))
  } catch {
    cachedAiPanelPrefs = normalizeAiPanelPrefs({})
  }
  return cachedAiPanelPrefs
}

function registerAiPanelPrefsIpc() {
  handle('app:get-ai-panel-prefs', () => currentAiPanelPrefs())

  handle('app:set-ai-panel-prefs', (_e, patch) => {
    const prev = currentAiPanelPrefs()
    const raw = patch !== null && typeof patch === 'object' ? patch : {}
    // 未知/非法字段回退为当前值而非默认值（与上游 shell 一致）
    const next = normalizeAiPanelPrefs({
      side: raw.side === 'left' || raw.side === 'right' ? raw.side : prev.side,
      fontSize: 'fontSize' in raw ? raw.fontSize : prev.fontSize,
      customFontSize: 'customFontSize' in raw ? raw.customFontSize : prev.customFontSize,
      spellcheck: 'spellcheck' in raw ? raw.spellcheck : prev.spellcheck,
    })
    if (
      next.side === prev.side &&
      next.fontSize === prev.fontSize &&
      next.customFontSize === prev.customFontSize &&
      next.spellcheck === prev.spellcheck
    ) {
      return prev
    }
    cachedAiPanelPrefs = next
    try {
      fs.writeFileSync(AI_PANEL_PREFS_FILE(), JSON.stringify(next, null, 2))
    } catch (e) {
      console.warn('[Office] save ai panel prefs failed:', e.message)
    }
    // 同步所有打开的编辑器视图
    for (const wc of webContents.getAllWebContents()) {
      try { if (!wc.isDestroyed() && state.resolveOwner?.(wc)) wc.send('app:ai-panel-prefs-changed', next) } catch { /* ignore */ }
    }
    return next
  })
}
