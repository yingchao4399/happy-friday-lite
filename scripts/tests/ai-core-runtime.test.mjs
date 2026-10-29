import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createAiCoreFacade } from '../../src-electron/ai-core/facade.js'
import { createAiCoreRuntime } from '../../src-electron/ai-core/task-runtime.js'
import { isAllowedAiCoreCapability, isWriteCapability } from '../../src-electron/ai-core/catalog-policy.js'
import { createAiCoreHealthCheck, createRetryableAsyncGetter } from '../../src-electron/ai-core/runtime-lifecycle.js'
import { createAiChatCapabilityInvoker } from '../../src-electron/office/ai-inference-adapter.js'

function request(capability, mode = 'execute') {
  return {
    intent: '测试任务', mode,
    input: { value: 'private body' },
    requestedCapabilities: [capability],
    idempotencyKey: `id:${capability}:${mode}`,
    context: { actor: { id: 'user:local', type: 'user' }, spaceId: 'space:test', sessionId: 'session:test', scopes: ['read', 'write'], resourceUris: ['friday://notes/private'] }
  }
}

async function waitForTerminal(runtime, taskId) {
  for (let index = 0; index < 100; index++) {
    const task = runtime.get(taskId, 'user:local')
    if (['completed', 'failed', 'partially_completed', 'cancelled'].includes(task.status)) return task
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  throw new Error('AI Core task did not finish in time')
}

test('AI Core runtime 执行读能力并留下状态事件', async () => {
  const calls = []
  const facade = createAiCoreFacade({ capabilities: [{ id: 'note.read', type: 'read', requiredScopes: ['read'] }] })
  const runtime = createAiCoreRuntime({ facade, executeCapability: async (...args) => { calls.push(args); return { ok: true, value: 1 } } })
  const pending = await runtime.submit(request('note.read'))
  const result = await waitForTerminal(runtime, pending.id)
  assert.equal(result.status, 'completed')
  assert.equal(result.output.verification.status, 'passed')
  assert.equal(calls.length, 1)
  assert.ok(result.events.some(event => event.type === 'task.status'))
})

test('AI Core 写能力先等待审批，审批后才执行', async () => {
  let calls = 0
  const facade = createAiCoreFacade({ capabilities: [
    { id: 'note.write', type: 'write', risk: 'medium', requiredScopes: ['write'] },
    { id: 'note.readback', type: 'read', requiredScopes: ['read'], supports: { readback: true }, readbackFor: ['note.write'] }
  ] })
  const runtime = createAiCoreRuntime({ facade, executeCapability: async () => { calls += 1; return { ok: true } } })
  const pending = await runtime.submit({ ...request('note.write'), requestedCapabilities: ['note.write', 'note.readback'], idempotencyKey: 'id:note-write-readback' })
  assert.equal(pending.status, 'awaiting_approval')
  assert.equal(calls, 0)
  assert.throws(() => runtime.pause(pending.id, 'user:local'), /只有运行中的任务可以暂停/)
  const done = await runtime.approve(pending.id, 'user:local')
  assert.equal(done.status, 'running')
  const completed = await waitForTerminal(runtime, pending.id)
  assert.equal(completed.status, 'completed')
  assert.equal(calls, 2)
})

test('AI Core 在当前能力完成后暂停，继续时跳过已完成步骤', async () => {
  const calls = []
  let releaseSecond
  const secondGate = new Promise(resolve => { releaseSecond = resolve })
  const facade = createAiCoreFacade({ capabilities: [
    { id: 'step.one', type: 'read', requiredScopes: ['read'] },
    { id: 'step.two', type: 'read', requiredScopes: ['read'] },
    { id: 'step.three', type: 'read', requiredScopes: ['read'] }
  ] })
  const runtime = createAiCoreRuntime({ facade, executeCapability: async name => {
    calls.push(name)
    if (name === 'step.two') await secondGate
    return { ok: true, name }
  } })
  const task = await runtime.submit({ ...request('step.one'), requestedCapabilities: ['step.one', 'step.two', 'step.three'], idempotencyKey: 'pause:resume' })
  for (let i = 0; i < 100 && !calls.includes('step.two'); i++) await new Promise(resolve => setTimeout(resolve, 2))
  assert.deepEqual(calls, ['step.one', 'step.two'])
  const requested = runtime.pause(task.id, 'user:local')
  assert.equal(requested.pauseRequested, true)
  releaseSecond()
  for (let i = 0; i < 100; i++) {
    const current = runtime.get(task.id, 'user:local')
    if (current.status === 'paused') break
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  assert.equal(runtime.get(task.id, 'user:local').status, 'paused')
  assert.deepEqual(calls, ['step.one', 'step.two'])
  await runtime.resume(task.id, 'user:local')
  const completed = await waitForTerminal(runtime, task.id)
  assert.equal(completed.status, 'completed')
  assert.deepEqual(calls, ['step.one', 'step.two', 'step.three'])
  assert.ok(completed.events.some(event => event.type === 'task.paused'))
  assert.ok(completed.events.some(event => event.type === 'task.resumed'))
})

test('AI Core honors pause requested before the worker starts', async () => {
  const calls = []
  const facade = createAiCoreFacade({ capabilities: [
    { id: 'step.first', type: 'read', requiredScopes: ['read'] },
    { id: 'step.second', type: 'read', requiredScopes: ['read'] }
  ] })
  const runtime = createAiCoreRuntime({ facade, executeCapability: async name => { calls.push(name); return { ok: true } } })
  const task = await runtime.submit({ ...request('step.first'), requestedCapabilities: ['step.first', 'step.second'], idempotencyKey: 'pause:before-start' })
  runtime.pause(task.id, 'user:local')
  for (let i = 0; i < 100 && runtime.get(task.id, 'user:local').status !== 'paused'; i++) await new Promise(resolve => setTimeout(resolve, 2))
  assert.equal(runtime.get(task.id, 'user:local').status, 'paused')
  assert.deepEqual(calls, [])
  await runtime.resume(task.id, 'user:local')
  const completed = await waitForTerminal(runtime, task.id)
  assert.equal(completed.status, 'completed')
  assert.deepEqual(calls, ['step.first', 'step.second'])
})

test('AI Core cancellation during the last capability stays cancelled', async () => {
  let releaseCapability
  let capabilityStarted = false
  const capabilityGate = new Promise(resolve => { releaseCapability = resolve })
  const facade = createAiCoreFacade({ capabilities: [{ id: 'step.read', type: 'read', requiredScopes: ['read'] }] })
  const runtime = createAiCoreRuntime({ facade, executeCapability: async () => { capabilityStarted = true; await capabilityGate; return { ok: true } } })
  const task = await runtime.submit({ ...request('step.read'), idempotencyKey: 'cancel:single-step' })
  for (let i = 0; i < 100 && !capabilityStarted; i++) await new Promise(resolve => setTimeout(resolve, 2))
  assert.equal(capabilityStarted, true)
  runtime.cancel(task.id, 'user:local')
  releaseCapability()
  const cancelled = await waitForTerminal(runtime, task.id)
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.output.verification.status, 'not_run')
})

test('AI Core 可把写能力结果引用到受控回读，并验证目标 ID', async () => {
  const calls = []
  const facade = createAiCoreFacade({ capabilities: [
    { id: 'create_note', type: 'write', risk: 'medium', requiredScopes: ['write'] },
    { id: 'get_note', type: 'read', requiredScopes: ['read'], supports: { readback: true }, readbackFor: ['create_note'] }
  ] })
  const runtime = createAiCoreRuntime({ facade, executeCapability: async (name, args) => {
    calls.push([name, args])
    return name === 'create_note' ? '已创建笔记: id=note-123' : `【笔记 ${args.noteId}】标题\n正文`
  } })
  const pending = await runtime.submit({
    ...request('create_note'), requestedCapabilities: ['create_note', 'get_note'], idempotencyKey: 'note:create-readback',
    input: { capabilityArgs: { create_note: { title: '标题', content: '正文' }, get_note: { noteId: { $from: 'create_note', field: 'id' } } } }
  })
  const running = await runtime.approve(pending.id, 'user:local')
  assert.equal(running.status, 'running')
  const result = await waitForTerminal(runtime, pending.id)
  assert.equal(result.status, 'completed')
  assert.deepEqual(calls[1], ['get_note', { noteId: 'note-123' }])
  assert.equal(result.output.verification.mode, 'readback-capability')
})

test('AI Core 任务持久化只保留元数据，不保存请求正文', async () => {
  let saved
  const store = {
    saveTask(task) { saved = structuredClone({ ...task, requestInput: {}, requestContext: {} }); return task },
    getTask() { return saved },
    listTasks() { return saved ? [saved] : [] },
    saveEvent() {},
    listEvents() { return [] }
  }
  const facade = createAiCoreFacade({ capabilities: [{ id: 'note.read', type: 'read', requiredScopes: ['read'] }] })
  const runtime = createAiCoreRuntime({ facade, store, executeCapability: async () => ({ ok: true }) })
  const task = await runtime.submit(request('note.read'))
  await waitForTerminal(runtime, task.id)
  assert.equal(runtime.get(saved.id).requestInput, undefined)
  assert.deepEqual(saved.requestInput, {})
  assert.match(saved.requestFingerprint, /^[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(saved).includes('private body'), false)
})

test('AI Core 幂等校验覆盖规范化输入内容且不持久化正文', async () => {
  const facade = createAiCoreFacade({ capabilities: [{ id: 'note.read', type: 'read', requiredScopes: ['read'] }] })
  const runtime = createAiCoreRuntime({ facade, executeCapability: async () => ({ ok: true }) })
  const base = { ...request('note.read', 'plan'), idempotencyKey: 'idem:shared', input: { z: 'secret text', a: { second: 2, first: 1 } } }
  const first = await runtime.submit(base)
  const sameContent = await runtime.submit({ ...base, input: { a: { first: 1, second: 2 }, z: 'secret text' } })
  assert.equal(sameContent.id, first.id)
  await assert.rejects(
    runtime.submit({ ...base, input: { ...base.input, z: 'different secret text' } }),
    /幂等键已用于不同的任务内容/
  )
  assert.equal(JSON.stringify(runtime.get(first.id)).includes('secret text'), false)
})

test('AI Core 撤销只删除本任务创建且哈希未变化的文件', async () => {
  const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'friday-ai-core-')), 'created.docx')
  await fs.writeFile(file, 'created by task')
  const facade = createAiCoreFacade({ capabilities: [
    { id: 'file.write', type: 'write', risk: 'medium', requiredScopes: ['write'], supports: { undo: true } },
    { id: 'file.verify', type: 'read', requiredScopes: ['read'], supports: { readback: true }, readbackFor: ['file.write'] }
  ] })
  const sha256 = createHash('sha256').update('created by task').digest('hex')
  const runtime = createAiCoreRuntime({ facade, executeCapability: async (name) => name === 'file.write'
    ? { ok: true, undoAction: { type: 'delete-created-file', path: file, sha256 } }
    : { ok: true } })
  const pending = await runtime.submit({ ...request('file.write'), requestedCapabilities: ['file.write', 'file.verify'], idempotencyKey: 'undo:test', input: { capabilityArgs: { file: {} } } })
  await runtime.approve(pending.id, 'user:local')
  const done = await waitForTerminal(runtime, pending.id)
  assert.equal(done.status, 'completed')
  const undone = await runtime.undo(done.id, 'user:local')
  assert.equal(undone.output.undo.status, 'applied')
  assert.equal(await fs.stat(file).catch(() => null), null)
})

