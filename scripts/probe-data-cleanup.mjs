import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setDataDir } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import { createBackup, restoreBackup } from '../src-electron/backup.js'
import { deleteResourceToTrash, permanentlyDeleteTrashEntry } from '../src-electron/trash.js'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-data-cleanup-'))
const data = path.join(root, 'data')
fs.mkdirSync(data)
app.setPath('userData', path.join(root, 'profile'))
app.on('window-all-closed', () => {})

async function main() {
  const deadline = setTimeout(() => app.exit(1), 30000)
  let ok = false
  try {
    setDataDir(data)
    db.setDataDir(data)
    await db.initDb()
    const installation = path.join(root, 'installation-fixture')
    fs.mkdirSync(installation)
    const marker = path.join(installation, 'package.json')
    fs.writeFileSync(marker, 'preserved-runtime')
    const source = path.join(data, 'knowledge', 'personal', '删除测试')
    fs.mkdirSync(source, { recursive: true })
    fs.writeFileSync(path.join(source, '正文.txt'), '删除目录自己的文件')
    fs.symlinkSync(installation, path.join(source, '外部目录链接'), 'junction')
    const entry = deleteResourceToTrash(source)
    permanentlyDeleteTrashEntry(entry.id)
    assert.equal(fs.existsSync(source), false)
    assert.equal(fs.readFileSync(marker, 'utf8'), 'preserved-runtime')

    const note = db.createNote(null, null, '备份恢复验收')
    db.updateNote(note.id, note.title, '<p>备份正文</p>', '备份正文')
    // 模拟 DSH 的真实 profile 布局：备份后整体移入 rollback，清理不可穿透。
    const modules = path.join(data, 'deepseek-harness', 'home', 'profiles', 'node_modules')
    fs.mkdirSync(modules, { recursive: true })
    fs.symlinkSync(installation, path.join(modules, 'runtime'), 'junction')
    const archive = path.join(root, 'snapshot.zip')
    const backup = await createBackup(archive)
    assert.equal(backup.success, true, backup.error)
    db.updateNote(note.id, note.title, '<p>备份后变更</p>', '备份后变更')
    const restored = await restoreBackup(archive)
    assert.equal(restored.success, true, restored.error)
    assert.equal(db.getNote(note.id).contentText, '备份正文')
    assert.equal(fs.readFileSync(marker, 'utf8'), 'preserved-runtime')
    assert.equal(fs.readdirSync(root).some(name => name.startsWith('.friday-rollback-')), false)
    ok = true
    console.log(JSON.stringify({ ok, permanentDeletePreservesLinkedTarget: true, backupRestorePreservesRuntime: true, noteRestored: true, rollbackCleaned: true }))
  } catch (error) { console.error(error.message) }
  finally {
    clearTimeout(deadline)
    db.closeDb()
    try { removePathNoFollowSync(root, { root: os.tmpdir() }) } catch { /* Chromium profile 尚未释放。 */ }
    app.exit(ok ? 0 : 1)
  }
}
app.whenReady().then(main).catch(() => app.exit(1))
