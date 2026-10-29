/**
 * DSH → AI Core 的最小受限上下文适配器。
 * DSH 使用独立 actor/space，Preview.20 默认只读；写能力必须由 Friday
 * 页面或未来显式配对流程授予 write scope，不能从 legacy MCP token 推导。
 */
export function createDshCoreContext({ clientId = 'legacy', requestId, context = {}, scopes = [] } = {}) {
  const safeClientId = String(clientId || 'legacy').slice(0, 120)
  const readScopes = [...new Set((Array.isArray(scopes) ? scopes : []).filter(scope => scope === 'read' || scope === 'ui'))]
  return {
    source: 'dsh',
    runtime: 'dsh',
    actor: { id: `mcp:${safeClientId}`, type: 'dsh', clientId: safeClientId },
    spaceId: typeof context.spaceId === 'string' && context.spaceId.trim() ? context.spaceId : `external:dsh:${safeClientId}`,
    sessionId: typeof context.sessionId === 'string' ? context.sessionId : null,
    threadId: typeof context.threadId === 'string' ? context.threadId : null,
    resourceUris: Array.isArray(context.resourceUris) ? context.resourceUris.filter(uri => typeof uri === 'string').slice(0, 32) : [],
    scopes: readScopes.length ? readScopes : ['read'],
    requestId
  }
}
