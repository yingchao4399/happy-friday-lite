import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const defaultProject = fileURLToPath(new URL('../../', import.meta.url))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value)
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
const fault = (code, detail = {}) => Object.assign(new Error(code), { code, detail })

function gitEnvironment(alternateObjects = []) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' }
  // Do not let a caller's shell redirect a supposedly read-only repository audit.
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR', 'GIT_PREFIX', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete env[key]
  if (alternateObjects.length) {
    // Git accepts C-style quoted alternate paths; quote drive letters, spaces,
    // path-list separators and Unicode without writing an alternates file.
    env.GIT_ALTERNATE_OBJECT_DIRECTORIES = alternateObjects.map(value => JSON.stringify(value.replaceAll('\\', '/'))).join(path.delimiter)
  }
  return env
}

function git(root, args, { raw = false, optional = false, allowedFailure = [1, 128], alternateObjects = [] } = {}) {
  const result = spawnSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', root, ...args], {
    encoding: raw ? null : 'utf8', env: gitEnvironment(alternateObjects), maxBuffer: 64 * 1024 * 1024, windowsHide: true,
  })
  if (result.status !== 0 || result.error) {
    if (optional && !result.error && allowedFailure.includes(result.status)) return null
    throw fault('OFFICE_AUDIT_GIT_FAILED', { operation: args[0], reason: result.error?.code || 'nonzero-exit' })
  }
  return raw ? result.stdout : result.stdout.trimEnd()
}

function sanitizedRemote(value) {
  try {
    const url = new URL(value)
    url.username = ''; url.password = ''; url.search = ''; url.hash = ''
    return url.href
  } catch { return /^git@[\w.-]+:[\w./-]+$/.test(value) ? value : null }
}

function repository(directory, { worktree = false } = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory.includes('\0')) throw fault('OFFICE_AUDIT_REPOSITORY_ABSOLUTE_REQUIRED')
  let requested
  try { requested = fs.realpathSync(directory) } catch { throw fault('OFFICE_AUDIT_REPOSITORY_UNAVAILABLE') }
  const shallow = git(requested, ['rev-parse', '--is-shallow-repository']) === 'true'
  if (git(requested, ['rev-parse', '--show-object-format']) !== 'sha1') throw fault('OFFICE_AUDIT_OBJECT_FORMAT_UNSUPPORTED')
  const bare = git(requested, ['rev-parse', '--is-bare-repository']) === 'true'
  if (worktree && bare) throw fault('OFFICE_AUDIT_VENDOR_WORKTREE_REQUIRED')
  const root = fs.realpathSync(bare ? requested : git(requested, ['rev-parse', '--show-toplevel']))
  const common = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  const objects = fs.realpathSync(path.join(common, 'objects'))
  const remotes = Object.fromEntries(git(root, ['remote']).split(/\r?\n/).filter(Boolean).sort(compare).map(name => [name, sanitizedRemote(git(root, ['remote', 'get-url', name]))]))
  return { root, bare, shallow, objectFormat: 'sha1', objects, remotes }
}

function resolveImmutableRef(repo, value, expectedCommitSha) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw fault('OFFICE_AUDIT_REF_REQUIRED')
  let ref
  if (sha(value)) ref = value.toLowerCase()
  else {
    if (value === 'HEAD' || value === 'latest' || value.startsWith('-') || value.startsWith('refs/') && !value.startsWith('refs/tags/') || /[~^:@{}\s]/.test(value)) throw fault('OFFICE_AUDIT_IMMUTABLE_REF_REQUIRED', { ref: value })
    ref = value.startsWith('refs/tags/') ? value : `refs/tags/${value}`
    if (git(repo.root, ['check-ref-format', ref], { optional: true }) === null) throw fault('OFFICE_AUDIT_IMMUTABLE_REF_REQUIRED', { ref: value })
  }
  const objectSha = git(repo.root, ['rev-parse', '--verify', '--end-of-options', ref], { optional: true })
  const commitSha = git(repo.root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { optional: true })
  if (!sha(objectSha) || !sha(commitSha)) throw fault('OFFICE_AUDIT_REF_UNAVAILABLE', { ref: value })
  if (expectedCommitSha !== undefined && (!sha(expectedCommitSha) || commitSha !== expectedCommitSha.toLowerCase())) throw fault('OFFICE_AUDIT_REF_LOCK_MISMATCH', { ref: value, expectedCommitSha, actualCommitSha: commitSha })
  const type = git(repo.root, ['cat-file', '-t', objectSha])
  return { input: value, ref, objectSha, commitSha, objectType: type, tagKind: ref.startsWith('refs/tags/') ? type === 'tag' ? 'annotated' : 'lightweight' : null }
}

