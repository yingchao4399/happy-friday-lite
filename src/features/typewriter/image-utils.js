export function normalizeImageSource(raw) {
  const value = String(raw || '').trim()
  const source = value.startsWith('<') && value.endsWith('>') ? value.slice(1, -1) : value
  if (/^(data:image\/|blob:|friday-asset:\/\/)/i.test(source)) return source
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
  const markdown = /!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["']([^"']*)["'])?\)/g
  for (const match of String(text || '').matchAll(markdown)) add(match[1], match[2] || match[3], match[4])
  const html = /<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi
  for (const match of String(text || '').matchAll(html)) add('', match[2])
  return found
}

/** 图片正文节点元数据。title 仍是标准 Markdown，不会破坏旧笔记。 */
export function parseTypewriterImageNodes(text) {
  const source = String(text || '')
  const nodes = []
  const markdown = /!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["']([^"']*)["'])?\)/g
  for (const match of source.matchAll(markdown)) {
    const src = normalizeImageSource(match[2] || match[3])
    if (!src) continue
    const title = String(match[4] || '')
    const metadata = Object.fromEntries(title.split(';').map(part => part.split('=').map(value => value.trim())).filter(([key, value]) => key && value))
    const tokenEnd = (match.index || 0) + match[0].length
    const flowRows = Math.max(0, Math.min(240, Number(metadata.flowRows) || 0))
    const legacyGap = source.slice(tokenEnd).match(/^\n{1,240}/)?.[0] || ''
    const consumedRows = Math.min(flowRows, legacyGap.length)
    nodes.push({
      id: `image_${nodes.length}_${match.index || 0}`,
      assetId: src.startsWith('friday-asset://') ? src.slice('friday-asset://'.length) : src,
      src,
      alt: String(match[1] || ''),
      anchor: { offset: Number(match.index || 0) },
      range: { from: Number(match.index || 0), to: tokenEnd + consumedRows },
      width: Math.max(96, Math.min(960, Number(metadata.width) || 160)),
      height: Number(metadata.height) > 0 ? Number(metadata.height) : null,
      flowRows: consumedRows,
      align: ['left', 'center', 'right', 'inline'].includes(metadata.align) ? metadata.align : 'center',
      fit: metadata.fit === 'cover' ? 'cover' : 'contain',
      light: {
        intensity: Math.max(0, Math.min(1, Number(metadata.intensity) || 0.18)),
        temperature: Math.max(-1, Math.min(1, Number(metadata.temperature) || 0)),
        shadow: Math.max(0, Math.min(1, Number(metadata.shadow) || 0.2)),
        blend: metadata.blend === 'photo' ? 'photo' : 'paper'
      }
    })
  }
  return nodes
}

/** Update persisted Markdown image attributes without rewriting adjacent text. */
export function updateTypewriterImageMetadata(source, offset, updates = {}) {
  const value = String(source || '')
  const image = parseTypewriterImageNodes(value).find(item => item.anchor.offset === Number(offset))
  if (!image) return value
  const tail = value.slice(image.anchor.offset)
  const match = tail.match(/^!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["']([^"']*)["'])?\)/)
  if (!match) return value
  const metadata = Object.fromEntries(String(match[4] || '').split(';').map(part => {
    const index = part.indexOf('=')
    return index < 0 ? [part.trim(), ''] : [part.slice(0, index).trim(), part.slice(index + 1).trim()]
  }).filter(([key, entry]) => key && entry !== ''))
  delete metadata.flowRows
  for (const key of ['width', 'height', 'align', 'fit', 'intensity', 'temperature', 'shadow', 'blend']) {
    if (updates[key] === undefined) continue
    metadata[key] = String(updates[key])
  }
  const attributes = Object.entries(metadata).map(([key, entry]) => `${key}=${entry}`).join(';')
  const token = `![${match[1]}](${match[2] ? `<${match[2]}>` : match[3]}${attributes ? ` "${attributes}"` : ''})`
  const from = image.anchor.offset
  const to = from + match[0].length
  const replaceTo = image.range.to
  const legacySpacer = image.flowRows ? '\n' : ''
  return value.slice(0, from) + token + legacySpacer + value.slice(replaceTo)
}

export function markdownImage(alt, src, options = {}) {
  const safeAlt = String(alt || '').replaceAll('\\', '\\\\').replaceAll(']', '\\]')
  const value = String(src || '')
  const target = /[\s()<>]/.test(value) ? '<' + value + '>' : value
  const width = Math.max(96, Math.min(960, Number(options.width) || 160))
  const height = Math.max(48, Number(options.height) || width)
  const metadata = [
    ['width', width], ['height', height], ['align', options.align || 'center'],
    ['fit', options.fit || 'contain'], ['intensity', options.intensity ?? 0.18], ['temperature', options.temperature ?? 0],
    ['shadow', options.shadow ?? 0.2], ['blend', options.blend || 'paper']
  ].filter(([, item]) => item !== '').map(([key, item]) => `${key}=${String(item)}`).join(';')
  return '\n![' + safeAlt + '](' + target + ' "' + metadata + '")\n'
}
