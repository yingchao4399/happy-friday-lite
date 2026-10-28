/** Friday AI Core 的稳定错误合同。 */
export class AiCoreError extends Error {
  constructor(code, message, options = {}) {
    super(message)
    this.name = 'AiCoreError'
    this.code = code
    this.stage = options.stage || 'contract'
    this.taskId = options.taskId || null
    this.capabilityId = options.capabilityId || null
    this.resourceUris = Array.isArray(options.resourceUris) ? [...options.resourceUris] : []
    this.recoverable = options.recoverable !== false
    this.nextActions = Array.isArray(options.nextActions) ? [...options.nextActions] : []
  }

  toJSON() {
    return {
      code: this.code,
      stage: this.stage,
      taskId: this.taskId,
      capabilityId: this.capabilityId,
      resourceUris: this.resourceUris,
      message: this.message,
      recoverable: this.recoverable,
      nextActions: this.nextActions
    }
  }
}

export function contractError(message, options = {}) {
  return new AiCoreError('AI_CORE_CONTRACT_INVALID', message, { ...options, stage: options.stage || 'contract' })
}

export function policyDenied(message, options = {}) {
  return new AiCoreError('POLICY_SCOPE_DENIED', message, { ...options, stage: options.stage || 'authorize' })
}

export function capabilityNotFound(capabilityId) {
  return new AiCoreError('CAPABILITY_NOT_FOUND', `未注册能力：${capabilityId}`, {
    capabilityId,
    stage: 'plan',
    nextActions: ['list_capabilities']
  })
}
