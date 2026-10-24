import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { getDataDir } from './config.js'
import * as db from './db.js'
import { isSensitiveClipboardExpired } from './clipboard-policy.js'
import { removePathNoFollowSync } from './fs-safe.js'

function fail(code, message) {
  return Object.assign(new Error(message), { code, recoverable: true })
}

function transaction(action) {
  db.queryAllRaw('BEGIN IMMEDIATE')
  try {
    const result = action()
    db.queryAllRaw('COMMIT')
    db.flushDb()
    return result
  } catch (error) {
    db.queryAllRaw('ROLLBACK')
    throw error
  }
}

function storageRoot() {
  const root = path.join(getDataDir(), 'recently-deleted')
  fs.mkdirSync(root, { recursive: true })
  return root
}

function inside(root, candidate) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate))
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)
}

function checkedSource(candidate) {
  if (typeof candidate !== 'string' || !candidate.trim()) throw fail('TRASH_PATH_INVALID', '资源路径无效')
  const full = path.resolve(candidate)
  const data = path.resolve(getDataDir())
  const root = storageRoot()
  if (full === path.parse(full).root || full === data || inside(full, data) || full === path.join(data, 'knowledge') || full === root || inside(root, full)) {
    throw fail('TRASH_PATH_PROTECTED', '不能删除数据根目录或最近删除存储目录')
  }
  if (fs.lstatSync(full).isSymbolicLink()) throw fail('TRASH_LINK_UNSUPPORTED', '请先在系统中处理符号链接，原资源未删除')
  return full
}

function moveResource(source, target) {
  if (fs.existsSync(target)) throw fail('TRASH_DESTINATION_EXISTS', '目标已存在，请选择其他位置或导出副本')
  try { fs.renameSync(source, target) } catch (error) {
    if (error.code !== 'EXDEV') throw error
    // 跨盘先完整复制，成功后才移除来源；复制失败不触碰来源。
    try { fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true }) } catch (copyError) {
      removePathNoFollowSync(target, { root: path.dirname(target) })
      throw copyError
    }
    try { removePathNoFollowSync(source, { root: path.dirname(source) }) } catch {
      throw fail('TRASH_MOVE_INCOMPLETE', '来源清理失败，完整副本已保留在最近删除目录')
    }
  }
}

function rawEntry(id) {
  const row = db.queryAllRaw('SELECT * FROM trash_entries WHERE id = ?', [id])[0]
  if (!row) throw fail('TRASH_NOT_FOUND', '最近删除记录不存在或已处理')
  return { ...row, payload: JSON.parse(row.payload) }
}

function noteReferences(noteId) {
  const root = path.join(getDataDir(), 'knowledge')
  const result = []
  function visit(dir) {
    if (!fs.existsSync(dir)) return
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name)
      if (item.isSymbolicLink()) continue
      if (item.isDirectory()) visit(full)
      else if (item.name.endsWith('.note')) {
        try {
          const content = fs.readFileSync(full, 'utf8')
          if (JSON.parse(content).noteId === noteId) result.push({ path: full, content })
        } catch { /* 非本笔记的损坏引用不改动。 */ }
      }
    }
  }
  visit(root)
  return result
}

export function deleteNoteToTrash(noteId) {
  const references = noteReferences(noteId)
  const deleted = db.softDeleteNote(noteId, { references })
  if (deleted) {
    db.flushDb()
    for (const ref of references) {
      try { fs.unlinkSync(ref.path) } catch { /* 已持久化引用；恢复时可识别尚存的同一引用。 */ }
    }
  }
  return deleted
}

export function deleteResourceToTrash(candidate, { title } = {}) {
  const source = checkedSource(candidate)
  const id = crypto.randomUUID()
  const backupPath = path.join(storageRoot(), id)
  const payload = { title: String(title || path.basename(source)), originalPath: source, backupPath, isDirectory: fs.statSync(source).isDirectory() }
  const deletedAt = new Date().toISOString()
  // 先落记录，意外退出后仍可发现原路径和副本。
  transaction(() => db.queryAllRaw('INSERT INTO trash_entries VALUES (?, ?, ?, ?, ?)', [id, 'knowledge', source, JSON.stringify(payload), deletedAt]))
  try { moveResource(source, backupPath) } catch (error) {
    if (!fs.existsSync(backupPath)) transaction(() => db.queryAllRaw('DELETE FROM trash_entries WHERE id = ?', [id]))
    throw error
  }
  return { success: true, id }
}

