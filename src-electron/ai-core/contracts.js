import { randomUUID } from 'node:crypto'
import { contractError } from './errors.js'

export const AI_CORE_CONTRACT_VERSION = 'friday.ai-core.v1'

export const TASK_STATES = Object.freeze([
  'draft', 'awaiting_approval', 'running', 'verifying', 'paused',
  'completed', 'failed', 'cancelled', 'partially_completed'
])

export const REQUEST_MODES = Object.freeze(['plan', 'execute', 'dry-run'])

const CAPABILITY_TYPES = new Set(['read', 'write', 'navigation', 'external'])
const RISK_LEVELS = new Set(['low', 'medium', 'high'])

function requireString(value, name, { max = 512 } = {}) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw contractError(`${name} 无效`)
  }
  return value.trim()
}

function clone(value) {
  return value == null ? value : structuredClone(value)
}

function normalizeActor(actor) {
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) throw contractError('actor 无效')
  return Object.freeze({
    id: requireString(actor.id, 'actor.id', { max: 160 }),
    type: requireString(actor.type || 'user', 'actor.type', { max: 80 }),
    clientId: actor.clientId == null ? null : requireString(actor.clientId, 'actor.clientId', { max: 160 })
  })
}

export function createAiContext(input = {}) {
  const context = {
    contractVersion: AI_CORE_CONTRACT_VERSION,
    actor: normalizeActor(input.actor),
    spaceId: requireString(input.spaceId, 'spaceId', { max: 240 }),
    sessionId: input.sessionId == null ? null : requireString(input.sessionId, 'sessionId', { max: 240 }),
    threadId: input.threadId == null ? null : requireString(input.threadId, 'threadId', { max: 240 }),
    taskId: input.taskId == null ? null : requireString(input.taskId, 'taskId', { max: 240 }),
    requestId: requireString(input.requestId || randomUUID(), 'requestId', { max: 240 }),
    scopes: [...new Set((input.scopes || []).map(scope => requireString(scope, 'scope', { max: 120 })))],
    resourceUris: [...new Set((input.resourceUris || []).map(uri => requireString(uri, 'resourceUri', { max: 1000 })))],
    memoryNamespace: input.memoryNamespace == null ? `space/${input.spaceId}` : requireString(input.memoryNamespace, 'memoryNamespace', { max: 320 }),
    budget: normalizeBudget(input.budget),
    locale: input.locale == null ? 'zh-CN' : requireString(input.locale, 'locale', { max: 32 })
  }
  return Object.freeze(context)
}

function normalizeBudget(budget = {}) {
  const result = {
    maxSteps: numberOr(budget.maxSteps, 12, 1, 1000),
    timeoutMs: numberOr(budget.timeoutMs, 300000, 1000, 86400000),
    maxTokens: numberOr(budget.maxTokens, 20000, 1, 10000000)
  }
  return Object.freeze(result)
}

function numberOr(value, fallback, min, max) {
  if (value == null) return fallback
  if (!Number.isInteger(value) || value < min || value > max) throw contractError('budget 数值无效')
  return value
}

export function createAiRequest(input = {}) {
  const mode = input.mode || 'plan'
  if (!REQUEST_MODES.includes(mode)) throw contractError(`mode 不支持：${mode}`)
  const context = createAiContext(input.context)
  const requestedCapabilities = [...new Set((input.requestedCapabilities || []).map(id => requireString(id, 'capabilityId', { max: 240 })))]
  if (!requestedCapabilities.length) throw contractError('至少需要一个 requestedCapabilities')
  return Object.freeze({
    contractVersion: AI_CORE_CONTRACT_VERSION,
    intent: requireString(input.intent, 'intent', { max: 240 }),
    input: clone(input.input || {}),
    context,
    mode,
    requestedCapabilities: Object.freeze(requestedCapabilities),
    idempotencyKey: requireString(input.idempotencyKey || `${context.actor.id}:${context.spaceId}:${context.requestId}`, 'idempotencyKey', { max: 400 })
  })
}

export function createCapabilityDefinition(input = {}) {
  const type = input.type || input.capabilityType || 'read'
  const risk = input.risk || 'low'
  if (!CAPABILITY_TYPES.has(type)) throw contractError(`capability type 不支持：${type}`)
  if (!RISK_LEVELS.has(risk)) throw contractError(`risk 不支持：${risk}`)
  return Object.freeze({
    id: requireString(input.id, 'capability.id', { max: 240 }),
    version: requireString(input.version || '1.0.0', 'capability.version', { max: 80 }),
    description: requireString(input.description || input.id, 'capability.description', { max: 2000 }),
    type,
    risk,
    requiredScopes: Object.freeze([...new Set((input.requiredScopes || []).map(scope => requireString(scope, 'requiredScope', { max: 120 })))]),
    inputSchema: clone(input.inputSchema || { type: 'object' }),
    outputSchema: clone(input.outputSchema || { type: 'object' }),
    idempotent: input.idempotent !== false,
    supports: Object.freeze({
      dryRun: input.supports?.dryRun !== false,
      undo: input.supports?.undo === true,
      readback: input.supports?.readback === true
    }),
    readbackFor: Object.freeze([...new Set((input.readbackFor || []).map(id => requireString(id, 'readbackFor', { max: 240 })))])
  })
}

export function createTaskRecord(input = {}) {
  const request = input.request || createAiRequest(input)
  const now = input.createdAt || new Date().toISOString()
  return {
    id: requireString(input.id || randomUUID(), 'task.id', { max: 240 }),
    actorId: request.context.actor.id,
    spaceId: request.context.spaceId,
    sessionId: request.context.sessionId,
    threadId: request.context.threadId,
    requestId: request.context.requestId,
    intent: request.intent,
    status: 'draft',
    idempotencyKey: request.idempotencyKey,
    currentStep: null,
    checkpoint: null,
    sourceVersions: {},
    interruption: null,
    budget: clone(request.context.budget),
    createdAt: now,
    updatedAt: now
  }
}

export function assertTaskTransition(from, to) {
  if (!TASK_STATES.includes(from) || !TASK_STATES.includes(to)) throw contractError('任务状态无效')
  if (from === to) return true
  const allowed = {
    draft: new Set(['awaiting_approval', 'running', 'cancelled']),
    awaiting_approval: new Set(['running', 'paused', 'failed', 'cancelled']),
    running: new Set(['verifying', 'paused', 'failed', 'cancelled', 'partially_completed']),
    verifying: new Set(['completed', 'failed', 'partially_completed', 'paused']),
    paused: new Set(['running', 'cancelled', 'failed']),
    failed: new Set(['paused', 'running', 'cancelled']),
    partially_completed: new Set(['paused', 'running', 'completed', 'cancelled']),
    completed: new Set(),
    cancelled: new Set()
  }
  if (!allowed[from]?.has(to)) throw contractError(`不允许的任务状态转换：${from} → ${to}`)
  return true
}

export function publicTask(task) {
  return clone({
    id: task.id,
    actorId: task.actorId,
    spaceId: task.spaceId,
    sessionId: task.sessionId,
    threadId: task.threadId,
    requestId: task.requestId,
    intent: task.intent,
    status: task.status,
    currentStep: task.currentStep,
    checkpoint: task.checkpoint,
    sourceVersions: task.sourceVersions,
    interruption: task.interruption,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  })
}
