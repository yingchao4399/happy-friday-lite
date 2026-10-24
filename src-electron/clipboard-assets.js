import http from 'node:http'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { clipboardFileType, clipboardAssetMime } from './clipboard-content.js'

// 只为已入库的条目签发本机播放地址；每次读取重新检查删除和过期状态。
export function createClipboardAssetServer(getItem) {
  let server, starting
  const grants = new Map()
  const valid = item => item && !item.deletedAt && item.sensitivity !== 'secret' && (!item.expiresAt || Date.parse(item.expiresAt) > Date.now())
  async function start() {
    if (server?.listening) return
    if (!starting) starting = new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        const grant = grants.get(req.url?.slice(1))
        const item = grant && getItem(grant.id)
        if (!['GET', 'HEAD'].includes(req.method) || !grant || grant.until <= Date.now() || !valid(item) || item.filePaths?.[grant.index] !== grant.path) { res.writeHead(404); res.end(); return }
        let stat
        try { stat = fs.statSync(grant.path) } catch { res.writeHead(404); res.end(); return }
        if (!stat.isFile()) { res.writeHead(404); res.end(); return }
        let start = 0, end = stat.size - 1, status = 200
        if (req.headers.range) {
          const match = req.headers.range.match(/^bytes=(\d*)-(\d*)$/)
          if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size }); res.end(); return }
          start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]))
          end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size }); res.end(); return }
          status = 206; res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + stat.size)
        }
        res.writeHead(status, { 'Content-Type': clipboardAssetMime(grant.path), 'Accept-Ranges': 'bytes', 'Content-Length': Math.max(0, end - start + 1) })
        if (req.method === 'HEAD' || !stat.size) { res.end(); return }
        const stream = fs.createReadStream(grant.path, { start, end })
        stream.on('error', () => res.destroy())
        res.on('close', () => stream.destroy())
        stream.pipe(res)
      })
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    }).finally(() => { starting = null })
    await starting
  }
  return {
    async get(id, index = 0) {
      const item = getItem(id)
      if (!valid(item) || !Number.isInteger(index) || index < 0) throw new Error('CLIPBOARD_ASSET_UNAVAILABLE')
      const file = item.filePaths?.[index], type = clipboardFileType(file)
      if (!file || !['audio', 'video', 'code'].includes(type.kind)) throw new Error('CLIPBOARD_ASSET_UNAVAILABLE')
      let stat
      try { stat = await fs.promises.stat(file) } catch { throw new Error('CLIPBOARD_ASSET_MISSING') }
      if (!stat.isFile()) throw new Error('CLIPBOARD_ASSET_UNAVAILABLE')
      if (type.kind === 'code') {
        if (stat.size > 2 * 1024 * 1024) throw new Error('CLIPBOARD_CODE_TOO_LARGE')
        const text = await fs.promises.readFile(file, 'utf8')
        if (!valid(getItem(id))) throw new Error('CLIPBOARD_ASSET_UNAVAILABLE')
        return { ...type, text }
      }
      await start()
      for (const [key, value] of grants) if (value.until <= Date.now()) grants.delete(key)
      if (grants.size >= 1024) grants.delete(grants.keys().next().value)
      const token = crypto.randomBytes(24).toString('base64url')
      grants.set(token, { id, index, path: file, until: Date.now() + 4 * 60 * 60 * 1000 })
      return { ...type, url: 'http://127.0.0.1:' + server.address().port + '/' + token }
    },
    close() { grants.clear(); server?.close(); server?.closeAllConnections(); server = null }
  }
}
