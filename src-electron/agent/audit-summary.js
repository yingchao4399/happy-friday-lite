// 审计只保留有界摘要。先限制遍历，再序列化，避免图片/base64/正文的整份复制。
export const AUDIT_TEXT_LIMIT = 8192

export function auditText(value, { metadataOnly = false } = {}) {
  let nodes = 0
  const seen = new WeakSet()
  const secretKey = /password|passwd|secret|token|api.?key|authorization|cookie|credential/i
  const contentKey = /^(content|text|html|body|image|imageData|base64|dataUrl|audio|buffer|data)$/i
  function describe(item) {
    if (item == null) return { type: String(item) }
    if (typeof item === 'string') return { type: 'string', length: item.length }
    if (ArrayBuffer.isView(item)) return { type: 'binary', bytes: item.byteLength }
    if (item instanceof ArrayBuffer) return { type: 'binary', bytes: item.byteLength }
    if (Array.isArray(item)) return { type: 'array', length: item.length }
    return { type: typeof item }
  }
  function visit(item, depth = 0) {
    if (++nodes > 96 || depth > 4) return '[truncated]'
    if (typeof item === 'string') {
      if (item.length > 256 || /^(?:data:|Bearer\s|sk-)/i.test(item)) return describe(item)
      return item
    }
    if (item == null || typeof item === 'boolean') return item
    if (typeof item === 'number') return Number.isFinite(item) ? item : String(item)
    if (typeof item !== 'object') return `[${typeof item}]`
    if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer) return describe(item)
    if (seen.has(item)) return '[circular]'
    seen.add(item)
    if (Array.isArray(item)) {
      const result = []
      for (let index = 0; index < Math.min(item.length, 8); index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index))
        result.push(descriptor && 'value' in descriptor ? visit(descriptor.value, depth + 1) : '[accessor]')
      }
      if (item.length > 8) result.push(`[${item.length - 8} more]`)
      return result
    }
    const result = Object.create(null)
    let count = 0
    for (const key in item) {
      if (!Object.hasOwn(item, key)) continue
      if (++count > 12 || nodes >= 96) { result._truncated = true; break }
      // 不读取 getter、不调用 toJSON，也不扫描长字符串中的敏感正文。
      const descriptor = Object.getOwnPropertyDescriptor(item, key)
      const safeKey = key.length > 64 ? `${key.slice(0, 64)}…` : key
      result[safeKey] = secretKey.test(key) ? '[hidden]'
        : !descriptor || !('value' in descriptor) ? '[accessor]'
          : contentKey.test(key) ? describe(descriptor.value) : visit(descriptor.value, depth + 1)
    }
    return result
  }
  try {
    const summary = metadataOnly ? describe(value) : visit(value)
    const text = typeof summary === 'string' ? summary : JSON.stringify(summary)
    return text.length <= AUDIT_TEXT_LIMIT ? text : JSON.stringify({ type: 'summary', truncated: true })
  } catch { return '[unavailable]' }
}
