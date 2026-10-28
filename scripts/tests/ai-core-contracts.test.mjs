import test from 'node:test'
import assert from 'node:assert/strict'
import { createAiContext, createAiRequest, createCapabilityDefinition, assertTaskTransition } from '../../src-electron/ai-core/contracts.js'
import { createAiCoreFacade } from '../../src-electron/ai-core/facade.js'

const context = {
  actor: { id: 'user:local', type: 'user' },
  spaceId: 'note:test',
  sessionId: 'session:test',
  scopes: ['note:read', 'office:write'],
  resourceUris: ['friday://note/test'],
  requestId: 'request:test'
}

test('AI Core context/request 合同固定 actor、space、request 和资源边界', () => {
  const value = createAiContext(context)
  assert.equal(value.contractVersion, 'friday.ai-core.v1')
  assert.equal(value.memoryNamespace, 'space/note:test')
  assert.throws(() => createAiRequest({ intent: 'x', context, requestedCapabilities: [] }), /至少需要/)
  const request = createAiRequest({
    intent: 'note_to_word', context, mode: 'plan',
    requestedCapabilities: ['office.document.create'], idempotencyKey: 'idem:test'
  })
  assert.equal(request.context.spaceId, 'note:test')
  assert.equal(request.idempotencyKey, 'idem:test')
})

test('AI Core plan 把能力投影、审批和缺少 scope 变成结构化结果', () => {
  const facade = createAiCoreFacade({ capabilities: [
    { id: 'note.read', description: '读取笔记', type: 'read', requiredScopes: ['note:read'] },
    { id: 'office.document.write', description: '写入 Word', type: 'write', risk: 'medium', requiredScopes: ['office:write'], supports: { readback: true } }
  ] })
  const planned = facade.plan({
    intent: 'note_to_word', context, mode: 'plan',
    requestedCapabilities: ['note.read', 'office.document.write'], idempotencyKey: 'idem:word'
  })
  assert.equal(planned.plan.steps.length, 2)
  assert.equal(planned.plan.steps[1].approvalRequired, true)
  assert.deepEqual(planned.plan.steps[1].missingScopes, [])
  assert.throws(() => facade.plan({ intent: 'x', context: { ...context, scopes: ['note:read'] }, mode: 'execute', requestedCapabilities: ['office.document.write'] }), /当前授权缺少/)
  assert.throws(() => facade.plan({ intent: 'x', context, requestedCapabilities: ['missing.capability'] }), /未注册能力/)
})

test('AI Core 状态机拒绝跳过验证和终态回退', () => {
  assert.equal(assertTaskTransition('running', 'verifying'), true)
  assert.equal(assertTaskTransition('verifying', 'completed'), true)
  assert.throws(() => assertTaskTransition('running', 'completed'), /不允许的任务状态转换/)
  assert.throws(() => assertTaskTransition('completed', 'running'), /不允许的任务状态转换/)
})

test('AI Core execute 只通过注入 Runtime executor 执行', async () => {
  const calls = []
  const facade = createAiCoreFacade({
    capabilities: [{ id: 'note.read', type: 'read', requiredScopes: ['note:read'] }],
    executor: async input => { calls.push(input); return { status: 'completed', verification: { status: 'passed' } } }
  })
  const result = await facade.execute({ intent: 'read_note', context, requestedCapabilities: ['note.read'] })
  assert.equal(result.result.status, 'completed')
  assert.equal(calls[0].request.mode, 'execute')
})
