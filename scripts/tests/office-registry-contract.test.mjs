import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import * as db from '../../src-electron/db.js'
import { registerTool, executeCapability, listRegisteredTools } from '../../src-electron/agent/tools/registry.js'
import { isAllowedAiCoreCapability } from '../../src-electron/ai-core/catalog-policy.js'
import '../../src-electron/agent/tools/builtin/officeOperations.js'
import { officeTaskArtifact, officeTaskRecord, isStandaloneOfficeTask } from '../../src/components/ai-core/office-task-view.js'

test('Office registry is a scoped, approval-required projection without model-owned identity', () => {
  for (const name of ['office_document_convert', 'office_document_create']) {
    const def = listRegisteredTools().find(def => def.name === name)
    assert.ok(def)
    assert.equal(def.meta.requireApproval, true)
    assert.equal(def.meta.auditSensitive, true)
    assert.equal(isAllowedAiCoreCapability(def), true)
    assert.deepEqual(def.meta.requiredScopes, ['write'])
    const input = name.endsWith('create') ? { content: { kind: 'html-fragment', value: '<p>body</p>' } } : { source: { resourceId: 'resource:1' } }
    const parsed = def.schema.parse({ ...input, target: { format: 'docx' }, actor: 'fake', spaceId: 'fake', approvalGranted: true })
    assert.equal(parsed.actor, undefined)
    assert.equal(parsed.spaceId, undefined)
    assert.equal(parsed.approvalGranted, undefined)
    assert.ok(def.schema.extend({ riskAssessment: z.object({}) }))
  }
})

test('auditSensitive hides HTML and output without excluding a capability from AI Core', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-office-audit-'))
  db.setDataDir(dir)
  try {
    await db.initDb()
    registerTool({ name: 'test_office_private_content', description: '测试正文审计', schema: z.object({ content: z.object({ value: z.string() }) }),
      handler: async () => ({ html: '<p>private output</p>', ok: true }), meta: { auditSensitive: true, capabilityType: 'write', requiredScopes: ['write'] } })
    const events = []
    const output = await executeCapability('test_office_private_content', { content: { value: '<p>private input</p>' } }, { emit: (name, payload) => events.push({ name, payload }) }, { actor: 'user:local', scopes: ['write'] })
    assert.equal(output.ok, true)
    assert.equal(JSON.stringify(events).includes('private input'), false)
    assert.equal(JSON.stringify(events).includes('private output'), false)
    const rows = db.queryAllRaw('SELECT arguments, output FROM agent_tool_logs WHERE toolName = ?', ['test_office_private_content'])
    assert.equal(rows.length, 1)
    assert.equal(JSON.stringify(rows).includes('private input'), false)
    assert.equal(JSON.stringify(rows).includes('private output'), false)
    await assert.rejects(executeCapability('office_document_create', { content: { kind: 'html-fragment', value: '<p>private</p>' }, target: { format: 'docx' } }, {}, { scopes: ['read'] }), /权限/)
  } finally { db.closeDb(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('Office task presentation requires delivery evidence and reads domain phase', () => {
  const record = { phase: 'completed', ownsCoreTask: true, result: { data: { artifact: { path: '/sandbox/a.docx', persisted: true, validation: { valid: true }, quality: { level: 'mixed' } } } } }
  const task = { events: [{ type: 'office.operation.updated', payload: { record } }] }
  assert.equal(officeTaskRecord(task).phase, 'completed')
  assert.equal(isStandaloneOfficeTask(task), true)
  assert.equal(officeTaskArtifact(task).quality.level, 'mixed')
  assert.equal(officeTaskArtifact({ output: 'created a.docx' }), null)
  record.result.data.artifact.validation.valid = false
  assert.equal(officeTaskArtifact(task), null)
})
