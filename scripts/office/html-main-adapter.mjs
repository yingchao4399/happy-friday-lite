import fs from 'node:fs'

function replace(source, needle, value, id) {
  if (!source.includes(needle)) throw new Error(`OFFICE_HTML_MAIN_ADAPTER_DRIFT: ${id}`)
  return source.replace(needle, value)
}

export function transformHtmlMainSource(source, id) {
  const file = id.replaceAll('\\', '/')
  if (file.endsWith('/apps/html/src/main/preview-protocol.ts')) {
    source = replace(source, '    if (!entry) return new Response(null, { status: 404 })', `    if (!entry || new URL(request.url).searchParams.get('owner') !== fridayPreviewTokens.get(Number(match![1]))) return new Response(null, { status: 404 })`, file)
    source = replace(source, '    return new Response(buildPreviewDocument(entry.text, entry.baseHref), {',
      `    const raw = new URL(request.url).searchParams.has('present') ? fridayPresentationBuffers.get(Number(match![1])) : undefined
    return new Response(buildPreviewDocument(raw ?? entry.text, entry.baseHref), {`, file)
    return source + `
import { randomUUID as fridayToken } from 'node:crypto'
import { previewUrlFor as fridayOriginalPreviewUrl } from './preview-document'
const fridayPresentationBuffers = new Map<number, string>()
const fridayPreviewTokens = new Map<number, string>()
function fridayTokenFor(id: number) {
  let token = fridayPreviewTokens.get(id)
  if (!token) { token = fridayToken(); fridayPreviewTokens.set(id, token) }
  return token
}
export function fridayScopedPreviewUrl(id: number) { return fridayOriginalPreviewUrl(id) + '?owner=' + fridayTokenFor(id) }
export function fridayScopedAssetBase(base: string | null, id: number) { return base ? base.replace('://local/', '://' + fridayTokenFor(id) + '/') : null }
export function fridayPreviewOwnerForToken(token: string) { return [...fridayPreviewTokens].find(([, value]) => value === token)?.[0] ?? -1 }
export function fridaySetPresentationSource(id: number, source: string | null) {
  if (source === null) { fridayPresentationBuffers.delete(id); fridayPreviewTokens.delete(id) }
  else fridayPresentationBuffers.set(id, source)
}
`
  }
  if (!file.endsWith('/apps/html/src/main/html-main.ts')) return null
  source = replace(source, 'url: previewUrlFor(presentOwnerByWc.get(e.sender.id) ?? e.sender.id)', 'url: fridayScopedPreviewUrl(presentOwnerByWc.get(e.sender.id) ?? e.sender.id)', file)
  source = replace(source, 'return { text, baseHref: doc ? assetBaseHref(dirname(doc)) : null }', 'return { text, baseHref: fridayScopedAssetBase(doc ? assetBaseHref(dirname(doc)) : null, wcId) }', file)
  source = source.replaceAll('assetBaseHref(dirname(docPath))', 'fridayAssetBaseForDocument(docPath)')
  source = replace(source, 'const conversion = convertHtmlToDocx({ url: pathToFileURL(htmlPath).href }, driver).then(', `const conversion = convertHtmlToDocx({ url: pathToFileURL(htmlPath).href }, driver, { log: process.env.FRIDAY_HTML_DOCX_DEBUG === '1' ? (message) => console.warn(message) : undefined }).then(`, file)
  source = replace(source, '    for (const doc of new Set([...openPathByWc.values(), ...savePathByWc.values()])) {', `    const fridayOwner = fridayPreviewOwnerForToken(new URL(request.url).hostname)
    const fridayDocument = savePathByWc.get(fridayOwner) ?? openPathByWc.get(fridayOwner)
    for (const doc of fridayDocument ? [fridayDocument] : []) {`, file)
  source = source.replaceAll('ipcMain.handle(', 'fridayHtmlHandle(').replaceAll('ipcMain.on(', 'fridayHtmlOn(')
  source = replace(source, '  ipcRegistered = true', `  ipcRegistered = true
  fridayHtmlHandle('friday:html-preview-sync', () => true)
  fridayHtmlOn('friday:html-presentation-source', (event, text) => {
    if (typeof text === 'string' && text.length <= 8 * 1024 * 1024) fridaySetPresentationSource(event.sender.id, text)
  })`, file)
  source = replace(source, '  const wcId = wc.id\n  const watcher', `  const wcId = wc.id
  fridayHtmlViews.add(wcId)
  wc.once('destroyed', () => {
    fridayHtmlViews.delete(wcId)
    fridayAttachmentGrants.delete(wcId)
    fridaySetPresentationSource(wcId, null)
  })
  const watcher`, file)
  // 三种输出使用相同的不可破坏旧目标协议；失败时不退回原地截断写入。
  const cancel = '      if (picked.canceled || !picked.filePath) return { ok: true, canceled: true }'
  if (source.split(cancel).length !== 4) throw new Error('OFFICE_HTML_MAIN_ADAPTER_DRIFT: export target count')
  source = source.replaceAll(cancel, cancel + '\n      const fridayTarget = await fridayPrepareExport(picked.filePath, e.sender.id)')
  source = replace(source, 'await writeFile(picked.filePath, docx)', 'await fridayWriteExport(picked.filePath, docx, fridayTarget)', file)
  source = replace(source, 'await writeFile(picked.filePath, await renderPrintPdf(request.html, docPath, workDir))', 'await fridayWriteExport(picked.filePath, await renderPrintPdf(request.html, docPath, workDir), fridayTarget)', file)
  source = replace(source, "await writeFile(picked.filePath, html, 'utf8')", 'await fridayWriteExport(picked.filePath, Buffer.from(html), fridayTarget)', file)
  return source + MAIN_HELPER
}

