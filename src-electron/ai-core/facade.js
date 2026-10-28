import { createAiRequest, createCapabilityDefinition, createTaskRecord, publicTask } from './contracts.js'
import { capabilityNotFound, policyDenied } from './errors.js'

/**
 * AI Core 的首版控制层。它只负责合同、能力投影和计划，不替换现有 Agent Runtime。
 * Runtime 通过 executor 注入，避免把 LangGraph、DSH 或模型 SDK 写进 Core。
 */
export function createAiCoreFacade({ capabilities = [], executor = null } = {}) {
  const catalog = new Map(capabilities.map(item => {
    const definition = createCapabilityDefinition(item)
    return [definition.id, definition]
  }))

  function listCapabilities(context = {}) {
    const scopes = new Set(context.scopes || [])
    return [...catalog.values()]
      .filter(item => item.requiredScopes.every(scope => scopes.has(scope) || scopes.has('*')))
      .map(item => structuredClone(item))
  }

  function plan(rawRequest) {
    const request = createAiRequest(rawRequest)
    const steps = request.requestedCapabilities.map((id, index) => {
      const capability = catalog.get(id)
      if (!capability) throw capabilityNotFound(id)
      const missingScopes = capability.requiredScopes.filter(scope => !request.context.scopes.includes(scope) && !request.context.scopes.includes('*'))
      if (request.mode === 'execute' && missingScopes.length) {
        throw policyDenied(`当前授权缺少：${missingScopes.join(', ')}`, {
          capabilityId: id,
          resourceUris: request.context.resourceUris,
          nextActions: missingScopes.map(scope => `request_scope:${scope}`)
        })
      }
      return {
        id: `step-${index + 1}`,
        capabilityId: capability.id,
        capabilityVersion: capability.version,
        risk: capability.risk,
        type: capability.type,
        resources: [...request.context.resourceUris],
        requiredScopes: [...capability.requiredScopes],
        supports: structuredClone(capability.supports),
        readbackFor: [...capability.readbackFor],
        approvalRequired: capability.type !== 'read' || capability.risk !== 'low',
        missingScopes,
        dependsOn: index ? [`step-${index}`] : []
      }
    })
    const task = createTaskRecord({ request })
    return {
      contractVersion: request.contractVersion,
      task: publicTask(task),
      plan: {
        taskId: task.id,
        intent: request.intent,
        mode: request.mode,
        steps,
        resourceUris: [...request.context.resourceUris],
        idempotencyKey: request.idempotencyKey
      }
    }
  }

  async function execute(rawRequest) {
    const request = createAiRequest({ ...rawRequest, mode: 'execute' })
    if (typeof executor !== 'function') throw new Error('AI Core 尚未绑定 Runtime executor')
    const prepared = plan(request)
    const result = await executor({ request, task: prepared.task, plan: prepared.plan })
    return { ...prepared, result }
  }

  return Object.freeze({
    contractVersion: 'friday.ai-core.v1',
    listCapabilities,
    plan,
    execute
  })
}
