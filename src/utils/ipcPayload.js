import { toRaw } from 'vue'

// Vue 的嵌套 Proxy 不能经过 Electron 的结构化克隆。
// 在服务边界统一去除响应式包装，保留二进制、日期、集合及循环引用的语义。
export function toIpcPayload(value, seen = new WeakMap()) {
  if (typeof value !== 'object' || value === null) return value
  const raw = toRaw(value)
  if (seen.has(raw)) return seen.get(raw)
  if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw) || raw instanceof Date || raw instanceof RegExp) return raw
  if (raw instanceof Map) {
    const result = new Map(); seen.set(raw, result)
    for (const [key, item] of raw) result.set(toIpcPayload(key, seen), toIpcPayload(item, seen))
    return result
  }
  if (raw instanceof Set) {
    const result = new Set(); seen.set(raw, result)
    for (const item of raw) result.add(toIpcPayload(item, seen))
    return result
  }
  if (Array.isArray(raw)) {
    const result = []; seen.set(raw, result)
    for (const item of raw) result.push(toIpcPayload(item, seen))
    return result
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(raw))) return raw
  const result = Object.create(Object.getPrototypeOf(raw)); seen.set(raw, result)
  for (const key of Object.keys(raw)) Object.defineProperty(result, key, { value: toIpcPayload(raw[key], seen), enumerable: true, configurable: true, writable: true })
  return result
}
