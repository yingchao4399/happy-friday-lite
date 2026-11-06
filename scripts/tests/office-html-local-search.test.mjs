import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { rerankLocalFileHits, restoreLocalFileRerankOrder } from '../../src-electron/office/ai-local-search.js'

const hits = count => Array.from({ length: count }, (_, index) => ({ type: 'knowledge_file', path: `/knowledge/same-file.md`, title: `片段 ${index}`, content: `内容 ${index} ` + 'x'.repeat(2000), score: count - index, index }))
const configured = { rerank: true, endpoint: 'openrouter', keys: { openrouter: 'private-key' } }

test('关闭、缺少远端密钥及必要端点信息时不加载服务、不发送本机内容', async () => {
  const original = hits(4)
  let loads = 0
  for (const settings of [{}, { rerank: false }, { rerank: true }, { rerank: true, endpoint: 'custom' }, { rerank: true, endpoint: 'cloudflare', keys: { cloudflare: 'configured' } }]) {
    const result = await rerankLocalFileHits('query', original, { readSettings: () => settings, loadReranker: () => { loads++; throw new Error('不应加载') } })
    assert.equal(result, original)
  }
  assert.equal(loads, 0)
})

test('只交付前20条已命中片段，正文最多1200字；同文件不同片段可排序且词法分数不被改写', async () => {
  const original = hits(25)
  let sent
  class Reranker {
    constructor(store) { this.store = store }
    async rerank(query, paths, settings) {
      sent = this.store.excerptsFor([...paths, '/unselected-secret-file'], query, 5000)
      assert.equal(settings.keys.openrouter, 'private-key')
      const order = paths.slice().reverse()
      return { order, scores: Object.fromEntries(order.map((reference, index) => [reference, index === 0 ? 2 : 0])) }
    }
  }
  const ranked = await rerankLocalFileHits('query', original, { readSettings: () => configured, loadReranker: () => Reranker })
  assert.equal(sent.length, 20)
  assert.equal(new Set(sent.map(item => item.path)).size, 20)
  assert.ok(sent.every(item => item.excerpt.length === 1200))
  assert.deepEqual(ranked.map(item => item.index), [...Array.from({ length: 20 }, (_, index) => 19 - index), 20, 21, 22, 23, 24])
  assert.equal(ranked[0].score, original[19].score)
  assert.equal(ranked[0].rerankScore, 2)
  assert.equal(ranked[0].rerankOrder, 0)
  assert.equal(original[19].rerankOrder, undefined)
  assert.equal(ranked.slice(0, 1)[0].index, 19, '先对20条候选排序，再应用用户 limit')
  assert.equal(JSON.stringify(ranked).includes('private-key'), false)
})

test('故障或无结果保留原排序；未知或重复引用不能注入额外文件', async () => {
  const original = hits(3)
  for (const behavior of [() => { throw new Error('secret-provider-response') }, () => null, () => ({ order: ['/unselected-file'] })]) {
    class Failing { async rerank() { return behavior() } }
    const result = await rerankLocalFileHits('query', original, { readSettings: () => configured, loadReranker: () => Failing })
    assert.equal(result, original)
  }
  class Partial {
    async rerank(_query, paths) { return { order: [paths[1], paths[1], '/unselected-file'] } }
  }
  const partial = await rerankLocalFileHits('query', original, { readSettings: () => configured, loadReranker: () => Partial })
  assert.deepEqual(partial.map(item => item.index), [1, 0, 2])
  assert.equal(partial.length, original.length)
})

test('本机端点允许无密钥；混合结果只重排已判断的文件槽位，笔记和未判断文件位置不变', async () => {
  const original = hits(3)
  class Local {
    async rerank(_query, paths) { return { order: paths.slice().reverse(), scores: {} } }
  }
  const ranked = await rerankLocalFileHits('query', original, { readSettings: () => ({ rerank: true, endpoint: 'kev' }), loadReranker: () => Local })
  assert.deepEqual(ranked.map(item => item.index), [2, 1, 0])
  const note = { type: 'note', title: '笔记', score: 4 }
  const unjudged = { type: 'knowledge_file', title: '未参与判断', score: 2 }
  const mixed = [ranked[2], note, ranked[1], unjudged, ranked[0]]
  const restored = restoreLocalFileRerankOrder(mixed)
  assert.deepEqual(restored, [ranked[0], note, ranked[1], unjudged, ranked[2]])
  assert.equal(restored[1], note)
  assert.equal(restored[3], unjudged)
})

test('固定上游 SearchReranker 使用真实决策协议；只替换网络传输并回读重排结果', async () => {
  const compiled = await build({ entryPoints: [fileURLToPath(new URL('../../vendor/genoffice-html/apps/shell/src/main/file-index/rerank.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' })
  const { SearchReranker } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)
  let body
  class BoundReranker extends SearchReranker {
    constructor(store) {
      super(store, async (_url, request, key) => {
        assert.equal(key, '')
        body = JSON.parse(request)
        return { status: 200, body: JSON.stringify({ answers: Object.fromEntries(body.state.documents.map((_, index) => [`d${index}`, {
          type: 'score', score: index === 1 ? 2 : 0, confidence: 1, probabilities: index === 1 ? { 0: 0, 1: 0, 2: 1 } : { 0: 1, 1: 0, 2: 0 },
        }])) }) }
      })
    }
  }
  const original = hits(3)
  const ranked = await rerankLocalFileHits('精确查询', original, { readSettings: () => ({ rerank: true, endpoint: 'custom', customBaseUrl: 'http://localhost:8765', customModel: 'decision' }), loadReranker: () => BoundReranker })
  assert.equal(body.state.query, '精确查询')
  assert.equal(body.state.documents.length, 3)
  assert.ok(body.state.documents.every(item => item.text.length <= 1200))
  assert.deepEqual(ranked.map(item => item.index), [1, 0, 2])
  assert.equal(ranked[0].rerankScore, 2)
  assert.equal(ranked[0].score, original[1].score)
})
