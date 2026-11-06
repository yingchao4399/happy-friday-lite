import { randomUUID } from 'node:crypto'

const fault = code => Object.assign(new Error(code), { code })

// 请求绑定 WebContents 和主 frame；迟到响应、子 frame 与其他文档均不能提交。
export function createHtmlDocumentBridge(ipcMain) {
  const pending = new Map()
  const receive = (event, packet) => {
    const task = pending.get(packet?.id)
    if (!task || event.sender !== task.sender || event.senderFrame !== task.sender.mainFrame) return
    task.finish(packet.error ? fault(/^OFFICE_[A-Z_]+$/.test(packet.error) ? packet.error : 'OFFICE_HTML_OPERATION_FAILED') : null, packet.result)
  }
  ipcMain.on('friday:html-document-result', receive)
  ipcMain.handle('friday:html-document-commit', (event, id) => {
    const task = pending.get(id)
    if (!task || event.sender !== task.sender || event.senderFrame !== task.sender.mainFrame) return false
    task.committed = true
    return true
  })
  return {
    request(sender, request, { signal, timeoutMs = 120000 } = {}) {
      if (!sender || sender.isDestroyed() || signal?.aborted) return Promise.reject(fault('OFFICE_OPERATION_CANCELLED'))
      return new Promise((resolve, reject) => {
        const id = randomUUID()
        const cancel = () => { if (!pending.get(id)?.committed) finish(fault('OFFICE_OPERATION_CANCELLED')) }
        const closed = () => finish(fault('OFFICE_SOURCE_CHANGED'))
        const timer = setTimeout(() => finish(fault('OFFICE_HTML_OPERATION_TIMEOUT')), timeoutMs)
        const finish = (error, result) => {
          if (!pending.delete(id)) return
          clearTimeout(timer)
          signal?.removeEventListener('abort', cancel)
          sender.removeListener('destroyed', closed)
          if (error) reject(error)
          else resolve(result)
        }
        pending.set(id, { sender, finish })
        signal?.addEventListener('abort', cancel, { once: true })
        sender.once('destroyed', closed)
        try { sender.send('friday:html-document-request', { ...request, id }) } catch { closed() }
      })
    },
    dispose() {
      ipcMain.removeListener('friday:html-document-result', receive)
      ipcMain.removeHandler('friday:html-document-commit')
      for (const task of [...pending.values()]) task.finish(fault('OFFICE_HOST_UNAVAILABLE'))
    },
  }
}
