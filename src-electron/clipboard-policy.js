export const SENSITIVE_TTL_MS = 15 * 60 * 1000

export function classifyClipboard(text, html = '') {
  const value = `${text || ''} ${html || ''}`
  const secret = /(?:password|passwd|pwd|token|api[_ -]?key|authorization)\s*[:=]|(?:密码|口令|验证码|账号|用户名)\s*[:：]?\s*\S+|\bBearer\s+\S+|\bsk-[a-zA-Z0-9_-]{12,}|\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+|^\s*\d{4,8}\s*$/i.test(value.trim())
  if (secret) return 'secret'
  if (/^https?:\/\//i.test(String(text || '').trim())) return 'link'
  return html ? 'html' : 'text'
}

export function protectedText(value, safeStorage) {
  if (!safeStorage.isEncryptionAvailable()) {
    const error = new Error('系统加密不可用，敏感剪贴板内容未保存；请恢复 Windows 凭据服务后重试')
    error.code = 'CLIPBOARD_ENCRYPTION_UNAVAILABLE'
    throw error
  }
  return `enc:${safeStorage.encryptString(value).toString('base64')}`
}

export function clipboardMatches(item, query) {
  const needle = String(query || '').trim().toLowerCase()
  if (!needle) return true
  const source = [item.sourceApp, item.sourceName].filter(Boolean).join(' ')
  if (item.sensitivity === 'secret') return source.toLowerCase().includes(needle)
  const date = new Date(item.capturedAt)
  const localDate = Number.isNaN(date.getTime()) ? '' : [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
  return [item.plainText, item.html?.replace(/<[^>]*>/g, ' '), item.maskedPreview, item.note, source, item.category, localDate, item.capturedAt, ...(item.tags || []), ...(item.filePaths || []), ...(item.parts || []).flatMap(part => [part.text, part.html?.replace(/<[^>]*>/g, ' '), part.sourceApp, part.sourceName, ...(part.filePaths || [])])].filter(Boolean).join(' ').toLowerCase().includes(needle)
}

export function clipboardInDateRange(item, from = '', to = '') {
  const date = new Date(item.capturedAt)
  if (!from && !to) return true
  if (Number.isNaN(date.getTime())) return false
  const localDate = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
  return (!from || localDate >= from) && (!to || localDate <= to)
}

export function isSensitiveClipboardExpired(item, now = Date.now()) {
  return item?.sensitivity === 'secret' && Boolean(item.expiresAt) && Date.parse(item.expiresAt) <= now
}
