import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import * as db from '../../src-electron/db.js'

function temporaryDataDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

test('scoped session history preserves metadata and supports pin, archive and restore', async () => {
  const root = temporaryDataDir('friday-history-')
  db.setDataDir(root)
  try {
    await db.initDb()
    const first = db.createSession('First', 'agent', 'note-agent', 'note:a', {
      resourceUri: 'friday://notes/note%3Aa', agentId: 'note-agent', modelId: 'deepseek-chat'
    })
    const second = db.createSession('Second', 'agent', 'note-agent', 'note:a')
    const other = db.createSession('Other note', 'agent', 'note-agent', 'note:b')
    const user = db.saveMessage(first.id, 'user', 'Hello')
    db.saveMessage(first.id, 'assistant', 'World', { reasoning: 'done' })
    assert.equal(db.setSessionPinned(first.id, true, 'note-agent', 'note:b'), false)
    assert.equal(db.setSessionPinned(first.id, true, 'note-agent', 'note:a'), true)
    assert.deepEqual(db.getSessions('note-agent', 'note:a').map(item => item.id), [first.id, second.id])
    assert.equal(db.getSessions('note-agent', 'note:a')[0].preview, 'World')
    assert.equal(db.getSessions('note-agent', 'note:a')[0].messageCount, 2)
    assert.equal(db.setSessionArchived(first.id, true, 'note-agent', 'note:a'), true)
    assert.deepEqual(db.getSessions('note-agent', 'note:a').map(item => item.id), [second.id])
    assert.deepEqual(db.getSessions('note-agent', 'note:a', 'archived').map(item => item.id), [first.id])
    assert.equal(db.moveSessionToTrash(first.id, 'note-agent', 'note:a'), true)
    assert.deepEqual(db.getSessions('note-agent', 'note:a', 'archived'), [])
    assert.deepEqual(db.getSessions('note-agent', 'note:a', 'trash').map(item => item.id), [first.id])
    assert.equal(db.restoreSessionFromTrash(first.id, 'note-agent', 'note:b'), false)
    assert.equal(db.restoreSessionFromTrash(first.id, 'note-agent', 'note:a'), true)
    assert.equal(db.setSessionArchived(first.id, false, 'note-agent', 'note:a'), true)
    assert.equal(db.deleteSession(second.id, 'note-agent', 'note:a').softDeleted, true)
    assert.equal(db.getMessages(second.id, 'note-agent', 'note:a').length, 0)
    assert.equal(db.restoreSessionFromTrash(second.id, 'note-agent', 'note:a'), true)
    db.closeDb()
    await db.initDb()
    assert.equal(db.getSession(first.id, 'note-agent', 'note:a').modelId, 'deepseek-chat')
    assert.equal(db.getSession(first.id, 'note-agent', 'note:a').resourceUri, 'friday://notes/note%3Aa')
    assert.equal(db.getMessages(first.id, 'note-agent', 'note:a')[0].id, user.id)
    assert.equal(db.getMessages(first.id, 'note-agent', 'note:a')[1].metadata.reasoning, 'done')
    assert.equal(db.getSessions('note-agent', 'note:a').length, 2)
    assert.deepEqual(db.getSessions('note-agent', 'note:b').map(item => item.id), [other.id])
  } finally {
    db.closeDb()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('preview.19 session fixture migrates twice without losing messages', async () => {
  const root = temporaryDataDir('friday-history-migration-')
  const source = new DatabaseSync(path.join(root, 'friday.db'))
  source.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, mode TEXT NOT NULL, scope TEXT NOT NULL, scopeKey TEXT, titleManuallySet INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sessionId TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, createdAt TEXT NOT NULL);
    INSERT INTO sessions VALUES ('legacy-1', 'Old chat', 'chat', 'friday', NULL, 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    INSERT INTO messages (sessionId, role, content, createdAt) VALUES ('legacy-1', 'user', 'Keep this text', '2026-01-01T00:00:00Z');
  `)
  source.close()
  db.setDataDir(root)
  try {
    await db.initDb()
    assert.deepEqual(db.getSessions().map(item => item.id), ['legacy-1'])
    assert.equal(db.getMessages('legacy-1')[0].content, 'Keep this text')
    assert.equal(db.getSession('legacy-1').archivedAt, null)
    db.closeDb()
    await db.initDb()
    assert.deepEqual(db.getSessions().map(item => item.id), ['legacy-1'])
    assert.equal(db.getMessages('legacy-1').length, 1)
    assert.ok(fs.readdirSync(path.join(root, 'backups')).some(name => name.endsWith('.db')))
  } finally {
    db.closeDb()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
