import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const OFFICE_HTML_UPSTREAM_LOCK_FILE = 'office-html-upstream.lock.json'
export const OFFICE_HTML_UPSTREAM_SOURCE_SCOPE = 'genoffice-html-source-v1'
export const OFFICIAL_HTML_REPOSITORY = 'https://github.com/genspark-ai/genoffice.git'

const defaultProjectRoot = fileURLToPath(new URL('../../', import.meta.url))
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
const issue = (code, detail) => ({ code, ...(detail ? { detail } : {}) })
const failure = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra })

function git(root, args, { raw = false, timeout = 30000 } = {}) {
  const result = spawnSync('git', [...(root ? ['-C', root] : []), ...args], {
    encoding: raw ? null : 'utf8', windowsHide: true, timeout, maxBuffer: 128 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) throw failure('OFFICE_HTML_GIT_FAILED', { operation: args[0] })
  return raw ? result.stdout : result.stdout.trimEnd()
}

function snapshotLock(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot)
  const lockFile = path.resolve(options.lockFile || options.lockPath || path.join(projectRoot, OFFICE_HTML_UPSTREAM_LOCK_FILE))
  let bytes
  try { bytes = fs.readFileSync(lockFile) } catch {
    throw failure(fs.existsSync(lockFile) ? 'OFFICE_HTML_LOCK_READ_FAILED' : 'OFFICE_HTML_LOCK_MISSING')
  }
  let lock
  try { lock = JSON.parse(bytes.toString('utf8')) } catch { throw failure('OFFICE_HTML_LOCK_INVALID') }
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) throw failure('OFFICE_HTML_LOCK_INVALID')
  if (lock.schemaVersion !== 1) throw failure('OFFICE_HTML_LOCK_SCHEMA_UNSUPPORTED')
  if (lock.officialRepository !== OFFICIAL_HTML_REPOSITORY) throw failure('OFFICE_HTML_REPOSITORY_MISMATCH')
  if (typeof lock.tag !== 'string' || !/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(lock.tag)) throw failure('OFFICE_HTML_TAG_INVALID')
  if (typeof lock.sha !== 'string' || !/^[a-f0-9]{40}$/.test(lock.sha)) throw failure('OFFICE_HTML_SHA_INVALID')
  if (lock.sourceRoot !== 'vendor/genoffice-html') throw failure('OFFICE_HTML_SOURCE_PATH_INVALID')
  if (lock.purpose !== 'html-only' || !Array.isArray(lock.editors) || lock.editors.length !== 1 || lock.editors[0] !== 'html') throw failure('OFFICE_HTML_PURPOSE_INVALID')
  if (typeof lock.packageLockSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(lock.packageLockSha256)) throw failure('OFFICE_HTML_PACKAGE_LOCK_DIGEST_INVALID')
  const sourceRoot = path.resolve(projectRoot, lock.sourceRoot)
  if (options.sourceRoot && path.resolve(options.sourceRoot) !== sourceRoot) throw failure('OFFICE_HTML_SOURCE_PATH_MISMATCH')
  return { projectRoot, lockFile, lock, lockSha256: digest(bytes), sourceRoot }
}

export function readOfficeHtmlUpstreamLock(options = {}) {
  return snapshotLock(options).lock
}

function sanitizedRemote(value) {
  try {
    const url = new URL(value)
    url.username = ''; url.password = ''; url.search = ''; url.hash = ''
    return url.href
  } catch { return /^git@[\w.-]+:[\w./-]+$/.test(value) ? value : null }
}

