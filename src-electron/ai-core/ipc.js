import electron from 'electron'
import { createAiCoreFacade } from './facade.js'
import { AI_CORE_CONTRACT_VERSION, createCapabilityDefinition } from './contracts.js'
import { createAiCoreRuntime } from './task-runtime.js'
import { executeCapability, getRequiredScopes, listRegisteredTools } from '../agent/tools/registry.js'
import * as db from '../db.js'
import { getDataDir } from '../config.js'
import { getAgentRootDir } from '../agent/backend.js'
import { createLogger } from '../agent/logger.js'
import { isAllowedAiCoreCapability, isWriteCapability } from './catalog-policy.js'
import { createAiCoreHealthCheck, createRetryableAsyncGetter } from './runtime-lifecycle.js'

const defaultIpcMain = electron.ipcMain
let registeredMainWindow = null

async function loadCatalog() {
  const registry = await import('../agent/tools/registry.js')
  await import('../agent/tools/index.js')
  return registry.listRegisteredTools()
    .filter(isAllowedAiCoreCapability)
    .map(def => createCapabilityDefinition({
    id: def.name,
    version: def.meta?.version || '1.0.0',
    description: def.description,
    type: isWriteCapability(def) ? 'write' : def.meta?.capabilityType || 'read',
    risk: def.meta?.risk || (isWriteCapability(def) ? 'medium' : 'low'),
    requiredScopes: def.meta?.requiredScopes || [isWriteCapability(def) ? 'write' : 'read'],
    supports: { dryRun: true, undo: def.meta?.supportsUndo === true, readback: def.meta?.supportsReadback === true },
    readbackFor: def.meta?.readbackFor || []
  }))
}

function createStore() {
  const live = new Map()
  return {
    saveTask(task) { live.set(task.id, structuredClone(task)); return db.saveAiCoreTask(task) },
    getTask(id) { return structuredClone(live.get(id) || db.getAiCoreTask(id)) },
    listTasks(actorId) {
      const merged = new Map(db.listAiCoreTasks(actorId).map(task => [task.id, task]))
      for (const [id, task] of live) if (!actorId || task.actorId === actorId) merged.set(id, structuredClone(task))
      return [...merged.values()]
    },
    saveEvent: event => db.saveAiCoreTaskEvent(event),
    listEvents: taskId => db.listAiCoreTaskEvents(taskId)
  }
}

async function createRuntime(mainWindow) {
  const capabilities = await loadCatalog()
  const facade = createAiCoreFacade({ capabilities })
  const runtime = createAiCoreRuntime({ facade, executeCapability, store: createStore(), executionContext: {
    dataDir: getDataDir(), agentRootDir: getAgentRootDir(), logger: createLogger('AiCore'), mainWindow
  } })
  runtime.recoverInterrupted()
  return runtime
}

/** 获取进程内唯一 AI Core Runtime；UI、MCP 和后台入口共享同一任务事实源。 */
const getRuntime = createRetryableAsyncGetter(() => createRuntime(registeredMainWindow))
export function getAiCoreRuntime() { return getRuntime() }

export function registerAiCoreCommands(mainWindow, ipcMain = defaultIpcMain) {
  registeredMainWindow = mainWindow
  ipcMain.handle('ai-core-health', createAiCoreHealthCheck({
    contractVersion: AI_CORE_CONTRACT_VERSION,
    getRuntime,
    loadCapabilities: loadCatalog
  }))

  ipcMain.handle('ai-core-list-capabilities', async (_event, args = {}) => {
    const capabilities = await loadCatalog()
    const facade = createAiCoreFacade({ capabilities })
    return { contractVersion: AI_CORE_CONTRACT_VERSION, capabilities: facade.listCapabilities(args.context || {}) }
  })

  ipcMain.handle('ai-core-plan', async (_event, request) => {
    const capabilities = await loadCatalog()
    const facade = createAiCoreFacade({ capabilities })
    return facade.plan(request)
  })

  ipcMain.handle('ai-core-execute', async (_event, request) => {
    const runtime = await getRuntime()
    return runtime.submit({ ...request, mode: 'execute', context: {
      ...(request?.context || {}), actor: { id: 'user:local', type: 'user' }, scopes: request?.context?.scopes || []
    } })
  })

  ipcMain.handle('ai-core-task-approve', async (_event, args = {}) => {
    const runtime = await getRuntime()
    return runtime.approve(args.taskId, 'user:local')
  })

  ipcMain.handle('ai-core-task-get', async (_event, args = {}) => {
    const runtime = await getRuntime()
    return runtime.get(args.taskId, 'user:local')
  })

  ipcMain.handle('ai-core-task-list', async (_event, args = {}) => {
    const runtime = await getRuntime()
    return runtime.list('user:local')
  })

  ipcMain.handle('ai-core-task-cancel', async (_event, args = {}) => {
    const runtime = await getRuntime()
    return runtime.cancel(args.taskId, 'user:local')
  })

  ipcMain.handle('ai-core-task-undo', async (_event, args = {}) => {
    const runtime = await getRuntime()
    return runtime.undo(args.taskId, 'user:local')
  })

  return mainWindow
}
