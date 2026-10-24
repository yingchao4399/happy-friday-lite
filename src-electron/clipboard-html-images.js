import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { load } from 'cheerio'
import { readClipboardImage, storeClipboardPng } from './clipboard-media.js'

const cache = new Map()
const MAX_BYTES = 64 * 1024 * 1024
const fail = code => Object.assign(new Error(code), { code })

export function clipboardItemHtml(item) {
  if (item.html) return item.html
  const escape = value => String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return item.parts?.map(part => part.html || '<p>' + escape(part.text || part.filePaths?.join('\n')).replaceAll('\n', '<br>') + '</p>').join('') || ''
}

export function replaceClipboardItemImage(item, index, src) {
  if (item.html) { item.html = replaceClipboardHtmlImage(item.html, index, src); return }
  if (!Number.isInteger(index) || index < 0) throw fail('CLIPBOARD_IMAGE_UNAVAILABLE')
  for (const part of item.parts || []) {
    const count = clipboardHtmlImages(part.html).length
    if (index < count) { part.html = replaceClipboardHtmlImage(part.html, index, src); return }
    index -= count
  }
  throw fail('CLIPBOARD_IMAGE_UNAVAILABLE')
}

export function clipboardHtmlImages(html = '') {
  const document = load(html, null, false)
  return document('img').toArray().map(node => String(document(node).attr('src') || ''))
}

export function replaceClipboardHtmlImage(html, index, src) {
  const document = load(html, null, false), images = document('img')
  if (!Number.isInteger(index) || index < 0 || index >= images.length) throw fail('CLIPBOARD_IMAGE_UNAVAILABLE')
  images.eq(index).attr('src', src).removeAttr('srcset').removeAttr('onerror').removeAttr('onload')
  return document.html()
}

export async function readClipboardHtmlImage(item, index, directory, { thumbnail = true, loadExternal = false } = {}) {
  if (!item || item.deletedAt || item.sensitivity === 'secret' || (item.expiresAt && Date.parse(item.expiresAt) <= Date.now()) || !Number.isInteger(index) || index < 0) throw fail('CLIPBOARD_IMAGE_UNAVAILABLE')
  const source = clipboardHtmlImages(clipboardItemHtml(item))[index]
  if (!source) throw fail('CLIPBOARD_IMAGE_UNAVAILABLE')
  const key = crypto.createHash('sha256').update(path.resolve(directory) + '\0' + source).digest('hex')
  const existing = cache.get(key) || item.htmlImageCache?.[key]
  if (existing) {
    try { return { ...await readClipboardImage({ ...item, imagePath: existing }, directory, { thumbnail }), sourceHash: key, imagePath: existing } }
    catch (error) { if (error.code !== 'CLIPBOARD_IMAGE_MISSING') throw error; cache.delete(key) }
  }
  let bytes
  if (/^data:image\/(?:png|jpe?g|gif|webp|bmp|tiff?|avif);base64,/i.test(source)) {
    const payload = source.slice(source.indexOf(',') + 1)
    if (payload.length > MAX_BYTES * 4 / 3 + 4) throw fail('CLIPBOARD_IMAGE_TOO_LARGE')
    if (!/^[a-z0-9+/\r\n]*={0,2}$/i.test(payload)) throw fail('CLIPBOARD_IMAGE_INVALID')
    bytes = Buffer.from(payload, 'base64')
  } else {
    if (!loadExternal) throw fail('CLIPBOARD_IMAGE_EXTERNAL_REQUIRED')
    if (/^https?:\/\//i.test(source)) {
      const url = new URL(source)
      if (url.username || url.password) throw fail('CLIPBOARD_IMAGE_UNAVAILABLE')
      // 用户点击后才读取；不携带浏览器 Cookie 或认证信息，并限制响应大小与耗时。
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15000), credentials: 'omit', referrerPolicy: 'no-referrer' })
        if (!response.ok) throw fail('CLIPBOARD_IMAGE_MISSING')
        if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body?.cancel(); throw fail('CLIPBOARD_IMAGE_TOO_LARGE') }
        const chunks = []; let length = 0
        const reader = response.body.getReader()
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            length += value.byteLength
            if (length > MAX_BYTES) throw fail('CLIPBOARD_IMAGE_TOO_LARGE')
            chunks.push(Buffer.from(value))
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
        bytes = Buffer.concat(chunks)
      } catch (error) { if (error.code?.startsWith('CLIPBOARD_IMAGE_')) throw error; throw fail('CLIPBOARD_IMAGE_LOAD_FAILED') }
    } else {
      let file
      try { file = /^file:/i.test(source) ? fileURLToPath(source) : path.isAbsolute(source) ? source : null } catch {}
      if (!file) throw fail('CLIPBOARD_IMAGE_UNAVAILABLE')
      try {
        const stat = await fs.stat(file)
        if (!stat.isFile()) throw fail('CLIPBOARD_IMAGE_UNAVAILABLE')
        if (stat.size > MAX_BYTES) throw fail('CLIPBOARD_IMAGE_TOO_LARGE')
        bytes = await fs.readFile(file)
      } catch (error) { if (error.code?.startsWith('CLIPBOARD_IMAGE_')) throw error; throw fail('CLIPBOARD_IMAGE_MISSING') }
    }
  }
  const stored = await storeClipboardPng(bytes, directory)
  if (cache.size >= 256) cache.delete(cache.keys().next().value)
  cache.set(key, stored.imagePath)
  return { ...await readClipboardImage({ ...item, imagePath: stored.imagePath }, directory, { thumbnail }), sourceHash: key, imagePath: stored.imagePath }
}
