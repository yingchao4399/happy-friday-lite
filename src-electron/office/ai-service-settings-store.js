import { queryAllRaw } from '../db.js'

// 与 Friday 业务数据使用同一 SQLite，服务密钥不发送给编辑器或存入 localStorage。
const ensureTable = () => queryAllRaw('CREATE TABLE IF NOT EXISTS office_ai_settings (id TEXT PRIMARY KEY, value TEXT NOT NULL)')

export function readOfficeAiServiceSettings() {
  ensureTable()
  const rows = queryAllRaw('SELECT value FROM office_ai_settings WHERE id = ?', ['services-v1'])
  if (!rows.length) return {}
  return JSON.parse(rows[0].value)
}

export function writeOfficeAiServiceSettings(value) {
  ensureTable()
  queryAllRaw('INSERT OR REPLACE INTO office_ai_settings (id, value) VALUES (?, ?)', ['services-v1', JSON.stringify(value)])
}
