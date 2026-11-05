/**
 * Pure helpers for the Office OpenAI-compatible streaming bridge.
 *
 * Providers are supposed to send tool arguments as fragments, but several
 * OpenAI-compatible gateways resend the complete/growing name or argument
 * string on every delta. Treating those deltas as append-only corrupts an
 * otherwise valid JSON tool call and makes the renderer retry three times.
 */

export const OFFICE_DEFAULT_MAX_OUTPUT_TOKENS = 8192

export const normalizeOfficeStopReason = (reason) => {
  if (reason === 'length' || reason === 'max_tokens') return 'max_tokens'
  if (reason === 'tool_calls') return 'tool_calls'
  if (reason === 'stop') return 'stop'
  return reason || undefined
}

/** Merge a provider delta that may be a fragment or a growing full value. */
export function mergeOfficeToolDelta(existing = '', fragment = '') {
  const previous = String(existing || '')
  const next = String(fragment || '')
  if (!next) return previous
  if (!previous) return next
  // Some gateways resend the accumulated value rather than a fragment.
  if (next === previous || next.startsWith(previous)) return next
  // A duplicate/shorter resend must not be appended.
  if (previous.startsWith(next) || previous.endsWith(next)) return previous
  return previous + next
}

export function mergeToolName(existing = '', fragment = '') {
  return mergeOfficeToolDelta(existing, fragment)
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