function nameStatus(bytes) {
  const parts = bytes.toString('utf8').split('\0')
  const files = []
  for (let index = 0; index < parts.length && parts[index];) {
    const status = parts[index++]
    if (!/^[ACDMRTUXB](\d{1,3})?$/.test(status)) throw fault('OFFICE_AUDIT_DIFF_INVALID')
    const first = parts[index++]
    const renamed = /^[RC]/.test(status)
    const destination = renamed ? parts[index++] : first
    if (!first || !destination) throw fault('OFFICE_AUDIT_DIFF_INVALID')
    files.push({ status, path: destination, ...(renamed ? { previousPath: first } : {}) })
  }
  return files
}

function numstat(bytes) {
  const parts = bytes.toString('utf8').split('\0')
  const values = new Map()
  for (let index = 0; index < parts.length && parts[index];) {
    const line = parts[index++]
    const first = line.indexOf('\t'), second = line.indexOf('\t', first + 1)
    if (first < 0 || second < 0) throw fault('OFFICE_AUDIT_DIFF_INVALID')
    const added = line.slice(0, first), deleted = line.slice(first + 1, second)
    const tail = line.slice(second + 1)
    const previousPath = tail ? null : parts[index++]
    const file = tail || parts[index++]
    if (!file || !/^(\d+|-)$/.test(added) || !/^(\d+|-)$/.test(deleted)) throw fault('OFFICE_AUDIT_DIFF_INVALID')
    values.set(JSON.stringify([previousPath, file]), { additions: added === '-' ? null : Number(added), deletions: deleted === '-' ? null : Number(deleted), binary: added === '-' || deleted === '-' })
  }
  return values
}

export function classifyOfficeAuditPath(file) {
  const name = file.split('/').at(-1)
  const categories = []
  if (/^(package\.json|Cargo\.toml|pyproject\.toml|requirements(?:[-.][^/]*)?\.txt|go\.mod|Gemfile|pnpm-workspace\.ya?ml)$/i.test(name)) categories.push('dependencies')
  if (/^(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.ya?ml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|go\.sum|Gemfile\.lock)$/i.test(name)) categories.push('lockfiles')
  if (/(^|\/)(scripts|tools)\//.test(file) || /^(?:electron[.-]vite\.config|vite(?:\.[^.]+)?\.config|webpack\.config|rollup\.config|electron-builder|forge\.config|tsconfig)(?:\.[^.]+)*\.(?:[cm]?[jt]s|json|ya?ml)$/i.test(name) || /^(CMakeLists\.txt|Makefile|build\.rs)$/i.test(name) || /^apps\/[^/]+\/src\/(?:main|preload)\//.test(file)) categories.push('buildEntries')
  if (/^(LICENSE|LICENCE|COPYING|NOTICE)(?:[._-].*)?$/i.test(name) || /third[-_]party[-_]?(?:licenses|notices)/i.test(name)) categories.push('licenses')
  return categories
}

const emptyCritical = () => ({ dependencies: [], lockfiles: [], buildEntries: [], licenses: [] })

function safeSpec(value) {
  if (typeof value !== 'string') return null
  // Dependency URLs can contain credentials or registry tokens. Keep the
  // package/version comparison useful without serializing those credentials.
  return value.replace(/(?:git\+)?(?:https?|ssh):\/\/[^\s]+/g, url => sanitizedRemote(url) || '<redacted-url>').slice(0, 2048)
}

function mapChanges(before, after) {
  const a = before && typeof before === 'object' && !Array.isArray(before) ? before : {}
  const b = after && typeof after === 'object' && !Array.isArray(after) ? after : {}
  const added = [], removed = [], changed = []
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)].sort(compare))) {
    if (!Object.hasOwn(a, key)) added.push({ name: key, spec: safeSpec(b[key]) })
    else if (!Object.hasOwn(b, key)) removed.push({ name: key, spec: safeSpec(a[key]) })
    else if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) changed.push({ name: key, before: safeSpec(a[key]), after: safeSpec(b[key]) })
  }
  return { added, removed, changed }
}

