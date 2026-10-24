import path from 'node:path'

const audio = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.opus', '.wma'])
const video = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.wmv'])
const images = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif', '.heic', '.heif'])
const languages = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', json: 'json', html: 'xml', htm: 'xml', xml: 'xml', vue: 'xml', css: 'css', scss: 'scss', sql: 'sql', sh: 'bash', bash: 'bash', ps1: 'powershell', java: 'java', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', go: 'go', rs: 'rust', rb: 'ruby', php: 'php', yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', md: 'markdown' }

export function clipboardFileType(file) {
  const extension = path.extname(String(file || '')).toLowerCase()
  if (images.has(extension)) return { kind: 'image' }
  if (audio.has(extension)) return { kind: 'audio' }
  if (video.has(extension)) return { kind: 'video' }
  const language = languages[extension.slice(1)]
  return language ? { kind: 'code', language } : { kind: 'file' }
}

export function clipboardCodeLanguage(text, html = '') {
  const value = String(text || '')
  if (/^\s*\x60{3}[\w+#-]*\s*\n[\s\S]*\n\x60{3}\s*$/.test(value) || /<(?:pre|code)\b/i.test(html)) return 'plaintext'
  if (/^\s*(?:import .+ from ['"]|export (?:default|const|function)|(?:const|let|var) \w+\s*=|(?:async )?function \w+\s*\()/m.test(value)) return 'javascript'
  if (/^\s*(?:def \w+\(|from \w+ import |if __name__\s*==)/m.test(value)) return 'python'
  if (/^\s*(?:SELECT .+ FROM |CREATE TABLE |INSERT INTO )/im.test(value)) return 'sql'
  if (/^\s*[\[{]/.test(value)) { try { JSON.parse(value); return 'json' } catch {} }
  return ''
}

export function clipboardAssetMime(file) {
  const image = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.avif': 'image/avif', '.heic': 'image/heic', '.heif': 'image/heif' }[path.extname(file).toLowerCase()]
  if (image) return image
  return ({ '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.opus': 'audio/ogg', '.wma': 'audio/x-ms-wma', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.m4v': 'video/mp4', '.wmv': 'video/x-ms-wmv' })[path.extname(file).toLowerCase()] || ''
}
