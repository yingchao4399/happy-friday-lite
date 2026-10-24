import { z } from 'zod'
import { registerTool } from '../registry.js'
import { getResource, readResource, resourceNavigation } from '../../resources.js'
import { getResourceLinks, linkResources, unlinkResources, queryAllRaw } from '../../../db.js'
import { transcribeMedia, mediaFormats } from '../../../rag/mediaTranscription.js'
import { listKnowledgeResources, documentFormats } from '../../fileIndex.js'

registerTool({
  name: 'list_execution_records', description: '读取当前调用主体自己的能力执行记录，包含参数、实际结果、状态及耗时。不能读取其他客户端的记录。',
  schema: z.object({ limit: z.number().int().min(1).max(100).default(30) }),
  handler: async ({ limit }, ctx) => JSON.stringify(queryAllRaw('SELECT id, actor, threadId, requestId, toolName, arguments, output, status, durationMs, createdAt FROM agent_tool_logs WHERE actor = ? ORDER BY createdAt DESC LIMIT ?', [ctx.capabilityPolicy?.actor || ctx.actor || 'friday-agent', limit])),
  meta: { exposedViaMcp: true, capabilityType: 'read' }
})

registerTool({
  name: 'list_resources', description: '列出知识库文件资源及解析状态，并返回当前格式覆盖表。未支持的文件也保持可见。',
  schema: z.object({}),
  handler: async () => JSON.stringify({ resources: listKnowledgeResources(), formats: { documentsAndOcr: documentFormats, audioTranscription: mediaFormats } }),
  meta: { exposedViaMcp: true, capabilityType: 'read' }
})

registerTool({
  name: 'transcribe_media', description: '转写知识库音频或视频的声音，保存带文件版本的正文供检索。省略 modelId 或使用 windows-local 时，使用 Windows 已安装的本机语音语言包，不上传文件；其他 modelId 须支持 OpenAI 兼容 /audio/transcriptions，并会将文件发送给所选模型服务。上限 25 MB，执行前需审批。',
  schema: z.object({ uri: z.string().url(), modelId: z.string().min(1).optional() }),
  handler: async ({ uri, modelId }, ctx) => {
    const resource = getResource(uri)
    if (resource.type !== 'knowledge_file') throw new Error('请选择知识库媒体文件')
    return JSON.stringify(await transcribeMedia(resource.path, modelId, ctx.signal))
  },
  meta: { requireApproval: true, exposedViaMcp: true, capabilityType: 'write' }
})

registerTool({
  name: 'get_resource',
  description: '读取 search_all 返回的 Friday 资源地址对应的当前内容和来源片段。可解析文件返回分页或工作表片段；未知格式明确报告不支持。',
  schema: z.object({ uri: z.string().url().describe('search_all 返回的 friday:// 或 file:// 资源地址') }),
  handler: async ({ uri }) => JSON.stringify(await readResource(uri)),
  meta: { requireApproval: false, exposedViaMcp: true, capabilityType: 'read' }
})

registerTool({
  name: 'open_at_span',
  description: '在 Friday 窗口打开资源并定位到消息、笔记、画布或文件；可提供要高亮的原文片段。返回实际导航结果。',
  schema: z.object({
    uri: z.string().url().describe('search_all 返回的资源地址'),
    selection: z.string().max(500).optional().describe('要定位的原文片段')
  }),
  handler: async ({ uri, selection = '' }, ctx) => {
    const payload = resourceNavigation(uri, selection)
    const { BrowserWindow } = await import('electron')
    const window = ctx.mainWindow || BrowserWindow.getAllWindows().find(item => !item.isDestroyed())
    if (!window || window.isDestroyed()) throw new Error('Friday 窗口未运行')
    const result = await window.webContents.executeJavaScript(
      `window.fridayOpenResource?.(${JSON.stringify(payload)})`, true
    )
    if (!result?.success) throw new Error(result?.error || '界面未确认资源已打开')
    return JSON.stringify(result)
  },
  meta: { requireApproval: false, exposedViaMcp: true, capabilityType: 'navigation' }
})

registerTool({
  name: 'traverse_links',
  description: '读取与指定 Friday 资源相连的来源、引用和衍生关系，包括入站与出站链接。',
  schema: z.object({ uri: z.string().url(), limit: z.number().int().min(1).max(200).optional() }),
  handler: async ({ uri, limit = 50 }) => {
    getResource(uri)
    const links = getResourceLinks(uri, limit)
    return JSON.stringify(links.map(link => ({ ...link,
      currentFromVersion: safeVersion(link.fromUri), currentToVersion: safeVersion(link.toUri),
      stale: safeVersion(link.fromUri) !== link.fromVersion || safeVersion(link.toUri) !== link.toVersion
    })))
  },
  meta: { requireApproval: false, exposedViaMcp: true, capabilityType: 'read' }
})

registerTool({
  name: 'link_resources',
  description: '明确记录两个现存 Friday 资源之间的引用或衍生关系，并保留证据。',
  schema: z.object({
    fromUri: z.string().url(), toUri: z.string().url(),
    relation: z.enum(['references', 'summarizes', 'explains', 'answers', 'contradicts', 'derived_from', 'related']),
    evidence: z.string().max(1000).optional()
  }),
  handler: async ({ fromUri, toUri, relation, evidence = '' }, ctx) => {
    const source = getResource(fromUri)
    const target = getResource(toUri)
    return JSON.stringify(linkResources(fromUri, toUri, relation, evidence, ctx.actor || 'friday-agent', { fromVersion: source.contentVersion, toVersion: target.contentVersion }))
  },
  meta: { requireApproval: true, exposedViaMcp: true, capabilityType: 'write' }
})

function safeVersion(uri) {
  try { return getResource(uri).contentVersion } catch { return null }
}

registerTool({
  name: 'unlink_resources',
  description: '撤销一个明确的 Friday 资源关系。',
  schema: z.object({ id: z.string().uuid() }),
  handler: async ({ id }) => JSON.stringify({ removed: unlinkResources(id) }),
  meta: { requireApproval: true, exposedViaMcp: true, capabilityType: 'write' }
})
