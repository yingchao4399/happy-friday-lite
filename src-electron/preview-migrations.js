// 预览版增量迁移：仅新增表，降级前必须保留数据库快照。
export const previewTables = ['clipboard_items', 'clipboard_tags', 'trash_entries', 'note_pinned', 'note_resource_links', 'recitation_sessions', 'recitation_segments', 'module_order']
export const previewMigrationId = '3.0.6-preview.2'

export function applyPreviewMigrations(db) {
  db.run('CREATE TABLE IF NOT EXISTS preview_migrations (id TEXT PRIMARY KEY, appliedAt TEXT NOT NULL)')
  const applied = db.exec(`SELECT id FROM preview_migrations WHERE id = '${previewMigrationId}'`)
  if (applied.length) return false
  db.run('BEGIN IMMEDIATE')
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS clipboard_items (id TEXT PRIMARY KEY, payload TEXT NOT NULL, capturedAt TEXT NOT NULL, deletedAt TEXT);
      CREATE TABLE IF NOT EXISTS clipboard_tags (itemId TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY(itemId, tag));
      CREATE TABLE IF NOT EXISTS trash_entries (id TEXT PRIMARY KEY, kind TEXT NOT NULL, resourceId TEXT NOT NULL, payload TEXT NOT NULL, deletedAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS note_pinned (noteId TEXT PRIMARY KEY, pinnedAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS note_resource_links (noteId TEXT NOT NULL, resourceUri TEXT NOT NULL, anchor TEXT, createdAt TEXT NOT NULL, PRIMARY KEY(noteId, resourceUri));
      CREATE TABLE IF NOT EXISTS recitation_sessions (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updatedAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS recitation_segments (sessionId TEXT NOT NULL, segmentIndex INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(sessionId, segmentIndex));
      CREATE TABLE IF NOT EXISTS module_order (moduleId TEXT PRIMARY KEY, position INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_clipboard_captured ON clipboard_items(capturedAt);
      CREATE INDEX IF NOT EXISTS idx_trash_deleted ON trash_entries(deletedAt);
    `)
    db.run('INSERT INTO preview_migrations VALUES (?, ?)', [previewMigrationId, new Date().toISOString()])
    db.run('COMMIT')
    return true
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  }
}

export function rollbackPreviewMigrations(db) {
  db.run('BEGIN IMMEDIATE')
  try {
    // Roll back the app version without destroying data written by the preview.
    // Additive tables are harmless to 3.0.6 and are reused on the next upgrade.
    db.run('CREATE TABLE IF NOT EXISTS preview_migrations (id TEXT PRIMARY KEY, appliedAt TEXT NOT NULL)')
    db.run('DELETE FROM preview_migrations WHERE id = ?', [previewMigrationId])
    db.run('COMMIT')
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  }
}
