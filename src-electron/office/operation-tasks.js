import { createHash, randomUUID } from 'node:crypto'
import { getAiCoreStore } from '../ai-core/store.js'

const EVENT_TYPE = 'office.operation.updated'
const TERMINAL_PHASES = new Set(['succeeded', 'completed', 'failed', 'cancelled', 'interrupted'])
const PRIVATE_KEY = /^(?:content|text|html|body|password|secret|token|authorization)$/i

function fault(code, message) { return Object.assign(new Error(message), { code }) }
function copy(value) { return value == null ? value : structuredClone(value) }
function copyRecord(value) { return value ? copy({ ...value, operationIdentity: value.operationIdentity || value.idempotencyHash }) : value }
function digest(value) { return createHash('sha256').update(String(value)).digest('hex') }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
}
function scrub(value, depth = 0) {
  if (depth > 12 || value == null) return value == null ? value : '[depth limited]'
  if (Array.isArray(value)) return value.slice(0, 100).map(item => scrub(item, depth + 1))
  if (typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 16000) : value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !PRIVATE_KEY.test(key)).map(([key, item]) => [key, scrub(item, depth + 1)]))
}
function identity(context = {}) {
  const actorId = typeof context.actor === 'string' ? context.actor : context.actor?.id
  if (!actorId || !context.spaceId) throw fault('OFFICE_CONTEXT_REQUIRED', 'Office task requires a trusted actor and space context')
  return { actorId, spaceId: context.spaceId }
}
function owns(task, context) {
  const owner = identity(context)
  return task?.actorId === owner.actorId && task?.spaceId === owner.spaceId
}

