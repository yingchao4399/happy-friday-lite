import path from 'node:path'

const fault = code => Object.assign(new Error(code), { code })
export const OFFICE_MEDIA_LIMITS = Object.freeze({ items: 12, itemBytes: 200 * 1024 * 1024, totalBytes: 200 * 1024 * 1024 })

// 按字节识别媒体，不让伪装成 .png 的本地文本随附件上传。
export function sniffOfficeMedia(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 4) return null
  const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 32))
  const ascii = (at, value) => head.subarray(at, at + value.length).toString('ascii') === value
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif'
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp'
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'audio/wav'
  if (ascii(0, 'OggS')) return 'audio/ogg'
  if (ascii(0, 'fLaC')) return 'audio/flac'
  if (ascii(0, 'ID3') || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) return 'audio/mpeg'
  if (head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'video/webm'
  if (ascii(4, 'ftyp')) {
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1'].some(value => ascii(8, value))) return 'image/heic'
    if (['avif', 'avis'].some(value => ascii(8, value))) return 'image/avif'
    return 'video/mp4'
  }
  return null
}

/** 本地引用必须经宿主选取授权；下载实现必须是上游 SSRF guard，绝不直接 fetch。 */
export async function loadOfficeMediaReferences(refs, { readGrantedMedia, fetchRemote, readBodyCapped, readGenerated, signal, limits = OFFICE_MEDIA_LIMITS } = {}) {
  const active = () => { if (signal?.aborted) throw signal.reason || fault('OFFICE_AI_REQUEST_CANCELLED') }
  if (!Array.isArray(refs) || !refs.length || refs.length > limits.items || refs.some(ref => typeof ref !== 'string' || !ref || ref.length > Math.ceil(limits.itemBytes * 4 / 3) + 100)) throw fault('OFFICE_AI_MEDIA_INPUT_INVALID')
  let total = 0
  const media = []
  for (const ref of refs) {
    active()
    let bytes, name
    if (ref.startsWith('data:')) {
      const match = /^data:(?:image|video|audio)\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/]*={0,2})$/i.exec(ref)
      if (!match || match[1].length % 4 !== 0 || Math.floor(match[1].length * 3 / 4) > Math.min(limits.itemBytes, limits.totalBytes - total) + 2) throw fault('OFFICE_AI_MEDIA_INPUT_INVALID')
      bytes = new Uint8Array(Buffer.from(match[1], 'base64'))
    } else if (/^https?:\/\//i.test(ref)) {
      if (ref.length > 4096 || typeof fetchRemote !== 'function' || typeof readBodyCapped !== 'function') throw fault('OFFICE_AI_MEDIA_UNAVAILABLE')
      const response = await fetchRemote(ref)
      active()
      if (!response?.ok) throw fault('OFFICE_AI_MEDIA_DOWNLOAD_FAILED')
      bytes = await readBodyCapped(response, Math.min(limits.itemBytes, limits.totalBytes - total))
      name = path.posix.basename(new URL(ref).pathname)
    } else if (ref.startsWith('friday-generated-image://')) {
      if (typeof readGenerated !== 'function') throw fault('OFFICE_AI_ASSET_NOT_OWNED')
      const image = readGenerated(ref)
      bytes = image?.bytes
    } else {
      if (ref.length > 4096 || !path.isAbsolute(ref) || typeof readGrantedMedia !== 'function') throw fault('OFFICE_AI_MEDIA_INPUT_INVALID')
      const media = await readGrantedMedia(ref, Math.min(limits.itemBytes, limits.totalBytes - total))
      bytes = media?.bytes
      name = media?.name
    }
    active()
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > limits.itemBytes || total + bytes.byteLength > limits.totalBytes) throw fault('OFFICE_AI_MEDIA_TOO_LARGE')
    const mime = sniffOfficeMedia(bytes)
    if (!mime) throw fault('OFFICE_AI_MEDIA_TYPE_INVALID')
    total += bytes.byteLength
    media.push({ bytes, mime, ...(name ? { name: String(name).slice(0, 255) } : {}) })
  }
  return media
}
