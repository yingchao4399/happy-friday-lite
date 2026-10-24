import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { getDataDir } from '../config.js'
import { loadDocument } from '../rag/loaders.js'
import * as db from '../db.js'
import { mediaFormats } from '../rag/mediaTranscription.js'

export const documentFormats = ['txt', 'text', 'log', 'md', 'markdown', 'mdx', 'csv', 'xml', 'html', 'htm', 'json', 'pdf', 'epub', 'docx', 'xls', 'xlsx', 'pptx', 'note', 'png', 'jpg', 'jpeg', 'bmp', 'tif', 'tiff']
const supported = new Set([...documentFormats, ...mediaFormats])

function readIndex() {
  try { return JSON.parse(fs.readFileSync(path.join(getDataDir(), 'resource-file-index.json'), 'utf8')) } catch { return {} }
}

export function listKnowledgeResources() {
  const root = path.join(getDataDir(), 'knowledge')
  const files = []
  const cached = readIndex()
  const walk = dir => {
    if (!fs.existsSync(dir)) return
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.name.startsWith('.') || item.isSymbolicLink()) continue
      const file = path.join(dir, item.name)
      if (item.isDirectory()) walk(file)
      else if (item.isFile()) {
        const stat = fs.statSync(file)
        const ext = path.extname(file).slice(1).toLowerCase()
        let version = `${stat.size}:${stat.mtimeMs}`
        if (ext === 'note') {
          try {
            const note = db.getNote(JSON.parse(fs.readFileSync(file, 'utf8')).noteId)
            version += ':' + createHash('sha256').update(JSON.stringify(note || null)).digest('hex')
          } catch { /* 无效引用由解析器登记失败原因。 */ }
        }
        const uri = pathToFileURL(file).href
        const record = cached[uri]?.version === version ? cached[uri] : null
        files.push({ uri, path: file, type: 'knowledge_file', title: item.name, size: stat.size, updatedAt: stat.mtime.toISOString(), version,
          parseStatus: record?.parseStatus || (supported.has(ext) ? 'unparsed' : 'unsupported'), reason: record?.reason, contentVersion: record?.contentVersion })
      }
    }
  }
  walk(root)
  return files
}

// 以文件版本缓存解析正文，每次搜索比对版本并移除已删除资源；无需模型或向量服务。
let searchQueue = Promise.resolve()
export function searchKnowledgeContent(query, limit = 20) {
  const result = searchQueue.then(() => searchContent(query, limit))
  searchQueue = result.catch(() => {})
  return result
}

async function searchContent(query, limit) {
  const indexFile = path.join(getDataDir(), 'resource-file-index.json')
  const index = readIndex()
  const terms = String(query).toLowerCase().split(/[\s,，、]+/).filter(Boolean)
  const files = listKnowledgeResources()
  const live = new Set(files.map(file => file.uri))
  for (const uri of Object.keys(index)) if (!live.has(uri)) delete index[uri]
  const results = []
  for (const file of files) {
    let record = index[file.uri]
    if (!record || record.version !== file.version || record.parseStatus === 'failed') {
      record = { version: file.version, parseStatus: file.parseStatus, spans: [] }
      if (file.parseStatus !== 'unsupported') {
        if (file.size > 50 * 1024 * 1024) { record.parseStatus = 'too_large'; record.reason = '文件超过 50 MB，请使用专用查看器' }
        else try {
          const docs = await loadDocument(file.path, db)
          record.spans = docs.flatMap((doc, pageIndex) => {
            const content = String(doc.pageContent || '')
            const parts = []
            for (let offset = 0; offset < content.length; offset += 1800) {
              const text = content.slice(offset, offset + 2000)
              parts.push({ text, index: pageIndex, offset, page: doc.metadata?.loc?.pageNumber || doc.metadata?.pageNumber || null, sheet: doc.metadata?.sheetName || null })
            }
            return parts
          })
          record.parseStatus = record.spans.length ? 'readable' : 'empty'
          record.contentVersion = createHash('sha256').update(record.spans.map(span => span.text).join('\n')).digest('hex')
        } catch (error) { record.parseStatus = 'failed'; record.reason = error.message }
      }
      index[file.uri] = record
    }
    const matches = record.spans.filter(span => terms.some(term => span.text.toLowerCase().includes(term)))
    if (matches.length) {
      for (const span of matches.slice(0, 3)) results.push({ ...file, ...span, content: span.text, parseStatus: record.parseStatus, contentVersion: record.contentVersion, score: terms.reduce((n, term) => n + (span.text.toLowerCase().includes(term) ? 2 : 0), 0) })
    } else if (terms.some(term => file.title.toLowerCase().includes(term))) results.push({ ...file, parseStatus: record.parseStatus, reason: record.reason, content: '', score: 1 })
  }
  const tmp = `${indexFile}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(index), 'utf8')
  fs.renameSync(tmp, indexFile)
  return results.sort((a, b) => b.score - a.score).slice(0, limit)
}
