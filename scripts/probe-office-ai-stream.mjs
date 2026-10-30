import { app } from 'electron'
import assert from 'node:assert/strict'
import http from 'node:http'
import { fridayStreamRequest, setOfficeAiModel } from '../src-electron/office/office-ai-bridge.js'
import { NETWORK_ERROR_CLASSIFICATIONS } from '../src-electron/ai-core/network-policy.js'

const server = http.createServer((_request, response) => {
  const route = String(_request.url || '').split('/')[1]
  if (route === 'auth') {
    response.writeHead(401, { 'Content-Type': 'application/json' })
    response.end('{"private":"provider-secret-response"}')
    return
  }
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  response.write('data: {"choices":[{"delta":{"content":"Friday"}}]}\n\n')
  if (route === 'interrupted') { response.end(); return }
  response.end('data: {"choices":[{"delta":{"content":" ready"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
})

app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  let exitCode = 1
  const timer = setTimeout(() => app.exit(1), 30000)
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    const select = route => setOfficeAiModel({
      provider: 'deepseek', modelName: 'probe-model', apiKey: 'probe-key',
      baseUrl: `http://127.0.0.1:${port}/${route}`,
    })
    const deltas = []
    select('success')
    const result = await fridayStreamRequest([{ role: 'user', content: 'ping' }], [], {
      requestId: 'office-probe-ok', onDelta: value => deltas.push(value),
    })
    assert.equal(result.content, 'Friday ready')
    assert.equal(result.stopReason, 'stop')
    assert.deepEqual(deltas, ['Friday', ' ready'])

    select('auth')
    await assert.rejects(
      fridayStreamRequest([{ role: 'user', content: 'ping' }], [], { requestId: 'office-probe-auth' }),
      error => {
        assert.equal(error.classification, NETWORK_ERROR_CLASSIFICATIONS.AUTH)
        assert.equal(error.diagnostic.status, 401)
        assert.equal(error.message.includes('provider-secret-response'), false)
        return true
      },
    )

    select('interrupted')
    const partial = []
    await assert.rejects(
      fridayStreamRequest([{ role: 'user', content: 'ping' }], [], {
        requestId: 'office-probe-interrupted', onDelta: value => partial.push(value),
      }),
      error => {
        assert.equal(error.classification, NETWORK_ERROR_CLASSIFICATIONS.STREAM_INTERRUPTED)
        assert.deepEqual(partial, ['Friday'])
        return true
      },
    )
    console.log(JSON.stringify({ ok: true, checks: ['stream', 'auth', 'interrupted'] }))
    exitCode = 0
  } catch (error) {
    console.error(error.stack)
  } finally {
    clearTimeout(timer)
    setOfficeAiModel(null)
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    app.exit(exitCode)
  }
})
