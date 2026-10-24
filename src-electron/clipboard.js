import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { app, clipboard, nativeImage, safeStorage, globalShortcut, ipcMain, shell } from 'electron'
import { getDataDir, loadConfig, saveConfig } from './config.js'
import { classifyClipboard, protectedText, clipboardMatches, clipboardInDateRange, isSensitiveClipboardExpired } from './clipboard-policy.js'
import { watchWindowsClipboard } from './windows-clipboard.js'
import { queryAllRaw } from './db.js'
import { recordClipboardDeletion } from './trash.js'
import { readClipboardImage, readClipboardSourceImage, storeClipboardPng } from './clipboard-media.js'
import { clipboardDefaults, normalizeClipboardSettings, validateClipboardSettings, clipboardRetentionIds, clipboardCapabilities } from './clipboard-settings.js'
import { clipboardGroupName, clipboardOrganization, clipboardInView } from './clipboard-organization.js'
import { clipboardAiError, createClipboardAnalyzer, saveClipboardNote } from './clipboard-ai.js'
import { getNotebooks, getNote } from './db.js'
import { recognizeImage } from './rag/imageOcr.js'
import { createClipboardShare, revokeClipboardShare, revokeClipboardResourceShares } from './shareServer.js'
import { clipboardFileType, clipboardCodeLanguage } from './clipboard-content.js'
import { createClipboardAssetServer } from './clipboard-assets.js'
import { createClipboardPins } from './clipboard-pins.js'
import { createClipboardDesktop } from './clipboard-desktop.js'
import { prepareClipboardAiContent, prepareClipboardNoteContent, clipboardNoteRevision, clipboardNoteSnapshotKey, clipboardSavedNoteMatches } from './clipboard-note-content.js'
import { clipboardFileEntries, clipboardFileItemKind } from './clipboard-files.js'
import { createRecordingCollector, createRecordingReleaseCheck } from './clipboard-recordings.js'
import { clipboardHtmlImages, clipboardItemHtml, readClipboardHtmlImage, replaceClipboardItemImage } from './clipboard-html-images.js'
import { compareClipboardOrder, reorderClipboardItems } from './clipboard-order.js'
import { transcriptionCapability } from './model-capabilities.js'

const POLL_MS = 650
const EXPIRY_CLEANUP_MS = 30_000
let preferences = { ...clipboardDefaults }
let registeredShortcut = ''

let timer = null
let expiryTimer = null
let mainWindow = null
let lastSignature = ''
let suppressSequence = null
let captureRetryTimer = null
let stopNativeWatch = null
let nativeClipboardAdapter = null
let analyzer = null
let assets = null
let pins = null
let desktop = null
let recordings = null
let recordingIssue = null
let appendState = { enabled: false, targetId: null, count: 0 }

function clipboardFilePaths() {
  return nativeClipboardAdapter?.readFilePaths?.({ strict: true }) || []
}

function historyPath() {
  return path.join(getDataDir(), 'clipboard-history.json')
}

function mediaDir() {
  return path.join(getDataDir(), 'clipboard-media')
}

function ensureStorage() {
  fs.mkdirSync(mediaDir(), { recursive: true })
}

function readItems() {
  const rows = queryAllRaw('SELECT payload FROM clipboard_items ORDER BY capturedAt DESC')
  if (!rows.length && fs.existsSync(historyPath())) {
    let value
    try { value = JSON.parse(fs.readFileSync(historyPath(), 'utf8')) } catch {
      const error = new Error(`旧剪贴板历史无法解析，原文件已保留：${historyPath()}`)
      error.code = 'CLIPBOARD_LEGACY_HISTORY_INVALID'
      error.recoverable = true
      throw error
    }
    if (!Array.isArray(value)) throw new Error('剪贴板历史格式损坏，已保留原文件')
    // 旧预览版可能留下未加密敏感内容；迁移时必须先加密。
    const items = value.map(item => item.sensitivity === 'secret' && !String(item.plainText).startsWith('enc:')
      ? { ...item, plainText: encrypt(String(item.plainText || '')), html: '', imagePath: null, maskedPreview: '••••••••' } : item)
    writeItems(items)
    fs.unlinkSync(historyPath())
    return items
  }
  return rows.map(row => {
    try { return JSON.parse(row.payload) } catch {
      const error = new Error('剪贴板数据库中存在无法读取的历史记录；该记录未被自动删除')
      error.code = 'CLIPBOARD_ITEM_INVALID'
      error.recoverable = true
      throw error
    }
  })
}

function writeItems(items) {
  queryAllRaw('BEGIN IMMEDIATE')
  try {
    queryAllRaw('DELETE FROM clipboard_tags')
    queryAllRaw('DELETE FROM clipboard_items')
    for (const item of items) {
      queryAllRaw('INSERT INTO clipboard_items VALUES (?, ?, ?, ?)', [item.id, JSON.stringify(item), item.capturedAt, item.deletedAt || null])
      for (const tag of item.tags || []) queryAllRaw('INSERT OR IGNORE INTO clipboard_tags VALUES (?, ?)', [item.id, tag])
    }
    queryAllRaw('COMMIT')
  } catch (error) { queryAllRaw('ROLLBACK'); throw error }
  pins?.refresh()
}

function encrypt(value) {
  return protectedText(value, safeStorage)
}