function packageManifestChange(repo, from, to, file, alternateObjects) {
  const read = (commit, relative, exists) => {
    if (!exists) return null
    const bytes = git(repo.root, ['show', '--no-ext-diff', '--no-textconv', `${commit}:${relative}`], { raw: true, alternateObjects })
    try {
      const value = JSON.parse(bytes)
      return value && typeof value === 'object' && !Array.isArray(value) ? value : false
    } catch { return false }
  }
  const before = read(from, file.previousPath || file.path, file.status[0] !== 'A')
  const after = read(to, file.path, file.status[0] !== 'D')
  if (before === false || after === false) return { format: 'package-json', parseStatus: 'invalid-json-or-object', reviewRequired: true }
  const dependencyChanges = Object.fromEntries(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].map(section => [section, mapChanges(before?.[section], after?.[section])]))
  const scripts = mapChanges(before?.scripts, after?.scripts)
  return { format: 'package-json', parseStatus: 'parsed', name: { before: safeSpec(before?.name), after: safeSpec(after?.name) },
    version: { before: safeSpec(before?.version), after: safeSpec(after?.version) }, packageManager: { before: safeSpec(before?.packageManager), after: safeSpec(after?.packageManager) },
    engines: mapChanges(before?.engines, after?.engines), dependencyChanges,
    // Only names and hashes of commands: scripts may embed private endpoints.
    scripts: { added: scripts.added.map(item => item.name), removed: scripts.removed.map(item => item.name), changed: scripts.changed.map(item => item.name),
      beforeSha256: hash(JSON.stringify(before?.scripts || {})), afterSha256: hash(JSON.stringify(after?.scripts || {})) } }
}

function comparison(repo, from, to, alternateObjects) {
  const options = { raw: true, alternateObjects }
  const base = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--find-renames', from, to]
  const files = nameStatus(git(repo.root, [...base, '--name-status', '-z', '--'], options))
  const counts = numstat(git(repo.root, [...base, '--numstat', '-z', '--'], options))
  const criticalChanges = emptyCritical()
  for (const file of files) {
    const count = counts.get(JSON.stringify([file.previousPath || null, file.path]))
    if (!count) throw fault('OFFICE_AUDIT_DIFF_INVALID')
    Object.assign(file, count)
    const categories = new Set([...classifyOfficeAuditPath(file.path), ...(file.previousPath ? classifyOfficeAuditPath(file.previousPath) : [])])
    file.categories = [...categories]
    if (categories.has('dependencies') && [file.path, file.previousPath].filter(Boolean).some(value => value.split('/').at(-1) === 'package.json')) file.manifestChange = packageManifestChange(repo, from, to, file, alternateObjects)
    for (const category of categories) criticalChanges[category].push(file)
  }
  const patch = git(repo.root, [...base, '--binary', '--full-index', '--'], options)
  const statusCounts = Object.fromEntries(['A', 'C', 'D', 'M', 'R', 'T', 'U', 'X', 'B'].map(status => [status, files.filter(file => file.status[0] === status).length]))
  return { from, to, summary: { files: files.length, statusCounts, binaryFiles: files.filter(file => file.binary).length,
    additions: files.reduce((sum, file) => sum + (file.additions || 0), 0), deletions: files.reduce((sum, file) => sum + (file.deletions || 0), 0),
    patchBytes: patch.length, patchSha256: hash(patch), filesSha256: hash(JSON.stringify(files)) }, files, criticalChanges }
}

