import { toIpcPayload } from '../utils/ipcPayload.js'

export const electronService = {
  aiCoreHealth() { return this.invoke('ai-core-health') },
  aiCoreListCapabilities(context = {}) { return this.invoke('ai-core-list-capabilities', { context }) },
  aiCorePlan(request) { return this.invoke('ai-core-plan', request) },
  aiCoreExecute(request) { return this.invoke('ai-core-execute', request) },
  aiCoreApproveTask(taskId, actorId = 'user:local') { return this.invoke('ai-core-task-approve', { taskId, actorId }) },
  aiCoreGetTask(taskId, actorId = 'user:local') { return this.invoke('ai-core-task-get', { taskId, actorId }) },
  aiCoreListTasks(actorId = 'user:local') { return this.invoke('ai-core-task-list', { actorId }) },
  aiCoreCancelTask(taskId, actorId = 'user:local') { return this.invoke('ai-core-task-cancel', { taskId, actorId }) },
  aiCoreUndoTask(taskId, actorId = 'user:local') { return this.invoke('ai-core-task-undo', { taskId, actorId }) },
  executeOfficeCommand(viewId,command) { return this.request('office-menu-command',{viewId,command}) },
  getOfficeDocumentSelection() { return this.request('office-get-selection') },
  openClipboardNote(noteId) { return this.request('clipboard-note-open', { noteId }) },
  openClipboardQuick() { return this.request('clipboard-quick-open') },
  getClipboardDesktopState() { return this.request('clipboard-desktop-state') },
  pasteClipboardItem(id, confirmSensitive = false) { return this.request('clipboard-paste', { id, confirmSensitive }) },
  startClipboardQueue(ids) { return this.request('clipboard-queue-start', { ids }) },
  clipboardQueue(action, args) { return this.request('clipboard-queue-' + action, args) },
  getClipboardImage(id, { thumbnail = true, index = 0, fileIndex, htmlIndex, loadExternal = false } = {}) {
    return this.request('clipboard-image', { id, thumbnail, index, fileIndex, htmlIndex, loadExternal })
  },
  getClipboardAsset(id, index = 0) { return this.request('clipboard-asset', { id, index }) },
  pinClipboardItem(id, expanded = false) { return this.request('clipboard-pin-open', { id, expanded }) },
  getClipboardAppend() { return this.request('clipboard-append-get') },
  setClipboardAppend(enabled) { return this.request('clipboard-append-set', { enabled }) },
  openClipboardLink(id) { return this.request('clipboard-open-link', { id }) },
  createClipboardShare(id) { return this.request('clipboard-share-create', { id }) },
  revokeClipboardShare(token) { return this.request('clipboard-share-revoke', { token }) },
  batchClipboardItems(args) { return this.request('clipboard-batch', args) },
  revealClipboardSecret(id) { return this.request('clipboard-secret-reveal', { id }) },
  getClipboardSettings() { return this.request('clipboard-settings-get') },
  saveClipboardSettings(settings) { return this.request('clipboard-settings-save', settings) },
  clearClipboardHistory() { return this.request('clipboard-clear') },
  getClipboardOrganization() { return this.request('clipboard-organization-get') },
  manageClipboardGroup(args) { return this.request('clipboard-group-manage', args) },
  createClipboardPhrase(args) { return this.request('clipboard-phrase-create', args) },
  getClipboardAiOptions() { return this.request('clipboard-ai-options') },
  analyzeClipboardItem(id) { return this.request('clipboard-ai-analyze', { id }) },
  saveClipboardToNote(id) { return this.request('clipboard-to-note', { id }) },
  async request(command, args) {
    if (!window.electronAPI) throw new Error('Electron API unavailable')
    const result = await window.electronAPI.invoke(command, toIpcPayload(args))
    if (result?.ok === false) throw Object.assign(new Error(result.error?.message || 'Operation failed'), result.error)
    return result
  },
  async invoke(command, args) {
    if (window.electronAPI) {
      try {
        return await window.electronAPI.invoke(command, args)
      } catch (e) {
        console.error(`IPC invoke '${command}' failed:`, e)
        return null
      }
    }
    console.warn('Electron API not available, invoke command:', command)
    return null
  },

  async saveFile(options) {
    if (window.electronAPI) {
      return window.electronAPI.invoke('save-file-dialog', options)
    }
    console.warn('Electron API not available, using fallback')
    return null
  },

  listen(event, callback) {
    if (window.electronAPI) {
      return window.electronAPI.on(event, (data) => {
        callback({ payload: data })
      })
    }
    console.warn('Electron API not available, cannot listen to event:', event)
    return () => {}
  },

  send(channel, data) {
    if (window.electronAPI) {
      window.electronAPI.send(channel, data)
    }
  },

  get isElectron() {
    return !!window.electronAPI
  }
}