function decrypt(value) {
  if (typeof value !== 'string' || !value.startsWith('enc:')) return value || ''
  try { return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64')) } catch { return '' }
}

function readClipboardSnapshot({ internal = false } = {}) {
  const sequence = internal ? undefined : nativeClipboardAdapter?.getSequenceNumber?.()
  const image = clipboard.readImage()
  const metadata = internal ? null : nativeClipboardAdapter?.readSnapshot?.()
  const text = metadata ? metadata.text : clipboard.readText() || ''
  const html = metadata ? metadata.html : clipboard.readHTML() || ''
  const filePaths = metadata ? metadata.filePaths : (internal ? [] : clipboardFilePaths())
  if (!internal && sequence !== nativeClipboardAdapter?.getSequenceNumber?.()) throw Object.assign(new Error('CLIPBOARD_BUSY'), { code: 'CLIPBOARD_BUSY' })
  if (metadata?.hasImage && image.isEmpty()) throw Object.assign(new Error('CLIPBOARD_BUSY'), { code: 'CLIPBOARD_BUSY' })
  return { text, html, image, filePaths, sequence }
}

function snapshotSignature({ text, html, image, filePaths }) {
  const imageData = image.isEmpty() ? '' : image.toPNG().toString('base64')
  return crypto.createHash('sha256').update(`${text}\n${html}\n${imageData}\n${filePaths.join('\n')}`).digest('hex')
}

function captureSignature() { return snapshotSignature(readClipboardSnapshot()) }

function emit(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
  desktop?.send(channel, payload)
}

function captureClipboard({ internal = false } = {}) {
  if (!preferences.captureEnabled) return null
  const snapshot = readClipboardSnapshot({ internal }), signature = snapshotSignature(snapshot)
  if (snapshot.sequence !== undefined && snapshot.sequence === suppressSequence) { lastSignature = signature; return null }
  suppressSequence = null
  if (!signature || signature === lastSignature) return null
  lastSignature = signature

  const { text: plainText, html, image, filePaths } = snapshot
  const hasImage = preferences.captureImages && !image.isEmpty()
  if (!plainText && !html && !hasImage && !filePaths.length) return null

  ensureStorage()
  const classification = classifyClipboard(plainText, html)
  const modalityCount = [plainText || html, hasImage, filePaths.length > 0].filter(Boolean).length
  const fileEntries = clipboardFileEntries(filePaths)
  const fileType = filePaths.length === 1 ? { ...clipboardFileType(filePaths[0]), kind: fileEntries[0].kind } : { kind: 'file' }
  const language = !filePaths.length && !hasImage ? clipboardCodeLanguage(plainText, html) : ''
  const kind = classification === 'secret' ? 'secret' : modalityCount > 1 ? 'mixed' : filePaths.length ? fileType.kind : hasImage ? 'image' : language ? 'code' : classification
  const sensitive = kind === 'secret'
  if (sensitive && !preferences.captureSensitive) return null
  let storedText = plainText
  if (sensitive) {
    try { storedText = encrypt(plainText || html) } catch (error) {
      emit('capability-error', { code: error.code, message: error.message, stage: 'clipboard-capture', recoverable: true, nextStep: 'restore-system-encryption' })
      return null
    }
  }
  const item = {
    id: crypto.randomUUID(),
    kind,
    language: fileType.language || language,
    plainText: storedText,
    html: sensitive ? '' : html,
    imagePath: null,
    imagePaths: [],
    filePaths: sensitive ? [] : filePaths,
    fileEntries: sensitive ? [] : fileEntries,
    sourceApp: internal ? 'friday' : (() => { try { return nativeClipboardAdapter?.readSource?.() || 'system-clipboard' } catch { return 'system-clipboard' } })(),
    capturedAt: new Date().toISOString(),
    hash: signature,
    tags: [],
    pinned: false,
    favorite: false,
    usageCount: 0,
    sensitivity: sensitive ? 'secret' : 'normal',
    maskedPreview: sensitive ? '••••••••' : (plainText || (filePaths.length ? filePaths.join('\n') : hasImage ? '[图片]' : '')),
    expiresAt: sensitive ? new Date(Date.now() + preferences.sensitiveMinutes * 60_000).toISOString() : null,
    deletedAt: null
  }
  if (hasImage && !sensitive) {
    const fileName = `${signature}.png`
    const filePath = path.join(mediaDir(), fileName)
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, image.toPNG())
    item.imagePath = filePath
    item.imagePaths = [filePath]
  }
  queueClipboardItem(item)
  return item
}

function itemPart(item) {
  return { text: item.sensitivity === 'secret' ? '' : decrypt(item.plainText), html: item.html || '', imagePath: item.imagePath || null, imagePaths: item.imagePaths || [], filePaths: [...(item.filePaths || [])], kind: item.kind, language: item.language, sourceApp: item.sourceApp, capturedAt: item.capturedAt }
}

function mergeClipboardItems(first, second) {
  const parts = [...(first.parts || [itemPart(first)]), ...(second.parts || [itemPart(second)])]
  const text = parts.map(part => part.text || (part.html || '').replace(/<[^>]*>/g, ' ')).filter(Boolean).join('\n\n')
  const imagePaths = [...new Set(parts.flatMap(part => part.imagePaths?.length ? part.imagePaths : part.imagePath ? [part.imagePath] : []))]
  const filePaths = [...new Set(parts.flatMap(part => part.filePaths || []))]
  return { ...first, savedNoteId: null, savedNoteHash: null, savedNoteSnapshotKey: null, ai: null, kind: 'mixed', plainText: text, html: '', imagePath: imagePaths[0] || null, imagePaths, filePaths, fileEntries: clipboardFileEntries(filePaths, [...(first.fileEntries || []), ...(second.fileEntries || [])]), parts, maskedPreview: text || filePaths.join('\n'), hash: crypto.createHash('sha256').update(first.hash + second.hash).digest('hex'), updatedAt: second.capturedAt }
}

function queueClipboardItem(item) {
  if (!appendState.enabled || item.sensitivity === 'secret') return commitClipboardItem(item)
  const items = readItems()
  const target = items.find(entry => entry.id === appendState.targetId && !entry.deletedAt && entry.sensitivity !== 'secret')
  if (target) {
    if ((target.parts?.length || 1) >= 200) {
      setClipboardAppend(false)
      emit('capability-error', { code: 'CLIPBOARD_APPEND_LIMIT', stage: 'clipboard-append', recoverable: true, nextStep: 'start-new-append' })
      return commitClipboardItem(item)
    }
    const merged = mergeClipboardItems(target, item)
    Object.assign(target, merged)
    delete target.savedNoteId; delete target.savedNoteHash; delete target.savedNoteSnapshotKey; delete target.ai
    writeItems(items)
    appendState.count = target.parts.length
    emit('clipboard-item-added', publicItem(target))
  } else {
    const captured = commitClipboardItem(item)
    appendState.targetId = captured.id
    appendState.count = 1
  }
  emit('clipboard-append-changed', getClipboardAppend())
}

export function getClipboardAppend() { return { ...appendState } }

export function setClipboardAppend(enabled) {
  if (typeof enabled !== 'boolean') throw clipboardAiError('CLIPBOARD_APPEND_INVALID')
  if (enabled && !preferences.captureEnabled) throw clipboardAiError('CLIPBOARD_CAPTURE_PAUSED')
  const finished = appendState.targetId
  appendState = { enabled, targetId: null, count: 0 }
  emit('clipboard-append-changed', getClipboardAppend())
  if (!enabled && finished && preferences.aiEnabled) void analyzer?.enqueue(finished)
  return getClipboardAppend()
}

