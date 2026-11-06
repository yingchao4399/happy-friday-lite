import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { createOfficeOperationService } from '../../src-electron/office/operations.js'
import { createOfficeTaskLedger } from '../../src-electron/office/operation-tasks.js'
import { createAiCoreStore } from '../../src-electron/ai-core/store.js'
import { deliverOfficeArtifact, officeFault, prepareOfficeTarget, sha256 } from '../../src-electron/office/artifact-delivery.js'

const owner = { actor: 'user:local', spaceId: 'friday', sourceEntry: 'main-assistant' }
const convert = key => ({ operationId: 'office.document.convert', idempotencyKey: key, source: { resourceId: 'pdf:1' }, target: { format: 'docx', title: key } })
const create = key => ({ operationId: 'office.document.create', idempotencyKey: key, content: { kind: 'html-fragment', value: '<p>可编辑的测试正文</p>' }, target: { format: 'docx', title: key } })

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function docxBytes(text = 'Friday 交付测试') {
  const zip = new AdmZip()
  zip.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'))
  zip.addFile('_rels/.rels', Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'))
  zip.addFile('word/document.xml', Buffer.from(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`))
  return zip.toBuffer()
}

async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-office-service-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const tasks = new Map()
  const events = new Map()
  const copy = value => value == null ? value : structuredClone(value)
  const database = {
    saveAiCoreTask(task) { tasks.set(task.id, copy(task)); return task },
    getAiCoreTask(id) { return copy(tasks.get(id)) },
    listAiCoreTasks(actorId) { return [...tasks.values()].filter(task => !actorId || task.actorId === actorId).map(copy) },
    saveAiCoreTaskEvent(event) { const list = events.get(event.taskId) || []; list.push(copy(event)); events.set(event.taskId, list); return event },
    listAiCoreTaskEvents(taskId) { return copy(events.get(taskId) || []) }
  }
  const ledger = createOfficeTaskLedger({ store: createAiCoreStore(database) })
  const bytes = docxBytes()
  const counters = { resolved: 0, released: 0, snapshots: 0, converted: 0, created: 0, opened: 0 }
  const adapters = {
    ledger,
    journalDir: path.join(directory, 'journal'),
    capabilities: async () => [{ operationId: 'office.document.convert', available: true }, { operationId: 'office.document.create', available: true }],
    async resolveSource() { counters.resolved++; return { resourceId: 'pdf:1', filePath: path.join(directory, 'source.pdf'), release: async () => { counters.released++ } } },
    async snapshotSource() { counters.snapshots++; return { bytes: Buffer.from('%PDF-1.7\nfixture'), revision: 'revision:1' } },
    async selectTarget(request) { return prepareOfficeTarget(path.join(directory, `${request.target.title}.docx`)) },
    async convertSnapshot() { counters.converted++; return { docx: bytes, pages: 1, pageResults: [{ page: 1, status: 'ok' }] } },
    async createDocx() { counters.created++; return { bytes, nodeCount: 1 } },
    async openArtifact() { counters.opened++; return { status: 'opened', viewId: 'docs:1' } },
    ...overrides
  }
  const service = createOfficeOperationService(adapters)
  t.after(() => service.shutdown())
  return { directory, database, ledger, adapters, service, counters, bytes }
}

test('three entry contexts share the same conversion and verified delivery contract', async t => {
  const f = await fixture(t)
  for (const sourceEntry of ['pdf-menu', 'pdf-ai', 'main-assistant']) {
    const result = await f.service.execute(convert(sourceEntry), { ...owner, sourceEntry })
    assert.equal(result.status, 'succeeded')
    assert.equal(result.data.artifact.persisted, true)
    assert.equal(result.data.artifact.validation.valid, true)
    assert.equal(result.data.artifact.quality.level, 'editable')
    assert.equal(result.data.artifact.sha256, sha256(await fs.readFile(result.data.path)))
    assert.equal((await f.ledger.get(result.taskId, owner)).sourceEntry, sourceEntry)
  }
  assert.equal(f.counters.converted, 3)
  assert.equal(f.counters.released, 3)
  assert.deepEqual((await f.ledger.list(owner)).map(task => task.phase), ['completed', 'completed', 'completed'])
})

test('未登记的操作或格式在读取源和创建任务前被拒绝', async t => {
  const f = await fixture(t)
  for (const [operationId, format] of [['office.document.convert', 'xlsx'], ['office.document.convert', 'pptx'], ['office.document.create', 'html'], ['unknown', 'docx']]) {
    const result = await f.service.execute({ ...convert(`${operationId}-${format}`), operationId, target: { format } }, owner)
    assert.equal(result.ok, false)
    assert.equal(result.code, 'OFFICE_OPERATION_UNSUPPORTED')
    assert.equal(result.data, undefined)
  }
  assert.equal((await f.ledger.list(owner)).length, 0)
  assert.deepEqual(f.counters, { resolved: 0, released: 0, snapshots: 0, converted: 0, created: 0, opened: 0 })
})

test('content creation imports sanitized HTML and a failed editor open preserves saved delivery', async t => {
  let imported
  const f = await fixture(t, {
    async createDocx(content) { imported = content.html; return { bytes: docxBytes(), nodeCount: 2 } },
    async openArtifact() { throw officeFault('OFFICE_OPEN_FAILED') }
  })
  const request = create('create-content')
  request.content.value = '<p onclick="run()">正文<script>secret()</script><img src="https://example.invalid/a.png"></p>'
  const result = await f.service.execute(request, owner)
  assert.equal(result.status, 'succeeded')
  assert.equal(result.data.artifact.persisted, true)
  assert.equal(result.data.artifact.open.status, 'failed')
  assert.equal(result.data.artifact.open.code, 'OFFICE_OPEN_FAILED')
  assert.equal(imported.includes('onclick'), false)
  assert.equal(imported.includes('<script'), false)
  assert.equal(imported.includes('https://example.invalid'), false)
  assert.equal((await f.ledger.get(result.taskId, owner)).phase, 'completed')
  assert.equal(f.counters.snapshots, 0)
})

test('invalid output and changed source revision never produce successful artifacts', async t => {
  const f = await fixture(t, { convertSnapshot: async () => ({ docx: Buffer.from('not a docx') }) })
  const malformed = await f.service.execute(convert('bad-docx'), owner)
  assert.equal(malformed.status, 'failed')
  assert.equal(malformed.code, 'OFFICE_DOCX_ZIP_INVALID')
  assert.equal(malformed.data, undefined)
  await assert.rejects(fs.stat(path.join(f.directory, 'bad-docx.docx')), { code: 'ENOENT' })
  const request = convert('old-revision')
  request.source.revision = 'older-revision'
  const changed = await f.service.execute(request, owner)
  assert.equal(changed.code, 'OFFICE_SOURCE_REVISION_CHANGED')
  assert.equal((await f.ledger.get(changed.taskId, owner)).phase, 'failed')
})

test('a repeated pending request cannot remove the original cancellation controller', async t => {
  const started = deferred()
  const controller = new AbortController()
  const f = await fixture(t, {
    async convertSnapshot(_bytes, { signal }) {
      started.resolve()
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(officeFault('OFFICE_OPERATION_CANCELLED')), { once: true }))
    }
  })
  const request = convert('pending-repeat')
  const context = { ...owner, signal: controller.signal }
  const executing = f.service.execute(request, context)
  await started.promise
  const repeated = await f.service.execute(request, context)
  assert.equal(repeated.status, 'task_pending')
  const cancellation = await f.service.cancel(repeated.taskId, owner)
  // 断言前主动结束原任务，即使回归也不会遗留悬挂测试。
  controller.abort()
  const result = await executing
  assert.equal(cancellation.status, 'cancelling')
  assert.equal(result.status, 'cancelled')
  assert.equal((await f.ledger.get(result.taskId, owner)).phase, 'cancelled')
  await assert.rejects(fs.stat(path.join(f.directory, 'pending-repeat.docx')), { code: 'ENOENT' })
})

test('a busy source request cannot release the running operation source lock', async t => {
  const snapshotStarted = deferred()
  const continueSnapshot = deferred()
  const started = deferred()
  const continueConversion = deferred()
  let converted = 0
  const f = await fixture(t, {
    async snapshotSource() { snapshotStarted.resolve(); await continueSnapshot.promise; return { bytes: Buffer.from('%PDF-1.7\nfixture'), revision: 'revision:1' } },
    async convertSnapshot() { converted++; started.resolve(); if (converted === 1) await continueConversion.promise; return { docx: docxBytes(), pages: 1, pageResults: [{ page: 1, status: 'ok' }] } }
  })
  const running = f.service.execute(convert('source-owner'), owner)
  await snapshotStarted.promise
  const second = await f.service.execute(convert('source-busy-1'), owner)
  const third = await f.service.execute(convert('source-busy-2'), owner)
  continueSnapshot.resolve()
  await started.promise
  // The snapshot is frozen now, so conversion no longer owns the source lock.
  const afterSnapshot = await f.service.execute(convert('source-after-snapshot'), owner)
  continueConversion.resolve()
  const delivered = await running
  assert.equal(second.code, 'OFFICE_SOURCE_BUSY')
  assert.equal(third.code, 'OFFICE_SOURCE_BUSY')
  assert.equal(afterSnapshot.status, 'succeeded')
  assert.equal(converted, 2)
  assert.equal(delivered.status, 'succeeded')
})

test('source release is attempted once even if its callback fails after releasing', async t => {
  let releases = 0
  const f = await fixture(t, {
    async resolveSource() {
      return { resourceId: 'pdf:1', filePath: path.join(f.directory, 'source.pdf'), release: async () => {
        releases++
        if (releases === 1) throw new Error('renderer was destroyed after Save-As depth changed')
      } }
    }
  })
  const failed = await f.service.execute(convert('release-callback-fails'), owner)
  assert.equal(failed.status, 'failed')
  assert.equal(releases, 1)
  const next = await f.service.execute(convert('release-after-failure'), owner)
  assert.equal(next.status, 'succeeded')
  assert.equal(releases, 2)
})

test('completed idempotent execution survives restart without converting or opening twice', async t => {
  const f = await fixture(t)
  const request = convert('restart-completed')
  const first = await f.service.execute(request, owner)
  const restartedLedger = createOfficeTaskLedger({ store: createAiCoreStore(f.database) })
  const restarted = createOfficeOperationService({ ...f.adapters, ledger: restartedLedger })
  t.after(() => restarted.shutdown())
  await restarted.recover(owner)
  const again = await restarted.execute(request, owner)
  assert.deepEqual(again, first)
  assert.equal(f.counters.converted, 1)
  assert.equal(f.counters.opened, 1)
  const changed = await restarted.execute({ ...request, target: { ...request.target, title: 'different' } }, owner)
  assert.equal(changed.code, 'OFFICE_IDEMPOTENCY_CONFLICT')
})

test('restart marks orphan work interrupted and never silently replays it', async t => {
  const f = await fixture(t)
  const request = convert('restart-pending')
  const created = await f.ledger.create({ request, context: owner })
  const restarted = createOfficeOperationService({ ...f.adapters, ledger: createOfficeTaskLedger({ store: createAiCoreStore(f.database) }) })
  t.after(() => restarted.shutdown())
  await restarted.recover(owner)
  const result = await restarted.execute(request, owner)
  assert.equal(result.status, 'interrupted')
  assert.equal((await restarted.get(created.task.id, owner)).phase, 'interrupted')
  assert.equal(f.counters.converted, 0)
})

test('restart reconciles a committed real DOCX journal into the existing task', async t => {
  const f = await fixture(t)
  const request = create('recover-delivered')
  const created = await f.ledger.create({ request, context: owner })
  const target = await prepareOfficeTarget(path.join(f.directory, 'recover-delivered.docx'))
  await assert.rejects(deliverOfficeArtifact({ bytes: f.bytes, target, taskId: created.task.id, operationIdentity: created.task.operationIdentity,
    scope: { actorId: owner.actor, spaceId: owner.spaceId }, journalDir: f.adapters.journalDir,
    faultInjection: async phase => { if (phase === 'committed') throw officeFault('TEST_CRASH_AFTER_COMMIT') } }), { code: 'TEST_CRASH_AFTER_COMMIT' })
  const restarted = createOfficeOperationService({ ...f.adapters, ledger: createOfficeTaskLedger({ store: createAiCoreStore(f.database) }) })
  t.after(() => restarted.shutdown())
  const deliveries = await restarted.recover(owner)
  assert.equal(deliveries[0].status, 'delivered')
  const task = await restarted.get(created.task.id, owner)
  assert.equal(task.phase, 'completed')
  assert.equal(task.result.data.artifact.persisted, true)
  assert.equal(task.result.data.artifact.sha256, sha256(await fs.readFile(target.path)))
  const repeated = await restarted.execute(request, owner)
  assert.equal(repeated.status, 'succeeded')
  assert.equal(f.counters.created, 0)
})

test('journal recovery is space-scoped and updates the original operation in a shared Core task', async t => {
  const f = await fixture(t)
  const core = { id: 'core:recovery-multi', actorId: owner.actor, spaceId: owner.spaceId, status: 'running', plan: { steps: [] } }
  f.database.saveAiCoreTask(core)
  const first = await f.ledger.create({ request: create('recover-first'), context: { ...owner, taskId: core.id } })
  const second = await f.ledger.create({ request: create('recover-second'), context: { ...owner, taskId: core.id } })
  const target = await prepareOfficeTarget(path.join(f.directory, 'recover-first.docx'))
  await assert.rejects(deliverOfficeArtifact({ bytes: f.bytes, target, taskId: core.id, operationIdentity: first.task.operationIdentity,
    scope: { actorId: owner.actor, spaceId: owner.spaceId }, journalDir: f.adapters.journalDir,
    faultInjection: async phase => { if (phase === 'committed') throw officeFault('TEST_CRASH_AFTER_COMMIT') } }), { code: 'TEST_CRASH_AFTER_COMMIT' })
  assert.deepEqual(await f.service.recover({ ...owner, spaceId: 'other' }), [])
  assert.equal((await fs.readdir(f.adapters.journalDir)).filter(name => name.endsWith('.json')).length, 1)
  const deliveries = await f.service.recover(owner)
  assert.equal(deliveries[0].status, 'delivered')
  assert.equal((await f.ledger.get(core.id, owner, first.task.operationIdentity)).phase, 'completed')
  const secondRecord = await f.ledger.get(core.id, owner, second.task.operationIdentity)
  assert.equal(secondRecord.phase, 'interrupted')
  assert.equal(secondRecord.result.data, undefined)
  assert.equal(f.database.getAiCoreTask(core.id).status, 'running')
})

test('reopen checks actor, space and actual file digest before invoking the editor', async t => {
  const f = await fixture(t)
  const result = await f.service.execute(create('reopen'), owner)
  const id = result.data.artifact.id
  await assert.rejects(f.service.reopen(id, { ...owner, actor: 'user:other' }), { code: 'OFFICE_ARTIFACT_NOT_FOUND' })
  await assert.rejects(f.service.reopen(id, { ...owner, spaceId: 'other' }), { code: 'OFFICE_ARTIFACT_NOT_FOUND' })
  const reopened = await f.service.reopen(id, owner)
  assert.equal(reopened.data.artifact.open.status, 'opened')
  assert.equal(f.counters.opened, 2)
  await fs.writeFile(result.data.path, docxBytes('外部修改后的正文'))
  await assert.rejects(f.service.reopen(id, owner), { code: 'OFFICE_ARTIFACT_CHANGED' })
  assert.equal(f.counters.opened, 2)
  assert.equal((await f.ledger.get(result.taskId, owner)).result.data.artifact.persisted, true)
})
