import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getDataDir, loadConfig } from '../config.js'
import { createLogger } from './logger.js'
import { createLangChainModel } from './modelAdapter.js'
import { executeCapability, getRequiredScopes, listRegisteredTools, describeCapability } from './tools/registry.js'
import { getAgentRootDir } from './backend.js'

const log = createLogger('ExternalTasks')
const controllers = new Map()
const MAX_STEPS = 20

function taskFile() {
  return path.join(getDataDir(), 'ai-core-tasks.json')
}

function readTasks() {
  try {
    const parsed = JSON.parse(fs.readFileSync(taskFile(), 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveTasks(tasks) {
  const file = taskFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

function updateTask(id, patch) {
  const tasks = readTasks()
  const task = tasks.find(item => item.id === id)
  if (!task) throw new Error('任务不存在')
  Object.assign(task, patch, { updatedAt: new Date().toISOString() })
  saveTasks(tasks)
  return task
}

function publicTask(task) {
  const { actor, scopes, ...safe } = task
  return safe
}

function findTask(id, actor) {
  const task = readTasks().find(item => item.id === id && item.actor === actor)
  if (!task) throw new Error('任务不存在或无权访问')
  return task
}

function permittedCapabilities(scopes) {
  return listRegisteredTools().filter(def => def.meta?.exposedViaMcp && getRequiredScopes(def).every(scope => scopes.includes(scope)))
}

function parseDecision(value) {
  const text = typeof value === 'string' ? value : Array.isArray(value) ? value.map(item => item.text || '').join('') : String(value ?? '')
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(cleaned)
}

async function executeStep(task, step, controller) {
  checkTaskBoundary(task, controller)
  const def = permittedCapabilities(task.scopes).find(item => item.name === step.name)
  if (!def) throw new Error(`能力不可用或超出授权范围: ${step.name}`)
  const ctx = {
    dataDir: getDataDir(),
    agentRootDir: getAgentRootDir(),
    signal: controller.signal,
    threadId: task.id,
    requestId: `${task.id}:${task.results.length + 1}`,
    actor: task.actor,
    logger: log,
    emit: () => {},
    mainWindow: null
  }
  updateTask(task.id, { inFlight: { name: step.name, startedAt: new Date().toISOString() } })
  const output = await executeCapability(step.name, step.args || {}, ctx, {
    actor: task.actor,
    requireMcpExposure: true,
    requireApproval: true,
    scopes: task.scopes
  })
  const result = { name: step.name, args: step.args || {}, output, completedAt: new Date().toISOString() }
  task.results.push(result)
  updateTask(task.id, { results: task.results, progress: task.results.length, inFlight: null })
  return result
}

async function runStructured(task, controller) {
  for (const step of task.steps.slice(task.results.length)) await executeStep(task, step, controller)
  return { message: '任务步骤已完成', results: task.results }
}

async function runInstruction(task, controller) {
  const config = loadConfig()
  const modelConfig = (config.customModels || []).find(model => model.id === config.selectedModelId)
  if (!modelConfig?.apiKey || !modelConfig?.modelName || !modelConfig?.baseUrl) {
    throw new Error('Friday 未配置可用模型，请先在模型设置中配置')
  }
  const model = createLangChainModel(modelConfig)
  const capabilities = await Promise.all(permittedCapabilities(task.scopes).map(describeCapability))
  const history = [...task.results]
  for (let index = history.length; index < MAX_STEPS; index++) {
    checkTaskBoundary(task, controller)
    const response = await model.invoke([
      { role: 'system', content: '你是 Friday 的任务规划器。每轮只返回一个 JSON 对象：{"action":"call","name":"能力名","args":{...}} 或 {"action":"finish","message":"结果摘要"}。只能选择已授权能力。不要猜测工具结果；完成后给出引用和实际对象 ID。' },
      { role: 'user', content: JSON.stringify({ instruction: task.instruction, capabilities, history }) }
    ], { signal: controller.signal })
    checkTaskBoundary(task, controller)
    const decision = parseDecision(response.content)
    if (decision.action === 'finish') return { message: String(decision.message || ''), results: task.results }
    if (decision.action !== 'call' || typeof decision.name !== 'string') throw new Error('模型返回了无效任务步骤')
    const result = await executeStep(task, { name: decision.name, args: decision.args }, controller)
    history.push(result)
  }
  throw new Error(`任务超过 ${MAX_STEPS} 步，请缩小范围后重试`)
}

async function runTask(task, controller) {
  try {
    checkTaskBoundary(task, controller)
    updateTask(task.id, { status: 'running' })
    const output = task.steps ? await runStructured(task, controller) : await runInstruction(task, controller)
    checkTaskBoundary(task, controller)
    if (controller.signal.aborted) updateTask(task.id, { status: 'cancelled', completedAt: new Date().toISOString() })
    else updateTask(task.id, { status: 'completed', output, completedAt: new Date().toISOString() })
  } catch (error) {
    if (readTasks().find(item => item.id === task.id)?.status === 'pausing' && !controller.signal.aborted) {
      updateTask(task.id, { status: 'paused', error: null })
      return
    }
    const cancelled = controller.signal.aborted
    updateTask(task.id, { status: cancelled ? 'cancelled' : 'failed', error: cancelled ? null : error.message, completedAt: new Date().toISOString() })
    if (!cancelled) log.warn(`外部任务 ${task.id} 失败: ${error.message}`)
  } finally {
    controllers.delete(task.id)
  }
}

export function submitExternalTask({ instruction, steps }, actor, scopes) {
  if ((!instruction || typeof instruction !== 'string') && (!Array.isArray(steps) || !steps.length)) throw new Error('需要 instruction 或 steps')
  if (instruction && instruction.length > 4000) throw new Error('任务说明过长')
  if (steps && (!Array.isArray(steps) || steps.length > MAX_STEPS || steps.some(step => !step || typeof step.name !== 'string'))) throw new Error('任务步骤无效')
  const now = new Date().toISOString()
  const task = { id: randomUUID(), actor, scopes: [...scopes], instruction: instruction || null, steps: steps || null, status: 'queued', progress: 0, results: [], output: null, error: null, createdAt: now, updatedAt: now, completedAt: null }
  const tasks = readTasks()
  tasks.push(task)
  saveTasks(tasks)
  const controller = new AbortController()
  controllers.set(task.id, controller)
  setImmediate(() => runTask(task, controller))
  return publicTask(task)
}

export function getExternalTaskStatus(id, actor) {
  return publicTask(findTask(id, actor))
}

export function cancelExternalTask(id, actor) {
  const task = findTask(id, actor)
  if (['completed', 'failed', 'cancelled'].includes(task.status)) return publicTask(task)
  const controller = controllers.get(id)
  controller?.abort()
  return publicTask(updateTask(id, { status: controller ? 'cancelling' : 'cancelled', completedAt: controller ? null : new Date().toISOString() }))
}

function checkTaskBoundary(task, controller) {
  if (controller.signal.aborted) throw new Error('任务已取消')
  if (readTasks().find(item => item.id === task.id)?.status === 'pausing') throw new Error('任务已暂停')
}

export function pauseExternalTask(id, actor) {
  const task = findTask(id, actor)
  if (!['queued', 'running'].includes(task.status)) return publicTask(task)
  return publicTask(updateTask(id, { status: 'pausing' }))
}

export function resumeExternalTask(id, actor, scopes) {
  const task = findTask(id, actor)
  if (task.status !== 'paused') throw new Error('仅可继续已暂停的任务')
  const original = new Set(task.scopes)
  task.scopes = task.scopes.filter(scope => scopes.includes(scope))
  if (task.scopes.length !== original.size) throw new Error('授权已变更，请用新的配对权限重新提交任务')
  Object.assign(task, updateTask(id, { status: 'queued', scopes: task.scopes }))
  const controller = new AbortController()
  controllers.set(id, controller)
  setImmediate(() => runTask(task, controller))
  return publicTask(task)
}

export function cancelExternalTasksForActor(actor) {
  for (const task of readTasks().filter(item => item.actor === actor)) cancelExternalTask(task.id, actor)
}

export function recoverExternalTasks() {
  const tasks = readTasks()
  let changed = false
  for (const task of tasks) {
    if (['queued', 'running', 'pausing', 'cancelling'].includes(task.status)) {
      if (task.status === 'cancelling') {
        task.status = 'cancelled'
        task.error = null
      } else if (task.inFlight) {
        task.status = 'failed'
        task.error = `Friday 在能力 ${task.inFlight.name} 执行期间退出，执行效果尚未确认。请检查对象与审计后再决定是否重试；不会自动重复写入。`
      } else {
        task.status = 'paused'
        task.error = null
      }
      task.completedAt = ['failed', 'cancelled'].includes(task.status) ? new Date().toISOString() : null
      changed = true
    }
  }
  if (changed) saveTasks(tasks)
}
