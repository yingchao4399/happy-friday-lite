/** 返回可重试的惰性异步单例，初始化失败不会永久缓存 rejected Promise。 */
export function createRetryableAsyncGetter(factory) {
  let pending = null
  return function get() {
    if (!pending) {
      pending = Promise.resolve()
        .then(factory)
        .catch(error => {
          pending = null
          throw error
        })
    }
    return pending
  }
}

const REQUIRED_RUNTIME_METHODS = ['submit', 'approve', 'get', 'list', 'cancel', 'undo']

/** 健康检查需同时验证 Runtime 接口与可用能力目录，避免静态误报 ready。 */
export function createAiCoreHealthCheck({ getRuntime, loadCapabilities, contractVersion }) {
  return async function checkAiCoreHealth() {
    try {
      const runtime = await getRuntime()
      const capabilities = await loadCapabilities()
      const missingMethods = REQUIRED_RUNTIME_METHODS.filter(method => typeof runtime?.[method] !== 'function')
      if (missingMethods.length) {
        throw Object.assign(new Error('AI Core Runtime 接口不完整'), { code: 'AI_CORE_RUNTIME_INVALID' })
      }
      if (!Array.isArray(capabilities) || capabilities.length === 0) {
        throw Object.assign(new Error('AI Core 能力目录为空'), { code: 'AI_CORE_CATALOG_EMPTY' })
      }
      return {
        contractVersion,
        status: 'ready',
        runtimeAdapters: ['registry-backed-tools'],
        capabilityBus: 'registry',
        taskRuntime: 'active',
        uiAdapter: 'ai-core-ipc',
        capabilityCount: capabilities.length
      }
    } catch (error) {
      return {
        contractVersion,
        status: 'unavailable',
        runtimeAdapters: [],
        capabilityBus: 'unavailable',
        taskRuntime: 'unavailable',
        uiAdapter: 'ai-core-ipc',
        capabilityCount: 0,
        retryable: true,
        error: {
          code: error?.code || 'AI_CORE_RUNTIME_UNAVAILABLE',
          stage: error?.stage || 'initialize',
          message: 'AI Core 运行时初始化失败'
        }
      }
    }
  }
}
