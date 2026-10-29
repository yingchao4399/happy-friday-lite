import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createAiRequest, assertTaskTransition } from './contracts.js'
import { AiCoreError, policyDenied } from './errors.js'

const TERMINAL = new Set(['completed', 'failed', 'cancelled'])
function clone(value) {
  return value == null ? value : structuredClone(value)
}

function nowIso() {
  return new Date().toISOString()
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
}

function requestFingerprint(request) {
  const canonical = JSON.stringify(stableValue({
    intent: request.intent,
    input: request.input,
    capabilities: request.requestedCapabilities,
    mode: request.mode,
    context: {
      actor: request.context.actor,
      spaceId: request.context.spaceId,
      sessionId: request.context.sessionId,
      threadId: request.context.threadId,
      taskId: request.context.taskId,
      scopes: request.context.scopes,
      resourceUris: request.context.resourceUris,
      memoryNamespace: request.context.memoryNamespace,
      budget: request.context.budget,
      locale: request.context.locale
    }
  }))
  return createHash('sha256').update(canonical).digest('hex')
}

function safeError(error) {
  return { code: error?.code || 'AI_CORE_EXECUTION_FAILED', message: error?.message || String(error), stage: error?.stage || 'execute' }
}

function publicResult(result) {
  return clone({
    status: result.status,
    taskId: result.taskId,
    requestId: result.requestId,
    plan: result.plan,
    output: result.output,
    steps: result.steps,
    error: result.error,
    approvalRequired: result.approvalRequired === true,
    pauseRequested: result.pauseRequested === true,
    events: result.events
  })
}

function capabilityOutputSucceeded(output) {
  if (output == null) return false
  if (typeof output === 'string') {
    const text = output.trim()
    if (!text || /^(?:错误[:：]|工具执行失败[:：]|操作失败[:：])/i.test(text)) return false
    try { return capabilityOutputSucceeded(JSON.parse(text)) } catch { return true }
  }
  if (typeof output !== 'object') return true
  if (output.ok === false || output.success === false || output.error || ['error', 'failed'].includes(String(output.status || '').toLowerCase())) return false
  return true
}

function capabilityArgs(request, step, index) {
  return request.input?.capabilityArgs?.[step.capabilityId] ?? request.input?.steps?.[index] ?? request.input ?? {}
}

function expectedTarget(capabilityId, args, output) {
  if (capabilityId === 'office_create' || capabilityId === 'note_to_word') return args?.out || valueAtPath(output, 'out') || ''
  if (capabilityId === 'office_edit_active') return args?.filePath || ''
  if (capabilityId === 'office_export') return args?.out || ''
  if (capabilityId === 'create_note' || capabilityId === 'update_note') {
    const text = typeof output === 'string' ? output : JSON.stringify(output || {})
    return text.match(/\bid\s*[:=]\s*([\w-]+)/i)?.[1] || args?.noteId || ''
  }
  return ''
}

function actualReadbackTarget(capabilityId, args) {
  if (capabilityId === 'office_inspect') return args?.filePath || ''
  if (capabilityId === 'get_note') return args?.noteId || ''
  return ''
}

function valueAtPath(value, field) {
  if (!field || field === 'output') return value
  if (field === 'id' && typeof value === 'string') return value.match(/\bid\s*[:=]\s*([\w-]+)/i)?.[1]
  let parsed = value
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { return undefined }
  }
  return String(field).split('.').reduce((current, key) => current?.[key], parsed)
}

function resolveInputReferences(value, outputs) {
  if (Array.isArray(value)) return value.map(item => resolveInputReferences(item, outputs))
  if (!value || typeof value !== 'object') return value
  if (typeof value.$from === 'string') {
    const source = [...outputs].reverse().find(item => item.capabilityId === value.$from)
    if (!source) throw new Error(`引用步骤尚未完成：${value.$from}`)
    const resolved = valueAtPath(source.output, value.field)
    if (resolved === undefined || resolved === null) throw new Error(`能力结果中没有可引用字段：${value.$from}.${value.field || 'output'}`)
    return resolved
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveInputReferences(item, outputs)]))
}

