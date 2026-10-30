// 外壳只读取这些通用能力，笔记和终端之间不共享输入、Shell 或存储代码。
let active = null
export function activateContent(plugin) {
  active = plugin
  return () => { if (active === plugin) active = null }
}
export function contentText(kind) { return active?.text(kind) || '' }
export function scrollContent(to) { active?.scroll(to) }
export function focusContent() { active?.focus() }
export function blurContent() { active?.blur?.() }
export function insertContent(text) { active?.insert?.(String(text || '')) }
export function flushContent() { return active?.flush?.() ?? Promise.resolve() }
