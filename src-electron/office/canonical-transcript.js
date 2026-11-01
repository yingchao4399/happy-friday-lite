import { serializeCanonicalMessages } from '../ai-core/canonical-message.js'

const safeJson = (value) => {
  try { return JSON.stringify(value ?? {}) } catch { return '{}' }
}

/** Vendor AgentMessage[] -> OpenAI compatible transcript. Kept Electron-free for contract tests. */
export function toOpenAiMessages(system, messages = [], { thinking = 'disabled' } = {}) {
  const out = []
  if (system) out.push({ role: 'system', content: String(system) })
  for (const m of messages) {
    if (m?.role === 'user') {
      if (Array.isArray(m.images) && m.images.length) {
        out.push({ role: 'user', content: [{ type: 'text', text: String(m.text || '') }, ...m.images.map(i => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.base64}` } }))] })
      } else out.push({ role: 'user', content: String(m.text || '') })
    } else if (m?.role === 'assistant') {
      const entry = { role: 'assistant', content: m.text || null }
      if (m.reasoning) entry.reasoning_content = String(m.reasoning)
      if (Array.isArray(m.toolCalls) && m.toolCalls.length) {
        entry.tool_calls = m.toolCalls.map((tc, i) => ({ id: String(tc.id || `call_${i}_${tc.name}`), type: 'function', function: { name: tc.name, arguments: safeJson(tc.input) } }))
      }
      out.push(entry)
    } else if (m?.role === 'tool' && Array.isArray(m.results)) {
      for (const r of m.results) out.push({ role: 'tool', tool_call_id: String(r.id || r.name || ''), content: String(r.output ?? '') })
    }
  }
  return serializeCanonicalMessages(out, { thinking: thinking === 'enabled' })
}
