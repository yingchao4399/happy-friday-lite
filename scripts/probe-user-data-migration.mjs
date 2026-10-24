// 使用真实用户数据副本验收升级和应用版本回退；不打印正文、配置或 API Key。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import initSqlJs from 'sql.js'
import AdmZip from 'adm-zip'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'
import { applyPreviewMigrations, rollbackPreviewMigrations, previewTables } from '../src-electron/preview-migrations.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const script = fileURLToPath(import.meta.url)
const flag = name => process.argv.find(value => value.startsWith('--' + name + '='))?.slice(name.length + 3)
const phase = flag('phase')
const sha = data => crypto.createHash('sha256').update(data).digest('hex')
const fileHash = file => sha(fs.readFileSync(file))
const qi = name => '"' + name.replaceAll('"', '""') + '"'
const all = (db, sql) => {
  const rows = []
  const statement = db.prepare(sql)
  try { while (statement.step()) rows.push(statement.getAsObject()) }
  finally { statement.free() }
  return rows
}
const readDatabase = async file => new (await initSqlJs()).Database(fs.readFileSync(file))

function describe(db, known) {
  assert.equal(db.exec('PRAGMA quick_check')[0].values[0][0], 'ok')
  const tables = all(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  const result = {}
  for (const { name } of tables) {
    const actualColumns = all(db, 'PRAGMA table_info(' + qi(name) + ')').map(row => row.name)
    const columns = known?.[name]?.columns || actualColumns
    for (const column of columns) assert.ok(actualColumns.includes(column), '旧字段丢失: ' + name + '.' + column)
    const digest = crypto.createHash('sha256')
    let count = 0
    const statement = db.prepare('SELECT ' + columns.map(qi).join(',') + ' FROM ' + qi(name) + ' ORDER BY rowid')
    try {
      while (statement.step()) {
        digest.update(JSON.stringify(statement.get()) + '\n')
        count++
      }
    } finally { statement.free() }
    result[name] = { columns, rows: count, sha256: digest.digest('hex') }
  }
  return result
}

function compareTables(actual, expected) {
  for (const [table, data] of Object.entries(expected)) assert.deepEqual(actual[table], data, '原表内容发生变化: ' + table)
}

async function child() {
  const dataDir = flag('data')
  const installed = flag('installed')
  const expectedFile = path.join(dataDir, 'baseline-manifest.json')
  const expected = fs.existsSync(expectedFile) ? JSON.parse(fs.readFileSync(expectedFile, 'utf8')) : null
  if (phase === 'rollback') {
    const database = await readDatabase(path.join(dataDir, 'friday.db'))
    try {
      rollbackPreviewMigrations(database)
      assert.equal(database.exec('SELECT COUNT(*) FROM preview_migrations')[0].values[0][0], 0)
      fs.writeFileSync(path.join(dataDir, 'friday.db'), Buffer.from(database.export()))
    } finally { database.close() }
    return
  }
  if (phase === 'snapshot-restore') {
    const appDb = await import('../src-electron/db.js')
    const { setDataDir } = await import('../src-electron/config.js')
    const { restoreBackup } = await import('../src-electron/backup.js')
    setDataDir(dataDir); appDb.setDataDir(dataDir)
    await appDb.initDb(); appDb.flushDb()
    const before = fileHash(path.join(dataDir, 'friday.db'))
    const configBefore = fileHash(path.join(dataDir, 'config.json'))
    const invalidFile = path.join(path.dirname(dataDir), 'invalid-backup.zip')
    const invalidArchive = new AdmZip()
    invalidArchive.addFile('friday.db', Buffer.from('invalid sqlite database fixture'))
    invalidArchive.writeZip(invalidFile)
    try {
      const rejected = await restoreBackup(invalidFile)
      assert.equal(rejected.success, false)
      assert.equal(fileHash(path.join(dataDir, 'friday.db')), before, '损坏备份触碰了现存数据')
      assert.equal(fileHash(path.join(dataDir, 'config.json')), configBefore)
      const runtime = path.join(dataDir, 'electron-user-data', 'acceptance-runtime.txt')
      fs.mkdirSync(path.dirname(runtime), { recursive: true })
      fs.writeFileSync(runtime, '运行目录需要保留')
      const restored = await restoreBackup(flag('snapshot'))
      assert.equal(restored.success, true, restored.error)
      appDb.closeDb()
      assert.equal(fs.readFileSync(runtime, 'utf8'), '运行目录需要保留')
      assert.equal(fileHash(path.join(dataDir, 'config.json')), configBefore)
      const database = await readDatabase(path.join(dataDir, 'friday.db'))
      try {
        compareTables(describe(database, expected), expected)
        for (const table of previewTables) assert.equal(database.exec('SELECT COUNT(*) FROM ' + qi(table))[0].values[0][0], 0, '升级前快照不应含后续夹具')
      } finally { database.close() }
      assert.equal(fs.readdirSync(path.dirname(dataDir)).some(name => name.startsWith('.friday-restore-') || name.startsWith('.friday-rollback-')), false)
      console.log(JSON.stringify({ phase, ok: true, officialSnapshotRestore: true, invalidBackupPreservesCurrent: true, runtimeProfilePreserved: true }))
    } finally { appDb.closeDb() }
    return
  }
  const modulePath = phase === 'baseline' || phase === 'legacy'
    ? path.join(installed, 'src-electron', 'db.js')
    : path.join(root, 'src-electron', 'db.js')
  const appDb = await import(pathToFileURL(modulePath))
  appDb.setDataDir(dataDir)
  try {
    await appDb.initDb()
    if (phase === 'preview') {
      const stamp = new Date().toISOString()
      const id = '__preview_migration_acceptance__'
      appDb.queryAllRaw('INSERT INTO clipboard_items VALUES (?, ?, ?, ?)', [id, JSON.stringify({ id, kind: 'text', plainText: '迁移测试夹具', capturedAt: stamp }), stamp, null])
      appDb.queryAllRaw('INSERT INTO clipboard_tags VALUES (?, ?)', [id, '验收标签'])
      appDb.queryAllRaw('INSERT INTO trash_entries VALUES (?, ?, ?, ?, ?)', [id, 'clipboard', id, JSON.stringify({ title: '验收删除夹具' }), stamp])
      appDb.queryAllRaw('INSERT INTO note_pinned VALUES (?, ?)', [id, stamp])
      appDb.queryAllRaw('INSERT INTO note_resource_links VALUES (?, ?, ?, ?)', [id, 'knowledge:acceptance', 'paragraph-1', stamp])
      appDb.queryAllRaw('INSERT INTO recitation_sessions VALUES (?, ?, ?)', [id, JSON.stringify({ id, transcript: '迁移测试夹具' }), stamp])
      appDb.queryAllRaw('INSERT INTO recitation_segments VALUES (?, ?, ?)', [id, 0, JSON.stringify({ start: 0, end: 1, text: '测试片段' })])
      appDb.queryAllRaw('INSERT INTO module_order VALUES (?, ?)', [id, 100])
    }
  } finally { appDb.closeDb() }
  const database = await readDatabase(path.join(dataDir, 'friday.db'))
  try {
    const actual = describe(database, expected)
    if (expected) compareTables(actual, expected)
    if (phase === 'baseline') fs.writeFileSync(expectedFile, JSON.stringify(actual))
    if (phase === 'preview') {
      for (const table of previewTables) assert.ok(actual[table].rows > 0, '预览表没有写入夹具: ' + table)
      fs.writeFileSync(path.join(dataDir, 'preview-manifest.json'), JSON.stringify(Object.fromEntries(previewTables.map(name => [name, actual[name]]))))
    }
    if (phase === 'legacy' || phase === 'reupgrade') compareTables(actual, JSON.parse(fs.readFileSync(path.join(dataDir, 'preview-manifest.json'), 'utf8')))
    if (phase === 'legacy') assert.equal(database.exec('SELECT COUNT(*) FROM preview_migrations')[0].values[0][0], 0)
    if (phase === 'reupgrade') assert.equal(applyPreviewMigrations(database), false)
    const privateTotals = Object.values(expected || actual).reduce((n, table) => n + table.rows, 0)
    console.log(JSON.stringify({ phase, ok: true, oldTables: Object.keys(expected || actual).length, oldRows: privateTotals }))
  } finally { database.close() }
}

async function runPhase(name, dataDir, installed, snapshot) {
  await new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['--max-old-space-size=8192', script, '--phase=' + name, '--data=' + dataDir, '--installed=' + installed, ...(snapshot ? ['--snapshot=' + snapshot] : [])], { cwd: root, windowsHide: true, stdio: 'inherit' })
    proc.on('error', reject)
    proc.on('exit', code => code === 0 ? resolve() : reject(new Error('验收阶段失败: ' + name + ' (' + code + ')')))
  })
}

