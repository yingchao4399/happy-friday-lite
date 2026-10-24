import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import * as db from '../../src-electron/db.js'
import { setDataDir } from '../../src-electron/config.js'
import { deleteNoteToTrash, deleteResourceToTrash, listTrashEntries, restoreTrashEntry, exportTrashEntry, recordClipboardDeletion, permanentlyDeleteTrashEntry } from '../../src-electron/trash.js'

async function isolated(action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-trash-test-'))
  db.setDataDir(root)
  setDataDir(root)
  try { await db.initDb(); await action(root) }
  finally { db.closeDb(); fs.rmSync(root, { recursive: true, force: true }) }
}

test('笔记正文、置顶与知识库引用在删除和重启后可完整恢复', () => isolated(async root => {
  const note = db.createNote(null, null, '恢复验收')
  db.updateNote(note.id, note.title, '<p>完整正文</p>', '完整正文')
  db.setNotePinned(note.id, true)
  const kb = path.join(root, 'knowledge', 'personal', '验收')
  fs.mkdirSync(kb, { recursive: true })
  const ref = path.join(kb, note.id + '.note')
  const content = JSON.stringify({ noteId: note.id, title: note.title })
  fs.writeFileSync(ref, content)
  assert.equal(deleteNoteToTrash(note.id), true)
  assert.equal(db.getNote(note.id), null)
  assert.equal(fs.existsSync(ref), false)
  assert.equal(deleteNoteToTrash(note.id), false)
  db.closeDb(); await db.initDb()
  const [entry] = listTrashEntries()
  assert.equal(entry.kind, 'note')
  restoreTrashEntry(entry.id)
  assert.equal(db.getNote(note.id).contentText, '完整正文')
  assert.equal(db.getNote(note.id).isPinned, true)
  assert.equal(fs.readFileSync(ref, 'utf8'), content)
  assert.equal(listTrashEntries().length, 0)
}))

test('知识库文件夹恢复处理目标冲突、缺失位置、导出和永久删除审计', () => isolated(root => {
  const parent = path.join(root, 'knowledge', 'personal')
  const source = path.join(parent, '验收目录')
  fs.mkdirSync(source, { recursive: true })
  fs.writeFileSync(path.join(source, '内容.txt'), '不可丢失')
  const result = deleteResourceToTrash(source)
  assert.equal(fs.existsSync(source), false)
  fs.mkdirSync(source)
  fs.writeFileSync(path.join(source, '其他.txt'), '不要覆盖')
  assert.throws(() => restoreTrashEntry(result.id), { code: 'TRASH_DESTINATION_EXISTS' })
  assert.equal(fs.readFileSync(path.join(source, '其他.txt'), 'utf8'), '不要覆盖')
  fs.rmSync(parent, { recursive: true })
  assert.throws(() => restoreTrashEntry(result.id), { code: 'TRASH_PARENT_MISSING' })
  const alt = path.join(root, 'alternate'); fs.mkdirSync(alt)
  const exported = path.join(alt, '导出')
  exportTrashEntry(result.id, exported)
  assert.equal(fs.readFileSync(path.join(exported, '内容.txt'), 'utf8'), '不可丢失')
  restoreTrashEntry(result.id, { targetDir: alt })
  const restored = path.join(alt, '验收目录')
  assert.equal(fs.readFileSync(path.join(restored, '内容.txt'), 'utf8'), '不可丢失')
  const again = deleteResourceToTrash(restored)
  permanentlyDeleteTrashEntry(again.id)
  assert.equal(listTrashEntries().length, 0)
  const audit = fs.readFileSync(path.join(root, 'recently-deleted', 'audit.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(audit.at(-1).action, 'permanent-delete-completed')
  assert.ok(!JSON.stringify(audit).includes('不可丢失'))
  assert.throws(() => deleteResourceToTrash(root), { code: 'TRASH_PATH_PROTECTED' })
}))

test('缺失笔记本需要明确选择，笔记导出不覆盖同名文件', () => isolated(root => {
  const book = db.createNotebook('旧位置', '')
  const note = db.createNote(null, book.id, '迁移笔记')
  db.updateNote(note.id, note.title, '<p>导出正文</p>', '导出正文')
  deleteNoteToTrash(note.id)
  const [entry] = listTrashEntries()
  db.deleteNotebook(book.id)
  // deleteNotebook 会清空所属关系；模拟旧版本遗留的失效关系。
  db.queryAllRaw('UPDATE notes SET notebookId = ? WHERE id = ?', [book.id, note.id])
  assert.throws(() => restoreTrashEntry(entry.id), { code: 'TRASH_NOTEBOOK_MISSING' })
  const out = path.join(root, 'note.txt')
  exportTrashEntry(entry.id, out)
  assert.equal(fs.readFileSync(out, 'utf8'), '导出正文')
  assert.throws(() => exportTrashEntry(entry.id, out), { code: 'TRASH_DESTINATION_EXISTS' })
  restoreTrashEntry(entry.id, { withoutNotebook: true })
  assert.equal(db.getNote(note.id).notebookId, null)
}))

test('敏感剪贴板最近删除只存掩码、不参与全文搜索，过期禁止恢复', () => isolated(root => {
  const secret = { id: 'secret', kind: 'secret', plainText: 'enc:protected-ciphertext', sensitivity: 'secret', expiresAt: new Date(Date.now() + 10000).toISOString(), capturedAt: new Date().toISOString(), deletedAt: new Date().toISOString() }
  db.queryAllRaw('INSERT INTO clipboard_items VALUES (?, ?, ?, ?)', [secret.id, JSON.stringify(secret), secret.capturedAt, secret.deletedAt])
  recordClipboardDeletion(secret)
  assert.equal(listTrashEntries({ query: 'protected-ciphertext' }).length, 0)
  assert.equal(db.queryAllRaw('SELECT payload FROM trash_entries')[0].payload.includes('protected-ciphertext'), false)
  const [entry] = listTrashEntries()
  restoreTrashEntry(entry.id)
  assert.equal(JSON.parse(db.queryAllRaw('SELECT payload FROM clipboard_items')[0].payload).deletedAt, null)
  secret.expiresAt = new Date(0).toISOString()
  db.queryAllRaw('UPDATE clipboard_items SET payload = ?, deletedAt = ? WHERE id = ?', [JSON.stringify(secret), secret.deletedAt, secret.id])
  recordClipboardDeletion(secret)
  assert.throws(() => restoreTrashEntry(listTrashEntries()[0].id), { code: 'TRASH_EXPIRED' })
  permanentlyDeleteTrashEntry(listTrashEntries()[0].id)
  assert.equal(db.queryAllRaw('SELECT * FROM clipboard_items').length, 0)
}))
