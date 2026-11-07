// Office 流式桥的纯函数；参数分片按提供商明确声明的协议重建。

export const OFFICE_DEFAULT_MAX_OUTPUT_TOKENS = 8192

export const normalizeOfficeStopReason = (reason) => {
  if (reason === 'length' || reason === 'max_tokens') return 'max_tokens'
  if (reason === 'tool_calls') return 'tool_calls'
  if (reason === 'stop') return 'stop'
  return reason || undefined
}

function streamFault(code) {
  return Object.assign(new Error(code), { code })
}

// 显式累计快照必须单调扩展；旧快照可忽略，冲突快照不能静默拼接。
function mergeCumulativeValue(previous, next, field) {
  if (!next || previous.startsWith(next)) return previous
  if (next.startsWith(previous)) return next
  throw streamFault(`OFFICE_AI_${field}_SNAPSHOT_INVALID`)
}

/** 默认是标准 OpenAI 增量参数，任何重叠、重复字符都具有语义。 */
export function mergeOfficeToolDelta(existing = '', fragment = '', { mode = 'delta' } = {}) {
  const previous = String(existing || '')
  const next = String(fragment || '')
  if (mode === 'delta') return previous + next
  if (mode === 'cumulative') return mergeCumulativeValue(previous, next, 'ARGUMENT')
  throw streamFault('OFFICE_AI_ARGUMENT_MODE_INVALID')
}

// 名称与 JSON 参数独立声明模式，不再复用参数的内容猜测逻辑。
export function mergeToolName(existing = '', fragment = '', { mode = 'delta' } = {}) {
  const previous = String(existing || '')
  const next = String(fragment || '')
  if (mode === 'delta') return previous + next
  if (mode === 'cumulative') return mergeCumulativeValue(previous, next, 'NAME')
  throw streamFault('OFFICE_AI_NAME_MODE_INVALID')
}

/**
 * Convert pending streamed calls to renderer AgentToolCall values.
 * The final call is marked truncated when the provider stopped at max_tokens;
 * AgentLoop can then ask the model to split the operation instead of treating
 * a cut-off JSON document as a quoting mistake.
 */
export function finalizeOfficeToolCalls(pendingCalls, stopReason) {
  const entries = [...pendingCalls.entries()].sort(([a], [b]) => a - b)
  const lastIndex = entries.at(-1)?.[0]
  return entries.map(([index, call]) => {
    let input = {}
    let inputError
    try {
      input = call.args ? JSON.parse(call.args) : {}
    } catch (error) {
      inputError = `invalid tool input JSON: ${error.message}`
    }
    return {
      id: call.id || `call_${call.name || 'tool'}_${index}`,
      name: call.name,
      input,
      ...(inputError ? { inputError } : {}),
      ...(stopReason === 'max_tokens' && index === lastIndex ? { truncated: true } : {}),
    }
  })
}
