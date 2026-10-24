import path from 'node:path'

export const clipboardDefaults = Object.freeze({
  trayEnabled: true, closeToTray: false,
  captureEnabled: true, captureImages: true, captureSensitive: true,
  captureRecordings: true, recordingFolders: Object.freeze([]),
  maxItems: 500, retentionDays: 30, sensitiveMinutes: 15,
  shortcutEnabled: true, shortcut: 'CommandOrControl+Shift+V',
  aiEnabled: false, aiModelId: '', aiTranscriptionModelId: 'windows-local', aiNotebookId: '', aiThreshold: 0.8, aiInstructions: ''
})

export const clipboardShortcuts = ['CommandOrControl+Shift+V', 'CommandOrControl+Alt+V', 'Alt+Shift+V']

// 本轮只验收应用内剪贴板。系统监听、托盘、全局快捷键、录屏自动收录、钉窗和网络分享
// 留到下一轮；保留旧配置字段以便升级后可恢复，不让旧值重新启动这些入口。
export const clipboardCapabilities = Object.freeze({
  externalCapture: false,
  tray: false,
  globalShortcut: false,
  recordingCapture: false,
  screenPin: false,
  networkShare: false,
})

export function normalizeClipboardSettings(value = {}) {
  const result = { ...clipboardDefaults }
  for (const key of ['trayEnabled', 'closeToTray', 'captureEnabled', 'captureImages', 'captureSensitive', 'captureRecordings', 'shortcutEnabled', 'aiEnabled']) {
    if (typeof value?.[key] === 'boolean') result[key] = value[key]
  }
  for (const [key, choices] of Object.entries({ maxItems: [100, 500, 1000, 2000], retentionDays: [0, 1, 7, 30, 90], sensitiveMinutes: [1, 5, 15] })) {
    if (choices.includes(value?.[key])) result[key] = value[key]
  }
  if (clipboardShortcuts.includes(value?.shortcut)) result.shortcut = value.shortcut
  for (const key of ['aiModelId', 'aiTranscriptionModelId', 'aiNotebookId', 'aiInstructions']) if (typeof value?.[key] === 'string') result[key] = value[key].slice(0, key === 'aiInstructions' ? 500 : 100)
  if (!result.aiTranscriptionModelId) result.aiTranscriptionModelId = 'windows-local'
  if ([0.6, 0.8, 0.9].includes(value?.aiThreshold)) result.aiThreshold = value.aiThreshold
  if (Array.isArray(value?.recordingFolders)) result.recordingFolders = [...new Set(value.recordingFolders.filter(folder => typeof folder === 'string' && path.isAbsolute(folder) && folder.trim() && folder.length <= 32767 && !/[\x00-\x1f]/.test(folder)))].slice(0, 12)
  return result
}

export function validateClipboardSettings(value) {
  const normalized = normalizeClipboardSettings(value)
  if (!value || Object.keys(clipboardDefaults).some(key => key === 'recordingFolders' ? JSON.stringify(normalized[key]) !== JSON.stringify(value[key]) : normalized[key] !== value[key])) {
    throw Object.assign(new Error('CLIPBOARD_SETTINGS_INVALID'), { code: 'CLIPBOARD_SETTINGS_INVALID' })
  }
  return normalized
}

// 容量只计算未置顶条目；自动清理进入最近删除，敏感内容仍遵守独立过期时间。
export function clipboardRetentionIds(items, settings, now = Date.now()) {
  const sorted = items.filter(item => !item.deletedAt && !item.pinned && !item.favorite && !item.phrase)
    .sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)))
  return sorted.filter((item, index) => index >= settings.maxItems ||
    (settings.retentionDays > 0 && Date.parse(item.capturedAt) < now - settings.retentionDays * 86400000))
    .map(item => item.id)
}
