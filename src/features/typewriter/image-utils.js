export function normalizeImageSource(raw) {
  const value = String(raw || '').trim()
  const source = value.startsWith('<') && value.endsWith('>') ? value.slice(1, -1) : value
  if (/^(data:image\/|https?:\/\/|file:\/\/|blob:|friday-asset:\/\/)/i.test(source)) return source
  if (/^[A-Za-z]:[\\/]/.test(source)) {
    const normalized = source.replaceAll('\\', '/')
    const encoded = normalized.split('/').map((part, index) =>
      index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)
    ).join('/')
    return 'file:///' + encoded
  }
  return ''
}

export function extractTypewriterImages(text) {
  const found = []
  const add = (alt, raw) => {
    const src = normalizeImageSource(raw)
    if (!src || found.some(item => item.src === src)) return
    found.push({ key: String(found.length) + ':' + src.slice(0, 48), alt: String(alt || ''), src, failed: false })
  }
  const markdown = /!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\)/g
  for (const match of String(text || '').matchAll(markdown)) add(match[1], match[2] || match[3])
  const html = /<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi
  for (const match of String(text || '').matchAll(html)) add('', match[2])
  return found
}

export function markdownImage(alt, src) {
  const safeAlt = String(alt || '').replaceAll('\\', '\\\\').replaceAll(']', '\\]')
  const value = String(src || '')
  const target = /[\s()<>]/.test(value) ? '<' + value + '>' : value
  return '\n![' + safeAlt + '](' + target + ')\n'
}
