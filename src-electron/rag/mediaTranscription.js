import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { getDataDir, loadConfig } from '../config.js'
import { normalizeOpenAIBaseUrl } from '../openaiUrl.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { transcriptionCapability } from '../model-capabilities.js'
const run = promisify(execFile)
const transcriptionError = (code, message) => Object.assign(new Error(`${code}: ${message}`), { code })

export const mediaFormats = ['mp3', 'wav', 'm4a', 'mp4', 'mpeg', 'mpga', 'webm', 'ogg', 'flac']
export function normalizeTranscriptionResult(result) {
  if (!result || typeof result.text !== 'string' || !result.text.trim()) throw transcriptionError('MEDIA_TRANSCRIPTION_RESULT_INVALID', '转写服务没有返回可用正文。')
  const duration = Number(result.duration)
  const hasDuration = Number.isFinite(duration) && duration > 0
  let previousEnd = 0
  const segments = Array.isArray(result.segments) ? result.segments.map(segment => {
    const start = Number(segment?.start), end = Number(segment?.end)
    const text = typeof segment?.text === 'string' ? segment.text.trim() : ''
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || start < previousEnd || (hasDuration && end > duration + 0.05)) throw transcriptionError('MEDIA_TRANSCRIPTION_RESULT_INVALID', '转写片段的时间戳无效，请检查模型兼容性或使用其他引擎。')
    const confidence = Number.isFinite(segment.confidence) ? segment.confidence : Number.isFinite(segment.avg_logprob) ? Math.exp(segment.avg_logprob) : null
    if (confidence !== null && (confidence < 0 || confidence > 1)) throw transcriptionError('MEDIA_TRANSCRIPTION_RESULT_INVALID', '模型返回了无效置信度。')
    previousEnd = end
    return { start, end, text, confidence }
  }) : []
  return { text: result.text.trim(), segments, durationSeconds: hasDuration ? duration : segments.at(-1)?.end ?? null }
}
const version = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function storeFile() { return path.join(getDataDir(), 'media-transcripts.json') }
function readStore() { try { return JSON.parse(fs.readFileSync(storeFile(), 'utf8')) } catch { return {} } }

export function readMediaTranscript(file) {
  const record = readStore()[file]
  if (!record || record.version !== version(file)) throw new Error('媒体尚未转写或文件已变化，请在预览中选择本机转写，或让 Friday 使用指定音频模型转写')
  return record
}

export async function transcribeMedia(file, modelId, signal, { persist = true } = {}) {
  const ext = path.extname(file).slice(1).toLowerCase()
  if (!mediaFormats.includes(ext)) throw new Error('此格式不支持音频转写')
  if (fs.statSync(file).size > 25 * 1024 * 1024) throw new Error('转写文件超过 25 MB，请先分段')
  const sourceVersion = version(file)
  let result
  let extraction = 'audio_transcription'
  if (!modelId || modelId === 'windows-local') {
    if (process.platform !== 'win32') throw new Error('本机语音引擎仅支持 Windows，请选择已配置的转写模型')
    const script = fileURLToPath(new URL('./windows-transcribe.ps1', import.meta.url))
    try {
      const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-MediaPath', file], {
        windowsHide: true, timeout: 240000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', ...(signal ? { signal } : {})
      })
      result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim())
    } catch (error) {
      if (signal?.aborted) throw transcriptionError('MEDIA_TRANSCRIPTION_CANCELLED', '转写已取消，可以重新开始。')
      if (error.killed || /timed out/i.test(error.stderr || '')) throw transcriptionError('MEDIA_TRANSCRIPTION_TIMEOUT', '本机转写超时，请将音频分段后重试。')
      if (/language pack unavailable/i.test(error.stderr || '')) throw transcriptionError('MEDIA_TRANSCRIPTION_ENGINE_UNAVAILABLE', '未找到本机语音识别语言包，请安装语言包或选择兼容的转写模型。')
      throw transcriptionError('MEDIA_TRANSCRIPTION_INVALID_AUDIO', '音频无法解码或识别，请检查文件及系统解码器，或转换为 PCM WAV 后重试。')
    }
    modelId = 'windows-local'
    extraction = 'windows_speech'
  } else {
    const config = loadConfig()
    const model = (config.customModels || []).find(item => item.id === modelId)
    if (!model?.apiKey || !model?.baseUrl || !model?.modelName) throw new Error('请选择已配置且支持 /audio/transcriptions 的模型')
    if (transcriptionCapability(model).supported === false) throw transcriptionError('MEDIA_TRANSCRIPTION_CHAT_ONLY', '当前聊天模型不提供音频转写，请选择本机语音或兼容的转写模型。')
    const form = new FormData()
    form.set('model', model.modelName)
    form.set('response_format', 'verbose_json')
    form.set('file', new Blob([fs.readFileSync(file)]), path.basename(file))
    const base = normalizeOpenAIBaseUrl(model.baseUrl).replace(/\/$/, '')
    const timeout = AbortSignal.timeout(120000)
    const response = await fetch(`${base}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${model.apiKey}` }, body: form, signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
    if (!response.ok) throw transcriptionError('MEDIA_TRANSCRIPTION_SERVICE_FAILED', `转写服务返回 HTTP ${response.status}，请检查接口、模型及鉴权设置。`)
    try { result = await response.json() }
    catch { throw transcriptionError('MEDIA_TRANSCRIPTION_RESULT_INVALID', '转写服务未返回有效 JSON，请检查接口兼容性。') }
  }
  if (signal?.aborted) throw new Error('转写已取消')
  if (version(file) !== sourceVersion) throw new Error('转写期间文件已变化，请重新转写')
  const record = { ...normalizeTranscriptionResult(result), version: sourceVersion, modelId, transcribedAt: new Date().toISOString(), extraction, ...(result.language ? { language: result.language } : {}) }
  // 剪贴板自动识别先在内存中检查敏感内容，未知隐私级别的转写不落入普通缓存。
  if (!persist) return record
  const store = readStore()
  store[file] = record
  const tmp = `${storeFile()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(store), 'utf8')
  fs.renameSync(tmp, storeFile())
  return record
}
