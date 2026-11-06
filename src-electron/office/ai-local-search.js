import { normalizeFileSearchPatch } from './ai-file-search-settings.js'

const MAX_HITS = 20
const EXCERPT_CHARS = 1200
const localEndpoint = endpoint => ['kev', 'rizzo', 'custom'].includes(endpoint)

async function readSettings() {
  const { readOfficeAiServiceSettings } = await import('./ai-service-settings-store.js')
  return readOfficeAiServiceSettings().fileSearch
}

async function loadReranker() {
  const { getHtmlFileSearchReranker } = await import('./office-host.js')
  return getHtmlFileSearchReranker()
}

/** 只将已命中的有限片段交给固定上游实现；关闭时不加载 Office 或发出请求。 */
export async function rerankLocalFileHits(query, hits, dependencies = {}) {
  if (!Array.isArray(hits) || hits.length < 2) return hits
  try {
    const settings = normalizeFileSearchPatch(await (dependencies.readSettings || readSettings)())
    if (!settings.rerank || (!localEndpoint(settings.endpoint) && !settings.keys[settings.endpoint])) return hits
    if (settings.endpoint === 'custom' && !settings.customBaseUrl) return hits
    if (settings.endpoint.startsWith('cloudflare') && !settings.cloudflareAccountId) return hits
    const Reranker = await (dependencies.loadReranker || loadReranker)()
    if (typeof Reranker !== 'function') return hits

    // 同一文件可能有多条命中；引用仅用于本次内存排序，不会据此读取磁盘。
    const candidates = hits.slice(0, MAX_HITS).map((hit, index) => ({
      path: `${String(hit.path || hit.uri || '')}#friday-search-hit-${index}`,
      name: String(hit.title || '').slice(0, 512),
      excerpt: String(hit.content || '').slice(0, EXCERPT_CHARS),
      hit,
    }))
    const byReference = new Map(candidates.map(item => [item.path, item]))
    const store = {
      excerptsFor(paths, _query, chars) {
        return paths.slice(0, MAX_HITS).flatMap(reference => {
          const candidate = byReference.get(reference)
          return candidate ? [{ path: candidate.path, name: candidate.name, excerpt: candidate.excerpt.slice(0, Math.min(EXCERPT_CHARS, Math.max(0, chars))) }] : []
        })
      },
    }
    const result = await new Reranker(store).rerank(String(query).slice(0, 2000), candidates.map(item => item.path), settings)
    if (!Array.isArray(result?.order)) return hits
    const seen = new Set()
    const ordered = result.order.filter(reference => byReference.has(reference) && !seen.has(reference) && seen.add(reference))
    if (!ordered.length) return hits
    const judged = ordered.map((reference, rerankOrder) => {
      const score = result.scores?.[reference]
      return { ...byReference.get(reference).hit, rerankOrder,
        ...(typeof score === 'number' && Number.isFinite(score) ? { rerankScore: score } : {}) }
    })
    return [...judged, ...candidates.filter(item => !seen.has(item.path)).map(item => item.hit), ...hits.slice(MAX_HITS)]
  } catch {
    // 缺配置、服务失败或 Office 尚不可用时保留本地搜索；不记录片段或凭证。
    return hits
  }
}

/** 混合搜索只重排已参与 Jev 判断的文件槽位，其余 Friday 内容保持原位置。 */
export function restoreLocalFileRerankOrder(hits) {
  const judged = hits.filter(hit => hit.type === 'knowledge_file' && Number.isInteger(hit.rerankOrder) && hit.rerankOrder >= 0)
    .sort((a, b) => a.rerankOrder - b.rerankOrder)
  if (judged.length < 2) return hits
  let index = 0
  return hits.map(hit => hit.type === 'knowledge_file' && Number.isInteger(hit.rerankOrder) && hit.rerankOrder >= 0 ? judged[index++] : hit)
}
