import { z } from 'zod'
import { registerTool } from '../registry.js'
import { pathToFileURL } from 'node:url'
import { getResource } from '../../resources.js'

const schema = z.object({
  query: z.string().trim().min(2).describe('跨 Friday 内容搜索的关键词或问题'),
  limit: z.number().int().min(1).max(20).optional().describe('最多返回多少条结果，默认 10')
})

async function searchAllHandler({ query, limit = 10 }) {
  const { searchAllContent } = await import('../../../db.js')
  const results = searchAllContent(query, limit)
  const { searchKnowledgeContent } = await import('../../fileIndex.js')
  results.push(...await searchKnowledgeContent(query, limit))

  // 向量知识库可能尚未初始化或尚未配置 Embedding；其失败不能丢失本地结构化搜索结果。
  try {
    const { searchKnowledgeBase } = await import('../../../rag/index.js')
    const docs = await searchKnowledgeBase(query, null, null, limit, 0.35)
    for (const result of docs) {
      const metadata = result.doc?.metadata || {}
      if (!metadata.source) continue
      // 已删除、越界或已修改文件的旧向量不能作为当前来源返回。
      let resource
      try { resource = getResource(pathToFileURL(metadata.source).href) } catch { continue }
      if (metadata.fileModifiedAt && metadata.fileModifiedAt !== resource.updatedAt) continue
      results.push({
        id: `${metadata.source || 'file'}:${metadata.loc?.pageNumber || metadata.pageNumber || ''}`,
        type: 'knowledge_file',
        title: metadata.title || metadata.source || '知识库文件',
        content: result.doc?.pageContent || '',
        source: metadata.source || '',
        page: metadata.loc?.pageNumber || metadata.pageNumber || null,
        confidence: result.confidence,
        uri: metadata.source ? pathToFileURL(metadata.source).href : null,
        parseStatus: 'success'
      })
    }
  } catch (_error) {
    // RAG 子系统不是结构化内容搜索的硬依赖；结果会明确包含已成功搜索的资源。
  }

  const ranked = results.sort((a, b) => (b.score || 2) - (a.score || 2)).slice(0, limit)
  return JSON.stringify({ query, count: ranked.length, results: ranked }, null, 2)
}

registerTool({
  name: 'search_all',
  description: '在 Friday 的笔记、历史对话（含 AI 回复）、画布、日程与知识库文件中统一搜索。返回资源类型、片段、来源和 Friday 内部定位地址；结果可能因文件未解析或索引未完成而不完整。',
  schema,
  handler: searchAllHandler,
  meta: { requireApproval: false, exposedViaMcp: true, capabilityType: 'read' }
})
