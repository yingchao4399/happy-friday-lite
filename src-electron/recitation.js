import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { getDataDir, loadConfig } from './config.js'
import { queryAllRaw, flushDb } from './db.js'
import { transcribeMedia } from './rag/mediaTranscription.js'
import { transcriptionCapability } from './model-capabilities.js'

function root() { return path.join(getDataDir(), 'recitation') }
function storePath() { return path.join(root(), 'sessions.json') }
function readStore() {
  let rows = queryAllRaw('SELECT payload FROM recitation_sessions')
  if (!rows.length && fs.existsSync(storePath())) {
    let legacy
    try { legacy = JSON.parse(fs.readFileSync(storePath(), 'utf8')) } catch { throw new Error('背诵历史无法解析，原文件已保留，请从备份恢复') }
    if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) throw new Error('背诵历史格式不正确，原文件已保留')
    for (const item of Object.values(legacy)) {
      if (!item?.id || typeof item.filePath !== 'string') throw new Error('背诵历史包含无效会话，原文件已保留')
    }
    for (const item of Object.values(legacy)) writeSession(item)
    flushDb()
    fs.renameSync(storePath(), `${storePath()}.migrated`)
    rows = queryAllRaw('SELECT payload FROM recitation_sessions')
  }
  return Object.fromEntries(rows.map(row => { const item = JSON.parse(row.payload); return [item.id, item] }))
}
function writeSession(item) {
  queryAllRaw('BEGIN IMMEDIATE')
  try {
    queryAllRaw('INSERT OR REPLACE INTO recitation_sessions VALUES (?, ?, ?)', [item.id, JSON.stringify(item), item.updatedAt])
    queryAllRaw('DELETE FROM recitation_segments WHERE sessionId = ?', [item.id])
    for (const [index, segment] of (item.segments || []).entries()) queryAllRaw('INSERT INTO recitation_segments VALUES (?, ?, ?)', [item.id, index, JSON.stringify(segment)])
    queryAllRaw('COMMIT')
  } catch (error) { queryAllRaw('ROLLBACK'); throw error }
}

export function listRecitationModels() {
  return (loadConfig().customModels || []).filter(model => model.id && model.apiKey && model.baseUrl && model.modelName && transcriptionCapability(model).supported !== false).map(model => ({ id: model.id, name: model.name || model.modelName }))
}

export function importRecitationAudio(filePath) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('音频文件不存在')
  const stat = fs.statSync(filePath)
  if (!stat.isFile() || !stat.size) throw new Error('请选择非空音频文件')
  if (stat.size > 25 * 1024 * 1024) throw new Error('音频超过 25 MB，请先分段后上传')
  const ext = path.extname(filePath).slice(1).toLowerCase()
  if (!['mp3', 'wav', 'm4a', 'mpeg', 'mpga', 'webm', 'ogg', 'flac'].includes(ext)) throw new Error('暂不支持该音频格式')
  const id = crypto.randomUUID()
  const target = path.join(root(), `${id}.${ext}`)
  fs.mkdirSync(root(), { recursive: true })
  fs.copyFileSync(filePath, target)
  const now = new Date().toISOString()
  const session = { id, filePath: target, name: path.basename(filePath), status: 'ready', transcript: '', analysis: null, createdAt: now, updatedAt: now }
  writeSession(session)
  return { ...session, filePath: undefined }
}

export function analyzeRecitation(text, { durationSeconds = 0, segments = [], referenceText = '' } = {}) {
  const value = String(text || '').trim()
  const units = value ? value.split(/[\s，。！？、；：,.!?;:]+/).filter(Boolean) : []
  const words = value.replace(/\s/g, '').length
  const pace = durationSeconds > 0 ? Math.round(words / (durationSeconds / 60)) : null
  const repeated = []
  for (let i = 1; i < units.length; i++) if (units[i] === units[i - 1]) repeated.push(units[i])
  const confidenceValues = segments.map(segment => segment.confidence).filter(value => Number.isFinite(value))
  const gaps = segments.slice(1).map((segment, index) => Math.max(0, segment.start - segments[index].end))
  const normalized = source => String(source || '').normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
  const reference = normalized(referenceText)
  let alignment = null
  if (reference) {
    const actual = normalized(value)
    if (Math.max(reference.length, actual.length) > 5000) alignment = { status: 'too_long' }
    else {
      let previous = Array.from({ length: actual.length + 1 }, (_, index) => index)
      for (let row = 1; row <= reference.length; row++) {
        const current = [row]
        for (let column = 1; column <= actual.length; column++) current[column] = Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + Number(reference[row - 1] !== actual[column - 1]))
        previous = current
      }
      const distance = previous[actual.length]
      alignment = { status: 'aligned', referenceCharacters: reference.length, matchedCharacters: Math.max(0, Math.min(reference.length, actual.length) - distance), editDistance: distance, accuracy: reference.length ? Math.max(0, 1 - distance / reference.length) : null, method: 'normalized_character_edit_distance' }
    }
  }
  return {
    characterCount: words, segmentCount: segments.length || units.length, durationSeconds: durationSeconds || null,
    pacePerMinute: pace, pauseCount: gaps.filter(gap => gap >= 0.8).length,
    totalPauseSeconds: Math.round(gaps.reduce((sum, gap) => sum + gap, 0) * 10) / 10,
    voicedSeconds: Math.round(segments.reduce((sum, segment) => sum + Math.max(0, segment.end - segment.start), 0) * 10) / 10,
    repeatedSegments: [...new Set(repeated)], repetitionCount: null,
    confidence: confidenceValues.length ? confidenceValues.reduce((sum, item) => sum + item, 0) / confidenceValues.length : null,
    evidence: segments.length ? 'timestamped_segments' : 'transcript_only', alignment
  }
}

