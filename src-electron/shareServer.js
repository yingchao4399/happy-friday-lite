import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import * as db from './db.js'
import crypto from 'crypto'
import { clipboardAssetMime } from './clipboard-content.js'
import { shareNetworkAddresses } from './share-network.js'
import { prepareClipboardShareFiles, removeClipboardShareDirectory } from './clipboard-share-files.js'

// 内网分享服务：在主进程启动一个 HTTP 服务，局域网内可通过浏览器访问
// 复用前端构建产物（dist/），直接加载已有的对话界面（隐藏输入框）。
// 仅暴露 GET /api/share/:sessionId 数据接口 + 静态文件服务，无任何写操作

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// dist 目录位于项目根目录（src-electron 的上一级）
const DIST_DIR = path.join(__dirname, '..', 'dist')

let server = null
let serverPort = null
let clipboardCleanupTimer = null
const clipboardShares = new Map()
const CLIPBOARD_SHARE_TTL = 10 * 60 * 1000
const PREFERRED_PORT = 17918

// 获取本机内网 IPv4 地址（非回环）
function getLocalIp() {
  return shareNetworkAddresses()[0].address
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8'
}

function getMime(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

function escapeShareHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

export async function createClipboardShare(payload = {}, options = {}) {
  if (!serverPort) return null
  const currentServer = server
  const prepared = await prepareClipboardShareFiles(Array.isArray(payload.filePaths) ? payload.filePaths : [], options)
  try {
  if (!serverPort || server !== currentServer) throw new Error('CLIPBOARD_SHARE_UNAVAILABLE')
  const now = Date.now()
  for (const [token, share] of clipboardShares) if (share.expiresAt <= now) revokeClipboardShare(token)
  if (clipboardShares.size >= 128) revokeClipboardShare(clipboardShares.keys().next().value)
  const token = crypto.randomBytes(24).toString('base64url')
  const isFile = file => { try { return typeof file === 'string' && fs.statSync(file).isFile() } catch { return false } }
  const filePaths = prepared.files
  const images = [...new Set([...(Array.isArray(payload.imagePaths) ? payload.imagePaths : []), payload.imagePath].filter(Boolean))]
  if (images.length > 200) throw new Error('CLIPBOARD_SHARE_TOO_MANY_FILES')
  if (!images.every(isFile)) throw new Error('CLIPBOARD_SHARE_FILE_MISSING')
  const imagePaths = images
  const expiresAt = now + CLIPBOARD_SHARE_TTL
  clipboardShares.set(token, { text: String(payload.text || ''), html: String(payload.html || ''), imagePaths, filePaths, expiresAt, directory: prepared.directory, resourceId: payload.resourceId, streams: new Set() })
  const urls = shareNetworkAddresses().map(iface => ({ label: iface.label, url: 'http://' + iface.address + ':' + serverPort + '/clipboard-share/' + token }))
  return { token, url: urls[0].url, urls, localOnly: urls.every(entry => new URL(entry.url).hostname === '127.0.0.1'), folderCount: prepared.folderCount, expiresAt: new Date(expiresAt).toISOString(), omittedFiles: 0 }
  } catch (error) { await removeClipboardShareDirectory(prepared.directory); throw error }
}

export function revokeClipboardShare(token) {
  const share = clipboardShares.get(token)
  if (!share) return false
  clipboardShares.delete(token)
  for (const stream of share.streams || []) stream.destroy()
  removeClipboardShareDirectory(share.directory)
  return true
}

export function revokeClipboardResourceShares(id) {
  for (const [token, share] of clipboardShares) if (share.resourceId === id) revokeClipboardShare(token)
}

function getClipboardShare(token) {
  const share = clipboardShares.get(token)
  if (!share || share.expiresAt <= Date.now()) { revokeClipboardShare(token); return null }
  return share
}

function streamClipboardFile(req, res, file, download = false, share) {
  let stat
  try { stat = fs.statSync(file) } catch { res.writeHead(404); res.end(); return }
  if (!stat.isFile()) { res.writeHead(404); res.end(); return }
  const mime = clipboardAssetMime(file) || getMime(file)
  let start = 0, end = stat.size - 1, status = 200
  if (req.headers.range) {
    const match = req.headers.range.match(/^bytes=(\d*)-(\d*)$/)
    if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size }); res.end(); return }
    start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]))
    end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size }); res.end(); return }
    status = 206; res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + stat.size)
  }
  if (download) res.setHeader('Content-Disposition', "attachment; filename=download; filename*=UTF-8''" + encodeURIComponent(path.basename(file)))
  res.writeHead(status, { 'Content-Type': mime, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', 'Content-Length': Math.max(0, end - start + 1), 'X-Content-Type-Options': 'nosniff' })
  if (req.method === 'HEAD' || !stat.size) { res.end(); return }
  const stream = fs.createReadStream(file, { start, end })
  share?.streams?.add(stream)
  stream.on('close', () => { share?.streams?.delete(stream); if (!res.writableEnded) res.destroy() })
  stream.on('error', () => res.destroy())
  res.on('close', () => stream.destroy())
  stream.pipe(res)
}

function serveClipboardShare(req, res, token, resource = '', download = false) {
  const share = getClipboardShare(token)
  if (!share) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Share expired'); return }
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  if (resource) {
    const [kind, number] = resource.split('/'), index = Number(number)
    const file = Number.isInteger(index) ? (kind === 'image' ? share.imagePaths : share.filePaths)[index] : null
    if (!file) { res.writeHead(404); res.end(); return }
    streamClipboardFile(req, res, file, kind === 'file' && (download || !clipboardAssetMime(file)), share)
    return
  }
  const base = '/clipboard-share/' + encodeURIComponent(token)
  const image = share.imagePaths.map((_, index) => '<img src="' + base + '/image/' + index + '" alt="Clipboard image">').join('')
  const files = share.filePaths.map((file, index) => {
    const url = base + '/file/' + index, mime = clipboardAssetMime(file)
    const media = mime.startsWith('image/') ? '<img loading="lazy" src="' + url + '" alt="' + escapeShareHtml(path.basename(file)) + '">' : mime.startsWith('video/') ? '<video controls preload="metadata" src="' + url + '"></video>' : mime.startsWith('audio/') ? '<audio controls preload="metadata" src="' + url + '"></audio>' : ''
    return '<li>' + media + '<a href="' + url + '?download=1">下载 / Download ' + escapeShareHtml(path.basename(file)) + '</a></li>'
  }).join('')
  const text = escapeShareHtml(share.text || share.html.replace(/<[^>]*>/g, ' '))
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" })
  res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Friday Clipboard</title><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:0 auto;padding:24px;line-height:1.6;color:#222}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f5f5;padding:16px;border-radius:8px}img,video,audio{max-width:100%;height:auto;display:block;margin:10px 0}a{color:#2563eb}</style></head><body><h1>Friday Clipboard</h1>' + (text ? '<pre>' + text + '</pre>' : '') + image + '<ul>' + files + '</ul></body></html>')
}

// 提供前端构建产物的静态文件服务（SPA：未命中的路径回退到 index.html）
function serveStatic(res, urlPath) {
  if (!fs.existsSync(DIST_DIR)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Share service unavailable: app not built yet.')
    return
  }

  // 规范化并防止路径穿越
  const resolved = path.normalize(path.join(DIST_DIR, urlPath))
  if (resolved !== DIST_DIR && !resolved.startsWith(DIST_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Forbidden')
    return
  }

  let filePath = resolved
  try {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      // SPA 回退：未命中的路径交给前端路由处理
      filePath = path.join(DIST_DIR, 'index.html')
    }
    const data = fs.readFileSync(filePath)
    res.writeHead(200, { 'Content-Type': getMime(filePath) })
    res.end(data)
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not Found')
  }
}

// 分享数据接口：返回会话信息和消息列表
function serveShareApi(res, sessionId) {
  try {
    const session = db.getSession(sessionId)
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ success: false, error: 'Session not found' }))
      return
    }
    const messages = db.getMessages(sessionId)
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ success: true, session, messages }))
  } catch (e) {
    // 数据库未就绪或查询异常时返回 404，避免暴露内部错误
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ success: false, error: 'Session not found' }))
  }
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function getSharedMessageContent(message) {
  if (typeof message?.content === 'string' && message.content.trim()) return message.content
  const segments = message?.metadata?.segments
  if (!Array.isArray(segments)) return ''
  return segments
    .filter(segment => segment?.type === 'text' && segment.content)
    .map(segment => segment.content)
    .join('\n\n')
}

