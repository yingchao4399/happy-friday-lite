import { app } from 'electron'
import assert from 'node:assert/strict'
import http from 'node:http'
import { fridayStreamRequest, setOfficeAiModel } from '../src-electron/office/office-ai-bridge.js'
import { NETWORK_ERROR_CLASSIFICATIONS } from '../src-electron/ai-core/network-policy.js'

const clarification = { questions: [{ id: 'audience', label: '好好11😀😀', options: ['Consumer', 'Business'] }] }
const clarificationFragments = ['{"questions":[', '{', '"id":"audience","label":"', '好', '好', '1', '1', '😀', '😀', '","options":["Consumer","Business"]', '}', ']', '}']
assert.deepEqual(JSON.parse(clarificationFragments.join('')), clarification)
const toolDefinitions = [
  { type: 'function', function: { name: 'ask_clarification', parameters: { type: 'object', required: ['questions'], properties: { questions: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', required: ['id', 'label', 'options'], properties: { id: { type: 'string' }, label: { type: 'string' }, options: { type: 'array', maxItems: 5, items: { type: 'string' } } } } } } } } },
  { type: 'function', function: { name: 'set_count', parameters: { type: 'object', required: ['value'], properties: { value: { type: 'integer' } } } } },
]

const server = http.createServer((_request, response) => {
  const route = String(_request.url || '').split('/')[1]
  if (route === 'auth') {
    response.writeHead(401, { 'Content-Type': 'application/json' })
    response.end('{"private":"provider-secret-response"}')
    return
  }
  if (route === 'parameter') {
    response.writeHead(422, { 'Content-Type': 'application/json', 'x-request-id': 'provider-422-probe' })
    response.end(JSON.stringify({ error: { type: 'invalid_request_error', code: 'invalid_parameter', param: 'tools[0].function.parameters', message: 'provider-private-422-detail' } }))
    return
  }
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  if (route === 'tool' || route === 'cumulative') {
    const send = value => response.write(`data: ${JSON.stringify(value)}\n\n`)
    const part = (index, name, args, id) => send({ choices: [{ delta: { tool_calls: [{ index, ...(id ? { id } : {}), function: { ...(name ? { name } : {}), arguments: args } }] } }] })
    if (route === 'tool') {
      // 标准增量含嵌套对象、重复文字/数字、Unicode，并交错另一工具。
      part(0, 'ask_', '', 'clarify-fixture')
      part(1, 'set_count', '{"value":', 'count-fixture')
      part(0, 'clarification', clarificationFragments[0])
      for (const fragment of clarificationFragments.slice(1)) part(0, '', fragment)
      for (const fragment of ['1', '1', '}']) part(1, '', fragment)
    } else {
      // 只有模型适配配置显式声明时才接受累计快照。
      const complete = JSON.stringify(clarification)
      part(0, 'ask_', complete.slice(0, 15), 'clarify-fixture')
      part(0, 'ask_clarification', complete)
      part(0, 'ask_clarification', complete)
      part(1, 'set_count', '{"value":', 'count-fixture')
      part(1, 'set_count', '{"value":11}')
    }
    send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
    send({ choices: [], usage: { prompt_tokens: 21, completion_tokens: 11 } })
    response.end('data: [DONE]\n\n')
    return
  }
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
    const select = (route, options = {}) => setOfficeAiModel({
      provider: 'deepseek', modelName: 'probe-model', apiKey: 'probe-key',
      baseUrl: `http://127.0.0.1:${port}/${route}`,
      ...options,
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

    select('parameter')
    await assert.rejects(
      fridayStreamRequest([{ role: 'user', content: 'ping' }], [{ name: 'probe_tool', inputSchema: { type: 'object' } }], { requestId: 'office-probe-422' }),
      error => {
        assert.equal(error.classification, NETWORK_ERROR_CLASSIFICATIONS.MODEL_REQUEST)
        assert.equal(error.diagnostic.status, 422)
        assert.equal(error.diagnostic.providerParam, 'tools[0].function.parameters')
        assert.equal(error.diagnostic.requestId, 'office-probe-422')
        assert.match(error.message, /HTTP 422/)
        assert.equal(error.message.includes('provider-private-422-detail'), false)
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
    for (const route of ['tool', 'cumulative']) {
      select(route, route === 'cumulative' ? { toolStreamMode: { arguments: 'cumulative', names: 'cumulative' } } : {})
      const usages = []
      const response = await fridayStreamRequest([{ role: 'user', content: '合成工具参数验收' }], toolDefinitions, {
        requestId: `office-probe-${route}`, onUsage: usage => usages.push(usage),
      })
      assert.equal(response.stopReason, 'tool_calls')
      assert.deepEqual(response.toolCalls.map(call => [call.id, call.name, call.input]), [
        ['clarify-fixture', 'ask_clarification', clarification],
        ['count-fixture', 'set_count', { value: 11 }],
      ])
      assert.equal(response.toolCalls.some(call => call.inputError || call.truncated), false)
      assert.deepEqual(usages, [{ inputTokens: 21, outputTokens: 11 }])
    }
    console.log(JSON.stringify({ ok: true, checks: ['stream', 'auth', 'parameter-422', 'interrupted', 'tool-arguments-usage', 'explicit-cumulative-tools'] }))
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
