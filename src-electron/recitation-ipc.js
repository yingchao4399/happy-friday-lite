import crypto from 'node:crypto'
import { commandFailure } from './capability-result.js'
import { importRecitationAudio, listRecitations, listRecitationModels, transcribeRecitation, reanalyzeRecitation, correctRecitationTranscript, readRecitationAudio } from './recitation.js'

export function registerRecitationCommands(ipcMain) {
  const active = new Map()
  const send = (sender, channel, payload) => { if (!sender.isDestroyed()) sender.send(channel, payload) }
  ipcMain.handle('recitation-list', () => listRecitations())
  ipcMain.handle('recitation-models', () => listRecitationModels())
  ipcMain.handle('recitation-audio', (_event, args) => readRecitationAudio(args?.id))
  ipcMain.handle('recitation-import', (event, args) => {
    const result = importRecitationAudio(args?.filePath)
    send(event.sender, 'resource-changed', { kind: 'recitation', action: 'import', id: result.id })
    return result
  })
  ipcMain.handle('recitation-analyze', (event, args) => {
    const result = reanalyzeRecitation(args?.id, args?.referenceText || '')
    send(event.sender, 'resource-changed', { kind: 'recitation', action: 'analyze', id: result.id })
    return result
  })
  ipcMain.handle('recitation-correct', (event, args) => {
    const result = correctRecitationTranscript(args?.id, args)
    send(event.sender, 'resource-changed', { kind: 'recitation', action: 'correct', id: result.id })
    return result
  })
  ipcMain.handle('recitation-cancel', (event, args) => {
    const task = active.get(args?.id)
    if (task?.senderId === event.sender.id) task.controller.abort()
    return { ok: true }
  })
  ipcMain.handle('recitation-transcribe', async (event, args) => {
    if (active.has(args?.id)) throw Object.assign(new Error('RECITATION_SESSION_BUSY'), { code: 'RECITATION_SESSION_BUSY' })
    const controller = new AbortController(), taskId = crypto.randomUUID()
    active.set(args?.id, { controller, senderId: event.sender.id })
    const destroyed = () => controller.abort()
    event.sender.once('destroyed', destroyed)
    let stage = 'validating'
    const progress = update => { stage = update.stage; send(event.sender, 'task-progress', { taskId, kind: 'recitation', id: args?.id, ...update }) }
    try {
      const result = await transcribeRecitation(args?.id, args?.modelId || 'windows-local', args?.referenceText || '', { signal: controller.signal, onProgress: progress })
      send(event.sender, 'resource-changed', { kind: 'recitation', action: 'transcribe', id: result.id })
      return result
    } catch (error) {
      const code = controller.signal.aborted ? 'MEDIA_TRANSCRIPTION_CANCELLED' : error.code || error.message?.match(/(?:MEDIA_TRANSCRIPTION|RECITATION)_[A-Z_]+/)?.[0] || 'RECITATION_FAILED'
      const failure = commandFailure({ code, message: code, stage, nextStep: code === 'MEDIA_TRANSCRIPTION_CHAT_ONLY' || code === 'MEDIA_TRANSCRIPTION_ENGINE_UNAVAILABLE' ? 'configure_transcription_model' : 'retry', recoverable: true, resource: args?.id })
      progress({ stage: controller.signal.aborted ? 'cancelled' : 'failed', error: failure.error })
      send(event.sender, 'capability-error', { kind: 'recitation', id: args?.id, ...failure.error })
      throw Object.assign(new Error(code), { code })
    } finally { event.sender.removeListener('destroyed', destroyed); active.delete(args?.id) }
  })
}