test('Core 目录拒绝剪贴板与敏感能力，并将写能力标记为写入', () => {
  assert.equal(isAllowedAiCoreCapability({ name: 'clipboard_read' }), false)
  assert.equal(isAllowedAiCoreCapability({ name: 'notes_read' }), true)
  assert.equal(isAllowedAiCoreCapability({ name: 'execute_command' }), false)
  assert.equal(isAllowedAiCoreCapability({ name: 'python_repl' }), false)
  assert.equal(isAllowedAiCoreCapability({ name: 'requests_post' }), false)
  assert.equal(isAllowedAiCoreCapability({ name: 'create_note' }), true)
  assert.equal(isAllowedAiCoreCapability({ name: 'private_lookup', meta: { sensitive: true } }), false)
  assert.equal(isAllowedAiCoreCapability({ name: 'secret_cache', meta: { privateOnly: true } }), false)
  assert.equal(isWriteCapability({ name: 'office_create' }), true)
})

test('AI Core Runtime 初始化失败后允许下一次健康检查重试', async () => {
  let attempts = 0
  const runtime = {
    submit() {}, approve() {}, pause() {}, resume() {}, get() {}, list() {}, cancel() {}, undo() {}
  }
  const getRuntime = createRetryableAsyncGetter(async () => {
    attempts += 1
    if (attempts === 1) throw new Error('transient bootstrap failure')
    return runtime
  })
  const health = createAiCoreHealthCheck({
    contractVersion: 'friday.ai-core.v1',
    getRuntime,
    loadCapabilities: async () => [{ id: 'note.read' }]
  })

  const failed = await health()
  assert.equal(failed.status, 'unavailable')
  assert.equal(failed.error.code, 'AI_CORE_RUNTIME_UNAVAILABLE')
  assert.equal(failed.retryable, true)
  const ready = await health()
  assert.equal(ready.status, 'ready')
  assert.equal(ready.capabilityCount, 1)
  assert.equal(attempts, 2)
})