function readbackSatisfies(step, writeStep, writeArgs, writeOutput, readArgs) {
  if (!step.supports?.readback || !step.readbackFor?.includes(writeStep.capabilityId)) return false
  const expected = expectedTarget(writeStep.capabilityId, writeArgs, writeOutput)
  const actual = actualReadbackTarget(step.capabilityId, readArgs)
  if (expected && actual) {
    const fileTarget = ['office_create', 'office_edit_active', 'office_export'].includes(writeStep.capabilityId)
    return fileTarget ? path.resolve(expected) === path.resolve(actual) : expected === actual
  }
  return JSON.stringify(step.resources || []) === JSON.stringify(writeStep.resources || [])
}

/**
 * AI Core 的最小任务运行时。它只管理请求、授权、状态和结果，
 * 实际能力仍统一委托给 agent/tools/registry 的 executeCapability。
 * store 由主进程注入，默认使用内存存储，便于单元测试和无数据库场景。
 */
export function createAiCoreRuntime({ facade, executeCapability, store = null, now = nowIso, executionContext = {} } = {}) {
  if (!facade || typeof facade.plan !== 'function') throw new TypeError('AI Core facade 未提供')
  if (typeof executeCapability !== 'function') throw new TypeError('AI Core capability executor 未提供')
  // 待审批正文、控制信号和 AbortController 只属于当前 Runtime 实例，
  // 绝不写入 Core 数据库；进程重启后要求重新提交。
  const pendingRequests = new Map()
  const controllers = new Map()
  // 控制命令通过 Store 读取的是任务副本；用内存信号交给活动执行循环。
  const pauseRequests = new Set()
  const memory = new Map()
  const events = new Map()
  const backend = store || {
    saveTask(task) { memory.set(task.id, clone(task)); return task },
    getTask(id) { return clone(memory.get(id)) },
    listTasks(actorId) { return [...memory.values()].filter(item => !actorId || item.actorId === actorId).map(clone) },
    saveEvent(event) { const list = events.get(event.taskId) || []; list.push(clone(event)); events.set(event.taskId, list); return event },
    listEvents(taskId) { return clone(events.get(taskId) || []) }
  }

  function persist(task) {
    task.updatedAt = now()
    backend.saveTask(clone(task))
    return task
  }

  function event(task, type, payload = {}) {
    const record = { id: randomUUID(), taskId: task.id, type, createdAt: now(), payload: clone(payload) }
    backend.saveEvent(record)
    return record
  }

  function transition(task, status, payload = {}) {
    const from = task.status
    assertTaskTransition(from, status)
    task.status = status
    const item = event(task, 'task.status', { from, to: status, ...payload })
    persist(task)
    return item
  }

  function getTask(id, actorId) {
    const task = backend.getTask(id)
    if (!task || (actorId && task.actorId !== actorId)) throw new AiCoreError('AI_CORE_TASK_NOT_FOUND', '任务不存在或无权访问', { stage: 'authorize' })
    return task
  }

  function publicTask(task) {
    const { requestInput: _requestInput, requestContext: _requestContext, ...safe } = task
    return clone({ ...safe, events: backend.listEvents(task.id) })
  }

  function requiresApproval(plan) {
    return plan.steps.some(step => step.approvalRequired)
  }

  function pauseAtCheckpoint(task, request, step) {
    if (!task.pauseRequested && !pauseRequests.has(task.id)) return false
    pauseRequests.delete(task.id)
    task.pauseRequested = false
    task.interruption = { reason: 'user-paused', stepId: step?.id || null, capabilityId: step?.capabilityId || null, at: now() }
    pendingRequests.set(task.id, request)
    transition(task, 'paused')
    event(task, 'task.paused', { stepId: step?.id || null, capabilityId: step?.capabilityId || null })
    return true
  }

  function makeTask(request, prepared) {
    const task = {
      id: prepared.task.id,
      actorId: request.context.actor.id,
      spaceId: request.context.spaceId,
      sessionId: request.context.sessionId,
      threadId: request.context.threadId,
      requestId: request.context.requestId,
      intent: request.intent,
      requestedCapabilities: [...request.requestedCapabilities],
      mode: request.mode,
      status: 'draft',
      idempotencyKey: request.idempotencyKey,
      plan: clone(prepared.plan),
      steps: [],
      output: null,
      error: null,
      checkpoint: null,
      pauseRequested: false,
      requestInput: clone(request.input),
      requestContext: clone(request.context),
      createdAt: now(),
      updatedAt: now()
    }
    return task
  }

  async function run(task, request, prepared) {
    if (TERMINAL.has(task.status)) return publicResult({ ...task, events: backend.listEvents(task.id) })
    const controller = controllers.get(task.id) || new AbortController()
    controllers.set(task.id, controller)
    if (task.status !== 'running') transition(task, 'running')
    // 继续任务时复用当前进程中已经完成的步骤，避免重复写入。
    const outputs = Array.isArray(task.steps) ? task.steps.map(clone) : []
    try {
      for (const step of prepared.plan.steps) {
        if (outputs.some(item => item.stepId === step.id && item.capabilityId === step.capabilityId)) continue
        if (pauseAtCheckpoint(task, request, step)) {
          return publicResult({ ...task, events: backend.listEvents(task.id) })
        }
        if (controller.signal.aborted) throw Object.assign(new Error('任务已取消'), { code: 'AI_CORE_TASK_CANCELLED' })
        task.checkpoint = { stepId: step.id, capabilityId: step.capabilityId, status: 'running' }
        persist(task)
        event(task, 'capability.started', { stepId: step.id, capabilityId: step.capabilityId })
        const args = resolveInputReferences(capabilityArgs(request, step, outputs.length), outputs)
        const output = await executeCapability(step.capabilityId, args, {
          ...executionContext,
          actor: request.context.actor.id,
          threadId: request.context.threadId || task.id,
          requestId: `${request.context.requestId}:${step.id}`,
          spaceId: request.context.spaceId,
          sessionId: request.context.sessionId,
          resourceUris: request.context.resourceUris,
          autoApprove: true,
          unattended: false,
          signal: controller.signal,
          emit: () => {}
        }, {
          actor: request.context.actor.id,
          scopes: request.context.scopes,
          requireApproval: true,
          approvalGranted: true
        })
        if (!capabilityOutputSucceeded(output)) throw Object.assign(new Error('能力返回失败结果，任务未通过结果检查'), { code: 'AI_CORE_OUTPUT_NOT_VERIFIED', stage: 'verify' })
        const item = { stepId: step.id, capabilityId: step.capabilityId, output: clone(output), completedAt: now() }
        outputs.push(item)
        task.steps.push(item)
        task.checkpoint = { stepId: step.id, capabilityId: step.capabilityId, status: 'completed' }
        persist(task)
        event(task, 'capability.completed', { stepId: step.id, capabilityId: step.capabilityId })
        if (controller.signal.aborted) {
          task.output = { steps: outputs, verification: { status: 'not_run', reason: 'cancelled' } }
          task.checkpoint = { stepId: step.id, capabilityId: step.capabilityId, status: 'cancelled' }
          transition(task, 'cancelled')
          return publicResult({ ...task, events: backend.listEvents(task.id) })
        }
        if (pauseAtCheckpoint(task, request, step)) {
          return publicResult({ ...task, events: backend.listEvents(task.id) })
        }
      }
      transition(task, 'verifying')
      const writeSteps = prepared.plan.steps.filter(step => step.type === 'write')
      const unverified = writeSteps.filter(write => {
        const writeIndex = prepared.plan.steps.indexOf(write)
        const writeArgs = resolveInputReferences(capabilityArgs(request, write, writeIndex), outputs.slice(0, writeIndex))
        const writeOutput = outputs[writeIndex]?.output
        return !prepared.plan.steps.some((read, readIndex) => {
          if (readIndex <= writeIndex || read.type !== 'read') return false
          let readArgs
          try { readArgs = resolveInputReferences(capabilityArgs(request, read, readIndex), outputs.slice(0, readIndex)) } catch { return false }
          return readbackSatisfies(read, write, writeArgs, writeOutput, readArgs)
        })
      })
      if (unverified.length) {
        task.output = { steps: outputs, verification: { status: 'required', capabilities: unverified.map(step => step.capabilityId) } }
        transition(task, 'partially_completed')
        return publicResult({ ...task, events: backend.listEvents(task.id) })
      }
      task.output = { steps: outputs, verification: { status: 'passed', mode: writeSteps.length ? 'readback-capability' : 'read-result', checkedAt: now() } }
      transition(task, 'completed')
      return publicResult({ ...task, events: backend.listEvents(task.id) })
    } catch (error) {
      if (controller.signal.aborted) {
        task.error = null
        task.checkpoint = { ...(task.checkpoint || {}), status: 'cancelled' }
        if (!TERMINAL.has(task.status)) transition(task, 'cancelled')
        return publicResult({ ...task, events: backend.listEvents(task.id) })
      }
      task.error = safeError(error)
      task.checkpoint = { ...(task.checkpoint || {}), status: 'failed' }
      persist(task)
      if (!TERMINAL.has(task.status)) transition(task, outputs.length ? 'partially_completed' : 'failed')
      return publicResult({ ...task, events: backend.listEvents(task.id) })
    } finally {
      controllers.delete(task.id)
      if (task.status !== 'paused') pendingRequests.delete(task.id)
    }
  }

  async function submit(rawRequest) {
    const request = createAiRequest(rawRequest)
    const prepared = facade.plan(request)
    const existing = backend.listTasks(request.context.actor.id).find(item => item.idempotencyKey === request.idempotencyKey)
    const fingerprint = requestFingerprint(request)
    if (existing) {
      if (existing.requestFingerprint && existing.requestFingerprint !== fingerprint) throw policyDenied('幂等键已用于不同的任务内容，请为新任务生成新的 requestId')
      return publicTask(existing)
    }
    const task = makeTask(request, prepared)
    task.requestInput = clone(request.input)
    task.requestContext = clone(request.context)
    task.requestFingerprint = fingerprint
    pendingRequests.set(task.id, request)
    controllers.set(task.id, new AbortController())
    backend.saveTask(task)
    event(task, 'task.created', { requestId: request.context.requestId, capabilityIds: request.requestedCapabilities })
    if (request.mode === 'plan' || request.mode === 'dry-run') return publicTask(task)
    if (requiresApproval(prepared.plan)) {
      transition(task, 'awaiting_approval')
      event(task, 'approval.required', { steps: prepared.plan.steps.filter(step => step.approvalRequired).map(step => step.id) })
      return publicTask(task)
    }
    transition(task, 'running')
    setImmediate(() => { run(task, request, prepared) })
    return publicTask(task)
  }

  async function approve(id, actorId) {
    const task = getTask(id, actorId)
    if (task.status !== 'awaiting_approval') throw policyDenied(`任务当前不等待审批：${task.status}`)
    const request = pendingRequests.get(task.id)
    if (!request) throw policyDenied('此任务的临时输入已随应用关闭清除，请重新提交并确认任务内容', { taskId: task.id, nextActions: ['resubmit_request'] })
    pendingRequests.delete(task.id)
    const prepared = facade.plan(request)
    task.plan = clone(prepared.plan)
    transition(task, 'running')
    setImmediate(() => { run(task, request, prepared) })
    return publicTask(task)
  }

  function pause(id, actorId) {
    const task = getTask(id, actorId)
    if (task.status === 'paused') return publicTask(task)
    if (task.status !== 'running') {
      throw policyDenied(`只有运行中的任务可以暂停：${task.status}`, { taskId: task.id })
    }
    task.pauseRequested = true
    pauseRequests.add(task.id)
    event(task, 'task.pause_requested', { status: task.status, currentStep: task.currentStep })
    persist(task)
    return publicTask(task)
  }

  function resume(id, actorId) {
    const task = getTask(id, actorId)
    if (task.status !== 'paused') throw policyDenied(`只有已暂停任务可以继续：${task.status}`, { taskId: task.id })
    const request = pendingRequests.get(task.id)
    if (!request) throw policyDenied('此任务的临时输入已随应用关闭清除，请重新提交并确认任务内容', { taskId: task.id, nextActions: ['resubmit_request'] })
    const prepared = facade.plan(request)
    pauseRequests.delete(task.id)
    task.pauseRequested = false
    task.interruption = null
    task.error = null
    transition(task, 'running', { reason: 'user-resumed' })
    event(task, 'task.resumed', { completedSteps: task.steps?.map(step => step.stepId) || [] })
    setImmediate(() => { run(task, request, prepared) })
    return publicTask(task)
  }

  function cancel(id, actorId) {
    const task = getTask(id, actorId)
    pendingRequests.delete(task.id)
    pauseRequests.delete(task.id)
    controllers.get(task.id)?.abort()
    if (!TERMINAL.has(task.status) && task.status !== 'running' && task.status !== 'verifying') transition(task, 'cancelled')
    return publicTask(task)
  }

  /** Apply a capability-provided undo action only while its target is unchanged. */
  async function undo(id, actorId) {
    const task = getTask(id, actorId)
    if (task.status !== 'completed') throw policyDenied(`只有已完成任务可以撤销：${task.status}`)
    if (task.output?.undo?.status === 'applied') throw policyDenied('任务已经撤销，不能重复执行', { taskId: task.id })
    const steps = task.output?.steps || []
    const actions = steps.flatMap(step => {
      const output = typeof step.output === 'string' ? (() => { try { return JSON.parse(step.output) } catch { return null } })() : step.output
      return output?.undoAction ? [output.undoAction] : []
    })
    if (!actions.length) throw policyDenied('任务没有可用的撤销动作', { taskId: task.id })
    const applied = []
    for (const action of actions) {
      if (action.type !== 'delete-created-file' || typeof action.path !== 'string' || !path.isAbsolute(action.path)) {
        throw policyDenied('撤销动作类型或目标无效', { taskId: task.id })
      }
      if (action.expiresAt && Date.parse(action.expiresAt) <= Date.now()) {
        throw policyDenied('撤销动作已过期，请手动处理目标文件', { taskId: task.id, path: action.path })
      }
      const current = await fs.readFile(action.path).catch(() => null)
      if (!current) continue
      const digest = createHash('sha256').update(current).digest('hex')
      if (action.sha256 && digest !== action.sha256) {
        throw policyDenied('目标文件已被修改，撤销已停止以保护用户内容', { taskId: task.id, path: action.path })
      }
      await fs.unlink(action.path)
      applied.push(action.path)
    }
    task.output = { ...(task.output || {}), undo: { status: 'applied', paths: applied, appliedAt: now() } }
    event(task, 'task.undo', { paths: applied })
    persist(task)
    return publicResult({ ...task, events: backend.listEvents(task.id) })
  }

  function recoverInterrupted() {
    for (const task of backend.listTasks()) {
      if (['running', 'verifying'].includes(task.status)) {
        task.error = { code: 'AI_CORE_INTERRUPTED', stage: 'recovery', message: '应用在任务执行期间退出；请检查目标资源后再重新提交。' }
        task.checkpoint = { ...(task.checkpoint || {}), status: 'interrupted' }
        transition(task, 'failed', { reason: 'process-restart' })
      } else if (task.status === 'awaiting_approval') {
        task.error = { code: 'AI_CORE_APPROVAL_INPUT_EXPIRED', stage: 'recovery', message: '待审批任务的临时输入已清除，请重新提交。' }
        transition(task, 'failed', { reason: 'approval-input-expired' })
      }
    }
  }

  return Object.freeze({
    submit,
    approve,
    pause,
    resume,
    cancel,
    undo,
    recoverInterrupted,
    get(id, actorId) { return publicTask(getTask(id, actorId)) },
    list(actorId) { return backend.listTasks(actorId).map(publicTask) }
  })
}

export { publicResult }
