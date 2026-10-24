import { DatabaseSync, backup } from 'node:sqlite'

// 保持业务层的 sql.js 调用协议，改由磁盘 SQLite 按页读写。
// 不在主进程复制整库，也不在每次自动保存时导出数百 MB 的 WASM 内存。
export function openSqliteStorage(filename, { readOnly = false } = {}) {
  const connection = new DatabaseSync(filename, { readOnly, enableForeignKeyConstraints: false })
  try {
    connection.exec('PRAGMA cache_size = -16384; PRAGMA busy_timeout = 3000; PRAGMA temp_store = FILE;')
    if (!readOnly) connection.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;')
  } catch (error) { connection.close(); throw error }
  let modified = 0
  const values = params => params.map(value => typeof value === 'boolean' ? Number(value) : value ?? null)
  return {
    run(sql, params) {
      if (params?.length) modified = Number(connection.prepare(sql).run(...values(params)).changes)
      else {
        connection.exec(sql)
        modified = Number(connection.prepare('SELECT changes() AS count').get().count)
      }
      return this
    },
    prepare(sql) {
      const statement = connection.prepare(sql)
      let iterator = null, current = null, parameters = []
      return {
        bind(params = []) { iterator?.return?.(); iterator = null; parameters = values(params) },
        step() {
          iterator ||= statement.iterate(...parameters)
          const next = iterator.next()
          current = next.value
          return !next.done
        },
        getAsObject() { return { ...current } },
        free() { iterator?.return?.(); iterator = null; current = null },
      }
    },
    exec(sql) {
      if (/^\s*(SELECT|PRAGMA)\b/i.test(sql)) {
        const statement = connection.prepare(sql)
        const rows = statement.all()
        if (!rows.length) return []
        const columns = statement.columns().map(column => column.name)
        return [{ columns, values: rows.map(row => columns.map(column => row[column])) }]
      }
      connection.exec(sql)
      return []
    },
    getRowsModified() { return modified },
    // DELETE 日志模式下，成功的写语句/COMMIT 已同步持久化；无需全库快照。
    flush() {},
    backupTo(destination) { return backup(connection, destination, { rate: 128 }) },
    close() { connection.close() },
  }
}
