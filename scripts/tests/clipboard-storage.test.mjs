import test from 'node:test'
import assert from 'node:assert/strict'
import { openSqliteStorage } from '../../src-electron/sqlite-storage.js'
import { applyPreviewMigrations } from '../../src-electron/preview-migrations.js'
import { persistClipboardItems } from '../../src-electron/clipboard-storage.js'

test('修改一个剪贴板条目仅写入变化行，保持其他行、标签、删除和原子回滚', () => {
  const db = openSqliteStorage(':memory:')
  const query = (sql, params = []) => {
    const statement = db.prepare(sql), result = []
    try { statement.bind(params); while (statement.step()) result.push(statement.getAsObject()); return result }
    finally { statement.free() }
  }
  try {
    applyPreviewMigrations(db)
    db.run('CREATE TABLE writes (id TEXT); CREATE TRIGGER changed AFTER UPDATE ON clipboard_items BEGIN INSERT INTO writes VALUES (new.id); END')
    const items = ['a', 'b', 'c'].map(id => ({ id, plainText: id, capturedAt: '2026-10-24', tags: ['原标签'] }))
    persistClipboardItems(query, items)
    items[1].tags = ['新标签']; items[1].favorite = true
    persistClipboardItems(query, items)
    assert.deepEqual(query('SELECT id FROM writes').map(row => row.id), ['b'])
    assert.equal(query('SELECT count(*) AS count FROM clipboard_tags WHERE tag = ?', ['原标签'])[0].count, 2)
    assert.equal(query('SELECT count(*) AS count FROM clipboard_tags WHERE tag = ?', ['新标签'])[0].count, 1)
    const before = query('SELECT * FROM clipboard_items')
    assert.throws(() => persistClipboardItems(query, [items[0], { id: 'bad', capturedAt: null }]))
    assert.deepEqual(query('SELECT * FROM clipboard_items'), before)
    persistClipboardItems(query, [items[1]])
    assert.deepEqual(query('SELECT id FROM clipboard_items').map(row => row.id), ['b'])
    assert.equal(query('SELECT count(*) AS count FROM clipboard_tags')[0].count, 1)
  } finally { db.close() }
})
