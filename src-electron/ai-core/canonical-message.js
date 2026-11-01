/**
 * AI provider 之间共享的消息合同。
 * 这里故意不依赖具体 provider SDK，避免能力 schema 或 IPC 边界把工具字段丢掉。
 */
const ROLES = new Set(['system', 'user', 'assistant', 'tool'])

export class TranscriptError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'TranscriptError'
    this.code = 'TRANSCRIPT_INVALID'
    this.kind = 'transcript'
    this.details = details
  }
}

function stringOrNull(value) {
  return value == null ? null : String(value)
}

export function validateCanonicalMessages(messages, { requireIds = false } = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new TranscriptError('消息记录不能为空', { path: 'messages' })
  }
  const knownToolCalls = new Set()
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    const path = `messages[${index}]`
    if (!message || typeof message !== 'object' || !ROLES.has(message.role)) {
      throw new TranscriptError('消息角色无效', { path: `${path}.role` })
    }
    if (!('content' in message)) throw new TranscriptError('消息缺少 content', { path: `${path}.content` })
    if (requireIds && !String(message.id || '').trim()) throw new TranscriptError('消息缺少稳定 ID', { path: `${path}.id` })
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      for (let callIndex = 0; callIndex < message.tool_calls.length; callIndex += 1) {
        const call = message.tool_calls[callIndex]
        const callPath = `${path}.tool_calls[${callIndex}]`
        if (!call || !String(call.id || '').trim()) throw new TranscriptError('tool call 缺少 ID', { path: `${callPath}.id` })
        if (call.type && call.type !== 'function') throw new TranscriptError('tool call 类型无效', { path: `${callPath}.type` })
        if (!call.function || !String(call.function.name || '').trim()) throw new TranscriptError('tool call 缺少函数名', { path: `${callPath}.function.name` })
        const args = call.function.arguments
        if (typeof args !== 'string') throw new TranscriptError('tool call arguments 必须是 JSON 字符串', { path: `${callPath}.function.arguments` })
        try { JSON.parse(args || '{}') } catch { throw new TranscriptError('tool call arguments 不是合法 JSON', { path: `${callPath}.function.arguments` }) }
        knownToolCalls.add(String(call.id))
      }
    }
    if (message.role === 'tool') {
      const toolCallId = String(message.tool_call_id || '').trim()
      if (!toolCallId) throw new TranscriptError('工具结果缺少 tool_call_id', { path: `${path}.tool_call_id` })
      if (!knownToolCalls.has(toolCallId)) throw new TranscriptError('工具结果没有对应的 tool call', { path: `${path}.tool_call_id`, toolCallId })
    }
  }
  return messages
}

/** 只复制 provider 允许的字段，避免把内部状态或密钥送到第三方。 */
export function serializeCanonicalMessages(messages, options = {}) {
  validateCanonicalMessages(messages, options)
  return messages.map(message => {
    const output = { role: message.role, content: message.content }
    if (message.name) output.name = String(message.name)
    if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length) {
      output.tool_calls = message.tool_calls.map(call => ({
        id: String(call.id),
        type: 'function',
        function: { name: String(call.function.name), arguments: String(call.function.arguments) }
      }))
    }
    if (message.role === 'tool') output.tool_call_id = String(message.tool_call_id)
    if (options.thinking && message.role === 'assistant' && message.reasoning_content) output.reasoning_content = String(message.reasoning_content)
    return output
  })
}

export function canonicalMessage(message, index = 0) {
  const role = message?.role
  if (!ROLES.has(role)) throw new TranscriptError('消息角色无效', { path: `messages[${index}].role` })
  return {
    id: String(message.id || `message_${index}`),
    role,
    content: stringOrNull(message.content),
    ...(message.name ? { name: String(message.name) } : {}),
    ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    ...(message.tool_call_id ? { tool_call_id: String(message.tool_call_id) } : {}),
    ...(message.reasoning_content ? { reasoning_content: String(message.reasoning_content) } : {}),
    createdAt: Number(message.createdAt) || Date.now()
  }
}
