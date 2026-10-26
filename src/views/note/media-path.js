// 渲染进程可用的路径转换，不依赖 Node，也不把 #、?、% 当作 URL 控制字符。
export function fileUrlForNote(filePath) {
  const input = String(filePath || '')
  if (!input || /^(?:file|https?|data|blob):/i.test(input)) return input
  const normalized = input.replaceAll('\\', '/')
  const encoded = normalized.split('/').map((part, index) => index === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part)).join('/')
  return normalized.startsWith('//') ? `file:${encoded}` : `file://${encoded.startsWith('/') ? '' : '/'}${encoded}`
}
export function notePathFromUrl(source) {
  const input = String(source || '')
  if (!/^file:/i.test(input)) return input
  try {
    const url = new URL(input), pathname = decodeURIComponent(url.pathname)
    if (url.hostname) return `\\\\${url.hostname}${pathname.replaceAll('/', '\\')}`
    if (/^\/[a-z]:/i.test(pathname)) return pathname.slice(1).replaceAll('/', '\\')
    return pathname
  } catch { return input }
}
