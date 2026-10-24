import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import AdmZip from 'adm-zip'
import * as db from '../../src-electron/db.js'
import { setDataDir } from '../../src-electron/config.js'
import { restoreBackup, createBackup } from '../../src-electron/backup.js'
import { openSqliteStorage } from '../../src-electron/sqlite-storage.js'
import { removePathNoFollowSync } from '../../src-electron/fs-safe.js'

test('损坏备份在验证阶段失败，不得替换仍有待落盘编辑的数据库实例', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-invalid-backup-'))
  db.setDataDir(root); setDataDir(root)
  try {
    await db.initDb()
    db.flushDb()
    const zipPath = path.join(root, 'invalid.zip')
    const zip = new AdmZip()
    zip.addFile('friday.db', Buffer.from('invalid sqlite fixture'))
    zip.writeZip(zipPath)
    const note = db.createNote(null, null, '尚在内存中的笔记')
    db.updateNote(note.id, note.title, '<p>待落盘编辑不能丢失</p>', '待落盘编辑不能丢失')
    const result = await restoreBackup(zipPath)
    assert.equal(result.success, false)
    assert.equal(db.getNote(note.id)?.contentText, '待落盘编辑不能丢失')
    db.closeDb()
    await db.initDb()
    assert.equal(db.getNote(note.id)?.contentText, '待落盘编辑不能丢失')
  } finally {
    db.closeDb()
    removePathNoFollowSync(root, { root: os.tmpdir() })
  }
})

test('备份压缩期间继续编辑，归档包含一致 SQLite 快照且当前编辑仍持久化', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-live-backup-'))
  db.setDataDir(root); setDataDir(root)
  try {
    await db.initDb()
    const note = db.createNote(null, null, '备份前')
    const archive = path.join(root, 'snapshot.zip')
    let edited = false
    const result = await createBackup(archive, false, () => {
      if (edited) return
      edited = true
      db.updateNote(note.id, '备份后', '<p>新编辑</p>', '新编辑')
    })
    assert.equal(result.success, true)
    assert.equal(edited, true)
    const saved = path.join(root, 'saved.db')
    fs.writeFileSync(saved, new AdmZip(archive).readFile('friday.db'))
    const snapshot = openSqliteStorage(saved, { readOnly: true })
    try {
      assert.equal(snapshot.exec('PRAGMA integrity_check')[0].values[0][0], 'ok')
      assert.equal(snapshot.exec('SELECT title FROM notes')[0].values[0][0], '备份前')
    } finally { snapshot.close() }
    db.closeDb(); await db.initDb()
    assert.equal(db.getNote(note.id).title, '备份后')
  } finally { db.closeDb(); removePathNoFollowSync(root, { root: os.tmpdir() }) }
})