export function listRecitations() { return Object.values(readStore()).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).map(({ filePath, ...item }) => ({ ...item, audioPath: filePath })) }

export function getRecitation(id) { const item = readStore()[id]; if (!item) throw new Error('背诵会话不存在'); const { filePath, ...safe } = item; return safe }

export function readRecitationAudio(id) {
  const item = readStore()[id]
  const fail = () => { throw Object.assign(new Error('RECITATION_AUDIO_MISSING'), { code: 'RECITATION_AUDIO_MISSING' }) }
  if (!item?.filePath || !fs.existsSync(item.filePath)) fail()
  const managed = fs.realpathSync(root()), filename = fs.realpathSync(item.filePath)
  const relative = path.relative(managed, filename)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail()
  const stat = fs.statSync(filename)
  const mime = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', mpeg: 'audio/mpeg', mpga: 'audio/mpeg', webm: 'audio/webm', ogg: 'audio/ogg', flac: 'audio/flac' }[path.extname(filename).slice(1).toLowerCase()]
  if (!stat.isFile() || !stat.size || stat.size > 25 * 1024 * 1024 || !mime) fail()
  return { bytes: fs.readFileSync(filename), mime }
}

export async function transcribeRecitation(id, modelId = 'windows-local', referenceText = '', { signal, onProgress = () => {} } = {}) {
  const store = readStore(); const item = store[id]
  if (!item || !fs.existsSync(item.filePath)) throw new Error('背诵音频不存在')
  if (activeSessions.has(id)) throw new Error('这段音频正在转写，请等待完成')
  const previous = structuredClone(item)
  activeSessions.add(id)
  const progress = stage => { signal?.throwIfAborted(); onProgress({ stage }) }
  try {
    progress('validating')
    item.status = 'transcribing'; item.error = null; item.updatedAt = new Date().toISOString(); writeSession(item)
    progress('transcribing')
    const record = await transcribeMedia(item.filePath, modelId, signal)
    item.transcript = record.text
    item.rawTranscript = record.text
    item.rawSegments = structuredClone(record.segments || [])
    item.status = 'analyzed'
    item.referenceText = String(referenceText || '')
    progress('analyzing')
    item.analysis = analyzeRecitation(record.text, { durationSeconds: record.durationSeconds, segments: record.segments, referenceText: item.referenceText })
    item.segments = record.segments || []
    item.transcription = { modelId: record.modelId, extraction: record.extraction, transcribedAt: record.transcribedAt }
    progress('generating-study')
    item.study = buildRecitationStudy(record.text, item.segments, item.analysis)
    item.updatedAt = new Date().toISOString()
    progress('saving'); writeSession(item); onProgress({ stage: 'complete' })
    const { filePath, ...safe } = item
    return { ...safe, audioPath: filePath }
  } catch (error) {
    // 重试失败不能覆盖此前已保存的有效转写/校对结果。
    previous.status = 'error'; previous.error = signal?.aborted ? 'MEDIA_TRANSCRIPTION_CANCELLED' : error.message; previous.updatedAt = new Date().toISOString(); writeSession(previous)
    throw error
  } finally { activeSessions.delete(id) }
}

const activeSessions = new Set()

