import { electronService } from '@/services/electron'

export const typewriterService = {
  createTerminal(options = {}) {
    return electronService.invoke('typewriter-terminal-create', options)
  },
  writeTerminal(sessionId, data) {
    return electronService.invoke('typewriter-terminal-write', { sessionId, data })
  },
  resizeTerminal(sessionId, cols, rows) {
    return electronService.invoke('typewriter-terminal-resize', { sessionId, cols, rows })
  },
  killTerminal(sessionId) {
    return electronService.invoke('typewriter-terminal-kill', { sessionId })
  },
  saveFile(filePath, content) {
    return electronService.invoke('typewriter-file-save', { filePath, content })
  },
  openFile(options = {}) {
    return electronService.invoke('open-file-dialog', options)
  },
  readFile(filePath) {
    return electronService.invoke('kb-read-file', { filePath })
  },
  saveDialog(options = {}) {
    return electronService.saveFile(options)
  },
  listenData(callback) {
    return electronService.listen('typewriter-terminal-data', callback)
  },
  listenExit(callback) {
    return electronService.listen('typewriter-terminal-exit', callback)
  },
  listenError(callback) {
    return electronService.listen('typewriter-terminal-error', callback)
  }
}
