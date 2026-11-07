// HTML 与其他 Office 共用项目聊天服务；只管理当前文档的会话，不接触历史文件。
export function createHtmlHistorySession({ api, filePath = null, tempChatId, onState = () => {}, onLoad = () => {}, onError = () => {}, onInvalidate = () => {} }) {
  let ids = null
  let boundPath = filePath
  let requestedPath = filePath
  let epoch = 0
  let ready = false
  let disposed = false
  let changing = false
  let initializing = null
  let draining = null
  const pending = []
  const scope = () => ({ filePath: boundPath, tempChatId })
  const state = () => ({ ids, ready, changing, epoch })
  const publish = () => { if (!disposed) onState(state()) }
  const fault = error => { if (!disposed) onError(error) }
  const current = version => !disposed && version === epoch
  const validateIds = value => {
    if (!value || typeof value.projectId !== 'string' || !value.projectId || typeof value.chatId !== 'string' || !value.chatId) throw new Error('OFFICE_HTML_HISTORY_ID_INVALID')
    return { projectId: value.projectId, chatId: value.chatId }
  }
  const ownershipChanged = error => ['OFFICE_HTML_HISTORY_OWNER_CHANGED', 'OFFICE_HTML_HISTORY_NOT_OWNED']
    .some(code => error?.code === code || String(error?.message ?? error).includes(code))
  const flush = () => {
    if (draining) return draining
    const batch = (async () => {
      while (pending.length) {
        const item = pending[0]
        await api.appendChat({ ...item.ids, ...item.message })
        pending.shift()
      }
    })()
    // 保持 draining 覆盖收尾微任务。上一批写完与清空锁之间追加的消息，
    // 也必须写完后才能兑现 append()，否则最后一条消息会一直留在内存。
    draining = batch.then(() => {
      draining = null
      return pending.length ? flush() : undefined
    }, error => {
      draining = null
      fault(error)
      throw error
    })
    return draining
  }
  const initialize = async () => {
    if (initializing) return initializing
    const version = ++epoch
    ready = false
    publish()
    initializing = (async () => {
      try {
        const startedUnsaved = !ids && boundPath == null
        while (current(version)) {
          const loadingPath = boundPath
          // 初始化前尚不能发送消息。此时首存无需搬运未授权的旧临时会话，
          // 必须改用最新宿主路径解析；旧请求即使成功也不能恢复旧上下文。
          const savedDuringLoad = () => startedUnsaved && !ids && requestedPath && requestedPath !== loadingPath
          try {
            const resolved = validateIds(await api.resolveChat(scope()))
            const messages = await api.loadChat({ ...resolved, limit: 200 })
            if (!current(version)) return
            if (savedDuringLoad()) { boundPath = requestedPath; continue }
            ids = resolved
            ready = true
            onLoad(messages)
            publish()
            return
          } catch (error) {
            if (!current(version)) return
            if (savedDuringLoad() && ownershipChanged(error)) { boundPath = requestedPath; continue }
            throw error
          }
        }
      } catch (error) { ready = false; publish(); fault(error); throw error }
    })()
    try { await initializing } finally { initializing = null }
  }
  const move = async (action, { load = true } = {}) => {
    if (disposed) return
    if (changing) throw new Error('OFFICE_HTML_HISTORY_BUSY')
    if (!ids) await initialize()
    if (changing) throw new Error('OFFICE_HTML_HISTORY_BUSY')
    if (disposed) return
    changing = true
    const version = ++epoch
    try {
      onInvalidate()
      ready = false
      publish()
      await flush()
      if (!current(version)) return
      const next = validateIds(await action())
      // 服务先确认归属和选择，renderer 再读取；读取失败保持不可发送，允许重试。
      if (!current(version)) return
      ids = next
      const messages = load ? await api.loadChat({ ...next, limit: 200 }) : []
      if (!current(version)) return
      ready = true
      onLoad(messages)
    } catch (error) { ready = false; fault(error); throw error } finally {
      if (current(version)) { changing = false; publish() }
    }
  }
  return {
    get ready() { return ready && !disposed && !changing },
    get epoch() { return epoch },
    get ids() { return ids },
    scope,
    initialize,
    flush,
    append(message) {
      if (!ids || !ready || disposed) { fault(new Error('OFFICE_HTML_HISTORY_NOT_READY')); return Promise.reject(new Error('OFFICE_HTML_HISTORY_NOT_READY')) }
      // 每次写入捕获原会话身份；切换后仍不能把旧消息写入新会话。
      pending.push({ ids: { ...ids }, message: { ...message } })
      return flush()
    },
    async listChats() {
      if (!ids) await initialize()
      if (changing || disposed) throw new Error('OFFICE_HTML_HISTORY_BUSY')
      const version = epoch
      const owner = scope()
      await flush()
      if (!current(version)) throw new Error('OFFICE_HTML_HISTORY_STALE')
      const result = await api.listChatsForFile(owner)
      if (!current(version)) throw new Error('OFFICE_HTML_HISTORY_STALE')
      return result
    },
    createChat() { return move(() => api.createChat(scope()), { load: false }) },
    selectChat(chatId) {
      if (chatId === ids?.chatId && ready) return Promise.resolve()
      return move(() => api.selectChatForFile({ ...scope(), chatId }))
    },
    updateChat(chatId, patch) { return move(() => api.updateChatForFile({ ...scope(), chatId, patch })) },
    async rebind(nextPath) {
      if (!nextPath) return
      requestedPath = nextPath
      if (nextPath === boundPath) return
      if (!ids) await initialize()
      if (nextPath === boundPath || disposed) return
      return move(async () => {
        const next = validateIds(boundPath
          ? await api.copyChatsToFile({ sourceFilePath: boundPath, currentChatId: ids.chatId, newFilePath: nextPath })
          : await api.rebindChat({ projectId: ids.projectId, tempChatId: ids.chatId, newFilePath: nextPath }))
        boundPath = nextPath
        return next
      })
    },
    async retry() {
      if (changing) throw new Error('OFFICE_HTML_HISTORY_BUSY')
      await flush()
      return initialize()
    },
    dispose() { disposed = true; epoch++; ready = false },
  }
}