// A framework-free page keeps LAN conversation links readable in browsers that
// cannot load Vite's module-based application bundle.
function serveSharedConversationPage(res, sessionId) {
  try {
    const session = db.getSession(sessionId)
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><title>Not Found</title><p>Conversation not found.</p>')
      return
    }

    const title = session.title || 'Friday Conversation'
    const messages = db.getMessages(sessionId)
    const content = messages
      .map((message) => {
        const text = getSharedMessageContent(message)
        if (!text) return ''
        const role = message.role === 'user' ? 'You' : 'Friday'
        const roleClass = message.role === 'user' ? 'user' : 'assistant'
        return `<div class="message ${roleClass}"><div class="role">${role}</div><div class="content">${escapeHtml(text)}</div></div>`
      })
      .filter(Boolean)
      .join('') || '<p class="empty">This conversation has no messages.</p>'

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f5f5f5; color: #1c1917; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; }
    .page { max-width: 860px; margin: 0 auto; padding: 32px 20px 48px; }
    .header { margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #e7e5e4; }
    h1 { margin: 0; font-size: 22px; line-height: 1.35; font-weight: 600; word-break: break-word; }
    .message { margin: 0 0 16px; padding: 16px; border: 1px solid #e7e5e4; border-radius: 8px; background: #fff; }
    .message.user { border-left: 3px solid #2563eb; }
    .role { margin-bottom: 8px; color: #78716c; font-size: 13px; font-weight: 600; }
    .content { white-space: pre-wrap; overflow-wrap: break-word; word-wrap: break-word; line-height: 1.65; font-size: 15px; }
    .empty { color: #78716c; text-align: center; }
    @media (max-width: 480px) { .page { padding: 20px 12px 32px; } .message { padding: 14px; } h1 { font-size: 20px; } }
  </style>
</head>
<body><div class="page"><div class="header"><h1>${escapeHtml(title)}</h1></div>${content}</div></body>
</html>`

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><title>Not Found</title><p>Conversation not found.</p>')
  }
}

// 笔记分享数据接口：返回笔记内容（只读查看）
function serveNoteShareApi(res, noteId) {
  try {
    const note = db.getNote(noteId)
    if (!note) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ success: false, error: 'Note not found' }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ success: true, note }))
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ success: false, error: 'Note not found' }))
  }
}

// 画布分享数据接口：返回画布内容（只读查看）
function serveDrawingShareApi(res, canvasId) {
  try {
    const canvas = db.getDrawingCanvas(canvasId)
    if (!canvas) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ success: false, error: 'Canvas not found' }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ success: true, canvas }))
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ success: false, error: 'Canvas not found' }))
  }
}

function handleRequest(req, res) {
  try {
    // 仅允许 GET 请求
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Method Not Allowed')
      return
    }

    const url = new URL(req.url, `http://${req.headers.host}`)

    // 健康检查
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
    const clipboardMatch = url.pathname.match(/^\/clipboard-share\/([^/]+)(?:\/(image\/\d+|file\/\d+))?$/)
    if (clipboardMatch) {
      serveClipboardShare(req, res, decodeURIComponent(clipboardMatch[1]), clipboardMatch[2] || '', url.searchParams.get('download') === '1')
      return
    }

    // 笔记分享数据接口 /api/share/note/:noteId（需在会话接口之前匹配）
    const noteApiMatch = url.pathname.match(/^\/api\/share\/note\/(.+)$/)
    if (noteApiMatch) {
      serveNoteShareApi(res, decodeURIComponent(noteApiMatch[1]))
      return
    }

    // 画布分享数据接口 /api/share/drawing/:canvasId（需在会话接口之前匹配）
    const drawingApiMatch = url.pathname.match(/^\/api\/share\/drawing\/(.+)$/)
    if (drawingApiMatch) {
      serveDrawingShareApi(res, decodeURIComponent(drawingApiMatch[1]))
      return
    }

    // 分享数据接口 /api/share/:sessionId
    const apiMatch = url.pathname.match(/^\/api\/share\/(.+)$/)
    if (apiMatch) {
      serveShareApi(res, decodeURIComponent(apiMatch[1]))
      return
    }

    // Serve shared conversations directly instead of relying on an ES module SPA.
    const sharePageMatch = url.pathname.match(/^\/share\/([^/]+)$/)
    if (sharePageMatch) {
      serveSharedConversationPage(res, decodeURIComponent(sharePageMatch[1]))
      return
    }

    // 其余请求交给静态文件服务（含 SPA 回退）
    serveStatic(res, url.pathname)
  } catch (e) {
    console.error('[ShareServer] request error:', e)
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Internal Server Error')
    }
  }
}

// 启动分享服务：优先使用固定端口，被占用时回退到随机端口
export async function startShareServer() {
  if (server) return serverPort

  return new Promise((resolve) => {
    const tryListen = (port) => {
      const s = http.createServer(handleRequest)
      s.on('error', () => {
        if (port !== 0) {
          tryListen(0)
        } else {
          console.error('[ShareServer] Failed to start share server')
          resolve(null)
        }
      })
      s.listen(port, '0.0.0.0', () => {
        server = s
        serverPort = s.address().port
        clipboardCleanupTimer = setInterval(() => {
          for (const [token, share] of clipboardShares) if (share.expiresAt <= Date.now()) revokeClipboardShare(token)
        }, 15000)
        clipboardCleanupTimer.unref?.()
        console.log(`[ShareServer] ✅ Share server running on http://0.0.0.0:${serverPort}`)
        resolve(serverPort)
      })
    }
    tryListen(PREFERRED_PORT)
  })
}

export function stopShareServer() {
  clearInterval(clipboardCleanupTimer); clipboardCleanupTimer = null
  for (const token of clipboardShares.keys()) revokeClipboardShare(token)
  if (server) {
    try { server.close() } catch (_e) {}
    server = null
    serverPort = null
  }
}

// Generate a framework-free page so recipients can use older browsers too.
export function getShareUrl(sessionId) {
  if (!serverPort) return null
  const ip = getLocalIp()
  return `http://${ip}:${serverPort}/share/${encodeURIComponent(sessionId)}`
}

// 生成笔记分享链接
export function getNoteShareUrl(noteId) {
  if (!serverPort) return null
  const ip = getLocalIp()
  return `http://${ip}:${serverPort}/#/share/note/${encodeURIComponent(noteId)}`
}

// 生成画布分享链接（只读查看）
export function getDrawingShareUrl(canvasId) {
  if (!serverPort) return null
  const ip = getLocalIp()
  return `http://${ip}:${serverPort}/#/share/drawing/${encodeURIComponent(canvasId)}`
}
