import fs from 'node:fs/promises'
import { load } from 'cheerio'
import { deliverOfficeArtifact, acknowledgeOfficeDelivery, officeFault, sha256, validateDocx, recoverOfficeDeliveries } from './artifact-delivery.js'
import { findOfficeOperation } from './operation-catalog.js'

const MAX_PDF_BYTES = 128 * 1024 * 1024
const abort = signal => { if (signal?.aborted) throw officeFault('OFFICE_OPERATION_CANCELLED') }
const terminal = task => ['completed', 'succeeded', 'failed', 'cancelled', 'interrupted'].includes(task.phase)
const operationKey = task => `${task.id}:${task.operationIdentity || ''}`
const operationScope = context => ({ actorId: typeof context.actor === 'string' ? context.actor : context.actor?.id, spaceId: context.spaceId })

export function sanitizeOfficeHtml(value) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > 8 * 1024 * 1024) throw officeFault('OFFICE_CONTENT_INVALID')
  const $ = load(value, {}, false)
  $('script,iframe,object,embed,link,meta,base,form,input,button,video,audio,svg,style').remove()
  $('*').each((_i, node) => {
    for (const name of Object.keys(node.attribs || {})) {
      const val = node.attribs[name]
      if (/^on/i.test(name) || ['srcset', 'formaction', 'action', 'srcdoc'].includes(name) || (name === 'style' && /url\s*\(|expression\s*\(|@import/i.test(val))) $(node).removeAttr(name)
    }
    if (node.attribs?.href && !/^(https?:|mailto:|#)/i.test(node.attribs.href)) $(node).removeAttr('href')
    if (node.attribs?.src && !/^data:image\/(?:png|jpeg|gif);base64,[a-z\d+/=\s]+$/i.test(node.attribs.src)) $(node).removeAttr('src')
  })
  if (!$.root().text().trim() && !$('img[src]').length) throw officeFault('OFFICE_CONTENT_EMPTY')
  return $.html()
}

export function officeConversionQuality(result = {}) {
  const pages = result.pageResults || []
  const imagePages = pages.filter(p => p.status === 'degraded' || p.status === 'scanned').map(p => p.page)
  const editablePages = pages.filter(p => p.status === 'ok' || p.status === 'ocr').map(p => p.page)
  return { level: !pages.length ? 'unknown' : !imagePages.length ? 'editable' : editablePages.length ? 'mixed' : 'imageOnly',
    pages: result.pages || pages.length, pageResults: pages, imagePages, editablePages,
    ocr: pages.some(p => p.status === 'ocr') ? 'used' : pages.some(p => p.status === 'scanned') ? 'unavailable-or-failed' : 'not-needed',
    warnings: result.warnings || [] }
}

/** 所有入口共用的领域执行器；不引用 Electron，便于对失败/取消/提交做真实故障注入。 */
export function createOfficeOperationService(adapters) {
  const { ledger, journalDir } = adapters
  const active = new Map()
  const sources = new Set()
  let running = 0
  async function update(taskId, patch, context) {
    const task = await ledger.update(taskId, patch, context)
    adapters.onTask?.(task)
    return task
  }
  async function execute(request, context) {
    let task, source, sourceKey, entered = false, sourceLocked = false, sourceAcquired = false
    let artifact = null
    let controller
    const releaseSourceSnapshotLock = async () => {
      let releaseError
      try {
        if (sourceAcquired) {
          // Mark first: a release callback can throw after decrementing its
          // shared Save-As depth, so retrying could release another operation.
          sourceAcquired = false
          await Promise.resolve(source?.release?.())
        }
      } catch (error) {
        releaseError = error
      } finally {
        if (sourceLocked) {
          sources.delete(sourceKey)
          sourceLocked = false
        }
      }
      if (releaseError) throw releaseError
    }
    const relay = () => controller?.abort()
    try {
      if (!findOfficeOperation({ operationId: request?.operationId, targetFormat: request?.target?.format })) throw officeFault('OFFICE_OPERATION_UNSUPPORTED')
      const capability = (await adapters.capabilities(context)).find(cap => cap.operationId === request.operationId)
      if (!capability?.available) throw officeFault(capability?.reasonCode || 'OFFICE_CAPABILITY_UNAVAILABLE')
      const created = await ledger.create({ request, context })
      task = created.task
      if (created.reused) return task.result || { ok: false, status: terminal(task) ? task.phase : 'task_pending', code: 'OFFICE_OPERATION_PENDING', taskId: task.id }
      if (running >= 2) throw officeFault('OFFICE_OPERATION_BUSY')
      running++
      entered = true
      controller = new AbortController()
      context.signal?.addEventListener('abort', relay, { once: true })
      if (context.signal?.aborted) relay()
      active.set(operationKey(task), controller)
      const signal = controller.signal
      const phase = async phase => { await update(task.id, { phase, operationIdentity: task.operationIdentity }, context) }
      abort(signal)
      let bytes, quality
      let html
      if (request.operationId === 'office.document.convert') {
        source = await adapters.resolveSource(request.source, context, signal)
        sourceKey = source.resourceId || source.filePath
        if (sources.has(sourceKey)) throw officeFault('OFFICE_SOURCE_BUSY')
        sources.add(sourceKey)
        sourceLocked = true
        await source.acquire?.({ signal })
        sourceAcquired = true
        await phase('snapshotting')
        const snapshot = await adapters.snapshotSource(source, { signal })
        bytes = Buffer.from(snapshot.bytes)
        if (!bytes.length || bytes.length > MAX_PDF_BYTES || !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw officeFault('OFFICE_PDF_SNAPSHOT_INVALID')
        if (request.source?.revision != null && String(request.source.revision) !== String(snapshot.revision)) throw officeFault('OFFICE_SOURCE_REVISION_CHANGED')
        source = { ...source, revision: snapshot.revision, sha256: sha256(bytes) }
        await source.assertCurrent?.()
        await source.snapshotComplete?.()
        // From this point onward the operation consumes immutable snapshot bytes;
        // conversion and delivery must not keep the editor or Save-As paused.
        await releaseSourceSnapshotLock()
        await update(task.id, { operationIdentity: task.operationIdentity, source: { resourceId: source.resourceId, revision: source.revision, sha256: source.sha256 } }, context)
      } else {
        if (request.content?.kind !== 'html-fragment') throw officeFault('OFFICE_CONTENT_KIND_UNSUPPORTED')
        html = sanitizeOfficeHtml(request.content.value)
      }
      abort(signal)
      const target = await adapters.selectTarget(request, context, source, task)
      if (!target) throw officeFault('OFFICE_OPERATION_CANCELLED')
      abort(signal)
      if (html != null) {
        await phase('importing')
        const serialized = await adapters.createDocx({ title: request.target.title, html }, { signal, onPhase: phase })
        bytes = serialized.bytes
        quality = { level: 'editable', nodeCount: serialized.nodeCount, warnings: [] }
      } else {
        await phase('converting')
        const converted = await adapters.convertSnapshot(bytes, { signal, onProgress: progress => adapters.onProgress?.(task.id, progress), context })
        bytes = converted.docx
        quality = officeConversionQuality(converted)
      }
      abort(signal)
      await phase('validating')
      validateDocx(bytes)
      artifact = await deliverOfficeArtifact({ bytes, target, taskId: task.id, operationIdentity: task.operationIdentity, scope: operationScope(context), journalDir, signal, onPhase: phase })
      artifact = { ...artifact, source: source ? { resourceId: source.resourceId, revision: source.revision, sha256: source.sha256 } : null, quality, open: { status: 'not-requested' } }
      // 先记录真实交付，打开编辑器是可独立重试的下一步。
      let result = { ok: true, status: 'succeeded', taskId: task.id, data: { path: artifact.path, artifact } }
      await update(task.id, { operationIdentity: task.operationIdentity, phase: 'completed', result, quality }, context)
      await acknowledgeOfficeDelivery({ journalDir, artifact }).catch(() => { /* 已持久交付，残留收据下次启动重新核验清理。 */ })
      if (request.options?.openAfterSave !== false) {
        try { artifact.open = await adapters.openArtifact(artifact, context) } catch (error) { artifact.open = { status: 'failed', code: error.code || 'OFFICE_OPEN_FAILED' } }
        result = { ...result, data: { path: artifact.path, artifact } }
        await update(task.id, { operationIdentity: task.operationIdentity, phase: 'completed', result }, context)
      }
      return result
    } catch (error) {
      if (artifact?.persisted) return { ok: true, status: 'succeeded', taskId: task?.id, data: { path: artifact.path, artifact }, code: 'OFFICE_DELIVERED_TASK_UPDATE_FAILED' }
      const cancelled = ['OFFICE_OPERATION_CANCELLED', 'OPERATION_CANCELED', 'OPERATION_CANCELLED'].includes(error.code) || error.name === 'AbortError'
      const result = { ok: false, status: cancelled ? 'cancelled' : 'failed', taskId: task?.id, code: error.code || 'OFFICE_OPERATION_FAILED',
        error: error.code || 'OFFICE_OPERATION_FAILED', ...(error.recoveryRequired ? { recoveryRequired: true, persisted: error.persisted === true, artifactPath: error.artifactPath } : {}) }
      if (task) await update(task.id, { operationIdentity: task.operationIdentity, phase: cancelled ? 'cancelled' : 'failed', result, error: { code: result.code }, recovery: result.recoveryRequired || false }, context).catch(() => {})
      return result
    } finally {
      context.signal?.removeEventListener('abort', relay)
      if (task && controller && active.get(operationKey(task)) === controller) active.delete(operationKey(task))
      if (entered) running--
      await releaseSourceSnapshotLock().catch(() => {})
    }
  }
  return {
    execute,
    get: (id, context) => ledger.get(id, context),
    async cancel(id, context) {
      const task = await ledger.get(id, context)
      if (terminal(task)) return task.result || { ok: true, taskId: id, status: task.phase }
      const controller = active.get(operationKey(task))
      if (controller) { controller.abort(); return { ok: true, taskId: id, status: 'cancelling' } }
      return { ok: false, taskId: id, status: 'interrupted', code: 'OFFICE_OPERATION_NOT_RUNNING' }
    },
    async reopen(id, context) {
      const tasks = await ledger.list(context)
      const task = tasks.find(task => task.id === id || task.result?.data?.artifact?.id === id)
      const artifact = task?.result?.data?.artifact
      if (!artifact?.persisted) throw officeFault('OFFICE_ARTIFACT_NOT_FOUND')
      const bytes = await fs.readFile(artifact.path)
      if (sha256(bytes) !== artifact.sha256) throw officeFault('OFFICE_ARTIFACT_CHANGED')
      validateDocx(bytes)
      artifact.open = await adapters.openArtifact(artifact, context)
      const result = { ...task.result, data: { ...task.result.data, artifact } }
      await update(task.id, { operationIdentity: task.operationIdentity, phase: 'completed', result }, context)
      return result
    },
    async recover(context) {
      const deliveries = await recoverOfficeDeliveries(journalDir, { scope: operationScope(context) })
      for (const delivery of deliveries) {
        if (!delivery.taskId) continue
        try {
          // 恢复必须定位原领域操作，不能把旧交付写进同一 Core 任务的后一笔操作。
          if (!delivery.operationIdentity) continue
          await ledger.get(delivery.taskId, context, delivery.operationIdentity)
          if (delivery.status === 'delivered') {
            const artifact = { ...delivery.artifact, open: { status: 'not-requested' }, quality: { level: 'unknown', warnings: ['RECOVERED_AFTER_INTERRUPTION'] } }
            await update(delivery.taskId, { operationIdentity: delivery.operationIdentity, phase: 'completed', result: { ok: true, status: 'succeeded', taskId: delivery.taskId, data: { path: artifact.path, artifact } } }, context)
            await acknowledgeOfficeDelivery({ journalDir, artifact })
          } else await update(delivery.taskId, { operationIdentity: delivery.operationIdentity, phase: 'interrupted', recovery: delivery, error: { code: 'OFFICE_OPERATION_INTERRUPTED' } }, context)
        } catch { /* 其它空间的任务由所属空间恢复，不泄露路径。 */ }
      }
      for (const task of await ledger.list(context)) if (!terminal(task) && !active.has(operationKey(task))) {
        const result = { ok: false, taskId: task.id, status: 'interrupted', code: 'OFFICE_OPERATION_INTERRUPTED', error: 'OFFICE_OPERATION_INTERRUPTED' }
        await update(task.id, { operationIdentity: task.operationIdentity, phase: 'interrupted', result, error: { code: result.code } }, context)
      }
      return deliveries
    },
    shutdown() { for (const controller of active.values()) controller.abort() },
  }
}
