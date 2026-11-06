import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import AdmZip from 'adm-zip'
import { DOMParser } from '@xmldom/xmldom'

const locks = new Set()
const MAX_BYTES = 256 * 1024 * 1024
const NS_WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const NS_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types'
export const officeFault = (code, message = code) => Object.assign(new Error(message), { code })
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const fold = p => process.platform === 'win32' ? p.toLowerCase() : p
const contained = (root, p) => fold(p) === fold(root) || fold(p).startsWith(fold(root) + path.sep)
const abort = signal => { if (signal?.aborted) throw officeFault('OFFICE_OPERATION_CANCELLED') }

function xml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw officeFault('OFFICE_DOCX_XML_UNSAFE')
  let invalid = false
  let doc
  try { doc = new DOMParser({ onError: () => { invalid = true } }).parseFromString(text, 'application/xml') } catch { throw officeFault('OFFICE_DOCX_XML_INVALID') }
  if (invalid || !doc?.documentElement || doc.getElementsByTagName('parsererror').length) throw officeFault('OFFICE_DOCX_XML_INVALID')
  return doc
}

/** 校验真实 OOXML 包、内部关系及正文，而不是只判断文件存在。 */
export function validateDocx(bytes) {
  const buffer = Buffer.from(bytes)
  if (!buffer.length || buffer.length > MAX_BYTES) throw officeFault('OFFICE_DOCX_SIZE_INVALID')
  let zip
  try { zip = new AdmZip(buffer) } catch { throw officeFault('OFFICE_DOCX_ZIP_INVALID') }
  const entries = zip.getEntries()
  const names = new Set()
  let expanded = 0
  const documents = new Map()
  for (const entry of entries) {
    const name = entry.entryName
    if (names.has(name) || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) throw officeFault('OFFICE_DOCX_ZIP_UNSAFE')
    names.add(name)
    expanded += entry.header.size
    if (entries.length > 10000 || expanded > MAX_BYTES * 2 || entry.header.size > MAX_BYTES) throw officeFault('OFFICE_DOCX_EXPANSION_LIMIT')
    if (name.endsWith('.xml') || name.endsWith('.rels')) {
      const data = entry.getData()
      if (data.length > 32 * 1024 * 1024) throw officeFault('OFFICE_DOCX_XML_TOO_LARGE')
      documents.set(name, xml(data.toString('utf8')))
    }
  }
  if (!documents.has('[Content_Types].xml') || !documents.has('_rels/.rels') || !documents.has('word/document.xml')) throw officeFault('OFFICE_DOCX_PART_MISSING')
  const types = documents.get('[Content_Types].xml').getElementsByTagNameNS(NS_TYPES, 'Override')
  if (!Array.from(types).some(node => node.getAttribute('PartName') === '/word/document.xml' && node.getAttribute('ContentType') === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')) throw officeFault('OFFICE_DOCX_CONTENT_TYPE_INVALID')
  let mainRelationship = false
  for (const [name, doc] of documents) {
    if (!name.endsWith('.rels')) continue
    const base = name === '_rels/.rels' ? '' : path.posix.dirname(path.posix.dirname(name))
    for (const rel of Array.from(doc.getElementsByTagNameNS(NS_REL, 'Relationship'))) {
      const target = rel.getAttribute('Target')
      if (rel.getAttribute('TargetMode') === 'External') continue
      let decoded
      try { decoded = decodeURIComponent(target.split('#')[0]) } catch { throw officeFault('OFFICE_DOCX_RELATIONSHIP_INVALID') }
      if (!decoded || decoded.includes('\\') || decoded.includes('\0')) throw officeFault('OFFICE_DOCX_RELATIONSHIP_INVALID')
      const resolved = path.posix.normalize(decoded.startsWith('/') ? decoded.slice(1) : path.posix.join(base, decoded))
      if (!resolved || resolved.startsWith('../') || !names.has(resolved)) throw officeFault('OFFICE_DOCX_RELATIONSHIP_INVALID')
      if (name === '_rels/.rels' && /\/officeDocument$/.test(rel.getAttribute('Type')) && resolved === 'word/document.xml') mainRelationship = true
    }
  }
  if (!mainRelationship) throw officeFault('OFFICE_DOCX_MAIN_RELATIONSHIP_MISSING')
  const main = documents.get('word/document.xml')
  if (main.documentElement.namespaceURI !== NS_WORD || main.documentElement.localName !== 'document' || main.getElementsByTagNameNS(NS_WORD, 'body').length !== 1) throw officeFault('OFFICE_DOCX_DOCUMENT_INVALID')
  const texts = Array.from(main.getElementsByTagNameNS(NS_WORD, 't')).map(node => node.textContent).join('')
  const drawings = main.getElementsByTagNameNS(NS_WORD, 'drawing').length + main.getElementsByTagNameNS(NS_WORD, 'pict').length
  if (!texts.trim() && !drawings) throw officeFault('OFFICE_DOCX_EMPTY_CONTENT')
  return { valid: true, checkedAt: new Date().toISOString(), textCharacters: texts.length, drawings, partCount: entries.length }
}

async function identity(p) {
  try {
    const s = await fs.lstat(p)
    if (!s.isFile() || s.isSymbolicLink()) throw officeFault('OFFICE_TARGET_UNSAFE')
    return { dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs }
  } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
const sameIdentity = (a, b) => a === null && b === null || Boolean(a && b && ['dev', 'ino', 'size', 'mtimeMs'].every(k => a[k] === b[k]))
async function directoryIdentity(directory) {
  const real = await fs.realpath(directory)
  const stat = await fs.lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink() || fold(real) !== fold(directory)) throw officeFault('OFFICE_TARGET_CHANGED')
  return { dev: stat.dev, ino: stat.ino }
}
const sameDirectory = (a, b) => Boolean(a && b && a.dev === b.dev && a.ino === b.ino)
async function writeDurable(file, bytes, flag = 'wx') {
  const handle = await fs.open(file, flag, 0o600)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
}
async function syncDirectory(directory) {
  // Windows 不支持目录 fsync；文件句柄已在 rename 前同步。
  if (process.platform === 'win32') return
  const handle = await fs.open(directory, 'r')
  try { await handle.sync() } finally { await handle.close() }
}

/** 在耗时转换前固定目标身份；模型输出还必须位于真实 SANDBOX 边界。 */
export async function prepareOfficeTarget(targetPath, { sourcePath, allowedRoot, allowOverwrite = false } = {}) {
  if (typeof targetPath !== 'string' || !path.isAbsolute(targetPath) || targetPath.includes('\0') || path.extname(targetPath).toLowerCase() !== '.docx') throw officeFault('OFFICE_TARGET_INVALID')
  const directory = await fs.realpath(path.dirname(targetPath))
  const resolved = path.join(directory, path.basename(targetPath))
  const root = allowedRoot ? await fs.realpath(allowedRoot) : null
  if (root && !contained(root, resolved)) throw officeFault('OFFICE_OUTPUT_OUTSIDE_SANDBOX')
  const before = await identity(resolved)
  if (sourcePath) {
    const source = await fs.realpath(sourcePath)
    const sourceStat = await identity(source)
    if (fold(source) === fold(resolved) || (before && sourceStat && sourceStat.dev === before.dev && sourceStat.ino === before.ino)) throw officeFault('OFFICE_SOURCE_OVERWRITE')
  }
  if (before && !allowOverwrite) throw officeFault('OFFICE_TARGET_EXISTS')
  return { path: resolved, directory, directoryIdentity: await directoryIdentity(directory), before, allowedRoot: root,
    rootIdentity: root ? await directoryIdentity(root) : null, sourcePath: sourcePath || null }
}

async function checkDirectory(target) {
  if (!sameDirectory(target.directoryIdentity, await directoryIdentity(target.directory))) throw officeFault('OFFICE_TARGET_CHANGED')
  if (target.allowedRoot && (!contained(await fs.realpath(target.allowedRoot), target.path) || !sameDirectory(target.rootIdentity, await directoryIdentity(target.allowedRoot)))) throw officeFault('OFFICE_OUTPUT_OUTSIDE_SANDBOX')
}
async function checkTarget(target) {
  await checkDirectory(target)
  if (!sameIdentity(target.before, await identity(target.path))) throw officeFault('OFFICE_TARGET_CHANGED')
}

/** 同目录临时文件 + 持久化 journal。提交后取消不能把已交付文件改报为未完成。 */
export async function deliverOfficeArtifact({ bytes, target, taskId, operationIdentity, scope, journalDir, signal, onPhase = async () => {}, faultInjection = async () => {} }) {
  const key = fold(target.path)
  if (locks.has(key)) throw officeFault('OFFICE_TARGET_BUSY')
  const id = randomUUID()
  const temporary = path.join(target.directory, `.friday-office-${id}.tmp`)
  const backup = path.join(target.directory, `.friday-office-${id}.bak`)
  const journalPath = path.join(journalDir, `${id}.json`)
  const buffer = Buffer.from(bytes)
  const validation = validateDocx(buffer)
  const digest = sha256(buffer)
  locks.add(key)
  const journal = { schemaVersion: 1, id, taskId, operationIdentity, scope, target, temporary, backup, sha256: digest, bytes: buffer.length, phase: 'prepared', createdAt: new Date().toISOString() }
  let committed = false
  let backedUp = false
  const record = async phase => {
    journal.phase = phase
    const next = journalPath + '.next'
    await writeDurable(next, JSON.stringify(journal))
    await fs.rename(next, journalPath)
    await syncDirectory(journalDir)
    await faultInjection(phase)
  }
  try {
    abort(signal)
    await checkTarget(target)
    await fs.mkdir(journalDir, { recursive: true })
    await record('prepared')
    await writeDurable(temporary, buffer)
    await record('temp-written')
    await onPhase('committing')
    abort(signal)
    await checkTarget(target)
    if (target.before) {
      await record('backup-planned')
      await fs.rename(target.path, backup)
      backedUp = true
      if (!sameIdentity(await identity(backup), target.before)) throw officeFault('OFFICE_TARGET_CHANGED')
      await record('backed-up')
    }
    abort(signal)
    await record('commit-planned')
    abort(signal)
    await checkDirectory(target)
    // 不覆盖最后检查后突然出现的目标。hard link 为同盘原子、不覆盖提交。
    await fs.link(temporary, target.path)
    committed = true
    await record('committed')
    await syncDirectory(target.directory)
    await onPhase('verifying')
    const readback = await fs.readFile(target.path)
    if (sha256(readback) !== digest) throw officeFault('OFFICE_ARTIFACT_HASH_MISMATCH')
    const verified = validateDocx(readback)
    await record('verified')
    // 保留交付收据直到调用方持久化 ledger completed，再 ack 清理；否则进程
    // 可能在文件交付与任务记录之间退出，导致重启丢失交付事实。
    return { id, path: target.path, format: 'docx', persisted: true, sha256: digest, bytes: buffer.length, validation: verified || validation }
  } catch (error) {
    if (!committed) {
      if (backedUp && !await identity(target.path) && sameIdentity(await identity(backup), target.before)) {
        try { await fs.rename(backup, target.path); backedUp = false } catch { error.recoveryRequired = true }
      } else if (backedUp) error.recoveryRequired = true
      await fs.unlink(temporary).catch(() => {})
      if (!error.recoveryRequired) await fs.unlink(journalPath).catch(() => {})
    } else {
      // 已落盘但验证或清理失败：保留 journal/备份用于恢复，不删除最终文件。
      error.recoveryRequired = true
      error.persisted = true
      error.artifactPath = target.path
    }
    throw error
  } finally { locks.delete(key) }
}

/** 任务事实已持久化后确认收据；清理失败不撤销已交付文件。 */
export async function acknowledgeOfficeDelivery({ journalDir, artifact }) {
  if (!/^[a-f0-9-]{36}$/.test(artifact?.id || '')) throw officeFault('OFFICE_JOURNAL_INVALID')
  const file = path.join(journalDir, `${artifact.id}.json`)
  let record
  try { record = JSON.parse(await fs.readFile(file, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  const { id, target, temporary, backup } = record
  if (record.schemaVersion !== 1 || id !== artifact.id || target?.path !== artifact.path || record.sha256 !== artifact.sha256 || temporary !== path.join(target.directory, `.friday-office-${id}.tmp`) || backup !== path.join(target.directory, `.friday-office-${id}.bak`)) throw officeFault('OFFICE_JOURNAL_INVALID')
  await checkDirectory(target)
  const bytes = await fs.readFile(target.path)
  if (sha256(bytes) !== record.sha256) throw officeFault('OFFICE_ARTIFACT_CHANGED')
  validateDocx(bytes)
  const previous = await identity(backup)
  if (previous && !sameIdentity(previous, target.before)) throw officeFault('OFFICE_RECOVERY_BACKUP_CHANGED')
  await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
  if (previous) await fs.unlink(backup)
  await fs.unlink(file)
  await syncDirectory(journalDir)
}

/** 启动恢复只操作本服务登记的临时文件；外部改动或歧义保留现场。 */
export async function recoverOfficeDeliveries(journalDir, { scope } = {}) {
  const recovered = []
  const names = await fs.readdir(journalDir).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  for (const name of names.filter(name => /^[a-f0-9-]{36}\.json$/.test(name))) {
    let record
    const file = path.join(journalDir, name)
    try {
      record = JSON.parse(await fs.readFile(file, 'utf8'))
      if (scope && (record.scope?.actorId !== scope.actorId || record.scope?.spaceId !== scope.spaceId)) continue
      const { id, target, temporary, backup } = record
      if (record.schemaVersion !== 1 || name !== `${id}.json` || !path.isAbsolute(target?.path || '') || path.dirname(target.path) !== target.directory || temporary !== path.join(target.directory, `.friday-office-${id}.tmp`) || backup !== path.join(target.directory, `.friday-office-${id}.bak`)) throw officeFault('OFFICE_JOURNAL_INVALID')
      await checkDirectory(target)
      const targetIdentity = await identity(target.path)
      const bytes = targetIdentity && targetIdentity.size === record.bytes ? await fs.readFile(target.path) : null
      if (bytes && sha256(bytes) === record.sha256) {
        const validation = validateDocx(bytes)
        // 只清理原始身份仍吻合的备份。
        const previous = await identity(backup)
        if (previous && !sameIdentity(previous, target.before)) throw officeFault('OFFICE_RECOVERY_BACKUP_CHANGED')
        // 调用方持久化相应操作的完成记录后再确认，恢复自身也可被安全中断。
        recovered.push({ taskId: record.taskId, operationIdentity: record.operationIdentity, status: 'delivered', artifact: { id, path: target.path, format: 'docx', persisted: true, bytes: bytes.length, sha256: record.sha256, validation } })
      } else if (!targetIdentity && sameIdentity(await identity(backup), target.before) && target.before) {
        await fs.rename(backup, target.path)
        await fs.unlink(temporary).catch(() => {})
        await fs.unlink(file)
        recovered.push({ taskId: record.taskId, operationIdentity: record.operationIdentity, status: 'restored' })
      } else if (sameIdentity(targetIdentity, target.before) && !await identity(backup)) {
        await fs.unlink(temporary).catch(() => {})
        await fs.unlink(file)
        recovered.push({ taskId: record.taskId, operationIdentity: record.operationIdentity, status: 'interrupted' })
      } else throw officeFault('OFFICE_RECOVERY_REQUIRES_REVIEW')
    } catch (error) { recovered.push({ taskId: record?.taskId, operationIdentity: record?.operationIdentity, status: 'recovery-required', code: error.code || 'OFFICE_JOURNAL_INVALID', journalPath: file }) }
  }
  return recovered
}