const MAIN_HELPER = `
import { fridaySetPresentationSource, fridayScopedPreviewUrl, fridayScopedAssetBase, fridayPreviewOwnerForToken } from './preview-protocol'
import { realpathSync, lstatSync } from 'node:fs'
import { rename as fridayRename } from 'node:fs/promises'
import { createHash as fridayHash, randomUUID as fridayUuid } from 'node:crypto'
const fridayHtmlViews = new Set<number>()
const fridayAttachmentGrants = new Map<number, Map<string, string>>()
const fridayExportLocks = new Set<string>()
function fridayPath(file: string) { const real = realpathSync(file); return process.platform === 'win32' ? real.toLowerCase() : real }
function fridayAttachmentState(file: string) {
  const stat = statSync(file)
  if (!stat.isFile()) throw new Error('OFFICE_HTML_ATTACHMENT_NOT_GRANTED')
  return JSON.stringify([stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs])
}
export async function htmlAiReadGrantedMedia(senderId: number, file: string, maxBytes = 200 * 1024 * 1024) {
  const sender = webContents.fromId(senderId)
  if (!sender || sender.isDestroyed() || !fridayHtmlViews.has(senderId) || presentOwnerByWc.has(senderId) || typeof file !== 'string') throw new Error('OFFICE_HTML_ATTACHMENT_NOT_GRANTED')
  const canonical = fridayPath(file)
  const granted = fridayAttachmentGrants.get(senderId)?.get(canonical)
  if (!granted || granted !== fridayAttachmentState(canonical)) throw new Error('OFFICE_HTML_ATTACHMENT_NOT_GRANTED')
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 200 * 1024 * 1024) throw new Error('OFFICE_AI_MEDIA_TOO_LARGE')
  const handle = await open(canonical, 'r')
  try {
    const before = await handle.stat()
    const snapshot = JSON.stringify([before.dev, before.ino, before.size, before.mtimeMs, before.ctimeMs])
    if (!before.isFile() || snapshot !== granted || before.size > maxBytes) throw new Error('OFFICE_HTML_ATTACHMENT_NOT_GRANTED')
    const chunks: Buffer[] = []
    let total = 0
    for (;;) {
      const buffer = Buffer.alloc(Math.min(65536, maxBytes - total + 1))
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null)
      if (!bytesRead) break
      total += bytesRead
      if (total > maxBytes) throw new Error('OFFICE_AI_MEDIA_TOO_LARGE')
      chunks.push(buffer.subarray(0, bytesRead))
    }
    const after = await handle.stat()
    if (JSON.stringify([after.dev, after.ino, after.size, after.mtimeMs, after.ctimeMs]) !== granted || fridayPath(file) !== canonical || fridayAttachmentGrants.get(senderId)?.get(canonical) !== granted || sender.isDestroyed()) throw new Error('OFFICE_HTML_ATTACHMENT_NOT_GRANTED')
    return { bytes: new Uint8Array(Buffer.concat(chunks, total)), name: basename(file) }
  } finally { await handle.close() }
}
function fridayAssetBaseForDocument(file: string) {
  const owner = [...savePathByWc].find(([, saved]) => resolve(saved).toLowerCase() === resolve(file).toLowerCase())?.[0]
  return owner == null ? null : fridayScopedAssetBase(assetBaseHref(dirname(file)), owner)
}
function fridayAssertSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) {
  if (event.senderFrame !== event.sender.mainFrame || event.sender.isDestroyed() ||
    (!fridayHtmlViews.has(event.sender.id) && !presentOwnerByWc.has(event.sender.id))) throw new Error('OFFICE_HTML_SENDER_INVALID')
}
function fridayHtmlHandle(channel: string, listener: (...args: any[]) => any) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!channel.startsWith('html:') && !channel.startsWith('friday:html-')) return listener(event, ...args)
    fridayAssertSender(event)
    if (presentOwnerByWc.has(event.sender.id) && ![HTML_CHANNELS.previewInfo, HTML_CHANNELS.getLanguage, HTML_CHANNELS.presentFullScreen].includes(channel as any)) throw new Error('OFFICE_HTML_PRESENT_READ_ONLY')
    const grants = fridayAttachmentGrants.get(event.sender.id) || new Map<string, string>()
    fridayAttachmentGrants.set(event.sender.id, grants)
    if ([HTML_CHANNELS.filesRead, HTML_CHANNELS.filesReadImage].includes(channel as any)) {
      if (typeof args[0] !== 'string' || !grants.has(fridayPath(args[0]))) throw new Error('OFFICE_HTML_ATTACHMENT_NOT_GRANTED')
    }
    if (channel === HTML_CHANNELS.filesAdd && Array.isArray(args[0]) && args[0].some(file => typeof file !== 'string' || !existsSync(file) || !grants.has(fridayPath(file)))) {
      const answer = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender) || undefined as any, {
        type: 'question', title: tm('dlgAddAttachment'), message: tm('dlgAddAttachment'),
        detail: args[0].filter(file => typeof file === 'string').slice(0, 20).join('\\n'),
        buttons: [tm('btnCancel'), tm('dlgAddAttachment')], defaultId: 0, cancelId: 0,
      })
      if (answer.response !== 1) return { accepted: [], rejected: [] }
    }
    let result
    try { result = await listener(event, ...args) }
    catch (error) {
      if ([HTML_CHANNELS.exportDocx, HTML_CHANNELS.exportPdf, HTML_CHANNELS.exportHtml].includes(channel as any)) return { ok: false, error: (error as Error).message }
      throw error
    }
    if ([HTML_CHANNELS.filesPick, HTML_CHANNELS.filesAdd, HTML_CHANNELS.filesAddPastedImage].includes(channel as any)) {
      for (const file of result?.accepted || []) if (typeof file.path === 'string' && existsSync(file.path)) {
        const canonical = fridayPath(file.path)
        grants.set(canonical, fridayAttachmentState(canonical))
      }
    }
    return result
  })
}
function fridayHtmlOn(channel: string, listener: (...args: any[]) => any) {
  ipcMain.on(channel, (event, ...args) => {
    try {
      fridayAssertSender(event)
      listener(event, ...args)
      if (channel === HTML_CHANNELS.previewUpdate) {
        for (const [id, owner] of presentOwnerByWc) {
          const present = webContents.fromId(id)
          if (owner === event.sender.id && present && !present.isDestroyed()) present.send('friday:html-preview-updated')
        }
      }
    }
    catch { console.warn('[Office HTML] rejected untrusted event:', channel) }
  })
}
function fridayTargetState(file: string) {
  if (!existsSync(file)) return null
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('OFFICE_TARGET_UNSAFE')
  return { dev: stat.dev, ino: stat.ino, hash: fridayHash('sha256').update(readFileSync(file)).digest('hex') }
}
async function fridayPrepareExport(file: string, _sender: number) {
  const target = resolve(file)
  const parent = realpathSync(dirname(target))
  if (parent.toLowerCase() !== dirname(target).toLowerCase()) throw new Error('OFFICE_TARGET_UNSAFE')
  const current = fridayTargetState(target)
  for (const source of savePathByWc.values()) {
    if (resolve(source).toLowerCase() === target.toLowerCase()) throw new Error('OFFICE_TARGET_IS_SOURCE')
    if (current && existsSync(source)) {
      const stat = statSync(source)
      if (stat.dev === current.dev && stat.ino === current.ino) throw new Error('OFFICE_TARGET_IS_SOURCE')
    }
  }
  return { parent, current }
}
async function fridayWriteExport(file: string, bytes: Buffer, before: any) {
  const key = resolve(file).toLowerCase()
  if (fridayExportLocks.has(key)) throw new Error('OFFICE_TARGET_BUSY')
  fridayExportLocks.add(key)
  const temp = file + '.' + fridayUuid() + '.tmp'
  try {
    if (realpathSync(dirname(file)) !== before.parent || JSON.stringify(fridayTargetState(file)) !== JSON.stringify(before.current)) throw new Error('OFFICE_TARGET_CHANGED')
    await writeFile(temp, bytes, { flag: 'wx' })
    if (JSON.stringify(fridayTargetState(file)) !== JSON.stringify(before.current)) throw new Error('OFFICE_TARGET_CHANGED')
    await fridayRename(temp, file)
  } finally {
    await rm(temp, { force: true }).catch(() => {})
    fridayExportLocks.delete(key)
  }
}
`

export function htmlMainAdapterPlugin() {
  return { name: 'friday-html-main-adapter', setup(build) {
    build.onLoad({ filter: /[\\/]apps[\\/]html[\\/]src[\\/]main[\\/](html-main|preview-protocol)\.ts$/ }, args => {
      const source = fs.readFileSync(args.path, 'utf8')
      return { contents: transformHtmlMainSource(source, args.path) ?? source, loader: 'ts' }
    })
  } }
}
