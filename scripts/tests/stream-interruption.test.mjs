import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { streamChat, streamChatWithRagAgent } from '../../src-electron/llm.js'
import { NETWORK_ERROR_CLASSIFICATIONS, annotateNetworkError } from '../../src-electron/ai-core/network-policy.js'
import * as db from '../../src-electron/db.js'

function model(baseUrl) {
  return {
    id: 'stream-test',
    modelName: 'stream-test-model',
    provider: 'test',
    apiKey: 'test-key',
    baseUrl
  }
}

function windowSpy() {
  const events = []
  return {
    events,
    mainWindow: { webContents: { send: (name, payload) => events.push({ name, payload }) } }
  }
}

async function withServer(handler, callback) {
  const server = http.createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    return await callback(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

function contentChunk(content) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
}

function reasoningChunk(reasoningContent) {
  return `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: reasoningContent } }] })}\n\n`
}

test('流在没有 [DONE] 的 EOF 结束时标记 stream_interrupted 并保留 partial content', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(contentChunk('已收到的部分').trim())
    res.end()
  }, async baseUrl => {
    const { mainWindow, events } = windowSpy()
    await assert.rejects(
      streamChat(mainWindow, [{ role: 'user', content: 'test' }], model(baseUrl), 'req-eof', null, false, { cancelled: false }),
      error => {
        assert.equal(error.classification, NETWORK_ERROR_CLASSIFICATIONS.STREAM_INTERRUPTED)
        assert.equal(error.partialContent, '已收到的部分')
        assert.equal(error.streamInterrupted, true)
        return true
      }
    )
    assert.equal(events.filter(event => event.name === 'chat-chunk').length, 1)
  })
})

test('正常收到 [DONE] 的流仍返回完整内容', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(contentChunk('完整回答'))
    res.write('data: [DONE]')
    res.end()
  }, async baseUrl => {
    const { mainWindow } = windowSpy()
    const result = await streamChat(mainWindow, [{ role: 'user', content: 'test' }], model(baseUrl), 'req-done', null, false, { cancelled: false })
    assert.equal(result.fullContent, '完整回答')
  })
})

test('供应商 HTTP 错误正文不会进入 CHAT_ERROR 或抛出错误', async () => {
  const secret = 'provider-secret-http-body'
  await withServer((_req, res) => {
    res.writeHead(503, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: secret } }))
  }, async baseUrl => {
    const { mainWindow, events } = windowSpy()
    await assert.rejects(
      streamChat(mainWindow, [{ role: 'user', content: 'test' }], model(baseUrl), 'req-http-secret', null, false, { cancelled: false }),
      error => {
        assert.equal(error.message.includes(secret), false)
        assert.equal(error.diagnostic.status, 503)
        return true
      }
    )
    const chatError = events.find(event => event.name === 'chat-error')
    assert.ok(chatError)
    assert.equal(JSON.stringify(chatError).includes(secret), false)
  })
})

test('供应商 SSE 错误正文不会进入 CHAT_ERROR 或抛出错误', async () => {
  const secret = 'provider-secret-sse-body'
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(`data: ${JSON.stringify({ error: { message: secret } })}\n\n`)
  }, async baseUrl => {
    const { mainWindow, events } = windowSpy()
    await assert.rejects(
      streamChat(mainWindow, [{ role: 'user', content: 'test' }], model(baseUrl), 'req-sse-secret', null, false, { cancelled: false }),
      error => {
        assert.equal(error.message.includes(secret), false)
        return true
      }
    )
    const chatError = events.find(event => event.name === 'chat-error')
    assert.ok(chatError)
    assert.equal(JSON.stringify(chatError).includes(secret), false)
  })
})

test('RAG HTTP/SSE 错误正文不会进入 CHAT_ERROR 或日志', async () => {
  for (const mode of ['http', 'sse']) {
    const secret = `provider-secret-rag-${mode}`
    await withServer((_req, res) => {
      if (mode === 'http') {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: secret } }))
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(`data: ${JSON.stringify({ error: { message: secret } })}\n\n`)
    }, async baseUrl => {
      const { mainWindow, events } = windowSpy()
      const logOutput = []
      const originalConsole = { log: console.log, warn: console.warn, error: console.error }
      console.log = (...args) => logOutput.push(args.join(' '))
      console.warn = (...args) => logOutput.push(args.join(' '))
      console.error = (...args) => logOutput.push(args.join(' '))
      try {
        await assert.rejects(
          streamChatWithRagAgent(mainWindow, [{ role: 'user', content: 'test' }], model(baseUrl), `req-rag-${mode}-secret`, null, false, { cancelled: false }, { kbName: 'test', kbCategoryId: '', topK: 1 }),
          error => {
            assert.equal(error.message.includes(secret), false)
            assert.equal(error.diagnostic.requestId, `req-rag-${mode}-secret`)
            return true
          }
        )
      } finally {
        console.log = originalConsole.log
        console.warn = originalConsole.warn
        console.error = originalConsole.error
      }
      const chatError = events.find(event => event.name === 'chat-error')
      assert.ok(chatError)
      assert.equal(JSON.stringify(chatError).includes(secret), false)
      assert.equal(logOutput.join('\n').includes(secret), false)
    })
  }
})

