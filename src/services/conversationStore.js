import { electronService } from './electron'

/**
 * Renderer 侧唯一会话边界。页面只提供 scope/scopeKey，所有 IPC 访问和
 * 快速选择竞态都在这里收口，避免 Dock/Office/笔记各自维护事实源。
 */
export const CONVERSATION_SCOPES = Object.freeze({
  main: { scope: 'friday', scopeKey: null },
  office: { scope: 'office', scopeKey: null },
  note: { scope: 'note-agent', scopeKey: null },
  knowledge: { scope: 'knowledge', scopeKey: null },
  schedule: { scope: 'schedule-agent', scopeKey: null },
  dock: { scope: 'dock', scopeKey: 'global' },
})

function normalizedScope(input = {}) {
  const preset = CONVERSATION_SCOPES[input.kind] || {}
  return {
    scope: String(input.scope || preset.scope || 'friday'),
    scopeKey: input.scopeKey == null || input.scopeKey === '' ? (preset.scopeKey ?? null) : String(input.scopeKey),
  }
}

export function createConversationStore(invoke = electronService.invoke.bind(electronService)) {
  const selectionEpochs = new Map()
  const scopeToken = (scope) => `${scope.scope}:${scope.scopeKey ?? ''}`
  const call = (channel, args = {}) => invoke(channel, args)
  return {
    normalizeScope: normalizedScope,
    async list(input = {}, query = {}) {
      const scope = normalizedScope(input)
      const args = { ...scope, ...query }
      const result = await call('get_sessions', args)
      if (Array.isArray(result) || Array.isArray(result?.sessions)) return result
      // Office overlay windows can briefly attach to a renderer generation
      // whose history endpoint still exposes the stats-shaped payload. Use
      // the same scoped source as a compatibility fallback instead of making
      // the history button look broken during that handoff.
      const stats = await call('get_sessions_with_stats', args)
      return Array.isArray(stats) || Array.isArray(stats?.sessions) ? stats : result
    },
    async create(input = {}) {
      const scope = normalizedScope(input)
      this.invalidateSelection(scope)
      return call('create_session', {
        ...scope,
        title: input.title || '新对话',
        mode: input.mode || 'chat',
        agentId: input.agentId,
        modelId: input.modelId,
        resourceUri: input.resourceUri,
      })
    },
    async load(id, input = {}) {
      const scope = normalizedScope(input)
      const token = scopeToken(scope)
      const epoch = (selectionEpochs.get(token) || 0) + 1
      selectionEpochs.set(token, epoch)
      const [session, messages] = await Promise.all([
        call('get_session', { ...scope, sessionId: id }),
        call('get_session_messages', { ...scope, sessionId: id }),
      ])
      return epoch === selectionEpochs.get(token) ? { session, messages, epoch } : { stale: true, session: null, messages: [], epoch }
    },
    invalidateSelection(input = {}) {
      const token = scopeToken(normalizedScope(input))
      const epoch = (selectionEpochs.get(token) || 0) + 1
      selectionEpochs.set(token, epoch)
      return epoch
    },
    async appendMessage(id, message, input = {}) {
      const scope = normalizedScope(input)
      const session = await call('get_session', { ...scope, sessionId: id })
      if (!session) throw new Error('会话不存在或范围不匹配')
      return call('save_message', { sessionId: id, role: message.role, content: message.content, scope: scope.scope, scopeKey: scope.scopeKey, metadata: message.metadata })
    },
    rename(id, title, input = {}) { return call('update_session_title', { ...normalizedScope(input), sessionId: id, title }) },
    archive(id, archived, input = {}) { return call('set_session_archived', { ...normalizedScope(input), sessionId: id, archived: archived !== false }) },
    pin(id, pinned, input = {}) { return call('set_session_pinned', { ...normalizedScope(input), sessionId: id, pinned: pinned === true }) },
    delete(id, input = {}) { return call('trash_session', { ...normalizedScope(input), sessionId: id }) },
    restore(id, input = {}) { return call('restore_session', { ...normalizedScope(input), sessionId: id }) },
  }
}

export const conversationStore = createConversationStore()
