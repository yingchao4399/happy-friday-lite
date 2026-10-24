// 保留业务层的列表修改协议，仅对实际变化的行及标签落盘。
export function persistClipboardItems(query, items) {
  const ids = new Set(items.map(item => item.id))
  if (ids.size !== items.length) throw new Error('剪贴板条目 ID 重复')
  query('BEGIN IMMEDIATE')
  try {
    for (const row of query('SELECT id FROM clipboard_items')) {
      if (ids.has(row.id)) continue
      query('DELETE FROM clipboard_tags WHERE itemId = ?', [row.id])
      query('DELETE FROM clipboard_items WHERE id = ?', [row.id])
    }
    for (const item of items) {
      query(`INSERT INTO clipboard_items (id, payload, capturedAt, deletedAt) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, capturedAt = excluded.capturedAt,
        deletedAt = excluded.deletedAt WHERE clipboard_items.payload <> excluded.payload`,
      [item.id, JSON.stringify(item), item.capturedAt, item.deletedAt || null])
      if (!query('SELECT changes() AS count')[0]?.count) continue
      query('DELETE FROM clipboard_tags WHERE itemId = ?', [item.id])
      for (const tag of item.tags || []) query('INSERT OR IGNORE INTO clipboard_tags (itemId, tag) VALUES (?, ?)', [item.id, tag])
    }
    query('COMMIT')
  } catch (error) { query('ROLLBACK'); throw error }
}