async function main() {
  const source = path.resolve(flag('source') || path.join(process.env.APPDATA, 'happy-friday-lite'))
  const installed = path.resolve(flag('installed') || path.join(process.env.LOCALAPPDATA, 'Programs', 'Happy Friday Lite', 'resources', 'app'))
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-real-migration-'))
  const dataDir = path.join(temporary, 'copy')
  fs.mkdirSync(dataDir)
  const protectedFiles = ['friday.db', 'config.json', 'session.json', '.sqlite-migrated'].filter(name => fs.existsSync(path.join(source, name)))
  const sourceHashes = {}
  try {
    for (const name of protectedFiles) {
      sourceHashes[name] = fileHash(path.join(source, name))
      fs.copyFileSync(path.join(source, name), path.join(dataDir, name))
      assert.equal(fileHash(path.join(dataDir, name)), sourceHashes[name], '复制期间源文件变化，请在应用空闲时重试')
    }
    await runPhase('baseline', dataDir, installed)
    const beforeSnapshot = Object.fromEntries(protectedFiles.map(name => [name, fileHash(path.join(dataDir, name))]))
    const { createUpgradeSnapshot } = await import('../src-electron/backup.js')
    const snapshot = await createUpgradeSnapshot(dataDir, '3.0.6-preview.2')
    const snapshotHash = fileHash(snapshot)
    const archive = new AdmZip(snapshot)
    for (const [name, hash] of Object.entries(beforeSnapshot)) assert.equal(sha(archive.readFile(name)), hash, '升级前备份内容不一致: ' + name)
    assert.equal(await createUpgradeSnapshot(dataDir, '3.0.6-preview.2'), snapshot)
    for (const name of ['preview', 'rollback', 'legacy', 'reupgrade']) await runPhase(name, dataDir, installed)
    await runPhase('snapshot-restore', dataDir, installed, snapshot)
    assert.equal(fileHash(snapshot), snapshotHash, '回退快照被升级过程覆盖')
    for (const [name, hash] of Object.entries(sourceHashes)) assert.equal(fileHash(path.join(source, name)), hash, '真实用户源文件在验收期间变化: ' + name)
    for (const name of protectedFiles.filter(name => name !== 'friday.db')) assert.equal(fileHash(path.join(dataDir, name)), sourceHashes[name], '原配置或会话文件变化: ' + name)
    const baseline = JSON.parse(fs.readFileSync(path.join(dataDir, 'baseline-manifest.json'), 'utf8'))
    const report = {
      ok: true, checkedAt: new Date().toISOString(), sourceVersion: '3.0.6', targetVersion: '3.0.6-preview.2',
      sourceDatabaseBytes: fs.statSync(path.join(source, 'friday.db')).size,
      originalTables: Object.keys(baseline).length,
      originalRows: Object.values(baseline).reduce((n, table) => n + table.rows, 0),
      upgradedTables: previewTables.length, originalRowsUnchanged: true, newRowsPreservedOnRollback: true,
      installedLegacyReopen: true, reupgradeIdempotent: true, preUpgradeSnapshotVerified: true,
      officialSnapshotRestore: true, invalidBackupPreservesCurrent: true, runtimeProfilePreserved: true,
      configAndSessionBytesUnchanged: true, originalSourceFilesUnchanged: true,
      limitation: '数据层副本验收；不代替最终安装升级、回退、卸载和重装验收'
    }
    const diagnostics = path.join(root, 'app-data', 'diagnostics')
    fs.mkdirSync(diagnostics, { recursive: true })
    fs.writeFileSync(path.join(diagnostics, 'user-data-migration-result.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
  } finally {
    removePathNoFollowSync(temporary, { root: os.tmpdir() })
  }
}

try { if (phase) await child(); else await main() }
catch (error) { console.error(error.message); process.exitCode = 1 }
