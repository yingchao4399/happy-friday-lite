import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { setDataDir, saveConfig } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import { clearEmbeddingsCache } from '../src-electron/rag/embeddings.js'
import { clearStoreCache } from '../src-electron/rag/vectorstore.js'
import { rebuildKbStore, getKbIndexSummary, searchKnowledgeBase } from '../src-electron/rag/index.js'

// 此探针只在独立目录操作合成文档；本地 HTTP fixture 验证请求协议和完整
// Zvec/SQLite 链路，不代表真实远端模型的语义质量或用户 API 配置已可用。
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-rag-recovery-'))
const originalLog = console.log
const originalWarn = console.warn
const originalError = console.error
const logs = []
let requests = 0
let server
const capture = (...args) => logs.push(args.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' '))
console.log = console.warn = console.error = capture

try {
  setDataDir(dataDir)
  db.setDataDir(dataDir)
  await db.initDb()
  const folder = path.join(dataDir, 'knowledge', 'personal', 'probe')
  fs.mkdirSync(folder, { recursive: true })
  const source = path.join(folder, 'synthetic-rag.md')
  const content = '# Recovery probe\n\nThe recovery marker is RAG_RECOVERY_42. This synthetic note validates document loading, chunking, persistence and retrieval.\n'
  fs.writeFileSync(source, content)
  saveConfig({ customModels: [{ id: 'probe', provider: 'other', baseUrl: 'http://127.0.0.1', apiKey: 'fixture-only' }], selectedModelId: 'probe' })
  const failed = await rebuildKbStore('personal')
  assert.equal(failed.failed, 1)
  assert.match(db.getFileStatus('personal', source).error_message, /未配置 Embedding/)

  saveConfig({ customModels: [{ id: 'probe', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: 'fixture-only' }], selectedModelId: 'probe' })
  clearEmbeddingsCache()
  const local = await rebuildKbStore('personal')
  assert.deepEqual(local, { total: 1, changed: 1, unchanged: 0, failed: 0 })
  const localSummary = await getKbIndexSummary('personal')
  assert.equal(localSummary.failed, 0)
  assert.ok(localSummary.vectorCount > 0)
  clearStoreCache()
  db.closeDb()
  await db.initDb()
  const localHits = await searchKnowledgeBase('RAG_RECOVERY_42', 'probe', 'personal', 3, 0.5)
  assert.ok(localHits.some(hit => hit.content.includes('RAG_RECOVERY_42')))
  fs.writeFileSync(source, content + '\nExternal embedding protocol follows.\n')

  server = http.createServer(async (req, res) => {
    assert.equal(req.url, '/v1/embeddings')
    assert.equal(req.method, 'POST')
    let body = ''
    for await (const chunk of req) body += chunk
    const parsed = JSON.parse(body)
    assert.equal(parsed.model, 'fixture-embedding')
    assert.ok(Array.isArray(parsed.input))
    requests++
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: parsed.input.map((_text, index) => ({ index, embedding: [1, 0.5, 0.25, 0.125] })) }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  saveConfig({ customModels: [{ id: 'probe', provider: 'openai', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'fixture-only', embeddingModelName: 'fixture-embedding' }], selectedModelId: 'probe' })
  clearEmbeddingsCache()
  const rebuilt = await rebuildKbStore('personal')
  assert.deepEqual(rebuilt, { total: 1, changed: 1, unchanged: 0, failed: 0 })
  const status = db.getFileStatus('personal', source)
  assert.equal(status.index_status, 'success')
  assert.equal(status.error_message, null)
  assert.ok(status.chunk_count > 0)
  const summary = await getKbIndexSummary('personal')
  assert.equal(summary.failed, 0)
  assert.equal(summary.success, 1)
  assert.ok(summary.vectorCount > 0)
  const hits = await searchKnowledgeBase('RAG_RECOVERY_42', 'probe', 'personal', 3, 0.5)
  assert.ok(hits.some(hit => hit.source === source && hit.content.includes('RAG_RECOVERY_42') && hit.parentInfo))

  // 关闭并重新打开数据库和向量库后，数据仍可检索。
  clearStoreCache()
  db.closeDb()
  await db.initDb()
  const reopened = await searchKnowledgeBase('RAG_RECOVERY_42', 'probe', 'personal', 3, 0.5)
  assert.ok(reopened.some(hit => hit.content.includes('RAG_RECOVERY_42')))
  const unchanged = await rebuildKbStore('personal')
  assert.deepEqual(unchanged, { total: 1, changed: 0, unchanged: 1, failed: 0 })
  fs.unlinkSync(source)
  const deleted = await rebuildKbStore('personal')
  assert.equal(deleted.total, 0)
  assert.equal(db.getFileStatus('personal', source), null)
  const afterDelete = await searchKnowledgeBase('RAG_RECOVERY_42', 'probe', 'personal', 3, 0.5)
  assert.equal(afterDelete.length, 0)
  originalLog(JSON.stringify({ ok: true, isolatedSyntheticData: true, missingConfigurationReproduced: true, nativeZvec: true, httpEmbeddingProtocol: true, requests, indexedChunks: summary.vectorCount, recoveredFailedStatus: true, parentRetrieval: true, databaseAndVectorStoreReopened: true, unchangedSkipped: true, deletionCleaned: true }))
} catch (error) {
  originalError(logs.join('\n'))
  throw error
} finally {
  console.log = originalLog
  console.warn = originalWarn
  console.error = originalError
  clearStoreCache()
  db.closeDb()
  if (server) await new Promise(resolve => server.close(resolve))
  assert.equal(path.dirname(dataDir), path.resolve(os.tmpdir()))
  assert.ok(path.basename(dataDir).startsWith('friday-rag-recovery-'))
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
