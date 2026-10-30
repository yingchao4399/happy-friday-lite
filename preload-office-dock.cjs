const { contextBridge, ipcRenderer } = require('electron')

// Office 覆盖层只暴露 Dock 所需的 AI Core 查询、任务控制和自身边界命令。
const channels = new Set([
  'ai-core-list-capabilities',
  'ai-core-task-list',
  'ai-core-task-approve',
  'ai-core-task-pause',
  'ai-core-task-resume',
  'ai-core-task-cancel',
  'office-dock-set-expanded',
  'office-dock-move',
  'office-dock-set-position',
  'office-dock-open-friday'
])

contextBridge.exposeInMainWorld('electronAPI', {
  invoke(channel, args) {
    if (!channels.has(channel)) throw new Error('Office Dock channel unavailable')
    return ipcRenderer.invoke(channel, args)
  }
})
