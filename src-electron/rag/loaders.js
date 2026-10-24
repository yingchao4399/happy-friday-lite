import fs from 'fs'
import path from 'path'
import { Document } from '@langchain/core/documents'
import { parseObsidianMarkdown } from '../obsidian/parser.js'
import { mediaFormats, readMediaTranscript } from './mediaTranscription.js'
import AdmZip from 'adm-zip'

/**
 * 文档加载器：将不同格式的文件加载为统一的 Document 对象数组
 * 支持: TXT, MD, PDF, HTML, JSON, EPUB, DOCX, XLSX, PPTX, .note(笔记引用)
 * 暂不支持 OCR PDF（复杂扫描版 PDF）
 */

// 根据文件扩展名获取文件类型
export function getFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase().slice(1)
  return ext
}

// 加载纯文本文件 (txt, md, markdown, log, text, csv, xml)
async function loadTextFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8')
  const stat = fs.statSync(filePath)
  const ext = path.extname(filePath).slice(1)
  if (['md', 'markdown', 'mdx'].includes(ext.toLowerCase())) {
    const parsed = parseObsidianMarkdown(content, { filePath })
    const metadataLines = []
    if (parsed.frontmatter.title) metadataLines.push(`Title: ${parsed.frontmatter.title}`)
    if (parsed.aliases.length) metadataLines.push(`Aliases: ${parsed.aliases.join(', ')}`)
    if (parsed.tags.length) metadataLines.push(`Tags: ${parsed.tags.join(', ')}`)
    if (parsed.wikilinks.length) metadataLines.push(`Links: ${parsed.wikilinks.map(link => link.alias || link.target).join(', ')}`)
    return [new Document({
      pageContent: [...metadataLines, parsed.body].filter(Boolean).join('\n\n'),
      metadata: {
        source: filePath,
        fileType: ext,
        fileSize: stat.size,
        fileCreatedAt: stat.birthtime.toISOString(),
        fileModifiedAt: stat.mtime.toISOString(),
        title: parsed.frontmatter.title || path.basename(filePath, path.extname(filePath)),
        obsidian: {
          frontmatter: parsed.frontmatter,
          tags: parsed.tags,
          aliases: parsed.aliases,
          wikilinks: parsed.wikilinks,
          embeds: parsed.embeds
        }
      }
    })]
  }
  return [new Document({
    pageContent: content,
    metadata: {
      source: filePath,
      fileType: ext,
      fileSize: stat.size,
      fileCreatedAt: stat.birthtime.toISOString(),
      fileModifiedAt: stat.mtime.toISOString()
    }
  })]
}

// 加载 PDF 文件
// 依赖 pdf-parse（@langchain/community 的可选 peer 依赖）。
// 同 EPUB：pdf-parse 必须显式声明在 dependencies 中，否则打包时被裁剪，
// 运行时 import("pdf-parse") 抛错，PDF 索引构建失败。
async function loadPdfFile(filePath) {
  try {
    const { PDFLoader } = await import('@langchain/community/document_loaders/fs/pdf')
    const loader = new PDFLoader(filePath)
    const docs = await loader.load()
    const stat = fs.statSync(filePath)
    // 补充元数据
    return docs.map(doc => ({
      ...doc,
      metadata: {
        ...doc.metadata,
        source: filePath,
        fileType: 'pdf',
        fileSize: stat.size,
        fileCreatedAt: stat.birthtime.toISOString(),
        fileModifiedAt: stat.mtime.toISOString()
      }
    }))
  } catch (e) {
    if (/pdf-parse/i.test(e.message)) {
      throw new Error(`PDF 解析依赖 pdf-parse 缺失（打包未包含）：${e.message}。请确认 pdf-parse 已在 dependencies 中声明并重新构建。`)
    }
    throw e
  }
}

// 加载 HTML 文件（本地文件直接用 cheerio 解析，不使用 CheerioWebBaseLoader）
async function loadHtmlFile(filePath) {
  const cheerio = await import('cheerio')
  const content = fs.readFileSync(filePath, 'utf-8')
  const $ = cheerio.load(content)
  // 移除 script 和 style 标签
  $('script, style').remove()
  const text = $('body').text().replace(/\s+/g, ' ').trim()
  const stat = fs.statSync(filePath)
  return [new Document({
    pageContent: text,
    metadata: {
      source: filePath,
      fileType: 'html',
      fileSize: stat.size,
      fileCreatedAt: stat.birthtime.toISOString(),
      fileModifiedAt: stat.mtime.toISOString()
    }
  })]
}

