import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import AdmZip from 'adm-zip'
import * as db from '../../src-electron/db.js'
import { setDataDir } from '../../src-electron/config.js'
import { restoreBackup } from '../../src-electron/backup.js'
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
