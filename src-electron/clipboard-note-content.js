import crypto from 'node:crypto'
import path from 'node:path'
import { loadHtml as load } from './html-parser.js'
import { clipboardItemHtml, clipboardHtmlImages } from './clipboard-html-images.js'
import { clipboardFileType } from './clipboard-content.js'
import { readMediaTranscript, transcribeMedia } from './rag/mediaTranscription.js'
import { classifyClipboard } from './clipboard-policy.js'

const escape = value => String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const fail = code => Object.assign(new Error(code), { code })
const safeLink = value => /^(?:https?:\/\/|mailto:)/i.test(String(value || '').trim())
const safeImage = value => /^data:image\/png;base64,[a-z0-9+/\r\n]*={0,2}$/i.test(String(value || ''))
const tags = new Set('p div span h1 h2 h3 h4 h5 h6 strong b em i u s strike sub sup code pre br hr blockquote ul ol li table thead tbody tfoot tr th td img a'.split(' '))
const MAX_FILE_AI_CHARS = 24_000

const fileAiError = code => Object.assign(new Error(code), { code })

export function clipboardNoteRevision(item) {
  return crypto.createHash('sha256').update(JSON.stringify([item.kind, item.plainText, item.html, item.parts, item.imagePath, item.imagePaths, item.filePaths, item.sensitivity, item.expiresAt])).digest('hex')
}

// 载入了原来未下载的图片后，允许保存包含图片的新快照；旧笔记仍保持原样。
export function clipboardNoteSnapshotKey(item) {
  const cache = Object.entries(item.htmlImageCache || {}).map(([key, value]) => [key, path.basename(value)]).sort(([a], [b]) => a.localeCompare(b))
  return cache.length ? crypto.createHash('sha256').update(JSON.stringify([item.hash || item.id, cache])).digest('hex') : item.hash || item.id
}

export function clipboardSavedNoteMatches(item) {
  if (!item.savedNoteId) return false
  if (item.savedNoteSnapshotKey) return item.savedNoteSnapshotKey === clipboardNoteSnapshotKey(item)
  return !Object.keys(item.htmlImageCache || {}).length && (!item.savedNoteHash || item.savedNoteHash === item.hash)
}