// 加载 JSON 文件（直接作为文本读取，@langchain/community 未导出 JSONLoader）
async function loadJsonFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8')
  const stat = fs.statSync(filePath)
  return [new Document({
    pageContent: content,
    metadata: {
      source: filePath,
      fileType: 'json',
      fileSize: stat.size,
      fileCreatedAt: stat.birthtime.toISOString(),
      fileModifiedAt: stat.mtime.toISOString()
    }
  })]
}

// 加载 EPUB 文件
// 依赖 epub2（@langchain/community 的可选 peer 依赖）。
// 注意：epub2 必须在 package.json 的 dependencies 中显式声明，否则
// electron-builder 打包时会将其作为 peer 依赖裁剪掉，导致打包后运行时
// import("epub2") 抛出 "Failed to load epub2"，EPUB 索引构建失败。
async function loadEpubFile(filePath) {
  try {
    const { EPubLoader } = await import('@langchain/community/document_loaders/fs/epub')
    const loader = new EPubLoader(filePath)
    let docs = await loader.load()
    // epub2 兼容性较弱（部分合法 EPUB 的默认命名空间会得到空 spine）。
    // 用 ZIP/XML fallback 保证章节正文仍可读取，并保留章节顺序。
    if (!docs.length) docs = await loadEpubZipFallback(filePath)
    const stat = fs.statSync(filePath)
    return docs.map(doc => ({
      ...doc,
      metadata: {
        ...doc.metadata,
        source: filePath,
        fileType: 'epub',
        fileSize: stat.size,
        fileCreatedAt: stat.birthtime.toISOString(),
        fileModifiedAt: stat.mtime.toISOString()
      }
    }))
  } catch (e) {
    if (/epub2/i.test(e.message)) {
      throw new Error(`EPUB 解析依赖 epub2 缺失（打包未包含）：${e.message}。请确认 epub2 已在 dependencies 中声明并重新构建。`)
    }
    throw e
  }
}

async function loadEpubZipFallback(filePath) {
  const zip = new AdmZip(filePath)
  const text = name => {
    const entry = zip.getEntry(name)
    return entry ? entry.getData().toString('utf8') : ''
  }
  const container = text('META-INF/container.xml')
  const rootMatch = container.match(/rootfile[^>]+full-path=["']([^"']+)["']/i)
  if (!rootMatch) return []
  const opfPath = rootMatch[1].replace(/^\//, '')
  const opf = text(opfPath)
  if (!opf) return []
  const base = path.posix.dirname(opfPath)
  const manifest = new Map()
  for (const match of opf.matchAll(/<item\b([^>]+)>/gi)) {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w:-]+)=["']([^"']*)["']/g)].map(item => [item[1].toLowerCase(), item[2]]))
    if (attrs.id && attrs.href) manifest.set(attrs.id, { href: path.posix.normalize(path.posix.join(base, decodeURIComponent(attrs.href))), type: attrs['media-type'] || '' })
  }
  const docs = []
  for (const match of opf.matchAll(/<itemref\b([^>]+)>/gi)) {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w:-]+)=["']([^"']*)["']/g)].map(item => [item[1].toLowerCase(), item[2]]))
    const item = manifest.get(attrs.idref)
    if (!item || !/xhtml|html|xml/i.test(item.type)) continue
    const html = text(item.href)
    if (!html) continue
    const cheerio = await import('cheerio')
    const $ = cheerio.load(html)
    $('script, style').remove()
    docs.push(new Document({ pageContent: $('body').text().replace(/\s+/g, ' ').trim(), metadata: { chapter: attrs.idref } }))
  }
  return docs
}

// 加载 DOCX 文件（使用 mammoth 提取纯文本）
async function loadDocxFile(filePath) {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ path: filePath })
  const stat = fs.statSync(filePath)
  return [new Document({
    pageContent: result.value,
    metadata: {
      source: filePath,
      fileType: 'docx',
      fileSize: stat.size,
      fileCreatedAt: stat.birthtime.toISOString(),
      fileModifiedAt: stat.mtime.toISOString()
    }
  })]
}

