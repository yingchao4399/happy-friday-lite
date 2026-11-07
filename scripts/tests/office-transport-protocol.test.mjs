import test from 'node:test'
import assert from 'node:assert/strict'
import { createIpcTransport } from '../../vendor/happyoffice/packages/agent-core/src/electron-transport.ts'
import { AgentLoop } from '../../vendor/happyoffice/packages/agent-core/src/loop.ts'
import { resolveAiErrorRecovery } from '../../vendor/happyoffice/packages/agent-core/src/error-recovery.ts'

async function replay(chunks, { cancel = false } = {}) {
  let listener
  let unsubscribed = 0
  let cancelled = 0
  const events = []
  const transport = createIpcTransport({
    onStream(fn) { listener = fn; return () => { unsubscribed++ } },
    start(request) {
      queueMicrotask(() => {
        for (const chunk of chunks) listener({ requestId: request.requestId, ...chunk })
      })
    },
    cancel() { cancelled++ }, getSettings: () => ({}), unknownErrorText: () => '未知错误',
  })
  const handle = transport.stream({ system: '', messages: [], tools: [] }, {
    onDelta: text => events.push(['delta', text]),
    onToolCall: call => events.push(['tool', call]),
    onUsage: usage => events.push(['usage', usage]),
    onDone: () => events.push(['done']),
    onError: (message, detail) => events.push(['error', message, detail]),
  })
  if (cancel) handle.cancel()
  await new Promise(resolve => setImmediate(resolve))
  return { events, unsubscribed, cancelled }
}

test('旧四编辑器消费 usage 不将正常正文误报为未知错误', async () => {
  const result = await replay([{ type: 'delta', text: '正文' }, { type: 'usage', usage: { inputTokens: 12, outputTokens: 5 } }, { type: 'done' }])
  assert.deepEqual(result.events, [['delta', '正文'], ['usage', { inputTokens: 12, outputTokens: 5 }], ['done']])
  assert.equal(result.unsubscribed, 1)
})

test('工具调用、用量和新增元数据保持单一成功终态', async () => {
  const call = { id: 'one', name: 'read', input: {} }
  const result = await replay([{ type: 'tool-call', toolCall: call }, { type: 'future-metadata', text: 'optional' }, { type: 'usage', usage: { outputTokens: 8 } }, { type: 'done' }, { type: 'done' }, { type: 'error', error: 'late' }])
  assert.deepEqual(result.events, [['tool', call], ['usage', { outputTokens: 8 }], ['done']])
  assert.equal(result.unsubscribed, 1)
})

test('显式错误保留结构化原因及恢复动作且不再交付 done', async () => {
  const result = await replay([{ type: 'error', error: '凭证无效', errorCode: 'auth', provider: 'deepseek', hostMode: 'friday-managed', recovery: 'model-settings', diagnostic: { status: 401 } }, { type: 'done' }])
  assert.equal(result.events.length, 1)
  assert.deepEqual(result.events[0].slice(0, 2), ['error', '凭证无效'])
  assert.deepEqual(result.events[0][2], { errorCode: 'auth', provider: 'deepseek', hostMode: 'friday-managed', recovery: 'model-settings', diagnostic: { status: 401 } })
})

test('取消立即完成并释放订阅，延迟到达的 token 不再进入界面', async () => {
  const result = await replay([{ type: 'delta', text: 'late' }, { type: 'usage', usage: { outputTokens: 2 } }, { type: 'done' }], { cancel: true })
  assert.deepEqual(result.events, [['done']])
  assert.equal(result.unsubscribed, 1)
  assert.equal(result.cancelled, 1)
})

test('结构化错误经真实 AgentLoop 到面板事件时保持原因与恢复动作', async () => {
  const detail = { errorCode: 'auth', provider: 'deepseek', hostMode: 'friday-managed', recovery: 'model-settings' }
  const received = await new Promise(resolve => {
    const loop = new AgentLoop({
      transport: { stream(_request, callbacks) { queueMicrotask(() => callbacks.onError('凭证无效', detail)); return { cancel() {} } } },
      skill: { id: 'fixture', systemPrompt: '', tools: [], executeTool: () => ({ output: '', summary: '' }) },
      events: { onError: (message, errorDetail) => resolve({ message, detail: errorDetail }) },
    })
    loop.run('fixture')
  })
  assert.deepEqual(received, { message: '凭证无效', detail })
})

test('API 模式认证错误进入模型设置，不查询或伪造上游登录状态', async () => {
  let accountQueries = 0
  const getStatus = async () => { accountQueries++; return { loggedIn: false } }
  assert.equal(await resolveAiErrorRecovery({ errorCode: 'auth', hostMode: 'friday-managed' }, 'deepseek', getStatus), 'model-settings')
  assert.equal(await resolveAiErrorRecovery({ errorCode: 'provider', hostMode: 'friday-managed' }, 'genspark', getStatus), 'model-settings')
  assert.equal(await resolveAiErrorRecovery({ errorCode: 'network', hostMode: 'friday-managed' }, 'deepseek', getStatus), undefined)
  assert.equal(accountQueries, 0)
})

test('只有真实 Genspark 认证失败才显示登录，普通未知错误不猜测认证', async () => {
  let queries = 0
  const loggedOut = async () => { queries++; return { loggedIn: false } }
  assert.equal(await resolveAiErrorRecovery(undefined, 'genspark', loggedOut), undefined)
  assert.equal(await resolveAiErrorRecovery({ errorCode: 'network' }, 'genspark', loggedOut), undefined)
  assert.equal(queries, 0)
  assert.equal(await resolveAiErrorRecovery({ errorCode: 'auth' }, 'genspark', loggedOut), 'login')
  assert.equal(await resolveAiErrorRecovery({ errorCode: 'auth' }, 'genspark', async () => ({ loggedIn: false, reason: 'friday-managed-provider' })), 'model-settings')
  assert.equal(await resolveAiErrorRecovery({ errorCode: 'auth' }, 'genspark', async () => ({ loggedIn: true })), undefined)
})
