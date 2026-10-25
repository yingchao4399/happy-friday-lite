import { z } from 'zod'
import { executeCapability, registerTool } from './tools/registry.js'
import { getResource } from './resources.js'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { getDataDir } from '../config.js'

const readable = /^(get[_-]|list[_-]|search[_-]|check[_-]|rag-get-|agent-list-|kb-(?:list|read|get|search)|obsidian-(?:get|list)|session-get$)/
const externalBusiness = /^(?:(?:get|search|create|import|update|delete|restore|save)_(?:notes?|notebooks?|drawing|schedule|sessions?|messages?)|kb-(?:read-file(?:-buffer)?|read-sqlite|read-dir|search-files|create-dir|mkdir|copy-file|copy-folder|copy-drop-items|save-webpage|save-note|delete-dir|rename-dir)|automation-(?:get|list|create|update|delete|run)|office-(?:open-file|new|close|get-state|get-recents|is-dirty|export))([_-]|$)/

function assertKnowledgeDirectory(candidate) {
  if (typeof candidate !== 'string' || !candidate) throw new Error('知识库目录参数无效')
  const root = path.resolve(getDataDir(), 'knowledge')
  const resolved = path.resolve(candidate)
  const relative = path.relative(root, resolved)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('外部操作只能访问 Friday 知识库目录')
  let current = resolved
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) throw new Error('知识库路径无效')
    current = parent
  }
  const realRoot = fs.realpathSync(root).toLowerCase()
  const realCurrent = fs.realpathSync(current).toLowerCase()
  if (realCurrent !== realRoot && !realCurrent.startsWith(realRoot + path.sep.toLowerCase())) throw new Error('知识库路径不能通过符号链接离开数据目录')
  return resolved
}

function authorizeKnowledgePaths(channel, args) {
  if (!channel.startsWith('kb-')) return
  const value = args[0] || {}
  if (/^kb-read-file(?:-buffer)?$/.test(channel) || channel === 'kb-read-sqlite') {
    if (typeof value.filePath !== 'string') throw new Error('文件路径无效')
    getResource(pathToFileURL(value.filePath).href)
  } else if (['kb-copy-file', 'kb-copy-folder', 'kb-copy-drop-items'].includes(channel)) {
    assertKnowledgeDirectory(value.destDir)
    const sources = channel === 'kb-copy-drop-items' ? value.srcPaths : [value.srcPath]
    if (!Array.isArray(sources) || !sources.length) throw new Error('知识库来源参数无效')
    const visited = new Set()
    const checkSource = source => {
      const checked = assertKnowledgeDirectory(source)
      const real = fs.realpathSync(checked).toLowerCase()
      if (visited.has(real)) return
      visited.add(real)
      if (fs.statSync(checked).isDirectory()) {
        for (const entry of fs.readdirSync(checked)) checkSource(path.join(checked, entry))
      }
    }
    for (const source of sources) checkSource(source)
  } else if (channel === 'kb-rename-dir') {
    assertKnowledgeDirectory(value.oldPath)
    assertKnowledgeDirectory(value.newPath)
  } else {
    const target = value.dirPath || value.parentPath || value.destDir || value.path
    if (target) assertKnowledgeDirectory(target)
  }
}

/** 保留现有 IPC 协议，以注册适配器把 UI 业务调用纳入同一校验与审计入口。 */
export function installIpcCapabilityGateway(ipcMain, getMainWindow) {
  if (ipcMain.__fridayGateway) return
  ipcMain.__fridayGateway = true
  const handle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, handler) => {
    const name = `app_${channel.replace(/[^a-zA-Z0-9_]/g, '_')}`
    const read = readable.test(channel) || ['trash-list', 'clipboard-list', 'clipboard-image', 'clipboard-settings-get', 'clipboard-organization-get', 'clipboard-ai-options', 'kb-read-sqlite'].includes(channel) || /^office-(?:get-state|get-recents|is-dirty|open-file)$/.test(channel)
    const exposed = externalBusiness.test(channel)
    registerTool({
      name,
      description: `Friday 应用动作 ${channel}。参数为原 IPC 的位置参数数组 args；操作完成后返回真实业务结果。`,
      schema: z.object({ args: z.array(z.unknown()).max(12).default([]) }),
      handler: async ({ args }, ctx) => {
        // 界面可读取用户打开的本地文件；外部文件操作限定在 Friday 知识库。
        if (ctx.capabilityPolicy?.requireMcpExposure) authorizeKnowledgePaths(channel, args)
        const window = ctx.mainWindow || getMainWindow()
        const event = ctx.ipcEvent || { sender: window?.webContents, senderFrame: window?.webContents?.mainFrame }
        return handler(event, ...args)
      },
      meta: {
        requireApproval: !read,
        capabilityType: read ? 'read' : /^office-open-file$/.test(channel) ? 'navigation' : 'write',
        requiredScopes: /^office-(?:get-state|get-recents|is-dirty)$/.test(channel) ? ['ui'] : /^office-open-file$/.test(channel) ? ['ui'] : /^office-(?:new|close)$/.test(channel) ? ['ui', 'write'] : undefined,
        exposedViaMcp: exposed, catalogOnly: true,
        sensitive: /config|model|token|credential|mcp|harness|clipboard|trash|recitation/i.test(channel)
      }
    })
    return handle(channel, (event, ...args) => executeCapability(name, { args }, {
      actor: 'friday-ui', ipcEvent: event, mainWindow: getMainWindow(), emit: () => {}
    }, { actor: 'friday-ui' }))
  }
}
