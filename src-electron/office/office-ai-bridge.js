import fs from 'fs'
import path from 'path'
import { app, ipcMain, net, webContents } from 'electron'
import { buildChatCompletionsUrl } from '../openaiUrl.js'
import { NETWORK_ERROR_CLASSIFICATIONS, annotateNetworkError, classifyNetworkError, fetchWithFiniteRetry, safeNetworkErrorSummary } from '../ai-core/network-policy.js'
import { executeCapability } from '../agent/tools/registry.js'
import { createAiChatCapabilityInvoker } from './ai-inference-adapter.js'

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
  streams: new Map(), // requestId -> AbortController
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
    return
  }
  state.model = { ...model, baseUrl: String(baseUrl).trim().replace(/\/+$/, '') }
  console.info('[Office AI] model selected:', state.model.provider || 'custom', state.model.modelName, state.model.baseUrl)
}

/** 编辑器 renderer 读取的 AI 设置：锁定为 Friday 托管形态（provider: genspark + 已登录态） */
function fridaySettings() {
  return {
    provider: 'genspark',
    providers: {
      genspark: { apiKey: 'friday-managed', model: 'Friday' },
    },
    gskToolsEnabled: true,
    maxOutputTokens: 8192,
  }
}

const MEDIA_UNSUPPORTED = '图片/媒体能力暂不可用：Friday 接管模式下请在设置中配置媒体 API（或联系管理员）'
const SEARCH_UNSUPPORTED = '联网搜索暂不可用：Friday 接管模式下未配置搜索后端'

function handle(channel, listener) {
  try { ipcMain.removeHandler(channel) } catch { /* not registered yet */ }
  ipcMain.handle(channel, listener)
}

const safeJson = (v) => {
  try { return JSON.stringify(v ?? {}) } catch { return '{}' }
}

