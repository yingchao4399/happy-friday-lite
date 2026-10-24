import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import initSqlJs from 'sql.js'
import { openSqliteStorage } from '../../src-electron/sqlite-storage.js'
import { applyPreviewMigrations, rollbackPreviewMigrations } from '../../src-electron/preview-migrations.js'
import * as applicationDb from '../../src-electron/db.js'

test('旧 sql.js 文件直接打开，增量提交后可由旧引擎重开，回滚不损坏数据', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-sqlite-storage-'))
  const file = path.join(dir, 'friday.db')
  const SQL = await initSqlJs()
  const legacy = new SQL.Database()
  legacy.run('CREATE TABLE notes (id TEXT PRIMARY KEY, content TEXT); INSERT INTO notes VALUES (\'old\', \'原笔记\')')
  fs.writeFileSync(file, legacy.export())
  legacy.close()
  let db = openSqliteStorage(file)
  try {
    assert.equal(applyPreviewMigrations(db), true)
    assert.equal(applyPreviewMigrations(db), false)
    db.run('BEGIN IMMEDIATE')
    db.run('INSERT INTO notes VALUES (?, ?)', ['discarded', '回滚'])
    db.run('ROLLBACK')
    db.run('INSERT INTO notes VALUES (?, ?)', ['new', '新增笔记'])
    assert.equal(db.getRowsModified(), 1)
    const stmt = db.prepare('SELECT * FROM notes ORDER BY id')
    stmt.bind([])
    const rows = []
    while (stmt.step()) rows.push(stmt.getAsObject())
    stmt.free()
    assert.deepEqual(rows.map(row => row.id), ['new', 'old'])
    rollbackPreviewMigrations(db)
    db.flush()
  } finally { db.close() }
  const reopened = new SQL.Database(fs.readFileSync(file))
  try {
    assert.equal(reopened.exec('PRAGMA integrity_check')[0].values[0][0], 'ok')
    assert.deepEqual(reopened.exec('SELECT content FROM notes ORDER BY id')[0].values, [['新增笔记'], ['原笔记']])
  } finally { reopened.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('大字段更新仅修改对应页，不再全量导出；提交后无需退出便可读取', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-sqlite-page-'))
  const file = path.join(dir, 'friday.db')
  const db = openSqliteStorage(file)
  try {
    db.run('CREATE TABLE blobs(id INTEGER PRIMARY KEY, value BLOB); CREATE TABLE settings(id INTEGER PRIMARY KEY, value TEXT)')
    db.run('INSERT INTO blobs VALUES (?, ?)', [1, Buffer.alloc(32 * 1024 * 1024, 7)])
    db.run('INSERT INTO settings VALUES (?, ?)', [1, 'old'])
    const before = fs.statSync(file).size
    db.run('UPDATE settings SET value = ? WHERE id = ?', ['保存后', 1])
    const reader = openSqliteStorage(file, { readOnly: true })
    try { assert.equal(reader.exec('SELECT value FROM settings')[0].values[0][0], '保存后') }
    finally { reader.close() }
    assert.equal(fs.statSync(file).size, before)
    assert.equal(typeof db.export, 'undefined')
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('已有空数据库不被当作首次启动覆盖，保留原文件并返回可恢复错误', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-empty-db-'))
  const file = path.join(dir, 'friday.db')
  fs.writeFileSync(file, '')
  applicationDb.setDataDir(dir)
  try {
    await assert.rejects(applicationDb.initDb(), error => error.code === 'DATABASE_FILE_EMPTY' && error.recoverable)
    assert.equal(fs.statSync(file).size, 0)
  } finally { applicationDb.closeDb(); fs.rmSync(dir, { recursive: true, force: true }) }
})