function sameDirectory(a, b) {
  const canonical = value => {
    const resolved = fs.realpathSync.native(value)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  return canonical(a) === canonical(b)
}

function sourceIdentity(root) {
  let stat
  try { stat = fs.lstatSync(root) } catch { throw failure('OFFICE_HTML_SOURCE_MISSING') }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure('OFFICE_HTML_SOURCE_PATH_INVALID')
  let top
  try { top = git(root, ['rev-parse', '--show-toplevel']) } catch { throw failure('OFFICE_HTML_SOURCE_NOT_GIT') }
  if (!sameDirectory(top, root)) throw failure('OFFICE_HTML_SOURCE_NOT_GIT_ROOT')
  const sha = git(root, ['rev-parse', 'HEAD'])
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all', '-z'], { raw: true })
  const changes = git(root, ['diff', '--binary', 'HEAD', '--', '.'], { raw: true })
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z'], { raw: true })
    .toString('utf8').split('\0').filter(Boolean).sort(compare)
  const files = untracked.map(file => {
    const absolute = path.join(root, file)
    const fileStat = fs.lstatSync(absolute)
    return { path: file, sha256: digest(fileStat.isSymbolicLink() ? fs.readlinkSync(absolute) : fs.readFileSync(absolute)) }
  })
  const remotes = {}
  for (const name of git(root, ['remote']).split(/\r?\n/).filter(Boolean).sort(compare)) {
    remotes[name] = sanitizedRemote(git(root, ['remote', 'get-url', name]))
  }
  let originMatchesOfficial = false
  try { originMatchesOfficial = git(root, ['remote', 'get-url', '--all', 'origin']) === OFFICIAL_HTML_REPOSITORY } catch {}
  if (git(root, ['rev-parse', 'HEAD']) !== sha || !git(root, ['status', '--porcelain=v1', '--untracked-files=all', '-z'], { raw: true }).equals(status)) {
    throw failure('OFFICE_HTML_SOURCE_CHANGED_DURING_CAPTURE')
  }
  let describe = sha
  try { describe = git(root, ['describe', '--tags', '--always']) } catch {}
  return { sha, describe, scope: OFFICE_HTML_UPSTREAM_SOURCE_SCOPE, dirty: status.length > 0,
    repositoryDirty: status.length > 0, diffDigest: digest(changes), untrackedSourceDigest: digest(JSON.stringify(files)),
    remotes, originMatchesOfficial }
}

// 仅读取固定官方 HTML 源码的身份，不把该来源当成另外四个编辑器的升级。
export function captureOfficeHtmlUpstreamSource(options = {}) {
  const snapshot = snapshotLock(options)
  const source = sourceIdentity(snapshot.sourceRoot)
  return { ...source, sourceRoot: snapshot.sourceRoot, officialRepository: snapshot.lock.officialRepository,
    tag: snapshot.lock.tag, expectedSha: snapshot.lock.sha, purpose: snapshot.lock.purpose,
    lockSha256: snapshot.lockSha256 }
}

function validateSnapshot(snapshot, { requireClean = true } = {}) {
  const issues = []
  let source
  try {
    source = sourceIdentity(snapshot.sourceRoot)
    if (source.sha !== snapshot.lock.sha) issues.push(issue('OFFICE_HTML_HEAD_MISMATCH'))
    if (!source.originMatchesOfficial) issues.push(issue('OFFICE_HTML_ORIGIN_MISMATCH'))
    if (requireClean && source.dirty) issues.push(issue('OFFICE_HTML_SOURCE_DIRTY'))
    let tagSha
    try { tagSha = git(snapshot.sourceRoot, ['rev-parse', `refs/tags/${snapshot.lock.tag}^{commit}`]) } catch {}
    if (tagSha !== snapshot.lock.sha) issues.push(issue('OFFICE_HTML_TAG_MISMATCH'))
    try {
      if (digest(fs.readFileSync(path.join(snapshot.sourceRoot, 'package-lock.json'))) !== snapshot.lock.packageLockSha256) issues.push(issue('OFFICE_HTML_PACKAGE_LOCK_MISMATCH'))
    } catch { issues.push(issue('OFFICE_HTML_PACKAGE_LOCK_MISSING')) }
    source = { ...source, sourceRoot: snapshot.sourceRoot, officialRepository: snapshot.lock.officialRepository,
      tag: snapshot.lock.tag, expectedSha: snapshot.lock.sha, purpose: snapshot.lock.purpose, lockSha256: snapshot.lockSha256 }
  } catch (error) { issues.push(issue(error.code || 'OFFICE_HTML_SOURCE_CAPTURE_FAILED', error.operation)) }
  try {
    if (digest(fs.readFileSync(snapshot.lockFile)) !== snapshot.lockSha256) issues.push(issue('OFFICE_HTML_LOCK_CHANGED_DURING_VERIFICATION'))
  } catch { issues.push(issue('OFFICE_HTML_LOCK_CHANGED_DURING_VERIFICATION')) }
  return { ok: issues.length === 0, code: issues[0]?.code || null, issues, source: source || null,
    lock: snapshot.lock, lockSha256: snapshot.lockSha256, sourceRoot: snapshot.sourceRoot }
}

export function validateOfficeHtmlUpstream(options = {}) {
  try { return validateSnapshot(snapshotLock(options), options) } catch (error) {
    const code = error.code || 'OFFICE_HTML_UPSTREAM_INVALID'
    return { ok: false, code, issues: [issue(code)], source: null }
  }
}

// 只创建不存在的独立 checkout。已有目录无论为空、dirty 或版本不同都不重置。
export function syncOfficeHtmlUpstream(options = {}) {
  let snapshot
  try { snapshot = snapshotLock(options) } catch (error) {
    const code = error.code || 'OFFICE_HTML_UPSTREAM_INVALID'
    return { ok: false, code, issues: [issue(code)], created: false }
  }
  const { sourceRoot, projectRoot, lock } = snapshot
  if (fs.existsSync(sourceRoot)) return { ...validateSnapshot(snapshot, options), created: false, reused: true }
  const parent = path.dirname(sourceRoot)
  fs.mkdirSync(parent, { recursive: true })
  // 不跟随被替换成外部目录的 vendor/junction。
  const parentReal = fs.realpathSync.native(parent)
  if (!sameDirectory(projectRoot, path.dirname(parentReal)) || path.basename(parentReal).toLowerCase() !== 'vendor') {
    const code = 'OFFICE_HTML_SOURCE_PARENT_INVALID'
    return { ok: false, code, issues: [issue(code)], created: false }
  }
  const guard = path.join(parent, '.genoffice-html-sync.lock')
  let guardFd
  try { guardFd = fs.openSync(guard, 'wx') } catch {
    const code = 'OFFICE_HTML_SYNC_BUSY'
    return { ok: false, code, issues: [issue(code)], created: false }
  }
  const stagingRoot = path.join(parent, `.genoffice-html-stage-${process.pid}-${randomUUID()}`)
  let published = false
  try {
    if (fs.existsSync(sourceRoot)) throw failure('OFFICE_HTML_SOURCE_APPEARED_DURING_SYNC')
    if (options.seedRepository) {
      const seed = path.resolve(options.seedRepository)
      if (!fs.existsSync(seed)) throw failure('OFFICE_HTML_SEED_MISSING')
      // 不共享对象存储或 alternates；删除研究 seed 不影响最终 checkout。
      git(null, ['clone', '--no-checkout', '--no-hardlinks', '--no-local', seed, stagingRoot], { timeout: 120000 })
      git(stagingRoot, ['remote', 'set-url', 'origin', lock.officialRepository])
    } else {
      git(null, ['clone', '--no-checkout', '--depth', '1', '--branch', lock.tag, '--single-branch', lock.officialRepository, stagingRoot], { timeout: 120000 })
    }
    git(stagingRoot, ['config', 'core.autocrlf', 'false'])
    git(stagingRoot, ['checkout', '--detach', lock.sha], { timeout: 120000 })
    const staged = validateSnapshot({ ...snapshot, sourceRoot: stagingRoot }, options)
    if (!staged.ok) throw failure(staged.code, { issues: staged.issues })
    if (fs.existsSync(sourceRoot)) throw failure('OFFICE_HTML_SOURCE_APPEARED_DURING_SYNC')
    fs.renameSync(stagingRoot, sourceRoot)
    published = true
    const result = validateSnapshot(snapshot, options)
    return { ...result, created: true, reused: false }
  } catch (error) {
    const code = error.code || 'OFFICE_HTML_SYNC_FAILED'
    return { ok: false, code, issues: error.issues || [issue(code, error.operation)], created: published,
      sourceRoot, ...(fs.existsSync(stagingRoot) ? { preservedStagingRoot: stagingRoot } : {}) }
  } finally {
    fs.closeSync(guardFd)
    fs.unlinkSync(guard)
  }
}
