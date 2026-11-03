import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setDataDir, saveConfig } from '../../src-electron/config.js'
import { clearEmbeddingsCache, getEmbeddings, getEmbeddingDimension } from '../../src-electron/rag/embeddings.js'

test('DeepSeek chat-only configuration has a local searchable embedding fallback', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-local-embedding-'))
  try {
    setDataDir(dataDir)
    saveConfig({ selectedModelId: 'deepseek', customModels: [{ id: 'deepseek', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: 'fixture-only' }] })
    clearEmbeddingsCache()
    const embeddings = await getEmbeddings()
    const [first, second] = await embeddings.embedDocuments(['知识库索引可以恢复', '完全不同的内容'])
    assert.equal(await getEmbeddingDimension(embeddings), 256)
    assert.equal(first.length, 256)
    assert.ok(first.some(value => value !== 0))
    assert.notDeepEqual(first, second)
  } finally {
    clearEmbeddingsCache()
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})