function commitClipboardItem(item) {
  const items = readItems()
  const previous = !appendState.enabled && items.find(entry => entry.hash === item.hash && !entry.deletedAt)
  if (previous) {
    Object.assign(item, { id: previous.id, tags: previous.tags || [], category: previous.category || '', pinned: Boolean(previous.pinned), favorite: Boolean(previous.favorite), phrase: Boolean(previous.phrase), usageCount: previous.usageCount || 0, savedNoteId: previous.savedNoteId, ai: previous.ai, note: previous.note, manualOrder: previous.manualOrder })
    items.splice(items.indexOf(previous), 1)
  }
  items.unshift(item)
  writeItems(items)
  enforceHistoryRetention()
  const sensitive = item.sensitivity === 'secret'
  emit('clipboard-item-added', publicItem(item))
  if (preferences.aiEnabled && !appendState.enabled && !sensitive && !item.savedNoteId && !['not-important', 'queued', 'recognizing', 'transcribing', 'saving'].includes(item.ai?.status)) void analyzer?.enqueue(item.id)
  return item
}

function publicItem(item) {
  const expired = item.expiresAt && Date.parse(item.expiresAt) <= Date.now()
  if (expired) return { ...item, plainText: '', html: '', note: '', maskedPreview: '[已过期]', expired: true }
  const fileEntries = item.sensitivity === 'secret' ? [] : clipboardFileEntries(item.filePaths, item.fileEntries)
  return { ...item, kind: clipboardFileItemKind(item, fileEntries), fileEntries, plainText: item.sensitivity === 'secret' ? '' : decrypt(item.plainText), note: item.sensitivity === 'secret' ? '' : item.note || '', hasNote: Boolean(item.note), expired: false }
}

export function listClipboardItems({ query = '', kind = '', includeExpired = false, view = 'all', category = '', tag = '', dateFrom = '', dateTo = '' } = {}) {
  enforceHistoryRetention()
  const needle = String(query).trim().toLowerCase()
  return readItems()
    .filter(item => !item.deletedAt)
    .filter(item => includeExpired || !item.expiresAt || Date.parse(item.expiresAt) > Date.now())
    .filter(item => clipboardMatches(item, needle))
    .filter(item => clipboardInDateRange(item, dateFrom, dateTo))
    .filter(item => clipboardInView(item, { view, category, tag }))
    .sort(compareClipboardOrder)
    .map(publicItem)
    .filter(item => !kind || item.kind === kind)
}

export async function getClipboardImage({ id, index = 0, thumbnail = true, fileIndex, htmlIndex, loadExternal = false } = {}) {
  if (!Number.isInteger(index) || index < 0) throw clipboardAiError('CLIPBOARD_IMAGE_UNAVAILABLE')
  const item = typeof id === 'string' ? readItems().find(entry => entry.id === id) : null
  if (htmlIndex !== undefined) {
    const image = await readClipboardHtmlImage(item, htmlIndex, mediaDir(), { thumbnail: thumbnail !== false, loadExternal: loadExternal === true })
    const latestItems = readItems(), latest = latestItems.find(entry => entry.id === id)
    if (!latest || latest.deletedAt || latest.sensitivity === 'secret' || clipboardItemHtml(latest) !== clipboardItemHtml(item) || isSensitiveClipboardExpired(latest)) throw clipboardAiError('CLIPBOARD_IMAGE_UNAVAILABLE')
    if (image.imagePath && latest.htmlImageCache?.[image.sourceHash] !== image.imagePath) {
      latest.htmlImageCache = Object.fromEntries([...Object.entries(latest.htmlImageCache || {}), [image.sourceHash, image.imagePath]].slice(-256))
      writeItems(latestItems)
    }
    const { imagePath, ...result } = image
    return result
  }
  if (fileIndex !== undefined) return readClipboardSourceImage(item, fileIndex, mediaDir(), { thumbnail: thumbnail !== false })
  if (item?.imagePaths?.length && index >= item.imagePaths.length) throw clipboardAiError('CLIPBOARD_IMAGE_UNAVAILABLE')
  if (!item?.imagePaths?.length && index !== 0) throw clipboardAiError('CLIPBOARD_IMAGE_UNAVAILABLE')
  return readClipboardImage(item ? { ...item, imagePath: item.imagePaths?.[index] || item.imagePath } : item, mediaDir(), { thumbnail: thumbnail !== false })
}

export function getClipboardAsset(id, index = 0) { return assets.get(id, index) }