// 本机整理与练习只摘取原文；题目保存来源，不用猜测知识性结论。
export function buildRecitationStudy(text, segments = [], analysis = {}) {
  const source = segments.length ? segments : String(text || '').split(/(?<=[。！？.!?])\s*|\n+/u).filter(Boolean).map(text => ({ text, start: null, end: null }))
  const points = source.map((segment, index) => ({ id: index, text: segment.text, start: segment.start, end: segment.end })).filter(point => point.text?.trim())
  const tokens = String(text || '').match(/[\p{Script=Han}]{2,6}|[A-Za-z]{4,}/gu) || []
  const counts = new Map()
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1)
  const keywords = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([word]) => word)
  const questions = []
  for (const point of points.slice(0, 6)) {
    const answer = (point.text.match(/[\p{Script=Han}]{2,6}|[A-Za-z]{3,}/u) || [])[0]
    if (answer) {
      questions.push({ type: 'blank', prompt: point.text.replace(answer, '______'), answer, source: point })
      const alternatives = [...new Set(points.filter(other => other.id !== point.id).map(other => (other.text.match(/[\p{Script=Han}]{2,6}|[A-Za-z]{3,}/u) || [])[0]).filter(word => word && word !== answer))].slice(0, 3)
      if (alternatives.length >= 2) questions.push({ type: 'choice', prompt: point.text.replace(answer, '______'), answer, options: [...alternatives, answer].sort(), source: point })
    }
    questions.push({ type: 'recall', prompt: point.text.slice(0, 16), answer: point.text, source: point })
  }
  const focus = points.filter(point => typeof segments[point.id]?.confidence === 'number' && segments[point.id].confidence < 0.65 && !segments[point.id].corrected).map(point => point.id)
  return { method: 'source_extraction', title: points[0]?.text.slice(0, 30) || '', paragraphs: points.map(point => point.text), points: points.slice(0, 12), keywords, questions, plan: [
    { afterHours: 0, action: 'verify', sourceIds: focus.length ? focus : points.slice(0, 3).map(point => point.id) },
    { afterHours: 24, action: 'recall', sourceIds: points.map(point => point.id) },
    { afterHours: 72, action: 'record', sourceIds: points.map(point => point.id) }
  ], alignmentAvailable: analysis.alignment?.status === 'aligned' }
}

export function reanalyzeRecitation(id, referenceText = '') {
  const item = readStore()[id]
  if (!item?.transcript) throw new Error('请先完成音频转写')
  if (activeSessions.has(id)) throw new Error('音频正在转写，请等待完成')
  item.referenceText = String(referenceText)
  item.analysis = analyzeRecitation(item.transcript, { durationSeconds: item.analysis?.durationSeconds, segments: item.segments || [], referenceText: item.referenceText })
  item.study = buildRecitationStudy(item.transcript, item.segments || [], item.analysis)
  item.updatedAt = new Date().toISOString()
  writeSession(item)
  return { ...item, audioPath: item.filePath, filePath: undefined }
}

// 人工校对只修改工作转写；原始识别、时间戳和模型置信度保留，不能伪造为 100%。
export function correctRecitationTranscript(id, { texts, expectedUpdatedAt, referenceText } = {}) {
  const fail = code => { throw Object.assign(new Error(code), { code }) }
  const item = readStore()[id]
  if (!item?.transcript) fail('RECITATION_TRANSCRIPT_REQUIRED')
  if (activeSessions.has(id)) fail('RECITATION_SESSION_BUSY')
  if (typeof expectedUpdatedAt !== 'string' || item.updatedAt !== expectedUpdatedAt) fail('RECITATION_TRANSCRIPT_CHANGED')
  const count = item.segments?.length || 1
  if (!Array.isArray(texts) || texts.length !== count || texts.some(text => typeof text !== 'string') || texts.join('').length > 1_000_000 || !texts.some(text => text.trim())) fail('RECITATION_CORRECTION_INVALID')
  if (referenceText !== undefined && (typeof referenceText !== 'string' || referenceText.length > 100_000)) fail('RECITATION_CORRECTION_INVALID')
  item.rawTranscript ??= item.transcript
  item.rawSegments ??= structuredClone(item.segments || [])
  item.transcript = texts.map(text => text.trim()).filter(Boolean).join('\n')
  if (item.segments?.length) item.segments = item.segments.map((segment, index) => ({ ...segment, text: texts[index].trim(), corrected: texts[index].trim() !== item.rawSegments[index]?.text }))
  item.referenceText = referenceText ?? item.referenceText ?? ''
  item.analysis = analyzeRecitation(item.transcript, { durationSeconds: item.analysis?.durationSeconds, segments: item.segments || [], referenceText: item.referenceText })
  item.study = buildRecitationStudy(item.transcript, item.segments || [], item.analysis)
  item.updatedAt = new Date(Math.max(Date.now(), (Date.parse(item.updatedAt) || 0) + 1)).toISOString()
  writeSession(item)
  const { filePath, ...safe } = item
  return { ...safe, audioPath: filePath }
}
