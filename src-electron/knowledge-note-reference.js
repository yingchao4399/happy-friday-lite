import fs from 'node:fs'
import path from 'node:path'
import { getNote, queryAllRaw } from './db.js'

function referenceError(code, message) {
  return Object.assign(new Error(message), { code })
}

export function saveKnowledgeNoteReference({ noteId, destDir, dataDir }) {
  const note = typeof noteId === 'string' && getNote(noteId)
  if (!note) throw referenceError('KB_NOTE_MISSING', '笔记不存在或已删除')
  if (typeof destDir !== 'string' || !destDir || typeof dataDir !== 'string' || !dataDir) {
    throw referenceError('KB_DEST_INVALID', '请选择知识库目录')
  }

  const root = path.join(dataDir, 'knowledge')
  if (!fs.existsSync(root) || !fs.existsSync(destDir) || !fs.statSync(destDir).isDirectory()) {
    throw referenceError('KB_DEST_MISSING', '知识库目录不存在')
  }
  const realRoot = fs.realpathSync(root)
  const realDest = fs.realpathSync(destDir)
  const relative = path.relative(realRoot, realDest)
  const segments = relative.split(path.sep).filter(Boolean)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) ||
      segments.length < 2 || !['personal', 'local', 'agent'].includes(segments[0])) {
    throw referenceError('KB_DEST_INVALID', '请选择 Friday 知识库内的目录')
  }

  const filePath = path.join(realDest, `${note.id}.note`)
  const resourceUri = `knowledge:${path.relative(realRoot, filePath).split(path.sep).join('/')}`
  let alreadyExists = false
  if (fs.existsSync(filePath)) {
    if (fs.lstatSync(filePath).isSymbolicLink()) throw referenceError('KB_NOTE_CONFLICT', '目标位置已有同名文件')
    let existing
    try { existing = JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch { /* report a conflict below */ }
    if (existing?.type !== 'note-ref' || existing.noteId !== note.id) {
      throw referenceError('KB_NOTE_CONFLICT', '目标位置已有同名文件')
    }
    alreadyExists = true
  }

  const metadata = {
    type: 'note-ref', noteId: note.id, title: note.title || '未命名笔记',
    exportedAt: new Date().toISOString()
  }
  if (!alreadyExists) fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2), { encoding: 'utf8', flag: 'wx' })
  try {
    queryAllRaw('INSERT OR IGNORE INTO note_resource_links VALUES (?, ?, ?, ?)', [
      note.id, resourceUri, JSON.stringify({ path: filePath, source: 'note' }), new Date().toISOString()
    ])
  } catch (error) {
    if (!alreadyExists) fs.rmSync(filePath, { force: true })
    throw error
  }
  return { success: true, path: filePath, fileName: path.basename(filePath), alreadyExists }
}