// 只保留笔记编辑器支持的正文结构；不把网页脚本、事件、远程图片或任意 CSS 带入笔记。
export function sanitizeClipboardNoteHtml(html) {
  const $ = load(String(html || ''), null, false)
  $('script,style,iframe,object,embed,svg,math,template,noscript,link,meta,base').remove()
  $('*').toArray().reverse().forEach(node => {
    const element = $(node), name = node.name
    if (!tags.has(name)) { element.replaceWith(element.contents()); return }
    const original = { ...node.attribs }
    for (const key of Object.keys(node.attribs)) element.removeAttr(key)
    if (name === 'a' && safeLink(original.href)) element.attr('href', original.href.trim()).attr('rel', 'noopener noreferrer').attr('target', '_blank')
    if (name === 'img') {
      if (!safeImage(original.src)) { element.remove(); return }
      element.attr('src', original.src).attr('alt', String(original.alt || '').slice(0, 500))
    }
    if (name === 'td' || name === 'th') {
      for (const key of ['rowspan', 'colspan']) if (/^[1-9]\d?$/.test(original[key] || '')) element.attr(key, original[key])
      if (/^\d{1,4}(?:,\d{1,4}){0,30}$/.test(original['data-colwidth'] || '')) element.attr('data-colwidth', original['data-colwidth'])
    }
    if (name === 'ol' && /^\d{1,6}$/.test(original.start || '')) element.attr('start', original.start)
    if (name === 'code' && /^language-[\w+-]{1,40}$/.test(original.class || '')) element.attr('class', original.class)
    const style = String(original.style || '').split(';').flatMap(rule => {
      const [key, value] = rule.split(':').map(part => part.trim())
      if (key === 'text-align' && /^(left|right|center|justify)$/.test(value)) return [key + ':' + value]
      if (['color', 'background-color'].includes(key) && /^(#[0-9a-f]{3,8}|[a-z]{1,20}|rgba?\([\d.,%\s]+\))$/i.test(value)) return [key + ':' + value]
      return []
    }).join(';')
    if (style) element.attr('style', style)
  })
  return $.html()
}

function htmlText(html) {
  const $ = load(html, null, false)
  $('br').replaceWith('\n')
  $('p,div,h1,h2,h3,h4,h5,h6,pre,li,tr,blockquote').append('\n')
  $('td,th').append('\t')
  return $.root().text().replace(/\n{3,}/g, '\n\n').trim()
}

// 外部图片未获点击载入时只保存明确的来源占位，不触发后台下载；已载入缓存和内嵌图片转为独立 PNG。
export async function prepareClipboardNoteContent(item, { getImage, language = 'zh-CN' }) {
  if (!item || item.deletedAt || item.sensitivity === 'secret' || classifyClipboard(item.plainText, clipboardItemHtml(item)) === 'secret') throw fail('CLIPBOARD_AI_SENSITIVE')
  if (item.expiresAt && Date.parse(item.expiresAt) <= Date.now()) throw fail('CLIPBOARD_AI_UNAVAILABLE')
  const english = language === 'en-US', images = [], warnings = []
  let imageBytes = 0
  const addImage = image => {
    if (!safeImage(image?.dataUrl)) throw fail('CLIPBOARD_IMAGE_INVALID')
    imageBytes += image.dataUrl.length
    if (imageBytes > 12_000_000 || images.length >= 32) throw fail('CLIPBOARD_IMAGE_TOO_LARGE')
    images.push(image); return image.dataUrl
  }
  const raw = clipboardItemHtml(item), $ = load(raw, null, false), inline = $('img').toArray()
  if (inline.length > 32) throw fail('CLIPBOARD_IMAGE_TOO_LARGE')
  for (let index = 0; index < inline.length; index++) {
    try { $(inline[index]).attr('src', addImage(await getImage({ id: item.id, htmlIndex: index, thumbnail: false, loadExternal: false }))) }
    catch (error) {
      if (error.code !== 'CLIPBOARD_IMAGE_EXTERNAL_REQUIRED') throw error
      warnings.push('CLIPBOARD_NOTE_IMAGE_NOT_LOADED')
      const source = clipboardHtmlImages(raw)[index]
      const label = english ? 'Image not loaded; reopen the clipboard entry to load it. Source: ' : '图片尚未载入；可回到剪贴板条目载入后另存。来源：'
      $(inline[index]).replaceWith('<p>' + label + (safeLink(source) ? '<a href="' + escape(source) + '">' + escape(source) + '</a>' : escape(source)) + '</p>')
    }
  }
  let html = raw ? sanitizeClipboardNoteHtml($.html()) : ''
  const standalone = item.imagePaths?.length ? item.imagePaths : item.imagePath ? [item.imagePath] : []
  for (let index = 0; index < standalone.length; index++) html += '<p><img src="' + addImage(await getImage({ id: item.id, index, thumbnail: false })) + '"></p>'
  for (let fileIndex = 0; fileIndex < (item.filePaths?.length || 0); fileIndex++) {
    const file = item.filePaths[fileIndex]
    if (clipboardFileType(file).kind === 'image' && !standalone.includes(file)) html += '<p><img src="' + addImage(await getImage({ id: item.id, fileIndex, thumbnail: false })) + '"></p>'
  }
  const text = raw ? htmlText(sanitizeClipboardNoteHtml($.html())) : String(item.plainText || '')
  if (!raw && text) html = (item.kind === 'code' ? '<pre><code>' + escape(text) + '</code></pre>' : '<p>' + escape(text).replaceAll('\n', '<br>') + '</p>') + html
  if (item.filePaths?.length) html += '<h3>' + (english ? 'Source files (original paths)' : '来源文件（原始路径）') + '</h3><ul>' + item.filePaths.map(file => '<li>' + escape(file) + '</li>').join('') + '</ul>'
  return { html, text: [text, ...(item.filePaths || [])].filter(Boolean).join('\n'), images, warnings: [...new Set(warnings)] }
}

// 文件条目先走 Friday 现有文档加载器，再交给统一的 AI 分类流程。图片仍由本机 OCR 处理；
// 音视频先复用版本匹配的转写，否则调用用户选定引擎；默认在本机识别，不把二进制伪装成文本。
export async function prepareClipboardAiContent(item, { getImage, language = 'zh-CN', loadDocument, transcriptionModelId = 'windows-local', signal, onProgress = () => {}, readTranscript = readMediaTranscript, transcribe = transcribeMedia, assertCurrent = () => {} } = {}) {
  const base = await prepareClipboardNoteContent(item, { getImage, language })
  const english = language === 'en-US'
  const files = (item?.filePaths || []).filter(file => typeof file === 'string' && file.trim())
  if (!files.length) return base
  const loader = loadDocument || (await import('./rag/loaders.js')).loadDocument
  const blocks = []
  const htmlBlocks = []
  let remaining = MAX_FILE_AI_CHARS
  for (const file of files) {
    signal?.throwIfAborted()
    assertCurrent()
    const type = clipboardFileType(file)
    if (type.kind === 'image') continue
    let docs
    try {
      if (type.kind === 'audio' || type.kind === 'video') {
        let transcript
        try { transcript = readTranscript(file) }
        catch {
          signal?.throwIfAborted()
          assertCurrent()
          onProgress('transcribing')
          // 未知内容只在内存中识别；敏感转写不写普通缓存或发送到分类模型。
          transcript = await transcribe(file, transcriptionModelId || 'windows-local', signal, { persist: false })
          onProgress('recognizing')
        }
        docs = [{ pageContent: transcript.text, metadata: { extraction: transcript.extraction, transcribedAt: transcript.transcribedAt } }]
      } else {
        docs = await loader(file)
      }
    } catch (error) {
      if (signal?.aborted || error.name === 'AbortError') throw error
      if (error.code?.startsWith('CLIPBOARD_')) throw error
      if (error.code === 'ENOENT' || /not found|不存在|missing/i.test(String(error.message || ''))) throw fileAiError('CLIPBOARD_AI_FILE_MISSING')
      if (type.kind === 'audio' || type.kind === 'video') {
        const codes = { MEDIA_TRANSCRIPTION_CHAT_ONLY: 'CLIPBOARD_AI_TRANSCRIPTION_MODEL_REQUIRED', MEDIA_TRANSCRIPTION_ENGINE_UNAVAILABLE: 'CLIPBOARD_AI_TRANSCRIPTION_ENGINE_UNAVAILABLE', MEDIA_TRANSCRIPTION_TIMEOUT: 'CLIPBOARD_AI_TRANSCRIPTION_TIMEOUT', MEDIA_TRANSCRIPTION_INVALID_AUDIO: 'CLIPBOARD_AI_TRANSCRIPTION_INVALID_AUDIO', MEDIA_TRANSCRIPTION_SERVICE_FAILED: 'CLIPBOARD_AI_TRANSCRIPTION_SERVICE_FAILED', MEDIA_TRANSCRIPTION_RESULT_INVALID: 'CLIPBOARD_AI_TRANSCRIPTION_INVALID_RESULT' }
        const fallback = /25 MB/.test(error.message) ? 'CLIPBOARD_AI_MEDIA_TOO_LARGE'
          : /请选择已配置|仅支持 Windows/.test(error.message) ? 'CLIPBOARD_AI_TRANSCRIPTION_MODEL_REQUIRED'
            : /文件已变化/.test(error.message) ? 'CLIPBOARD_AI_CONTENT_CHANGED'
              : error.name === 'TimeoutError' || /超时|timed out/i.test(error.message) ? 'CLIPBOARD_AI_TRANSCRIPTION_TIMEOUT' : 'CLIPBOARD_AI_TRANSCRIPTION_FAILED'
        throw fileAiError(codes[error.code] || fallback)
      }
      throw fileAiError('CLIPBOARD_AI_FILE_UNSUPPORTED')
    }
    signal?.throwIfAborted()
    assertCurrent()
    const content = docs.map(doc => String(doc?.pageContent || '').trim()).filter(Boolean).join('\n\n')
    if (classifyClipboard(content) === 'secret') throw fileAiError('CLIPBOARD_AI_SENSITIVE')
    if (!content) continue
    if (remaining <= 0) break
    const clipped = content.slice(0, remaining)
    remaining -= clipped.length
    const label = path.basename(file)
    const heading = ['audio', 'video'].includes(type.kind) ? (english ? 'Audio/video transcript: ' : '音视频转写：') : (english ? 'File: ' : '文件：')
    blocks.push('[' + heading + label + ']\n' + clipped)
    htmlBlocks.push('<h3>' + heading + escape(label) + '</h3><pre>' + escape(clipped) + '</pre>')
    if (clipped.length < content.length) break
  }
  if (!blocks.length) return base
  const truncated = english ? 'File content truncated at the AI analysis limit.' : '文件内容已截断，超过 AI 单次分析上限。'
  const suffix = remaining === 0 ? '\n\n[' + truncated + ']' : ''
  return {
    ...base,
    text: [base.text, ...blocks].filter(Boolean).join('\n\n') + suffix,
    html: base.html + htmlBlocks.join('') + (remaining === 0 ? '<p>' + truncated + '</p>' : '')
  }
}