export function recordClipboardDeletion(item) {
  if (db.queryAllRaw("SELECT id FROM trash_entries WHERE kind = 'clipboard' AND resourceId = ?", [item.id]).length) return
  // 密文仅留在剪贴板表，最近删除标题和搜索不包含敏感内容。
  const title = item.sensitivity === 'secret' ? '••••••••' : String(item.plainText || item.maskedPreview || item.kind).slice(0, 160)
  db.queryAllRaw('INSERT INTO trash_entries VALUES (?, ?, ?, ?, ?)', [crypto.randomUUID(), 'clipboard', item.id, JSON.stringify({ title, sensitivity: item.sensitivity, expiresAt: item.expiresAt }), item.deletedAt])
}

export function listTrashEntries({ query = '', kind = '' } = {}) {
  // 吸收此前预览版留下的软删除，不丢弃用户记录。
  for (const row of db.queryAllRaw("SELECT id, title, notebookId, updatedAt FROM notes WHERE isDeleted = 1 AND NOT EXISTS (SELECT 1 FROM trash_entries t WHERE t.kind = 'note' AND t.resourceId = notes.id)")) {
    db.queryAllRaw('INSERT INTO trash_entries VALUES (?, ?, ?, ?, ?)', [crypto.randomUUID(), 'note', row.id, JSON.stringify({ title: row.title, notebookId: row.notebookId }), row.updatedAt])
  }
  for (const row of db.queryAllRaw('SELECT payload FROM clipboard_items WHERE deletedAt IS NOT NULL')) recordClipboardDeletion(JSON.parse(row.payload))
  const needle = String(query).trim().toLocaleLowerCase()
  return db.queryAllRaw('SELECT * FROM trash_entries ORDER BY deletedAt DESC').map(row => {
    const p = JSON.parse(row.payload)
    return { id: row.id, kind: row.kind, resourceId: row.resourceId, title: p.title, deletedAt: row.deletedAt, originalPath: p.originalPath || '', sensitive: p.sensitivity === 'secret', expired: p.expiresAt ? Date.parse(p.expiresAt) <= Date.now() : false }
  }).filter(item => (!kind || item.kind === kind) && (!needle || (!item.sensitive && (item.title + ' ' + item.originalPath).toLocaleLowerCase().includes(needle))))
}

export function restoreTrashEntry(id, { targetDir, withoutNotebook = false } = {}) {
  const entry = rawEntry(id)
  const p = entry.payload
  const warnings = []
  if (entry.kind === 'knowledge') {
    const target = targetDir ? path.join(path.resolve(targetDir), path.basename(p.originalPath)) : p.originalPath
    if (!fs.existsSync(path.dirname(target))) throw fail('TRASH_PARENT_MISSING', '原位置已不存在，请选择恢复位置或导出')
    if (!fs.statSync(path.dirname(target)).isDirectory() || inside(storageRoot(), target) || target === storageRoot()) throw fail('TRASH_PATH_INVALID', '恢复位置无效')
    moveResource(p.backupPath, target)
    try { transaction(() => db.queryAllRaw('DELETE FROM trash_entries WHERE id = ?', [id])) } catch (error) { moveResource(target, p.backupPath); throw error }
    return { ok: true, warnings, path: target }
  }
  if (entry.kind === 'clipboard') {
    const row = db.queryAllRaw('SELECT payload FROM clipboard_items WHERE id = ?', [entry.resourceId])[0]
    if (!row) throw fail('TRASH_SOURCE_MISSING', '剪贴板内容已过期或不再存在')
    const item = JSON.parse(row.payload)
    if (isSensitiveClipboardExpired(item, Date.now())) throw fail('TRASH_EXPIRED', '敏感内容已过期，不能恢复')
    item.deletedAt = null
    transaction(() => {
      db.queryAllRaw('UPDATE clipboard_items SET payload = ?, deletedAt = NULL WHERE id = ?', [JSON.stringify(item), item.id])
      db.queryAllRaw('DELETE FROM trash_entries WHERE id = ?', [id])
    })
    return { ok: true, warnings }
  }
  if (entry.kind !== 'note') throw fail('TRASH_KIND_UNSUPPORTED', '此资源类型暂不能恢复')
  const note = db.queryAllRaw('SELECT * FROM notes WHERE id = ?', [entry.resourceId])[0]
  if (!note) throw fail('TRASH_SOURCE_MISSING', '笔记正文已不存在，可从备份恢复')
  const notebookMissing = note.notebookId && !db.getNotebook(note.notebookId)
  if (notebookMissing && !withoutNotebook) throw fail('TRASH_NOTEBOOK_MISSING', '原笔记本不存在，请确认恢复到全部笔记或导出')
  const refs = (p.references || []).map(ref => ({ ...ref, target: targetDir ? path.join(path.resolve(targetDir), path.basename(ref.path)) : ref.path }))
  for (const ref of refs) {
    if (!fs.existsSync(path.dirname(ref.target))) throw fail('TRASH_PARENT_MISSING', '笔记的原知识库不存在，请选择新位置或导出')
    if (fs.existsSync(ref.target) && fs.readFileSync(ref.target, 'utf8') !== ref.content) throw fail('TRASH_DESTINATION_EXISTS', '目标有同名资源，请选择其他位置或导出')
  }
  const created = []
  try {
    for (const ref of refs) if (!fs.existsSync(ref.target)) { fs.writeFileSync(ref.target, ref.content, { flag: 'wx' }); created.push(ref.target) }
    transaction(() => {
      db.queryAllRaw('UPDATE notes SET isDeleted = 0, notebookId = ?, updatedAt = ? WHERE id = ?', [notebookMissing ? null : note.notebookId, new Date().toISOString(), note.id])
      db.queryAllRaw('DELETE FROM trash_entries WHERE id = ?', [id])
    })
  } catch (error) { for (const file of created) fs.unlinkSync(file); throw error }
  if (notebookMissing) warnings.push('NOTE_RESTORED_WITHOUT_NOTEBOOK')
  return { ok: true, warnings, noteId: note.id }
}