/** vendor AgentMessage[] → OpenAI chat messages（含 tool_calls / tool 结果往返） */
function toOpenAiMessages(system, messages = []) {
  const out = []
  if (system) out.push({ role: 'system', content: String(system) })
  for (const m of messages) {
    if (m?.role === 'user') {
      if (Array.isArray(m.images) && m.images.length) {
        out.push({
          role: 'user',
          content: [
            { type: 'text', text: String(m.text || '') },
            ...m.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.base64}` } })),
          ],
        })
      } else {
        out.push({ role: 'user', content: String(m.text || '') })
      }
    } else if (m?.role === 'assistant') {
      const entry = { role: 'assistant', content: m.text || null }
      if (Array.isArray(m.toolCalls) && m.toolCalls.length) {
        entry.tool_calls = m.toolCalls.map((tc, i) => ({
          id: String(tc.id || `call_${i}_${tc.name}`),
          type: 'function',
          function: { name: tc.name, arguments: safeJson(tc.input) },
        }))
      }
      out.push(entry)
    } else if (m?.role === 'tool' && Array.isArray(m.results)) {
      for (const r of m.results) {
        out.push({ role: 'tool', tool_call_id: String(r.id || r.name || ''), content: String(r.output ?? '') })
      }
    }
  }
  return out
}

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

export async function fridayStreamRequest(chatMessages, tools, { signal, onDelta, onReasoning, requestId }) {
  const model = state.model
  const url = buildChatCompletionsUrl(model.baseUrl)
  const body = {
    model: model.modelName,
    messages: chatMessages,
    stream: true,
    stream_options: { include_usage: true },
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
      try { await response.body?.cancel?.() } catch { /* 释放服务端响应 */ }
      throw annotateNetworkError(new Error('模型请求失败'), {
        provider: model.provider, requestId, phase: 'response', status: response.status,
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
      const choice = parsed.choices?.[0]
      const delta = choice?.delta
      if (delta?.reasoning_content) onReasoning?.(delta.reasoning_content)
      if (delta?.content) { content += delta.content; onDelta?.(delta.content) }
      if (Array.isArray(delta?.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const index = Number.isInteger(tc.index) ? tc.index : 0
          const current = pendingCalls.get(index) || { id: '', name: '', args: '' }
          if (tc.id) current.id = tc.id
          if (tc.function?.name) current.name = tc.function.name
          if (tc.function?.arguments) current.args += tc.function.arguments
          pendingCalls.set(index, current)
        }
      }
      if (choice?.finish_reason) stopReason = NORMALIZE_STOP[choice.finish_reason] || choice.finish_reason
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
    const toolCalls = [...pendingCalls.values()].map(call => {
      let input
      let inputError
      try { input = call.args ? JSON.parse(call.args) : {} } catch (error) { input = {}; inputError = `invalid tool input JSON: ${error.message}` }
      return { id: call.id || `call_${call.name}`, name: call.name, input, ...(inputError ? { inputError } : {}) }
    })
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
  const { requestId, system, messages, tools } = request
  const sendSafe = (chunk) => {
    try {
      if (!send.sender.isDestroyed()) send.sender.send('ai:stream-chunk', chunk)
    } catch { /* sender gone */ }
  }
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
    })
    return
  }
  const controller = new AbortController()
  state.streams.set(requestId, controller)
  const t0 = Date.now()
  const ping = setInterval(() => sendSafe({ requestId, type: 'ping' }), 5000)
  try {
    const { content, toolCalls, stopReason } = await invokeAiChat(
      toOpenAiMessages(system, messages),
      toOpenAiTools(tools),
      {
        actor: 'office-ai',
        requestId,
        threadId: requestId,
        stream: true,
        signal: controller.signal,
        onDelta: (text) => sendSafe({ requestId, type: 'delta', text }),
        onReasoning: (text) => sendSafe({ requestId, type: 'reasoning', text }),
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
    if (controller.signal.aborted) {
      sendSafe({ requestId, type: 'done' })
    } else {
      const classification = err?.classification || classifyNetworkError(err)
      console.warn('[Office AI] stream error:', classification, `(${Date.now() - t0}ms)`)
      const errorCode = classification === NETWORK_ERROR_CLASSIFICATIONS.TIMEOUT ? 'timeout'
        : [NETWORK_ERROR_CLASSIFICATIONS.DNS_CONNECTION, NETWORK_ERROR_CLASSIFICATIONS.PROXY, NETWORK_ERROR_CLASSIFICATIONS.TLS].includes(classification) ? 'network'
          : [NETWORK_ERROR_CLASSIFICATIONS.RATE_LIMIT, NETWORK_ERROR_CLASSIFICATIONS.SERVER].includes(classification) ? 'overloaded' : undefined
      sendSafe({ requestId, type: 'error', error: safeNetworkErrorSummary(err), errorCode })
    }
  } finally {
    clearInterval(ping)
    state.streams.delete(requestId)
  }
}

/** 注册覆写（需在编辑器 IPC 注册之后调用） */
export function registerOfficeAiBridge() {
  handle('office-set-ai-model', (_e, model) => {
    setOfficeAiModel(model)
    return { success: true }
  })

  handle('ai:get-settings', () => fridaySettings())
  handle('ai:set-settings', (_e, settings) => settings ?? fridaySettings())
  handle('ai:gsk-status', () => ({ loggedIn: true, email: 'friday@local' }))
  handle('ai:gsk-login', () => ({}))
  handle('ai:codex-models', () => ({
    models: [state.model?.modelName || 'Friday'],
    defaultModel: state.model?.modelName || 'Friday',
  }))

  handle('ai:stream', (event, request) => runFridayStream(request, event))
  handle('ai:stream-cancel', (_e, requestId) => {
    state.streams.get(String(requestId))?.abort()
  })

  handle('ai:chat', async (_e, request) => {
    const { system, user } = request ?? {}
    if (!state.model) return { ok: false, error: 'Friday 模型未配置，请在本项目设置中添加模型' }
    try {
      const requestId = `office-chat:${Date.now()}`
      const { content } = await invokeAiChat(
        toOpenAiMessages(system, [{ role: 'user', text: String(user ?? '') }]),
        [],
        { actor: 'office-ai', requestId, threadId: requestId, stream: true },
      )
      return { ok: true, content }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // —— 优雅降级：Friday 接管模式下未提供的云能力 ——
  handle('ai:web-search', () => [])
  handle('ai:image-search', () => [])
  handle('ai:fetch-image', () => null)
  handle('ai:search-test', () => ({ ok: false, error: SEARCH_UNSUPPORTED }))
  handle('ai:media-test', () => ({ ok: false, error: MEDIA_UNSUPPORTED }))

  const imageGenChannels = ['ai:generate-image', 'docs:ai-generate-image', 'sheets:ai-generate-image']
  for (const ch of imageGenChannels) {
    handle(ch, () => ({ error: MEDIA_UNSUPPORTED }))
  }
  handle('ai:analyze-media', () => ({ error: MEDIA_UNSUPPORTED }))

  // —— AI 面板偏好（左侧/右侧等）：上游由 shell 主进程注册，这里由 Friday 接管 ——
  registerAiPanelPrefsIpc()

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
      try { wc.send('app:ai-panel-prefs-changed', next) } catch { /* ignore */ }
    }
    return next
  })
}