function parseStatus(bytes) {
  const parts = bytes.toString('utf8').split('\0')
  const files = []
  for (let index = 0; index < parts.length && parts[index];) {
    const record = parts[index++]
    const status = record.slice(0, 2), file = record.slice(3)
    if (record[2] !== ' ' || !file) throw fault('OFFICE_AUDIT_STATUS_INVALID')
    const renamed = /[RC]/.test(status)
    const previousPath = renamed ? parts[index++] : null
    if (renamed && !previousPath) throw fault('OFFICE_AUDIT_STATUS_INVALID')
    files.push({ path: file, indexStatus: status[0], worktreeStatus: status[1], untracked: status === '??', ...(previousPath ? { previousPath } : {}) })
  }
  return files
}

function untrackedIdentity(root, relative) {
  const file = path.resolve(root, relative)
  const boundary = path.relative(root, file)
  if (!boundary || boundary === '..' || boundary.startsWith(`..${path.sep}`) || path.isAbsolute(boundary)) throw fault('OFFICE_AUDIT_UNTRACKED_PATH_INVALID')
  let ancestor = root
  for (const part of boundary.split(path.sep).slice(0, -1)) {
    ancestor = path.join(ancestor, part)
    if (fs.lstatSync(ancestor).isSymbolicLink()) throw fault('OFFICE_AUDIT_UNTRACKED_PATH_INVALID')
  }
  const stat = fs.lstatSync(file)
  if (stat.isSymbolicLink()) {
    const target = fs.readlinkSync(file)
    return { path: relative, kind: 'symlink', bytes: Buffer.byteLength(target), sha256: hash(target) }
  }
  if (!stat.isFile()) throw fault('OFFICE_AUDIT_UNTRACKED_TYPE_UNSUPPORTED')
  const digest = createHash('sha256')
  const fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(1024 * 1024)
  try { let length; while ((length = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) digest.update(buffer.subarray(0, length)) } finally { fs.closeSync(fd) }
  return { path: relative, kind: 'file', bytes: stat.size, sha256: digest.digest('hex') }
}

function workingTree(repo) {
  const head = git(repo.root, ['rev-parse', '--verify', 'HEAD'])
  const statusBytes = git(repo.root, ['status', '--porcelain=v1', '--untracked-files=all', '-z'], { raw: true })
  const files = parseStatus(statusBytes)
  const untracked = git(repo.root, ['ls-files', '--others', '--exclude-standard', '-z'], { raw: true }).toString('utf8').split('\0').filter(Boolean).sort(compare).map(relative => untrackedIdentity(repo.root, relative))
  const diff = extra => {
    const bytes = git(repo.root, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--binary', '--full-index', ...extra, '--'], { raw: true })
    return { bytes: bytes.length, sha256: hash(bytes) }
  }
  const criticalChanges = emptyCritical()
  for (const file of files) for (const category of new Set([...classifyOfficeAuditPath(file.path), ...(file.previousPath ? classifyOfficeAuditPath(file.previousPath) : [])])) criticalChanges[category].push(file)
  const state = { headSha: head, dirty: files.length > 0, hasUnmergedPaths: files.some(file => file.indexStatus === 'U' || file.worktreeStatus === 'U' || ['AA', 'DD'].includes(file.indexStatus + file.worktreeStatus)),
    statusSha256: hash(statusBytes), files, untracked, stagedDiff: diff(['--cached', head]), unstagedDiff: diff([]), headToWorkingDiff: diff([head]), criticalChanges }
  return { ...state, identityDigest: hash(JSON.stringify(state)) }
}

function mergeBases(repo, a, b, alternateObjects) {
  const output = git(repo.root, ['merge-base', '--all', a, b], { optional: true, allowedFailure: [1], alternateObjects })
  return output ? output.split(/\r?\n/).filter(Boolean) : []
}

function readLock(file, required) {
  try {
    const bytes = fs.readFileSync(file)
    const value = JSON.parse(bytes)
    if (!value || Array.isArray(value) || value.schemaVersion !== 1) throw fault('OFFICE_AUDIT_LOCK_INVALID')
    return { value, sha256: hash(bytes), path: file }
  } catch (error) {
    if (!required && error.code === 'ENOENT') return null
    throw fault('OFFICE_AUDIT_LOCK_INVALID')
  }
}

/** Collect evidence only. No fetch, checkout, merge, approved-lock edit or patch application. */
export function auditOfficeUpstream(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProject)
  const lockPath = options.lockPath || path.join(projectRoot, 'office-upstream.lock.json')
  const lock = readLock(lockPath, options.lockPath !== undefined)
  const candidate = lock?.value.approvedTarget || lock?.value.observedCandidate || null
  const oldInput = options.oldRef || lock?.value.vendorBaseSha
  if (!oldInput) throw fault('OFFICE_AUDIT_OLD_BASE_REQUIRED')
  const targetInput = options.targetRef || candidate?.commitSha
  if (!targetInput) throw fault('OFFICE_AUDIT_TARGET_REQUIRED')
  const vendor = repository(options.vendorRoot || path.resolve(projectRoot, lock?.value.vendorPath || 'vendor/happyoffice'), { worktree: true })
  const official = repository(options.officialRoot || vendor.root)
  let old, oldRepository = official
  try { old = resolveImmutableRef(official, oldInput) } catch (error) {
    if (error.code !== 'OFFICE_AUDIT_REF_UNAVAILABLE' || vendor.root === official.root) throw error
    oldRepository = vendor
    old = resolveImmutableRef(vendor, oldInput)
  }
  const targetExpected = options.targetSha || (!options.targetRef || options.targetRef === candidate?.tag || options.targetRef === candidate?.commitSha ? candidate?.commitSha : undefined)
  const target = resolveImmutableRef(official, targetInput, targetExpected)
  // When the target comes from the lock, verify both tag object and peeled commit.
  let lockedTag = null
  if (!options.targetRef && candidate?.tag) {
    lockedTag = resolveImmutableRef(official, candidate.tag, candidate.commitSha)
    if (candidate.tagObjectSha !== lockedTag.objectSha || candidate.tagKind !== lockedTag.tagKind) throw fault('OFFICE_AUDIT_REF_LOCK_MISMATCH', { ref: candidate.tag })
  }
  const before = workingTree(vendor)
  const alternateObjects = official.objects === vendor.objects ? [] : [vendor.objects]
  const comparisons = { oldToTarget: comparison(official, old.commitSha, target.commitSha, alternateObjects),
    oldToVendor: comparison(official, old.commitSha, before.headSha, alternateObjects),
    targetToVendor: comparison(official, target.commitSha, before.headSha, alternateObjects) }
  const bases = { oldTarget: mergeBases(official, old.commitSha, target.commitSha, alternateObjects),
    oldVendor: mergeBases(official, old.commitSha, before.headSha, alternateObjects), targetVendor: mergeBases(official, target.commitSha, before.headSha, alternateObjects) }
  const upstreamPaths = new Set(comparisons.oldToTarget.files.flatMap(file => [file.path, ...(file.previousPath ? [file.previousPath] : [])]))
  const vendorPaths = new Set(comparisons.oldToVendor.files.flatMap(file => [file.path, ...(file.previousPath ? [file.previousPath] : [])]))
  const overlap = [...upstreamPaths].filter(file => vendorPaths.has(file)).sort(compare)
  const after = workingTree(vendor)
  if (before.identityDigest !== after.identityDigest) throw fault('OFFICE_AUDIT_SOURCES_CHANGED')
  for (const [entry, repo] of [[old, oldRepository], [target, official], [lockedTag, official]].filter(([entry]) => entry)) {
    const again = resolveImmutableRef(repo, entry.input, entry.commitSha)
    if (again.objectSha !== entry.objectSha) throw fault('OFFICE_AUDIT_SOURCES_CHANGED')
  }
  if (lock && hash(fs.readFileSync(lock.path)) !== lock.sha256) throw fault('OFFICE_AUDIT_LOCK_CHANGED')
  return { ok: true, schemaVersion: 1, checkedAt: new Date().toISOString(), mode: 'read-only-three-way-evidence', reviewState: 'review-required',
    official: { root: official.root, bare: official.bare, shallow: official.shallow, remotes: official.remotes, configuredRepository: lock?.value.officialRepository || null, identityAttestation: 'not-performed' },
    vendor: { root: vendor.root, shallow: vendor.shallow, remotes: vendor.remotes, headSha: before.headSha, lockHeadSha: lock?.value.vendorHeadSha || null, matchesRecordedLockHead: lock?.value.vendorHeadSha ? before.headSha === lock.value.vendorHeadSha : null },
    references: { oldOfficialBaseline: { ...old, resolvedRepository: oldRepository.root === official.root ? 'official' : 'vendor', approval: 'comparison-start-only-not-approved-fork-base' }, newOfficialTarget: target, lockedTag },
    lock: lock ? { path: lock.path, sha256: lock.sha256, selection: options.targetRef ? 'explicit-target' : lock.value.approvedTarget ? 'approvedTarget' : 'observedCandidate', modifiesApproval: false } : null,
    mergeBases: bases, mergeBaseHistoryComplete: !official.shallow && !vendor.shallow, comparisons, workingTree: before,
    reviewSignals: { overlappingPaths: overlap, overlapMeaning: 'path-overlap-only', semanticConflictAssessment: 'not-performed',
      unrelatedPairs: !official.shallow && !vendor.shallow ? Object.entries(bases).filter(([, values]) => values.length === 0).map(([key]) => key) : [],
      incompleteHistoryPairs: official.shallow || vendor.shallow ? Object.keys(bases) : [] },
    limitations: ['A file overlap is a review lead, not a semantic conflict determination.', 'Recorded Git refs/remotes and hashes do not attest official ownership, feature parity or merge correctness.', 'A baseline resolved from the vendor is only a comparison start, not an approved official fork base.', 'Shallow history permits tree diffs but cannot prove missing ancestry or complete merge-base results.', 'Tracked comparisons use committed vendor HEAD; staged, unstaged and untracked changes are reported separately.', 'Each Git read is bounded to 64 MiB; larger output fails closed rather than producing a partial digest.', 'No repository fetch, checkout, merge, lock update, build, installation or semantic test was performed.'] }
}

export function parseOfficeUpstreamAuditArguments(args) {
  const mapping = { '--project': 'projectRoot', '--official': 'officialRoot', '--vendor': 'vendorRoot', '--lock': 'lockPath', '--old': 'oldRef', '--target': 'targetRef', '--target-sha': 'targetSha' }
  const options = {}
  for (let index = 0; index < args.length; index++) {
    const key = mapping[args[index]], value = args[++index]
    if (!key || options[key] !== undefined || !value || value.startsWith('--')) throw fault('OFFICE_AUDIT_ARGUMENT_INVALID')
    if (key.endsWith('Root') || key === 'lockPath') {
      if (!path.isAbsolute(value) || value.includes('\0')) throw fault('OFFICE_AUDIT_REPOSITORY_ABSOLUTE_REQUIRED')
      options[key] = path.normalize(value)
    } else options[key] = value
  }
  return options
}
