import path from 'node:path'
import { randomUUID } from 'node:crypto'

const fault = code => Object.assign(new Error(code), { code })
const fileKey = value => {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) return null
  const key = path.resolve(value)
  return process.platform === 'win32' ? key.toLowerCase() : key
}
const pair = value => JSON.stringify([value?.projectId, value?.chatId])
const scoped = new Set(['project:resolveChat', 'project:listChatsForFile', 'project:createChat', 'project:selectChatForFile', 'project:updateChatForFile'])
const resolved = new Set(['project:resolveChat', 'project:createChat', 'project:selectChatForFile', 'project:updateChatForFile', 'project:rebindChat', 'project:copyChatsToFile'])
const allowed = new Set([...scoped, 'project:loadChat', 'project:appendChat', 'project:rebindChat', 'project:copyChatsToFile'])
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value)

// 历史存储复用现有服务；HTML 只能读取其当前文档解析出来的项目/会话。
export function createHtmlProjectBoundary({ resolveEntry }) {
  const grants = new WeakMap()
  return {
    wrap(channel, listener) {
      if (!channel.startsWith('project:')) return listener
      return async (event, request, ...rest) => {
        const entry = resolveEntry(event.sender)
        if (entry?.type !== 'html') return listener(event, request, ...rest)
        if (entry.presentation || event.senderFrame !== event.sender.mainFrame || !allowed.has(channel) ||
          !request || typeof request !== 'object' || Array.isArray(request) || request.sessionId !== undefined) throw fault('OFFICE_HTML_HISTORY_NOT_OWNED')
        let scope = grants.get(entry)
        if (!scope) {
          scope = { permitted: new Set(), known: new Set(), projectId: null, file: null, rawFile: null, tempAlias: null, hostTempId: `unsaved-${randomUUID()}` }
          grants.set(entry, scope)
        }
        const permitted = scope.permitted
        let forwarded = request
        if (scoped.has(channel)) {
          if ((request.filePath != null && !fileKey(request.filePath)) || fileKey(request.filePath) !== fileKey(entry.filePath)) throw fault('OFFICE_HTML_HISTORY_NOT_OWNED')
          if (!entry.filePath) {
            if (!validId(request.tempChatId) || (scope.tempAlias && request.tempChatId !== scope.tempAlias)) throw fault('OFFICE_HTML_HISTORY_NOT_OWNED')
            if (!scope.tempAlias) scope.tempAlias = request.tempChatId
          }
          if (['project:selectChatForFile', 'project:updateChatForFile'].includes(channel) && !scope.known.has(request.chatId)) throw fault('OFFICE_HTML_HISTORY_NOT_OWNED')
          // 未保存组名由宿主生成；renderer提供的临时名只作为本视图内的别名。
          forwarded = { ...request, filePath: entry.filePath || null, ...(!entry.filePath ? { tempChatId: scope.hostTempId } : {}) }
        } else if (channel === 'project:copyChatsToFile') {
          if (!scope.rawFile || fileKey(request.sourceFilePath) !== scope.file ||
            !permitted.has(pair({ projectId: scope.projectId, chatId: request.currentChatId })) ||
            !fileKey(request.newFilePath) || fileKey(request.newFilePath) !== fileKey(entry.filePath) || scope.file === fileKey(entry.filePath)) throw fault('OFFICE_HTML_HISTORY_NOT_OWNED')
          forwarded = { sourceFilePath: scope.rawFile, currentChatId: request.currentChatId, newFilePath: entry.filePath }
        } else if (channel === 'project:rebindChat') {
          const oldPair = JSON.stringify([request?.projectId, request?.tempChatId])
          if (!permitted.has(oldPair) || !fileKey(request.newFilePath) || fileKey(request.newFilePath) !== fileKey(entry.filePath) || request.newChatId !== undefined) throw fault('OFFICE_HTML_HISTORY_NOT_OWNED')
          forwarded = { ...request, newFilePath: entry.filePath }
        } else if ((channel === 'project:loadChat' && scope.file !== fileKey(entry.filePath)) || !permitted.has(pair(request))) {
          throw fault('OFFICE_HTML_HISTORY_NOT_OWNED')
        }
        if (channel === 'project:appendChat') forwarded = { ...request, durable: true }
        const before = fileKey(entry.filePath)
        const result = await listener(event, forwarded, ...rest)
        // append 的归属已在调用前核验，且 durable 结果代表旧会话已经写盘。
        // 同一文档首存/另存可以改变路径；此时拒绝回执会令队列重写已落盘消息。
        // 读取和身份解析仍须匹配原路径，所有通道仍须属于同一个视图 entry。
        if (resolveEntry(event.sender) !== entry || (channel !== 'project:appendChat' && before !== fileKey(entry.filePath))) throw fault('OFFICE_HTML_HISTORY_OWNER_CHANGED')
        if (channel === 'project:listChatsForFile') {
          if (!Array.isArray(result) || result.some(item => !validId(item?.chatId))) throw fault('OFFICE_HTML_HISTORY_CONTRACT_INVALID')
          for (const item of result) scope.known.add(item.chatId)
        }
        if (resolved.has(channel)) {
          if (!validId(result?.projectId) || !validId(result?.chatId)) throw fault('OFFICE_HTML_HISTORY_CONTRACT_INVALID')
          if (['project:rebindChat', 'project:copyChatsToFile'].includes(channel) || (scope.file !== before && channel === 'project:resolveChat')) {
            permitted.clear()
            scope.known.clear()
            scope.projectId = null
          }
          if (scope.projectId && scope.projectId !== result.projectId) throw fault('OFFICE_HTML_HISTORY_CONTRACT_INVALID')
          scope.projectId = result.projectId
          scope.file = before
          scope.rawFile = entry.filePath || null
          scope.known.add(result.chatId)
          permitted.add(pair(result))
        }
        return result
      }
    },
  }
}
