import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as db from '../../src-electron/db.js'
import { saveKnowledgeNoteReference } from '../../src-electron/knowledge-note-reference.js'

test('笔记加入知识库验证目标、来源、重复引用和同名冲突', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-note-kb-'))
  db.setDataDir(dataDir)
  try {
    await db.initDb()
    const note = db.createNote(null, null, '原始标题')
    db.updateNote(note.id, '最新标题', '<p>内容</p>', '内容')
    const destDir = path.join(dataDir, 'knowledge', 'personal', '我的笔记')
    fs.mkdirSync(destDir, { recursive: true })

    const first = saveKnowledgeNoteReference({ noteId: note.id, destDir, dataDir })
    assert.equal(first.success, true)
    assert.equal(first.alreadyExists, false)
    assert.equal(JSON.parse(fs.readFileSync(first.path, 'utf8')).title, '最新标题')
    assert.equal(db.queryAllRaw('SELECT COUNT(*) AS count FROM note_resource_links WHERE noteId = ?', [note.id])[0].count, 1)
    const second = saveKnowledgeNoteReference({ noteId: note.id, destDir, dataDir })
    assert.equal(second.alreadyExists, true)
    assert.equal(db.queryAllRaw('SELECT COUNT(*) AS count FROM note_resource_links WHERE noteId = ?', [note.id])[0].count, 1)

    assert.throws(() => saveKnowledgeNoteReference({ noteId: 'missing', destDir, dataDir }), { code: 'KB_NOTE_MISSING' })
    assert.throws(() => saveKnowledgeNoteReference({ noteId: note.id, destDir: dataDir, dataDir }), { code: 'KB_DEST_INVALID' })
    assert.throws(() => saveKnowledgeNoteReference({ noteId: note.id, destDir: path.join(dataDir, 'knowledge', 'local', 'missing'), dataDir }), { code: 'KB_DEST_MISSING' })

    fs.writeFileSync(first.path, 'unrelated content')
    assert.throws(() => saveKnowledgeNoteReference({ noteId: note.id, destDir, dataDir }), { code: 'KB_NOTE_CONFLICT' })
    assert.equal(fs.readFileSync(first.path, 'utf8'), 'unrelated content')
  } finally {
    db.closeDb()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})
