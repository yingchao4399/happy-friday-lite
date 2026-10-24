import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getDataDir } from '../config.js'
import {
  getNote, getMessages, getDrawingCanvas, getScheduleEvent, getFileStatus,
} from '../db.js'
import * as db from '../db.js'
import { createHash } from 'node:crypto'
import { mediaFormats } from '../rag/mediaTranscription.js'

function parseResourceUri(uri) {
  if (typeof uri !== 'string' || uri.length > 4096) throw new Error('资源地址无效')
  const url = new URL(uri)
  if (url.protocol === 'friday:') {
    const id = decodeURIComponent(url.pathname.slice(1))
    if (!id || id.includes('/')) throw new Error('资源 ID 无效')
    return { type: url.hostname, id, messageId: url.searchParams.get('message') }
  }
  if (url.protocol === 'file:') return { type: 'file', filePath: fileURLToPath(url) }
  throw new Error('不支持的资源地址')
}

function ensureKnowledgePath(filePath) {
  const knowledgeRoot = path.join(getDataDir(), 'knowledge')
  if (!fs.existsSync(knowledgeRoot)) throw new Error('知识库目录不存在')
  const relative = path.relative(knowledgeRoot, filePath)
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error('文件不在 Friday 知识库内')
  const root = fs.realpathSync(knowledgeRoot)
  const realPath = fs.realpathSync(filePath)
  if (!realPath.toLowerCase().startsWith((root + path.sep).toLowerCase())) throw new Error('文件不在 Friday 知识库内')
  return realPath
}

const TEXT_EXTENSIONS = new Set(['txt', 'text', 'log', 'md', 'markdown', 'mdx', 'csv', 'xml', 'html', 'htm', 'json'])
const DOCUMENT_EXTENSIONS = new Set(['pdf', 'epub', 'docx', 'xls', 'xlsx', 'pptx', 'note', 'png', 'jpg', 'jpeg', 'bmp', 'tif', 'tiff'])

export async function readResource(uri, maxChars = 20000) {
  const resource = getResource(uri)
  if (resource.type !== 'knowledge_file') return resource
  const ext = path.extname(resource.path).toLowerCase().slice(1)
  if (!TEXT_EXTENSIONS.has(ext) && !DOCUMENT_EXTENSIONS.has(ext) && !mediaFormats.includes(ext)) {
    return { ...resource, parseStatus: 'unsupported', spans: [], reason: `当前没有 .${ext || '(无扩展名)'} 解析器` }
  }
  try {
    const { loadDocument } = await import('../rag/loaders.js')
    const docs = await loadDocument(resource.path, db)
    let remaining = Math.min(Math.max(Number(maxChars) || 20000, 1000), 50000)
    const spans = []
    for (let index = 0; index < docs.length && remaining > 0; index++) {
      const doc = docs[index]
      const content = String(doc.pageContent || '')
      if (!content.trim()) continue
      const text = content.slice(0, remaining)
      spans.push({ index, text, page: doc.metadata?.loc?.pageNumber || doc.metadata?.pageNumber || null, sheet: doc.metadata?.sheetName || null, truncated: text.length < content.length })
      remaining -= text.length
    }
    return { ...resource, parseStatus: spans.length ? 'readable' : 'empty', spans, truncated: remaining <= 0 }
  } catch (error) {
    return { ...resource, parseStatus: 'failed', spans: [], reason: error.message }
  }
}

export function getResource(uri) {
  const resource = resolveResource(uri)
  const snapshot = resource.type === 'knowledge_file' ? { path: resource.path, size: resource.size, updatedAt: resource.updatedAt } : resource
  return { ...resource, contentVersion: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') }
}

function resolveResource(uri) {
  const ref = parseResourceUri(uri)
  if (ref.type === 'notes') {
    const note = getNote(ref.id)
    if (!note || note.isDeleted) throw new Error('笔记不存在')
    return { uri, type: 'note', id: note.id, title: note.title, content: note.contentText || '', updatedAt: note.updatedAt }
  }
  if (ref.type === 'sessions') {
    const messages = getMessages(ref.id)
    if (ref.messageId) {
      const message = messages.find(item => String(item.id) === ref.messageId)
      if (!message) throw new Error('消息不存在')
      return { uri, type: message.role === 'assistant' ? 'ai_message' : 'chat_message', id: String(message.id), sessionId: ref.id, content: message.content, metadata: message.metadata, updatedAt: message.createdAt }
    }
    return { uri, type: 'session', id: ref.id, messages }
  }
  if (ref.type === 'canvases') {
    const canvas = getDrawingCanvas(ref.id)
    if (!canvas) throw new Error('画布不存在')
    return { uri, type: 'canvas', id: canvas.id, title: canvas.title, content: canvas.graphJSON, updatedAt: canvas.updatedAt }
  }
  if (ref.type === 'schedule') {
    const event = getScheduleEvent(ref.id)
    if (!event) throw new Error('日程不存在')
    return { uri, type: 'schedule_event', id: event.id, title: event.title, content: event.description, updatedAt: event.updatedAt, start: event.start, end: event.end }
  }
  if (ref.type === 'file') {
    const realPath = ensureKnowledgePath(ref.filePath)
    const stat = fs.statSync(realPath)
    if (!stat.isFile()) throw new Error('资源不是文件')
    const relative = path.relative(path.join(getDataDir(), 'knowledge'), realPath)
    const kbType = relative.split(path.sep)[0]
    const indexed = ['personal', 'local'].includes(kbType) ? getFileStatus(kbType, realPath) : null
    return { uri, type: 'knowledge_file', title: path.basename(realPath), path: realPath, size: stat.size, updatedAt: stat.mtime.toISOString(), parseStatus: indexed?.index_status || 'unparsed', chunkCount: indexed?.chunk_count || 0 }
  }
  throw new Error('未知 Friday 资源类型')
}

export function searchKnowledgeFiles(query, limit = 20) {
  const root = path.join(getDataDir(), 'knowledge')
  if (!fs.existsSync(root)) return []
  const terms = String(query || '').toLowerCase().split(/[\s,，、]+/).filter(Boolean)
  if (!terms.length) return []
  const results = []
  const stack = [root]
  while (stack.length && results.length < limit) {
    const dir = stack.pop()
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) stack.push(file)
      else if (entry.isFile() && terms.some(term => entry.name.toLowerCase().includes(term))) {
        let stat
        try { stat = fs.statSync(file) } catch { continue }
        const relative = path.relative(root, file)
        const kbType = relative.split(path.sep)[0]
        const indexed = ['personal', 'local'].includes(kbType) ? getFileStatus(kbType, file) : null
        results.push({ id: file, type: 'knowledge_file', title: entry.name, content: '', updatedAt: stat.mtime.toISOString(), uri: pathToFileURL(file).href, parseStatus: indexed?.index_status || 'unparsed' })
        if (results.length >= limit) break
      }
    }
  }
  return results
}

export function resourceNavigation(uri, selection = '') {
  const ref = parseResourceUri(uri)
  // 先读取并验证资源，避免把不存在的 URI 当作成功导航。
  const resource = getResource(uri)
  return { uri, type: resource.type, id: resource.id || null, path: resource.path || null, selection: String(selection || '').slice(0, 500) }
}
