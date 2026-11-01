import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import * as db from '../src-electron/db.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-preview22-history-'))
const scopes = [
  ['friday', null],
  ['dock', 'global'],
  ['office-docs', 'file:docx'],
  ['office-sheets', 'file:xlsx'],
  ['office-slides', 'file:pptx'],
  ['office-pdf', 'file:pdf'],
  ['note-agent', 'note:a'],
  ['note-agent', 'note:b'],
  ['knowledge', 'kb:acceptance-a'],
  ['knowledge', 'kb:acceptance-b'],
  ['knowledge', 'folder:acceptance'],
  ['knowledge-agent', 'folder:acceptance'],
  ['schedule-agent', null],
]
try {
  db.setDataDir(root)
  await db.initDb()
  const created = new Map()
  for (const [scope, scopeKey] of scopes) {
    const ids = []
    for (let index = 0; index < 20; index += 1) {
      const session = db.createSession(`${scope}-${index}`, 'chat', scope, scopeKey, { agentId: 'friday', modelId: 'acceptance-model' })
      db.saveMessage(session.id, 'user', `${scope} message ${index}`)
      db.saveMessage(session.id, 'assistant', `${scope} reply ${index}`)
      ids.push(session.id)
    }
    created.set(`${scope}:${scopeKey || ''}`, ids)
    const first = ids[0]
    assert.equal(db.updateSessionTitle(first, '验收重命名', scope, scopeKey), true)
    assert.equal(db.setSessionPinned(first, true, scope, scopeKey), true)
    assert.equal(db.getSessions(scope, scopeKey)[0].id, first)
    assert.equal(db.setSessionArchived(first, true, scope, scopeKey), true)
    assert.equal(db.getSessions(scope, scopeKey, 'archived')[0].id, first)
    assert.equal(db.moveSessionToTrash(first, scope, scopeKey), true)
    assert.equal(db.getSessions(scope, scopeKey, 'trash')[0].id, first)
    assert.equal(db.restoreSessionFromTrash(first, scope, scopeKey), true)
    assert.equal(db.setSessionArchived(first, false, scope, scopeKey), true)
    assert.equal(db.setSessionPinned(first, true, scope, scopeKey), true)
  }
  db.closeDb()
  await db.initDb()
  const result = {}
  for (const [scope, scopeKey] of scopes) {
    const key = `${scope}:${scopeKey || ''}`
    const sessions = db.getSessions(scope, scopeKey)
    if (sessions.length !== 20) throw new Error(`${key} expected 20 sessions, got ${sessions.length}`)
    assert.deepEqual(new Set(sessions.map(session => session.id)), new Set(created.get(key)))
    // 用固定置换遍历全部历史，避免只抽中一条记录掩盖遗漏。
    for (let index = 0; index < 20; index += 1) {
      const selected = sessions[(index * 7) % 20]
      const messages = db.getMessages(selected.id, scope, scopeKey)
      assert.equal(messages.length, 2, `${key} message count`)
      assert.ok(messages[0].content.startsWith(scope), `${key} message restore`)
      assert.equal(selected.agentId, 'friday')
      assert.equal(selected.modelId, 'acceptance-model')
      assert.equal(db.getSession(selected.id, scope, '__wrong_scope_key__'), null)
      assert.deepEqual(db.getMessages(selected.id, scope, '__wrong_scope_key__'), [])
    }
    const first = db.getSession(created.get(key)[0], scope, scopeKey)
    assert.equal(first.title, '验收重命名')
    assert.ok(first.pinnedAt)
    result[key] = { count: sessions.length, restored: 20, messagesPerSession: 2, metadata: true, renamePinArchiveTrashRestore: true }
  }
  const other = db.getSessions('dock', 'other-global')
  if (other.length !== 0) throw new Error('dock scope leaked into another scopeKey')
  const report = { ok: true, checkedAt: new Date().toISOString(), totalSessions: scopes.length * 20, restart: true, scopeIsolation: true, scopes: result }
  fs.mkdirSync('artifacts', { recursive: true })
  fs.writeFileSync('artifacts/preview22-history-report.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally {
  db.closeDb()
  fs.rmSync(root, { recursive: true, force: true })
}
