import path from 'node:path'

const fault = code => Object.assign(new Error(code), { code })
const fileKey = value => {
  if (typeof value !== 'string' || value.includes('\0')) return null
  const key = path.resolve(value)
  return process.platform === 'win32' ? key.toLowerCase() : key
}
const pair = value => JSON.stringify([value?.projectId, value?.chatId])

// 历史存储复用现有服务；HTML 只能读取其当前文档解析出来的项目/会话。
export function createHtmlProjectBoundary({ resolveEntry }) {
  const grants = new WeakMap()
  return {
    wrap(channel, listener) {
      if (!channel.startsWith('project:')) return listener
      return async (event, request, ...rest) => {
        const entry = resolveEntry(event.sender)
        if (entry?.type !== 'html') return listener(event, request, ...rest)
        if (entry.presentation || event.senderFrame !== event.sender.mainFrame) throw fault('OFFICE_HTML_HISTORY_NOT_OWNED')
        const permitted = grants.get(entry) || new Set()
        grants.set(entry, permitted)
        if (channel === 'project:resolveChat') {
          if (fileKey(request?.filePath) !== fileKey(entry.filePath)) throw fault('OFFICE_HTML_HISTORY_NOT_OWNED')
        } else if (channel === 'project:rebindChat') {
          const oldPair = JSON.stringify([request?.projectId, request?.tempChatId])
          if (!permitted.has(oldPair) || (request?.newFilePath && fileKey(request.newFilePath) !== fileKey(entry.filePath))) throw fault('OFFICE_HTML_HISTORY_NOT_OWNED')
        } else if (['project:loadChat', 'project:appendChat'].includes(channel) && !permitted.has(pair(request))) {
          throw fault('OFFICE_HTML_HISTORY_NOT_OWNED')
        }
        const before = fileKey(entry.filePath)
        const result = await listener(event, request, ...rest)
        if (resolveEntry(event.sender) !== entry || before !== fileKey(entry.filePath)) throw fault('OFFICE_HTML_HISTORY_OWNER_CHANGED')
        if (['project:resolveChat', 'project:rebindChat'].includes(channel)) {
          if (typeof result?.projectId !== 'string' || typeof result?.chatId !== 'string') throw fault('OFFICE_HTML_HISTORY_CONTRACT_INVALID')
          permitted.add(pair(result))
        }
        return result
      }
    },
  }
}
