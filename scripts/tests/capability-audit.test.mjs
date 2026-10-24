import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import * as db from '../../src-electron/db.js'
import { registerTool, executeCapability, describeCapability, buildLangChainTools } from '../../src-electron/agent/tools/registry.js'
import { logToolCall, listToolLogs } from '../../src-electron/agent/memory.js'
import { AUDIT_TEXT_LIMIT } from '../../src-electron/agent/audit-summary.js'

test('按需加载的 LangChain 适配保留工具参数结构和审批字段', async () => {
  const def = { name: 'test_lazy_tool', description: '验收', schema: z.object({ text: z.string() }), handler: async () => '完成', meta: { requireApproval: true } }
  registerTool(def)
  const described = await describeCapability(def)
  assert.equal(described.inputSchema.properties.text.type, 'string')
  assert.deepEqual(described.scopes, ['write'])
  const tools = await buildLangChainTools({})
  const tool = tools.find(item => item.name === def.name)
  assert.ok(tool)
  assert.equal(tool.schema.safeParse({ text: '正文' }).success, false, '需审批工具不得漏掉风险字段')
  assert.equal(tool.schema.safeParse({ text: '正文', riskAssessment: { level: 'low', evaluation: '写入本次正文' } }).success, true)
})

test('真实能力入口保留 OCR 返回值和权限，审计/事件大小有界，旧大日志查询也有界', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-audit-'))
  db.setDataDir(dir)
  try {
    await db.initDb()
    const image = 'data:image/png;base64,' + 'A'.repeat(4 * 1024 * 1024)
    const output = { text: 'OCR正文', image }
    let called = 0
    registerTool({ name: 'test_ocr_audit', description: '验收', schema: z.object({ image: z.string() }), handler: async () => { called++; return output }, meta: { requiredScopes: ['read'] } })
    const events = []
    const actual = await executeCapability('test_ocr_audit', { image }, { emit: (name, data) => events.push({ name, data }) }, { actor: 'friday-ui' })
    assert.equal(actual, output)
    assert.equal(called, 1)
    assert.ok(JSON.stringify(events).length < AUDIT_TEXT_LIMIT)
    const logs = db.queryAllRaw('SELECT length(arguments) AS a, length(output) AS o FROM agent_tool_logs')
    assert.ok(logs.every(log => log.a <= AUDIT_TEXT_LIMIT && log.o <= AUDIT_TEXT_LIMIT))
    await assert.rejects(executeCapability('test_ocr_audit', { image }, {}, { scopes: [] }), /权限/)
    assert.equal(called, 1)
    logToolCall({ toolName: 'direct', arguments: { image }, output })
    // 模拟旧版本已写入的大日志，查询必须在 SQLite 中截断。
    db.queryAllRaw('UPDATE agent_tool_logs SET arguments = ?, output = ? WHERE toolName = ?', [image, image, 'direct'])
    const [history] = listToolLogs({ toolName: 'direct' })
    assert.equal(history.arguments.length, AUDIT_TEXT_LIMIT)
    assert.equal(history.output.length, AUDIT_TEXT_LIMIT)
    assert.equal(history.argumentsTruncated, 1)
    assert.equal(history.outputTruncated, 1)
  } finally { db.closeDb(); fs.rmSync(dir, { recursive: true, force: true }) }
})
