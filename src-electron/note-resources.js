import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { getDataDir } from './config.js'

const MAX_NOTE_ASSET_BYTES = 512 * 1024 * 1024

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

export function importNoteResource({ noteId, filePath }) {
  if (!noteId || typeof noteId !== 'string') throw new Error('NOTE_ID_REQUIRED')
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
    url: pathToFileURL(destination).href,
    dataUrl: dataUrlFor(destination, mime, stat.size),
  }
}