export function exportTrashEntry(id, targetPath) {
  const entry = rawEntry(id)
  if (!targetPath || fs.existsSync(targetPath)) throw fail('TRASH_DESTINATION_EXISTS', '请选择不存在的导出目标，避免覆盖已有文件')
  if (entry.kind === 'note') {
    const note = db.queryAllRaw('SELECT * FROM notes WHERE id = ?', [entry.resourceId])[0]
    if (!note) throw fail('TRASH_SOURCE_MISSING', '笔记正文不存在')
    fs.writeFileSync(targetPath, note.contentText || note.content, { flag: 'wx' })
  } else if (entry.kind === 'knowledge') {
    fs.cpSync(entry.payload.backupPath, targetPath, { recursive: true, errorOnExist: true, force: false })
  } else throw fail('TRASH_EXPORT_UNSUPPORTED', '剪贴板条目请恢复后使用，敏感内容不能导出')
  return { ok: true, path: targetPath }
}

export function permanentlyDeleteTrashEntry(id) {
  const entry = rawEntry(id)
  // 审计不记录正文、路径或敏感内容。
  const audit = path.join(storageRoot(), 'audit.jsonl')
  fs.appendFileSync(audit, JSON.stringify({ action: 'permanent-delete-requested', entryId: id, kind: entry.kind, at: new Date().toISOString() }) + '\n')
  if (entry.kind === 'knowledge') {
    if (!inside(storageRoot(), entry.payload.backupPath)) throw fail('TRASH_PATH_INVALID', '最近删除备份路径无效')
    removePathNoFollowSync(entry.payload.backupPath, { root: storageRoot() })
  }
  transaction(() => {
    if (entry.kind === 'note') {
      db.queryAllRaw('DELETE FROM note_pinned WHERE noteId = ?', [entry.resourceId])
      db.queryAllRaw('DELETE FROM note_resource_links WHERE noteId = ?', [entry.resourceId])
      db.queryAllRaw('DELETE FROM notes WHERE id = ? AND isDeleted = 1', [entry.resourceId])
    } else if (entry.kind === 'clipboard') {
      db.queryAllRaw('DELETE FROM clipboard_tags WHERE itemId = ?', [entry.resourceId])
      db.queryAllRaw('DELETE FROM clipboard_items WHERE id = ? AND deletedAt IS NOT NULL', [entry.resourceId])
    }
    db.queryAllRaw('DELETE FROM trash_entries WHERE id = ?', [id])
  })
  fs.appendFileSync(audit, JSON.stringify({ action: 'permanent-delete-completed', entryId: id, kind: entry.kind, at: new Date().toISOString() }) + '\n')
  return { ok: true }
}
