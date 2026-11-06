const { contextBridge, ipcRenderer } = require('electron')

// Office 覆盖层与主页面复用同一套 Dock 会话合同：历史、新建、输入、
// 发送/取消和流事件都必须穿过这个 preload。只暴露 Dock 需要的白名单，
// 不把完整主窗口 API 面暴露给 Office WebContentsView。
const channels = new Set([
  'get-config',
  'get_sessions',
  'get_sessions_with_stats',
  'get_session',
  'get_session_messages',
  'create_session',
  'update_session_title',
  'delete_session',
  'set_session_pinned',
  'set_session_archived',
  'trash_session',
  'restore_session',
  'save_message',
  'rollback_session',
  'chat_with_memory',
  'chat_without_memory',
  'stop_chat',
  'ai-core-list-capabilities',
  'ai-core-task-list',
  'ai-core-task-approve',
  'ai-core-task-pause',
  'ai-core-task-resume',
  'ai-core-task-cancel',
  'office-get-capabilities',
  'office-get-operation-task',
  'office-cancel-operation-task',
  'office-reopen-artifact',
  'office-dock-set-expanded',
  'office-dock-move',
  'office-dock-set-position',
  'office-dock-open-friday'
])

contextBridge.exposeInMainWorld('electronAPI', {
  invoke(channel, args) {
    if (!channels.has(channel)) throw new Error('Office Dock channel unavailable')
    return ipcRenderer.invoke(channel, args)
  },
  on(channel, callback) {
    const events = new Set(['chat-chunk', 'chat-done', 'chat-error', 'chat-session-created', 'session-title-updated', 'config-changed', 'office-operation-updated', 'office-operation-progress'])
    if (!events.has(channel)) return () => {}
    const subscription = (event, ...args) => callback(...args)
    ipcRenderer.on(channel, subscription)
    return () => ipcRenderer.removeListener(channel, subscription)
  }
})
