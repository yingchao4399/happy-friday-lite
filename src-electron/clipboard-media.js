import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import crypto from 'node:crypto'
import { clipboardFileType } from './clipboard-content.js'

function unavailable(code) {
  return Object.assign(new Error(code), { code })
}

export async function storeClipboardPng(buffer, directory) {
  if (!Buffer.isBuffer(buffer) || buffer.length > 64 * 1024 * 1024) throw unavailable('CLIPBOARD_IMAGE_TOO_LARGE')
  let png
  try { png = await sharp(buffer, { limitInputPixels: 100_000_000 }).rotate().png().toBuffer() }
  catch { throw unavailable('CLIPBOARD_IMAGE_INVALID') }
  const hash = crypto.createHash('sha256').update(png).digest('hex')
  await fs.mkdir(directory, { recursive: true })
  const imagePath = path.join(directory, hash + '.png')
  await fs.writeFile(imagePath, png, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error })
  return { imagePath, hash }
}

export async function readClipboardSourceImage(item, index, directory, options) {
  if (!item || item.deletedAt || item.sensitivity === 'secret' || !Number.isInteger(index) || index < 0 || (item.expiresAt && Date.parse(item.expiresAt) <= Date.now())) throw unavailable('CLIPBOARD_IMAGE_UNAVAILABLE')
  const file = item.filePaths?.[index]
  if (clipboardFileType(file).kind !== 'image') throw unavailable('CLIPBOARD_IMAGE_UNAVAILABLE')
  try {
    const stat = await fs.stat(file)
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw unavailable('CLIPBOARD_IMAGE_TOO_LARGE')
    const { imagePath } = await storeClipboardPng(await fs.readFile(file), directory)
    return readClipboardImage({ ...item, imagePath }, directory, options)
  } catch (error) {
    if (error.code === 'ENOENT') throw unavailable('CLIPBOARD_IMAGE_MISSING')
    throw error
  }
}

// 只读取历史条目对应的受管 PNG，不接受渲染进程传入的文件路径。
export async function readClipboardImage(item, directory, { thumbnail = true } = {}) {
  if (!item || item.deletedAt || item.sensitivity === 'secret' ||
      (item.expiresAt && Date.parse(item.expiresAt) <= Date.now())) {
    throw unavailable('CLIPBOARD_IMAGE_UNAVAILABLE')
  }
  if (!item.imagePath || !/^[a-f0-9]{64}[.]png$/i.test(path.basename(item.imagePath))) {
    throw unavailable('CLIPBOARD_IMAGE_UNAVAILABLE')
  }
  const expected = path.resolve(directory)
  const candidate = path.resolve(item.imagePath)
  if (path.dirname(candidate) !== expected) throw unavailable('CLIPBOARD_IMAGE_UNAVAILABLE')
  try {
    const [root, real, stat] = await Promise.all([fs.realpath(expected), fs.realpath(candidate), fs.lstat(candidate)])
    if (stat.isSymbolicLink() || !stat.isFile() || path.dirname(real) !== root) throw unavailable('CLIPBOARD_IMAGE_UNAVAILABLE')
    if (stat.size > 64 * 1024 * 1024) throw unavailable('CLIPBOARD_IMAGE_TOO_LARGE')
    const buffer = await fs.readFile(real)
    const source = sharp(buffer, { limitInputPixels: 100_000_000 })
    const { width, height, format } = await source.metadata()
    if (format !== 'png' || !width || !height) throw unavailable('CLIPBOARD_IMAGE_INVALID')
    const output = thumbnail
      ? await source.resize({ width: 440, height: 240, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
      : buffer
    return { dataUrl: `data:image/png;base64,${output.toString('base64')}`, width, height, contentHash: crypto.createHash('sha256').update(buffer).digest('hex') }
  } catch (error) {
    if (error.code?.startsWith('CLIPBOARD_IMAGE_')) throw error
    if (error.code === 'ENOENT') throw unavailable('CLIPBOARD_IMAGE_MISSING')
    throw unavailable('CLIPBOARD_IMAGE_INVALID')
  }
}