export async function saveClipboardImage({ id, index = 0, fileIndex, htmlIndex, dataUrl, baseHash } = {}) {
  const original = readItems().find(entry => entry.id === id)
  if (!original || original.deletedAt || original.sensitivity === 'secret') throw clipboardAiError('CLIPBOARD_IMAGE_UNAVAILABLE')
  if (typeof dataUrl !== 'string' || dataUrl.length > 90_000_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) throw clipboardAiError('CLIPBOARD_IMAGE_INVALID')
  const currentImage = await getClipboardImage({ id, index, fileIndex, htmlIndex, thumbnail: false })
  if (!baseHash || baseHash !== currentImage.contentHash) throw clipboardAiError('CLIPBOARD_IMAGE_EDIT_CONFLICT')
  const stored = await storeClipboardPng(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'), mediaDir())
  const items = readItems(), item = items.find(entry => entry.id === id)
  if (!item || item.deletedAt || item.sensitivity === 'secret' || isSensitiveClipboardExpired(item) || item.hash !== original.hash) throw clipboardAiError('CLIPBOARD_IMAGE_EDIT_CONFLICT')
  const old = htmlIndex !== undefined ? currentImage.sourceHash : fileIndex !== undefined ? item.filePaths[fileIndex] : item.imagePaths?.[index] || item.imagePath
  item.imageEdits = [...(item.imageEdits || []), { before: old, after: stored.imagePath, at: new Date().toISOString() }].slice(-20)
  if (htmlIndex !== undefined) {
    replaceClipboardItemImage(item, htmlIndex, dataUrl)
  } else if (fileIndex !== undefined) {
    item.originalFilePaths ||= [...item.filePaths]
    item.filePaths[fileIndex] = stored.imagePath
    for (const part of item.parts || []) part.filePaths = (part.filePaths || []).map(file => file === old ? stored.imagePath : file)
  } else {
    item.imagePaths = item.imagePaths?.length ? item.imagePaths.map((file, i) => i === index ? stored.imagePath : file) : [stored.imagePath]
    item.imagePath = item.imagePaths[0]
    for (const part of item.parts || []) {
      if (part.imagePath === old) part.imagePath = stored.imagePath
      part.imagePaths = (part.imagePaths || []).map(file => file === old ? stored.imagePath : file)
    }
  }
  item.hash = crypto.createHash('sha256').update(JSON.stringify([item.plainText, clipboardItemHtml(item), item.imagePaths, item.filePaths])).digest('hex')
  delete item.savedNoteId; delete item.savedNoteHash; delete item.savedNoteSnapshotKey; delete item.ai
  item.updatedAt = new Date().toISOString()
  writeItems(items)
  emit('clipboard-item-added', publicItem(item))
  return publicItem(item)
}

export async function createClipboardShareForItem(id) {
  const item = readItems().find(entry => entry.id === id)
  if (!item || item.deletedAt || item.sensitivity === 'secret') throw clipboardAiError('CLIPBOARD_SHARE_UNAVAILABLE')
  const inlineImages = []
  for (const [htmlIndex] of clipboardHtmlImages(clipboardItemHtml(item)).entries()) {
    if (inlineImages.length >= 200) throw clipboardAiError('CLIPBOARD_SHARE_TOO_MANY_FILES')
    const image = await readClipboardHtmlImage(item, htmlIndex, mediaDir(), { thumbnail: false, loadExternal: true })
    inlineImages.push(image.imagePath || (await storeClipboardPng(Buffer.from(image.dataUrl.split(',')[1], 'base64'), mediaDir())).imagePath)
  }
  const share = await createClipboardShare({ resourceId: id, text: decrypt(item.plainText), html: clipboardItemHtml(item), imagePath: item.imagePath, imagePaths: [...(item.imagePaths || []), ...inlineImages], filePaths: item.filePaths }, { onProgress: progress => emit('clipboard-share-progress', { id, ...progress }) })
  if (!share) throw clipboardAiError('CLIPBOARD_SHARE_UNAVAILABLE')
  const latest = readItems().find(entry => entry.id === id)
  if (!latest || latest.deletedAt || latest.sensitivity === 'secret' || latest.hash !== item.hash || (latest.expiresAt && Date.parse(latest.expiresAt) <= Date.now())) {
    revokeClipboardShare(share.token)
    throw clipboardAiError('CLIPBOARD_SHARE_SOURCE_CHANGED')
  }
  return share
}

export function revealClipboardSecret(id) {
  const item = readItems().find(entry => entry.id === id)
  if (!item || item.deletedAt || item.sensitivity !== 'secret' || (item.expiresAt && Date.parse(item.expiresAt) <= Date.now())) throw clipboardAiError('CLIPBOARD_SECRET_UNAVAILABLE')
  const plainText = decrypt(item.plainText)
  if (!plainText) throw clipboardAiError('CLIPBOARD_SECRET_UNAVAILABLE')
  return { id, plainText, note: decrypt(item.note), expiresAt: item.expiresAt }
}

export function reorderClipboardItem(id, beforeId, after = false) {
  const items = readItems()
  let result
  try { result = reorderClipboardItems(items, id, beforeId, after) }
  catch (error) { throw clipboardAiError(error.code === 'CLIPBOARD_ORDER_INVALID' ? error.code : 'CLIPBOARD_ORDER_INVALID') }
  if (result.changed) {
    writeItems(items)
    emit('clipboard-item-added', { id })
  }
  return { ok: true }
}

function enforceHistoryRetention() {
  const ids = clipboardRetentionIds(readItems(), preferences)
  if (ids.length) deleteClipboardItems(ids)
}

function shortcutAction() { desktop?.show().catch(() => desktop.full()) }

function applyShortcut(settings) {
  const next = settings.shortcutEnabled ? settings.shortcut : ''
  if (next === registeredShortcut) return
  if (next && !globalShortcut.register(next, shortcutAction)) {
    throw Object.assign(new Error('CLIPBOARD_SHORTCUT_UNAVAILABLE'), { code: 'CLIPBOARD_SHORTCUT_UNAVAILABLE' })
  }
  if (registeredShortcut) globalShortcut.unregister(registeredShortcut)
  registeredShortcut = next
}

export function getClipboardSettings() {
  return { ...preferences, capabilities: { ...clipboardCapabilities }, recordingIssue, defaultRecordingFolders: defaultRecordingFolders(), shortcutRegistered: Boolean(registeredShortcut) }
}

function defaultRecordingFolders() {
  return [path.join(app.getPath('videos'), 'Captures'), path.join(app.getPath('videos'), 'Screen Recordings')]
}

function startRecordingCapture() {
  recordings?.stop(); recordings = null
  recordingIssue = null
  if (!preferences.captureEnabled || !preferences.captureRecordings || !mainWindow) return
  const reported = new Set()
  const report = code => {
    if (reported.has(code)) return
    reported.add(code)
    recordingIssue = { code, at: new Date().toISOString() }
    emit('capability-error', { code, stage: 'clipboard-recording', recoverable: true, nextStep: 'check-recording-folders' })
  }
  try {
    recordings = createRecordingCollector({
      directories: [...defaultRecordingFolders(), ...preferences.recordingFolders], optionalDirectories: defaultRecordingFolders(), isReleased: createRecordingReleaseCheck(), onError: report,
      onReady: ({ file, size, modifiedAt }) => {
        if (!preferences.captureEnabled || !preferences.captureRecordings) return
        const now = new Date().toISOString()
        queueClipboardItem({ id: crypto.randomUUID(), kind: 'video', plainText: '', html: '', imagePath: null, imagePaths: [], filePaths: [file], sourceApp: 'screen-recording', capturedAt: now,
          hash: crypto.createHash('sha256').update(JSON.stringify([file, size, modifiedAt])).digest('hex'), tags: [], pinned: false, favorite: false, usageCount: 0, sensitivity: 'normal', maskedPreview: file, expiresAt: null, deletedAt: null })
      }
    })
    recordings.start().catch(() => report('CLIPBOARD_RECORDING_CAPTURE_FAILED'))
  } catch { report('CLIPBOARD_RECORDING_CAPTURE_FAILED') }
}

export function saveClipboardSettings(value) {
  const next = validateClipboardSettings(value)
  const config = loadConfig()
  const previous = preferences
  if (next.aiEnabled && !(config.customModels || []).some(model => model.id === (next.aiModelId || config.selectedModelId) && model.apiKey && model.baseUrl && model.modelName)) throw clipboardAiError('CLIPBOARD_AI_MODEL_REQUIRED')
  if (next.aiTranscriptionModelId !== 'windows-local' && !(config.customModels || []).some(model => model.id === next.aiTranscriptionModelId && model.apiKey && model.baseUrl && model.modelName && transcriptionCapability(model).supported !== false)) throw clipboardAiError('CLIPBOARD_AI_TRANSCRIPTION_MODEL_REQUIRED')
  if (next.aiNotebookId && !getNotebooks().some(book => book.id === next.aiNotebookId)) throw clipboardAiError('CLIPBOARD_NOTEBOOK_MISSING')
  applyShortcut(next)
  try { saveConfig({ ...config, clipboard: next }) } catch (error) { applyShortcut(previous); throw error }
  preferences = next
  desktop?.applySettings()
  if (previous.captureEnabled !== next.captureEnabled || previous.captureRecordings !== next.captureRecordings || JSON.stringify(previous.recordingFolders) !== JSON.stringify(next.recordingFolders)) startRecordingCapture()
  if (!next.captureEnabled && appendState.enabled) setClipboardAppend(false)
  if (previous.aiEnabled && !next.aiEnabled) analyzer?.cancelAutomatic()
  if (!previous.captureEnabled && next.captureEnabled) {
    try { lastSignature = captureSignature() } catch {}
  }
  // 缩短敏感内容期限会应用到现有条目，但延长期限不会复活过期内容。
  const items = readItems()
  let updated = false
  for (const item of items) {
    if (item.sensitivity !== 'secret') continue
    const expiresAt = new Date(Date.parse(item.capturedAt) + next.sensitiveMinutes * 60_000).toISOString()
    if (!item.expiresAt || expiresAt < item.expiresAt) { item.expiresAt = expiresAt; updated = true }
  }
  if (updated) writeItems(items)
  removeExpiredSensitiveItems()
  enforceHistoryRetention()
  emit('clipboard-settings-changed', getClipboardSettings())
  return getClipboardSettings()
}

function removeExpiredSensitiveItems() {
  const items = readItems()
  const now = Date.now()
  const live = items.filter(item => !isSensitiveClipboardExpired(item, now))
  if (live.length !== items.length) writeItems(live)
  return items.length - live.length
}

export function useClipboardItem(id, { confirmSensitive = false, mode = 'content', index } = {}) {
  const items = readItems()
  const item = items.find(entry => entry.id === id)
  if (!item || item.deletedAt) throw new Error('剪贴板条目不存在')
  if (item.sensitivity === 'secret' && !confirmSensitive) throw new Error('敏感内容需要确认后才能使用')
  if (item.expiresAt && Date.parse(item.expiresAt) <= Date.now()) throw new Error('敏感内容已过期')
  if (!['content', 'path', 'text'].includes(mode)) throw clipboardAiError('CLIPBOARD_COPY_MODE_INVALID')
  const text = decrypt(item.plainText)
  if (mode === 'path') {
    if (!item.filePaths?.length) throw clipboardAiError('CLIPBOARD_NO_FILE_PATH')
    if (index !== undefined && (!Number.isInteger(index) || index < 0 || index >= item.filePaths.length)) throw clipboardAiError('CLIPBOARD_NO_FILE_PATH')
    clipboard.writeText(index === undefined ? item.filePaths.join('\n') : item.filePaths[index])
  } else if (mode === 'text') {
    if (!text) throw clipboardAiError('CLIPBOARD_NO_TEXT')
    clipboard.writeText(text)
  } else if (item.kind === 'mixed') {
    const escape = value => String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    const images = item.imagePaths?.length ? item.imagePaths : item.imagePath ? [item.imagePath] : []
    const files = [...new Set([...(item.filePaths || []), ...images])]
    if (files.some(file => !fs.existsSync(file))) throw clipboardAiError('CLIPBOARD_IMAGE_MISSING')
    const total = images.reduce((size, file) => size + fs.statSync(file).size, 0)
    if (total > 32 * 1024 * 1024) throw clipboardAiError('CLIPBOARD_IMAGE_TOO_LARGE')
    const htmlText = (item.parts?.length ? item.parts : [{ text, html: item.html }]).map(part => part.html || '<p>' + escape(part.text).replaceAll('\n', '<br>') + '</p>').join('')
    const htmlImages = images.map(file => '<p><img src="data:image/png;base64,' + fs.readFileSync(file).toString('base64') + '"></p>').join('')
    clipboard.write({ text: [text, ...(item.filePaths || [])].filter(Boolean).join('\n'), html: htmlText + htmlImages, ...(images.length ? { image: nativeImage.createFromPath(images[0]) } : {}) })
    if (files.length && !nativeClipboardAdapter?.writeFilePaths?.(files, { preserve: true })) throw clipboardAiError('CLIPBOARD_COPY_MODE_INVALID')
  } else if (item.filePaths?.length) {
    const missing = item.filePaths.filter(filePath => !fs.existsSync(filePath))
    if (missing.length) throw new Error(`部分源文件已不存在，无法粘贴：${missing.slice(0, 3).join('、')}`)
    if (!nativeClipboardAdapter?.writeFilePaths?.(item.filePaths)) throw new Error('当前系统不支持将文件放回系统剪贴板')
  } else if (item.imagePath) {
    if (!fs.existsSync(item.imagePath)) throw clipboardAiError('CLIPBOARD_IMAGE_MISSING')
    const image = nativeImage.createFromPath(item.imagePath)
    if (image.isEmpty()) throw clipboardAiError('CLIPBOARD_IMAGE_INVALID')
    clipboard.writeImage(image)
  } else if (item.html) {
    clipboard.write({ text, html: item.html })
  } else {
    clipboard.writeText(text)
  }
  suppressSequence = nativeClipboardAdapter?.getSequenceNumber?.() ?? null
  try { lastSignature = captureSignature() } catch {}
  item.usageCount = Number(item.usageCount || 0) + 1
  item.lastUsedAt = new Date().toISOString()
  writeItems(items)
  emit('clipboard-item-used', { id: item.id })
  return { ok: true, id: item.id }
}

export function updateClipboardItem(id, patch = {}) {
  const items = readItems()
  const item = items.find(entry => entry.id === id)
  if (!item || item.deletedAt) throw new Error('剪贴板条目不存在')
  if (item.sensitivity === 'secret' && (patch.tags || patch.category || patch.phrase)) throw clipboardAiError('CLIPBOARD_AI_SENSITIVE')
  if (Array.isArray(patch.tags)) item.tags = [...new Set(patch.tags.map(clipboardGroupName))].slice(0, 20)
  if (typeof patch.category === 'string') item.category = patch.category ? clipboardGroupName(patch.category) : ''
  if (typeof patch.note === 'string') item.note = item.sensitivity === 'secret' && patch.note.trim() ? encrypt(patch.note.trim().slice(0, 2000)) : patch.note.trim().slice(0, 2000)
  for (const key of ['pinned', 'favorite', 'phrase']) if (typeof patch[key] === 'boolean') item[key] = patch[key]
  if (typeof patch.plainText === 'string') {
    if (item.sensitivity === 'secret' || (!item.phrase && patch.editContent !== true) || !patch.plainText.trim() || patch.plainText.length > (item.kind === 'code' ? 2 * 1024 * 1024 : 24000)) throw clipboardAiError('CLIPBOARD_PHRASE_INVALID')
    const html = ['html', 'mixed'].includes(item.kind) && typeof patch.html === 'string' ? patch.html : ''
    if (html.length > 90_000_000) throw clipboardAiError('CLIPBOARD_PHRASE_INVALID')
    if (classifyClipboard(patch.plainText, html) === 'secret') throw clipboardAiError('CLIPBOARD_AI_SENSITIVE')
    item.plainText = item.kind === 'code' ? patch.plainText : patch.plainText.trim(); item.html = html; item.maskedPreview = item.plainText
    if (item.kind === 'code' && item.filePaths?.length) { item.originalFilePaths = [...item.filePaths]; item.filePaths = [] }
    if (patch.editContent === true && item.kind === 'html' && !html) item.kind = 'text'
    item.hash = crypto.createHash('sha256').update(JSON.stringify([item.plainText, item.html, item.imagePaths, item.filePaths])).digest('hex')
    delete item.savedNoteId; delete item.savedNoteHash; delete item.savedNoteSnapshotKey; delete item.ai
  }
  writeItems(items)
  return publicItem(item)
}

export function getClipboardOrganization() { return clipboardOrganization(readItems(), loadConfig().clipboardOrganization) }

export function batchClipboardItems({ ids, action, patch = {} } = {}) {
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string') || !['favorite', 'unfavorite', 'pin', 'unpin', 'organize', 'merge', 'delete'].includes(action)) throw clipboardAiError('CLIPBOARD_BATCH_INVALID')
  const items = readItems(), wanted = [...new Set(ids)]
  const selected = wanted.map(id => items.find(item => item.id === id && !item.deletedAt && (!item.expiresAt || Date.parse(item.expiresAt) > Date.now())))
  if (selected.some(item => !item)) throw clipboardAiError('CLIPBOARD_BATCH_STALE')
  if (['merge', 'organize'].includes(action) && selected.some(item => item.sensitivity === 'secret')) throw clipboardAiError('CLIPBOARD_BATCH_SENSITIVE')
  if (action === 'delete') return deleteClipboardItems(wanted)
  if (action === 'merge') {
    if (selected.length < 2 || selected.reduce((count, item) => count + (item.parts?.length || 1), 0) > 200) throw clipboardAiError('CLIPBOARD_BATCH_MERGE_LIMIT')
    const merged = selected.reduce((first, second) => mergeClipboardItems(first, second))
    const now = new Date().toISOString()
    Object.assign(merged, { id: crypto.randomUUID(), sourceApp: 'friday-merge', capturedAt: now, updatedAt: now, favorite: false, pinned: false, phrase: false, usageCount: 0, tags: [], category: '', note: '', ai: undefined, savedNoteId: undefined, manualOrder: Date.now() })
    writeItems([merged, ...items])
    emit('clipboard-item-added', publicItem(merged))
    return publicItem(merged)
  }
  let category, tags
  if (action === 'organize') {
    if (patch.category !== undefined) category = patch.category === '' ? '' : clipboardGroupName(patch.category)
    if (!Array.isArray(patch.tags)) throw clipboardAiError('CLIPBOARD_BATCH_INVALID')
    tags = [...new Set(patch.tags.map(clipboardGroupName))]
  }
  // 先校验整批，再一次写入；避免中途失败造成部分条目已修改。
  const changes = selected.map(item => {
    if (action !== 'organize') return { [action.includes('favorite') ? 'favorite' : 'pinned']: ['favorite', 'pin'].includes(action) }
    const nextTags = [...new Set([...(item.tags || []), ...tags])]
    if (nextTags.length > 20) throw clipboardAiError('CLIPBOARD_BATCH_TAG_LIMIT')
    return { ...(category !== undefined ? { category } : {}), tags: nextTags }
  })
  selected.forEach((item, index) => Object.assign(item, changes[index]))
  writeItems(items)
  emit('clipboard-item-added', { ids: wanted })
  return { ok: true, count: selected.length }
}

export function manageClipboardGroup({ type, action, name, nextName } = {}) {
  if (!['categories', 'tags'].includes(type) || !['create', 'rename', 'delete'].includes(action)) throw clipboardAiError('CLIPBOARD_GROUP_INVALID')
  name = clipboardGroupName(name)
  const config = loadConfig(), groups = getClipboardOrganization()
  if (action !== 'delete') {
    nextName = action === 'create' ? name : clipboardGroupName(nextName)
    if (groups[type].some(entry => entry.toLocaleLowerCase() === nextName.toLocaleLowerCase() && (action === 'create' || entry !== name))) throw clipboardAiError('CLIPBOARD_GROUP_EXISTS')
  }
  if (action === 'create') groups[type].push(nextName)
  else {
    groups[type] = groups[type].filter(entry => entry !== name)
    if (action === 'rename') groups[type].push(nextName)
    const items = readItems()
    for (const item of items) {
      if (type === 'categories' && item.category === name) item.category = action === 'rename' ? nextName : ''
      if (type === 'tags' && item.tags?.includes(name)) item.tags = [...new Set(item.tags.flatMap(tag => tag === name ? action === 'rename' ? [nextName] : [] : [tag]))]
    }
    writeItems(items)
  }
  saveConfig({ ...config, clipboardOrganization: groups })
  return groups
}

export function createClipboardPhrase({ text, category = '', tags = [] } = {}) {
  if (typeof text !== 'string' || !text.trim() || text.length > 24000) throw clipboardAiError('CLIPBOARD_PHRASE_INVALID')
  if (classifyClipboard(text) === 'secret') throw clipboardAiError('CLIPBOARD_AI_SENSITIVE')
  const now = new Date().toISOString()
  const item = { id: crypto.randomUUID(), kind: 'text', plainText: text.trim(), html: '', imagePath: null, filePaths: [], sourceApp: 'friday-phrase', capturedAt: now, hash: crypto.createHash('sha256').update(text.trim()).digest('hex'), tags: tags.map(clipboardGroupName).slice(0, 20), category: category ? clipboardGroupName(category) : '', pinned: false, favorite: true, phrase: true, usageCount: 0, sensitivity: 'normal', maskedPreview: text.trim(), expiresAt: null, deletedAt: null }
  writeItems([item, ...readItems()])
  emit('clipboard-item-added', publicItem(item))
  return publicItem(item)
}

export function listClipboardAiOptions() {
  const config = loadConfig()
  const models = (config.customModels || []).filter(model => model.apiKey && model.baseUrl && model.modelName)
  return { models: models.map(model => ({ id: model.id, name: model.name || model.modelName })), transcriptionModels: models.filter(model => transcriptionCapability(model).supported !== false).map(model => ({ id: model.id, name: model.name || model.modelName })), notebooks: getNotebooks().map(book => ({ id: book.id, name: book.name })), defaultModelId: config.selectedModelId || '' }
}

async function ocrClipboardImage(image) {
  const temporary = path.join(mediaDir(), 'ocr-' + crypto.randomUUID() + '.png')
  try { await fs.promises.writeFile(temporary, Buffer.from(image.dataUrl.split(',')[1], 'base64')); return await recognizeImage(temporary) }
  finally { await fs.promises.rm(temporary, { force: true }) }
}

export async function clipboardToNote(id) {
  const item = readItems().find(entry => entry.id === id)
  if (!item || item.deletedAt || item.sensitivity === 'secret' || classifyClipboard(item.plainText, item.html) === 'secret') throw clipboardAiError('CLIPBOARD_AI_SENSITIVE')
  const existing = item.savedNoteId ? getNote(item.savedNoteId) : null
  if (existing && clipboardSavedNoteMatches(item)) return { noteId: existing.id, warnings: [] }
  const config = loadConfig(), revision = clipboardNoteRevision(item)
  const content = await prepareClipboardNoteContent(item, { getImage: getClipboardImage, language: config.language })
  const items = readItems(), current = items.find(entry => entry.id === id)
  if (!current || current.deletedAt || clipboardNoteRevision(current) !== revision) throw clipboardAiError('CLIPBOARD_AI_CONTENT_CHANGED')
  const note = saveClipboardNote(current, { ...content, title: content.text.trim().split(/\r?\n/)[0].trim().slice(0, 60) || (config.language === 'en-US' ? 'Clipboard image' : '剪贴板图片'), notebookId: preferences.aiNotebookId, language: config.language })
  current.savedNoteId = note.id; current.savedNoteHash = current.hash; current.savedNoteSnapshotKey = clipboardNoteSnapshotKey(current); writeItems(items)
  emit('resource-changed', { kind: 'note', id: note.id })
  return { noteId: note.id, warnings: content.warnings }
}

export function deleteClipboardItems(ids = []) {
  const wanted = new Set(ids)
  const items = readItems()
  const removed = items.filter(item => wanted.has(item.id) && !item.deletedAt)
  for (const item of removed) { item.deletedAt = new Date().toISOString(); revokeClipboardResourceShares(item.id) }
  writeItems(items)
  for (const item of removed) recordClipboardDeletion(item)
  emit('trash-changed', { kind: 'clipboard', count: removed.length })
  return { ok: true, count: removed.length }
}

export function startClipboardCapture(win) {
  mainWindow = win
  if (timer || stopNativeWatch) return
  // Windows 延迟渲染或其他应用短暂占用时，通知可能只到达一次，必须重试同一次采集。
  const capture = (attempt = 0) => {
    clearTimeout(captureRetryTimer); captureRetryTimer = null
    try { captureClipboard() } catch (error) {
      if (error.code === 'CLIPBOARD_BUSY' && attempt < 6) captureRetryTimer = setTimeout(() => capture(attempt + 1), 40 * (attempt + 1))
      else emit('capability-error', { code: 'CLIPBOARD_CAPTURE_FAILED', stage: 'capture', recoverable: true, nextStep: 'retry' })
    }
  }
  // 外部系统监听、轮询、托盘、录屏目录监听和全局快捷键在本轮明确关闭。
  nativeClipboardAdapter = null
  stopNativeWatch = null
  timer = null
  recordings?.stop(); recordings = null
  desktop?.stop(); desktop = null
  try { if (registeredShortcut) globalShortcut.unregister(registeredShortcut) } catch {}
  registeredShortcut = ''
}

export function stopClipboardCapture() {
  desktop?.stop(); desktop = null
  recordings?.stop(); recordings = null
  pins?.stop(); pins = null
  assets?.close(); assets = null
  appendState = { enabled: false, targetId: null, count: 0 }
  analyzer?.stop(); analyzer = null
  if (timer) clearInterval(timer)
  clearTimeout(captureRetryTimer); captureRetryTimer = null
  if (expiryTimer) clearInterval(expiryTimer)
  if (typeof stopNativeWatch === 'function') stopNativeWatch()
  stopNativeWatch = null
  nativeClipboardAdapter = null
  suppressSequence = null
  timer = null
  expiryTimer = null
  try { if (registeredShortcut) globalShortcut.unregister(registeredShortcut) } catch {}
  registeredShortcut = ''
  mainWindow = null
}

export function registerClipboardCommands(win) {
  mainWindow = win
  assets = createClipboardAssetServer(id => readItems().find(item => item.id === id))
  pins = createClipboardPins(() => mainWindow, id => { const item = readItems().find(item => item.id === id); return item ? publicItem(item) : null })
  preferences = normalizeClipboardSettings(loadConfig().clipboard)
  desktop = createClipboardDesktop({ getMainWindow: () => mainWindow, getItem: id => readItems().find(item => item.id === id), listItems: () => listClipboardItems(), useItem: useClipboardItem, getSettings: () => ({ ...preferences }), setSettings: saveClipboardSettings, getLanguage: () => loadConfig().language })
  analyzer = createClipboardAnalyzer({
    getItem: id => readItems().find(item => item.id === id),
    patchItem: (id, patch) => { const items = readItems(), item = items.find(entry => entry.id === id); if (item && !item.deletedAt) { Object.assign(item, patch); writeItems(items) } },
    getSettings: () => ({ ...preferences, language: loadConfig().language }),
    getModel: id => { const config = loadConfig(); return (config.customModels || []).find(model => model.id === (id || config.selectedModelId)) },
    prepareContent: (item, { settings, ...options }) => prepareClipboardAiContent(item, { ...options, getImage: getClipboardImage, language: loadConfig().language, transcriptionModelId: settings.aiTranscriptionModelId }),
    getImage: id => getClipboardImage({ id, thumbnail: false }), ocr: ocrClipboardImage,
    notify: progress => { emit('clipboard-ai-progress', progress); if (progress.noteId) emit('resource-changed', { kind: 'note', id: progress.noteId }) }
  })
  removeExpiredSensitiveItems()
  enforceHistoryRetention()
  if (!expiryTimer) expiryTimer = setInterval(() => {
    try { removeExpiredSensitiveItems(); enforceHistoryRetention() } catch (error) {
      emit('capability-error', { code: error.code || 'CLIPBOARD_EXPIRY_CLEANUP_FAILED', message: error.message, stage: 'clipboard-expiry', recoverable: true, nextStep: 'retry' })
    }
  }, EXPIRY_CLEANUP_MS)
  ipcMain.handle('clipboard-note-open', (_event, args) => { if (!getNote(args?.noteId)) throw clipboardAiError('CLIPBOARD_AI_UNAVAILABLE'); return { ok: true, noteId: args.noteId } })
  const externalUnavailable = () => { throw Object.assign(new Error('CLIPBOARD_EXTERNAL_DEFERRED'), { code: 'CLIPBOARD_EXTERNAL_DEFERRED' }) }
  ipcMain.handle('clipboard-quick-open', externalUnavailable)
  ipcMain.handle('clipboard-quick-hide', externalUnavailable)
  ipcMain.handle('clipboard-quick-full', externalUnavailable)
  ipcMain.handle('clipboard-desktop-state', () => ({ target: { available: false, label: '' }, queue: { active: false, paused: false, armed: false, shortcut: '' }, supported: false, trayAvailable: false, capabilities: { ...clipboardCapabilities } }))
  ipcMain.handle('clipboard-paste', (_event, args) => useClipboardItem(args?.id, { confirmSensitive: args?.confirmSensitive === true, mode: args?.mode || 'content', index: args?.index }))
  ipcMain.handle('clipboard-queue-start', externalUnavailable)
  ipcMain.handle('clipboard-queue-next', externalUnavailable)
  ipcMain.handle('clipboard-queue-pause', externalUnavailable)
  ipcMain.handle('clipboard-queue-skip', externalUnavailable)
  ipcMain.handle('clipboard-queue-cancel', externalUnavailable)
  ipcMain.handle('clipboard-queue-arm', externalUnavailable)
  ipcMain.handle('clipboard-capture-internal', () => captureClipboard({ internal: true }))
  ipcMain.handle('clipboard-list', (_event, args) => listClipboardItems(args || {}))
  ipcMain.handle('clipboard-append-get', () => getClipboardAppend())
  ipcMain.handle('clipboard-append-set', (_event, args) => setClipboardAppend(args?.enabled))
  ipcMain.handle('clipboard-open-link', async (_event, args) => {
    const item = readItems().find(entry => entry.id === args?.id)
    if (!item || item.deletedAt || item.sensitivity === 'secret') throw clipboardAiError('CLIPBOARD_LINK_INVALID')
    let url
    try { url = new URL(item.plainText.trim()) } catch { throw clipboardAiError('CLIPBOARD_LINK_INVALID') }
    if (!['http:', 'https:'].includes(url.protocol)) throw clipboardAiError('CLIPBOARD_LINK_INVALID')
    await shell.openExternal(url.href)
    return { ok: true }
  })
  ipcMain.handle('clipboard-file-open', async (_event, args) => {
    const item = readItems().find(entry => entry.id === args?.id)
    const index = args?.index ?? 0
    if (!item || item.deletedAt || item.sensitivity === 'secret' || !Number.isInteger(index) || index < 0) throw clipboardAiError('CLIPBOARD_FILE_UNAVAILABLE')
    const file = item.filePaths?.[index]
    if (!file || !fs.existsSync(file)) throw clipboardAiError('CLIPBOARD_FILE_MISSING')
    if (args?.mode === 'folder') shell.showItemInFolder(path.resolve(file))
    else if (args?.mode === 'open') { const error = await shell.openPath(path.resolve(file)); if (error) throw clipboardAiError('CLIPBOARD_FILE_OPEN_FAILED') }
    else throw clipboardAiError('CLIPBOARD_COPY_MODE_INVALID')
    return { ok: true }
  })
  ipcMain.handle('clipboard-image', (_event, args) => getClipboardImage(args || {}))
  ipcMain.handle('clipboard-image-save', (_event, args) => saveClipboardImage(args || {}))
  ipcMain.handle('clipboard-asset', (_event, args) => getClipboardAsset(args?.id, args?.index ?? 0))
  ipcMain.handle('clipboard-pin-open', externalUnavailable)
  ipcMain.handle('clipboard-pin-state', event => pins.state(event.sender))
  ipcMain.handle('clipboard-pin-mode', externalUnavailable)
  ipcMain.handle('clipboard-pin-close', externalUnavailable)
  ipcMain.handle('clipboard-reorder', (_event, args) => reorderClipboardItem(args?.id, args?.beforeId, args?.after === true))
  ipcMain.handle('clipboard-share-create', externalUnavailable)
  ipcMain.handle('clipboard-share-revoke', externalUnavailable)
  ipcMain.handle('clipboard-secret-reveal', (_event, args) => revealClipboardSecret(args?.id))
  ipcMain.handle('clipboard-settings-get', () => getClipboardSettings())
  ipcMain.handle('clipboard-settings-save', (_event, args) => saveClipboardSettings(args))
  ipcMain.handle('clipboard-clear', () => deleteClipboardItems(readItems().filter(item => !item.deletedAt && !item.pinned && !item.favorite && !item.phrase).map(item => item.id)))
  ipcMain.handle('clipboard-organization-get', () => getClipboardOrganization())
  ipcMain.handle('clipboard-group-manage', (_event, args) => manageClipboardGroup(args))
  ipcMain.handle('clipboard-phrase-create', (_event, args) => createClipboardPhrase(args))
  ipcMain.handle('clipboard-ai-options', () => listClipboardAiOptions())
  ipcMain.handle('clipboard-ai-analyze', (_event, args) => analyzer.enqueue(args?.id, false))
  ipcMain.handle('clipboard-to-note', (_event, args) => clipboardToNote(args?.id))
  ipcMain.handle('clipboard-use', (_event, args) => useClipboardItem(args?.id, { confirmSensitive: args?.confirmSensitive === true, mode: args?.mode || 'content', index: args?.index }))
  ipcMain.handle('clipboard-update', (_event, args) => updateClipboardItem(args?.id, args || {}))
  ipcMain.handle('clipboard-batch', (_event, args) => batchClipboardItems(args))
  ipcMain.handle('clipboard-delete', (_event, args) => deleteClipboardItems(args?.ids || []))
}