test('AI Core 健康检查不会对空目录或不完整 Runtime 报 ready', async () => {
  const health = createAiCoreHealthCheck({
    contractVersion: 'friday.ai-core.v1',
    getRuntime: async () => ({ submit() {} }),
    loadCapabilities: async () => []
  })
  const result = await health()
  assert.equal(result.status, 'unavailable')
  assert.equal(result.capabilityCount, 0)
  assert.equal(result.error.code, 'AI_CORE_RUNTIME_INVALID')
})

test('Office 模型推理经共享敏感能力入口并保留取消与流式回调', async () => {
  let invocation
  const invoke = createAiChatCapabilityInvoker(
    async (...args) => {
      invocation = args
      return args[2].chat(args[1])
    },
    async (messages, tools, options) => {
      options.onDelta('回答')
      return { content: messages[0].content, toolCalls: tools, stopReason: 'stop' }
    }
  )
  const controller = new AbortController()
  const deltas = []
  const result = await invoke([{ role: 'user', content: '私密问题' }], [{ type: 'function' }], {
    requestId: 'office:req-1',
    signal: controller.signal,
    onDelta: value => deltas.push(value)
  })

  assert.equal(invocation[0], 'ai_chat_inference')
  assert.equal(invocation[1].stream, true)
  assert.equal(invocation[2].actor, 'office-ai')
  assert.equal(invocation[2].signal, controller.signal)
  assert.deepEqual(invocation[3], { actor: 'office-ai', scopes: ['read'] })
  assert.equal(result.content, '私密问题')
  assert.deepEqual(deltas, ['回答'])
})
