import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { getDataDir } from './config.js'

const MAX_NOTE_ASSET_BYTES = 512 * 1024 * 1024
export const NOTE_ASSET_SCHEME = 'friday-asset'

const mimeFor = (filePath) => {
  const ext = path.extname(filePath).toLowerCase()
  const map = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
    '.flac': 'audio/flac', '.aac': 'audio/aac',
  }
  return map[ext] || 'application/octet-stream'
}

const safeName = (filePath) => {
  const name = path.basename(filePath).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim()
  return name || 'attachment'
}

const dataUrlFor = (filePath, mime, size) => {
  if (!mime.startsWith('image/') || size > 16 * 1024 * 1024) return null
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`
}

const encodeAssetSegment = value => encodeURIComponent(String(value))

/**
 * Stable renderer URL for a managed note asset. The path deliberately keeps
 * the note id and file name as separate URL segments so the protocol handler
 * can enforce the note-assets/<noteId> boundary before opening a file.
 */
export function noteAssetUrl(noteId, filePath) {
  return `${NOTE_ASSET_SCHEME}://note-assets/${encodeAssetSegment(noteId)}/${encodeAssetSegment(path.basename(filePath))}`
}

function decodeSegment(value) {
  try {
    const decoded = decodeURIComponent(value)
    if (!decoded || decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')) return null
    return decoded
  } catch {
    return null
  }
}

/**
 * Resolve a friday-asset URL without ever allowing traversal outside the
 * managed note-assets/<noteId> directory. Returns null for malformed,
 * unknown, missing, non-regular, or symlinked-outside resources.
 */
export function resolveNoteAssetPath(requestUrl) {
  let parsed
  try { parsed = new URL(String(requestUrl)) } catch { return null }
  if (parsed.protocol !== `${NOTE_ASSET_SCHEME}:` || parsed.hostname !== 'note-assets' || parsed.search || parsed.hash) return null
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length !== 2) return null
  const noteId = decodeSegment(segments[0])
  const fileName = decodeSegment(segments[1])
  if (!noteId || !fileName || !/^[A-Za-z0-9_-]+$/.test(noteId)) return null
  const dataDir = getDataDir()
  if (!dataDir) return null
  const noteRoot = path.resolve(dataDir, 'note-assets', noteId)
  const candidate = path.resolve(noteRoot, fileName)
  const relative = path.relative(noteRoot, candidate)
  if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null
  try {
    const rootReal = fs.realpathSync(noteRoot)
    const real = fs.realpathSync(candidate)
    const relativeReal = path.relative(rootReal, real)
    if (!relativeReal || relativeReal.startsWith('..' + path.sep) || path.isAbsolute(relativeReal)) return null
    if (!fs.statSync(real).isFile()) return null
    return real
  } catch {
    return null
  }
}

export function importNoteResource({ noteId, filePath }) {
  if (!noteId || typeof noteId !== 'string') throw new Error('NOTE_ID_REQUIRED')
  if (!/^[A-Za-z0-9_-]+$/.test(noteId)) throw new Error('NOTE_ID_INVALID')
  if (!filePath || typeof filePath !== 'string') throw new Error('NOTE_RESOURCE_PATH_REQUIRED')
  const source = path.resolve(filePath)
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error('NOTE_RESOURCE_NOT_FOUND')
  const stat = fs.statSync(source)
  if (stat.size > MAX_NOTE_ASSET_BYTES) throw new Error('NOTE_RESOURCE_TOO_LARGE')

  const digest = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex')
  const destinationDir = path.join(getDataDir(), 'note-assets', noteId)
  fs.mkdirSync(destinationDir, { recursive: true })
  const destination = path.join(destinationDir, `${digest.slice(0, 24)}-${safeName(source)}`)
  if (!fs.existsSync(destination)) fs.copyFileSync(source, destination)

  const mime = mimeFor(destination)
  return {
    ok: true,
    assetId: digest,
    name: safeName(source),
    mime,
    size: stat.size,
    path: destination,
    url: noteAssetUrl(noteId, destination),
    dataUrl: dataUrlFor(destination, mime, stat.size),
  }
}
