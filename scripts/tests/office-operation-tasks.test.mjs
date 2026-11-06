import test from 'node:test'
import assert from 'node:assert/strict'
import { createOfficeTaskLedger } from '../../src-electron/office/operation-tasks.js'
import { createAiCoreStore } from '../../src-electron/ai-core/store.js'
import { createAiCoreRuntime } from '../../src-electron/ai-core/task-runtime.js'
import { createAiCoreFacade } from '../../src-electron/ai-core/facade.js'

function fixture() {
  const tasks = new Map()
  const events = new Map()
  const database = {
    saveAiCoreTask(task) { tasks.set(task.id, structuredClone(task)); return task },
    getAiCoreTask(id) { return structuredClone(tasks.get(id)) },
    listAiCoreTasks(actorId) { return [...tasks.values()].filter(task => !actorId || task.actorId === actorId).map(task => structuredClone(task)) },
    saveAiCoreTaskEvent(event) { const items = events.get(event.taskId) || []; items.push(structuredClone(event)); events.set(event.taskId, items); return event },
    listAiCoreTaskEvents(taskId) { return structuredClone(events.get(taskId) || []) }
  }
  const store = createAiCoreStore(database)
  return { tasks, events, store, database, ledger: createOfficeTaskLedger({ store }) }
}
const context = { actor: 'user:local', spaceId: 'friday', requestId: 'request:1', sourceEntry: 'pdf-menu' }
const request = { operationId: 'office.document.create', idempotencyKey: 'create:1', target: { format: 'docx' }, content: { kind: 'html-fragment', value: '<p>private body</p>' } }

test('Office ledger reuses the Core store and journals no document body', async () => {
  const f = fixture()
  const created = await f.ledger.create({ request, context })
  assert.equal(created.reused, false)
  assert.equal(f.store.getTask(created.task.taskId).status, 'running')
  await f.ledger.update(created.task.taskId, { phase: 'succeeded', result: { ok: true, status: 'succeeded', data: { artifact: { persisted: true, path: '/sandbox/result.docx' } } } })
  assert.equal(f.store.getTask(created.task.taskId).status, 'completed')
  assert.equal(JSON.stringify([...f.tasks.values(), ...f.events.values()]).includes('private body'), false)
  const restarted = createOfficeTaskLedger({ store: createAiCoreStore(f.database) })
  const restored = await restarted.get(created.task.taskId, context)
  assert.equal(restored.result.data.artifact.path, '/sandbox/result.docx')
  assert.equal((await restarted.create({ request, context })).reused, true)
  assert.equal((await restarted.update(created.task.taskId, { phase: 'cancelled' })).phase, 'succeeded')
})

test('lazy Core initialization leaves live standalone Office tasks to their owning service', async () => {
  const f = fixture()
  const created = await f.ledger.create({ request, context })
  await f.ledger.update(created.task.id, { operationIdentity: created.task.operationIdentity, phase: 'converting' }, context)
  f.store.saveTask({ id: 'interrupted-core-task', actorId: context.actor, spaceId: context.spaceId, status: 'running', createdAt: new Date().toISOString() })
  const runtime = createAiCoreRuntime({ store: f.store,
    facade: createAiCoreFacade({ capabilities: [{ id: 'office_document_create', type: 'write', requiredScopes: ['write'] }] }),
    executeCapability: async () => { throw new Error('recovery must not replay a capability') }
  })
  runtime.recoverInterrupted()
  assert.equal(runtime.get(created.task.id, context.actor).status, 'running')
  assert.equal((await f.ledger.get(created.task.id, context)).phase, 'converting')
  assert.equal(runtime.get('interrupted-core-task', context.actor).status, 'failed')
  await f.ledger.update(created.task.id, { operationIdentity: created.task.operationIdentity, phase: 'completed', result: { ok: true, status: 'succeeded' } }, context)
  assert.equal(runtime.get(created.task.id, context.actor).status, 'completed')
})

test('Office ledger idempotency fingerprints input and isolates actor and space', async () => {
  const { ledger } = fixture()
  const created = await ledger.create({ request, context })
  await assert.rejects(ledger.create({ request: { ...request, content: { kind: 'html-fragment', value: 'different' } }, context }), { code: 'OFFICE_IDEMPOTENCY_CONFLICT' })
  await assert.rejects(ledger.get(created.task.taskId, { ...context, actor: 'other' }), { code: 'OFFICE_TASK_NOT_FOUND' })
  await assert.rejects(ledger.get(created.task.taskId, { ...context, spaceId: 'other' }), { code: 'OFFICE_TASK_NOT_FOUND' })
  assert.deepEqual(await ledger.list({ ...context, spaceId: 'other' }), [])
  assert.notEqual((await ledger.create({ request, context: { ...context, spaceId: 'other' } })).task.taskId, created.task.taskId)
  await assert.rejects(ledger.create({ request, context: {} }), { code: 'OFFICE_CONTEXT_REQUIRED' })
})

test('Office operation inside a Core task preserves its plan, state and output', async () => {
  const { store, ledger } = fixture()
  const core = { id: 'core:existing', actorId: 'user:local', spaceId: 'friday', status: 'running', plan: { steps: [{ id: 'step:1' }] }, output: { value: 'existing' } }
  store.saveTask(core)
  const created = await ledger.create({ request, context: { ...context, taskId: core.id, stepId: 'step:1' } })
  assert.equal(created.task.taskId, core.id)
  assert.equal(created.task.ownsCoreTask, false)
  await ledger.update(core.id, { phase: 'succeeded', result: { status: 'succeeded' } })
  assert.deepEqual(store.getTask(core.id), core)
  await ledger.create({ request: { ...request, idempotencyKey: 'create:2' }, context: { ...context, taskId: core.id } })
  assert.equal((await ledger.list(context)).length, 2)
  await assert.rejects(ledger.create({ request, context: { ...context, taskId: 'unknown' }, fingerprint: 'different' }), { code: 'OFFICE_IDEMPOTENCY_CONFLICT' })
})

test('operation identity isolates recovery updates inside one enclosing Core task', async () => {
  const { store, ledger, database } = fixture()
  const core = { id: 'core:multi', actorId: 'user:local', spaceId: 'friday', status: 'running', plan: { steps: [{ id: 'step:1' }, { id: 'step:2' }] } }
  store.saveTask(core)
  const first = await ledger.create({ request, context: { ...context, taskId: core.id, stepId: 'step:1' } })
  const second = await ledger.create({ request: { ...request, idempotencyKey: 'second' }, context: { ...context, taskId: core.id, stepId: 'step:2' } })
  assert.notEqual(first.task.operationIdentity, second.task.operationIdentity)
  const restarted = createOfficeTaskLedger({ store: createAiCoreStore(database) })
  await restarted.update(core.id, { operationIdentity: first.task.operationIdentity, phase: 'completed', result: { ok: true, status: 'succeeded', data: { artifact: { id: 'artifact:first', persisted: true } } } }, context)
  assert.equal((await restarted.get(core.id, context, first.task.operationIdentity)).phase, 'completed')
  assert.equal((await restarted.get(core.id, context, second.task.operationIdentity)).phase, 'accepted')
  assert.equal((await restarted.list(context)).length, 2)
  assert.deepEqual(store.getTask(core.id), core)
  await assert.rejects(restarted.update(core.id, { operationIdentity: 'nonexistent', phase: 'completed' }, context), { code: 'OFFICE_TASK_NOT_FOUND' })
  await assert.rejects(restarted.get(core.id, context, 'nonexistent'), { code: 'OFFICE_TASK_NOT_FOUND' })
})