/** Office 阶段记入 AI Core 事件，不覆盖所属 Core 任务。 */
export function createOfficeTaskLedger({ store, now = () => new Date().toISOString(), id = randomUUID } = {}) {
  if (!store?.getTask || !store?.saveTask || !store?.listTasks || !store?.saveEvent || !store?.listEvents) throw new TypeError('AI Core task store is required')
  const latest = taskId => (store.listEvents(taskId) || []).filter(event => event.type === EVENT_TYPE).at(-1)?.payload?.record || null
  const records = taskId => (store.listEvents(taskId) || []).filter(event => event.type === EVENT_TYPE).map(event => event.payload?.record).filter(Boolean)
  const operation = (taskId, operationIdentity) => records(taskId).findLast(record => (record.operationIdentity || record.idempotencyHash) === operationIdentity)
  function save(record) {
    const normalized = { ...record, operationIdentity: record.operationIdentity || record.idempotencyHash }
    store.saveEvent({ id: id(), taskId: record.taskId, type: EVENT_TYPE, createdAt: now(), payload: { record: scrub(normalized) } })
    return copyRecord(normalized)
  }
  function get(taskId, context, operationIdentity) {
    const coreTask = store.getTask(taskId)
    if (!owns(coreTask, context)) throw fault('OFFICE_TASK_NOT_FOUND', 'Office task does not exist or is not accessible')
    const record = operationIdentity ? operation(taskId, operationIdentity) : latest(taskId)
    if (!record) throw fault('OFFICE_TASK_NOT_FOUND', 'Office task does not exist or is not accessible')
    return copyRecord(record)
  }
  return Object.freeze({
    async create({ request, context, fingerprint } = {}) {
      const { actorId, spaceId } = identity(context)
      const operationId = request?.operationId
      if (!operationId) throw fault('OFFICE_INVALID_OPERATION', 'Office operationId is required')
      const requestId = context.requestId || id()
      const key = request.idempotencyKey || context.idempotencyKey || requestId
      const idempotencyHash = digest(`${actorId}\0${spaceId}\0${operationId}\0${key}`)
      const requestFingerprint = digest(fingerprint || JSON.stringify(canonical(request)))
      for (const task of store.listTasks(actorId) || []) {
        if (task.spaceId !== spaceId) continue
        const previous = records(task.id).findLast(record => record.idempotencyHash === idempotencyHash)
        if (!previous) continue
        if (previous.requestFingerprint !== requestFingerprint) throw fault('OFFICE_IDEMPOTENCY_CONFLICT', 'The idempotency key was used for different operation input')
        return { task: copyRecord(previous), reused: true }
      }
      let coreTask = context.taskId ? store.getTask(context.taskId) : null
      if (context.taskId && !owns(coreTask, context)) throw fault('OFFICE_TASK_NOT_FOUND', 'Enclosing AI Core task does not exist or is not accessible')
      const ownsCoreTask = !context.taskId
      if (!coreTask) {
        const at = now()
        coreTask = { id: id(), actorId, spaceId, sessionId: context.sessionId || null, threadId: context.threadId || null,
          requestId, intent: operationId, mode: 'execute', status: 'running', idempotencyKey: idempotencyHash,
          requestFingerprint, requestedCapabilities: [], plan: { steps: [] }, steps: [], requestInput: {}, requestContext: {},
          output: null, error: null, checkpoint: null, createdAt: at, updatedAt: at }
        store.saveTask(coreTask)
      }
      const task = { id: coreTask.id, taskId: coreTask.id, actorId, spaceId, operationId, operationIdentity: idempotencyHash, idempotencyHash, requestFingerprint,
        ownsCoreTask, stepId: context.stepId || null, sourceEntry: context.sourceEntry || null, phase: 'accepted',
        status: 'running', createdAt: now(), updatedAt: now(), source: scrub(request.source || null),
        target: scrub(request.target || null), result: null, error: null }
      return { task: save(task), reused: false }
    },
    async update(taskId, patch = {}, context = null) {
      const coreTask = store.getTask(taskId)
      const artifactId = patch.result?.data?.artifact?.id
      const previous = patch.operationIdentity ? operation(taskId, patch.operationIdentity) : artifactId ? records(taskId).findLast(record => record.result?.data?.artifact?.id === artifactId) || latest(taskId) : latest(taskId)
      if (!coreTask || !previous || (context && !owns(coreTask, context))) throw fault('OFFICE_TASK_NOT_FOUND', 'Office task does not exist or is not accessible')
      // 文件已提交后到达的取消不能推翻真实交付。
      if (['succeeded', 'completed'].includes(previous.phase) && ['cancelled', 'interrupted'].includes(patch.phase)) return copyRecord(previous)
      const safePatch = Object.fromEntries(['phase', 'status', 'result', 'source', 'error', 'progress', 'recovery', 'quality'].filter(key => patch[key] !== undefined).map(key => [key, scrub(patch[key])]))
      const record = { ...previous, ...safePatch, operationIdentity: previous.operationIdentity || previous.idempotencyHash, updatedAt: now() }
      if (TERMINAL_PHASES.has(record.phase)) record.status = ['succeeded', 'completed'].includes(record.phase) ? record.phase : record.phase === 'cancelled' ? 'cancelled' : 'failed'
      save(record)
      if (previous.ownsCoreTask) {
        const updated = store.getTask(taskId)
        updated.updatedAt = record.updatedAt
        updated.checkpoint = { capabilityId: record.operationId, status: record.phase }
        if (TERMINAL_PHASES.has(record.phase)) {
          updated.status = record.status === 'succeeded' ? 'completed' : record.status
          updated.output = record.result ? { verification: { status: ['succeeded', 'completed'].includes(record.phase) ? 'passed' : 'not_run' } } : null
          updated.error = record.error || null
        }
        store.saveTask(updated)
      }
      return copyRecord(record)
    },
    async get(taskId, context, operationIdentity) { return get(taskId, context, operationIdentity) },
    async list(context) {
      const { actorId, spaceId } = identity(context)
      const operations = new Map()
      for (const task of store.listTasks(actorId) || []) {
        if (task.spaceId !== spaceId) continue
        for (const record of records(task.id)) operations.set(record.idempotencyHash, record)
      }
      return [...operations.values()].map(copyRecord)
    }
  })
}

let defaultLedger = null
export async function getOfficeTaskLedger() {
  if (!defaultLedger) {
    const database = await import('../db.js')
    defaultLedger = createOfficeTaskLedger({ store: getAiCoreStore(database) })
  }
  return defaultLedger
}