test('RAG 流在没有 [DONE] 的 EOF 结束时也作为失败并保留 partial content', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(contentChunk('RAG 已收到的部分').trim())
    res.end()
  }, async baseUrl => {
    const { mainWindow } = windowSpy()
    await assert.rejects(
      streamChatWithRagAgent(mainWindow, [{ role: 'user', content: 'test' }], model(baseUrl), 'req-rag-eof', null, false, { cancelled: false }, { kbName: 'test', kbCategoryId: '', topK: 1 }),
      error => {
        assert.equal(error.classification, NETWORK_ERROR_CLASSIFICATIONS.STREAM_INTERRUPTED)
        assert.equal(error.partialContent, 'RAG 已收到的部分')
        assert.equal(error.streamInterrupted, true)
        return true
      }
    )
  })
})

test('RAG 后续轮次断流时保留此前各轮正文和思考内容', async () => {
  let requestCount = 0
  await withServer((_req, res) => {
    requestCount += 1
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    if (requestCount === 1) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {
        content: '第一轮正文',
        reasoning_content: '第一轮思考',
        tool_calls: [{ index: 0, id: 'call-1', function: { name: 'unknown_tool', arguments: '{}' } }]
      } }] })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }

    res.write(contentChunk('第二轮正文'))
    res.write(reasoningChunk('第二轮思考'))
    res.end()
  }, async baseUrl => {
    const { mainWindow } = windowSpy()
    await assert.rejects(
      streamChatWithRagAgent(mainWindow, [{ role: 'user', content: 'test' }], model(baseUrl), 'req-rag-multiround-reset', null, true, { cancelled: false }, { kbName: 'test', kbCategoryId: '', topK: 1 }),
      error => {
        assert.equal(error.classification, NETWORK_ERROR_CLASSIFICATIONS.STREAM_INTERRUPTED)
        assert.equal(error.partialContent, '第一轮正文第二轮正文')
        assert.equal(error.partialReasoning, '第一轮思考第二轮思考')
        assert.equal(error.streamInterrupted, true)
        return true
      }
    )
    assert.equal(requestCount, 2)
  })
})

test('流读取错误保留已收到的 partial content', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(contentChunk('连接中断前的内容'))
    setTimeout(() => res.destroy(), 20)
  }, async baseUrl => {
    const { mainWindow } = windowSpy()
    await assert.rejects(
      streamChat(mainWindow, [{ role: 'user', content: 'test' }], model(baseUrl), 'req-reset', null, false, { cancelled: false }),
      error => {
        assert.equal(error.partialContent, '连接中断前的内容')
        assert.equal(error.streamInterrupted, true)
        return true
      }
    )
  })
})

test('数据库历史读取可还原断流助手正文与错误元数据', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-stream-interruption-'))
  db.setDataDir(root)
  try {
    await db.initDb()
    const session = db.createSession('断流测试', 'chat', 'friday', null)
    const user = db.saveMessage(session.id, 'user', '继续回答')
    const partial = '已经生成的正文'
    db.saveChatFailure(session.id, {
      message: 'Stream ended before completion',
      partialContent: partial,
      partialReasoning: '已生成的思考过程',
      streamInterrupted: true,
      classification: NETWORK_ERROR_CLASSIFICATIONS.STREAM_INTERRUPTED
    }, { retryable: true })

    db.closeDb()
    await db.initDb()
    const history = db.getMessages(session.id, 'friday', null)
    const failed = history.find(message => message.role === 'assistant')
    assert.equal(failed.content.includes(partial), true)
    assert.equal(failed.metadata.streamInterrupted, true)
    assert.equal(failed.metadata.classification, NETWORK_ERROR_CLASSIFICATIONS.STREAM_INTERRUPTED)
    assert.equal(failed.metadata.reasoning, '已生成的思考过程')
    assert.equal(failed.metadata.retryable, true)
    db.closeDb()
    await db.initDb()
    assert.equal(db.getMessages(session.id, 'friday', null)[1].content.includes(partial), true)
    assert.equal(db.removeLatestFailedAssistantMessage(session.id, user.id, 'friday', null), true)
    assert.equal(db.getMessages(session.id, 'friday', null).some(message => message.role === 'assistant'), false)
  } finally {
    db.closeDb()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('网络错误持久化时只保留脱敏摘要与白名单诊断', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-network-privacy-'))
  db.setDataDir(root)
  try {
    await db.initDb()
    const session = db.createSession('隐私门禁测试', 'chat', 'friday', null)
    const secret = 'provider-secret-persisted-body'
    const error = {
      message: secret,
      classification: NETWORK_ERROR_CLASSIFICATIONS.SERVER,
      diagnostic: {
        provider: 'demo', requestId: 'req-db-privacy', phase: 'response', status: 502,
        classification: NETWORK_ERROR_CLASSIFICATIONS.SERVER, body: secret
      }
    }
    const saved = db.saveChatFailure(session.id, error)
    assert.equal(saved.content.includes(secret), false)
    assert.equal(saved.metadata.errorMessage.includes(secret), false)
    assert.equal(JSON.stringify(saved.metadata.diagnostic).includes(secret), false)
    assert.deepEqual(Object.keys(saved.metadata.diagnostic).sort(), [
      'classification', 'elapsedMs', 'phase', 'provider', 'requestId', 'retryAfterMs', 'retryable', 'status'
    ])
  } finally {
    db.closeDb()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