// 加载 XLS/XLSX 文件（使用 xlsx 库提取文本）
async function loadExcelFile(filePath) {
  const module = await import('xlsx')
  const XLSX = module.default || module
  const workbook = XLSX.readFile(filePath)
  const stat = fs.statSync(filePath)
  const docs = []
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const csv = XLSX.utils.sheet_to_csv(sheet)
    if (csv.trim()) {
      docs.push(new Document({
        pageContent: csv,
        metadata: {
          source: filePath,
          fileType: path.extname(filePath).slice(1),
          fileSize: stat.size,
          fileCreatedAt: stat.birthtime.toISOString(),
          fileModifiedAt: stat.mtime.toISOString(),
          sheetName
        }
      }))
    }
  }
  return docs
}

// 加载 PPTX 文件（使用 officeparser 提取文本）
async function loadPptxFile(filePath) {
  const officeparser = await import('officeparser')
  const ast = await officeparser.parseOffice(filePath)
  const stat = fs.statSync(filePath)
  const slides = ast.content.filter(node => node.type === 'slide')
  const toText = node => [node.text || '', ...(node.children || node.content || []).map(toText)].filter(Boolean).join('\n')
  const parts = slides.length ? slides.map((slide, index) => ({ text: toText(slide), page: slide.metadata?.slideNumber || index + 1 })) : [{ text: ast.toText(), page: 1 }]
  return parts.map(part => new Document({
    pageContent: part.text,
    metadata: {
      source: filePath,
      fileType: path.extname(filePath).slice(1),
      pageNumber: part.page,
      fileSize: stat.size,
      fileCreatedAt: stat.birthtime.toISOString(),
      fileModifiedAt: stat.mtime.toISOString()
    }
  }))
}

// 加载 .note 笔记引用文件
// .note 文件是 JSON 元数据，包含 noteId，需要从数据库获取笔记内容
async function loadNoteFile(filePath, db) {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const meta = JSON.parse(raw)
  const stat = fs.statSync(filePath)

  if (!meta.noteId) {
    throw new Error(`Invalid .note file: missing noteId in ${filePath}`)
  }

  // 从数据库获取笔记内容
  const note = db.getNote(meta.noteId)
  if (!note) {
    throw new Error(`Note not found in DB: ${meta.noteId}`)
  }

  // 笔记内容是 HTML 格式，需要转为纯文本/markdown
  // contentText 字段已经是纯文本
  const content = note.contentText || note.content || ''
  const title = note.title || meta.title || '未命名笔记'

  return [new Document({
    pageContent: `# ${title}\n\n${content}`,
    metadata: {
      source: filePath,
      fileType: 'note',
      fileSize: stat.size,
      fileCreatedAt: note.createdAt || stat.birthtime.toISOString(),
      fileModifiedAt: note.updatedAt || stat.mtime.toISOString(),
      noteId: meta.noteId,
      title: title
    }
  })]
}

// 主加载入口：根据文件类型选择加载器
export async function loadDocument(filePath, db = null) {
  const ext = path.extname(filePath).toLowerCase().slice(1)

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }
  if (mediaFormats.includes(ext)) {
    const record = readMediaTranscript(filePath)
    return [new Document({ pageContent: record.text, metadata: { source: filePath, fileType: ext, extraction: record.extraction, transcribedAt: record.transcribedAt } })]
  }

  switch (ext) {
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'bmp':
    case 'tif':
    case 'tiff': {
      const { recognizeImage } = await import('./imageOcr.js')
      const result = await recognizeImage(filePath)
      return [new Document({ pageContent: result.text, metadata: { source: filePath, fileType: ext, extraction: 'ocr', language: result.language } })]
    }
    case 'txt':
    case 'text':
    case 'log':
    case 'md':
    case 'markdown':
    case 'mdx':
    case 'csv':
    case 'xml':
      return loadTextFile(filePath)

    case 'pdf':
      return loadPdfFile(filePath)

    case 'html':
    case 'htm':
      return loadHtmlFile(filePath)

    case 'json':
      return loadJsonFile(filePath)

    case 'epub':
      return loadEpubFile(filePath)

    case 'docx':
      return loadDocxFile(filePath)

    case 'xls':
    case 'xlsx':
      return loadExcelFile(filePath)

    case 'pptx':
      return loadPptxFile(filePath)

    case 'note':
      if (!db) {
        throw new Error('Loading .note files requires db module')
      }
      return loadNoteFile(filePath, db)

    default:
      throw new Error(`未支持的文件格式 .${ext || '(无扩展名)'}，请转换为受支持的文档格式`)
  }
}
