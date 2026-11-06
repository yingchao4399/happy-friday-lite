import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { auditOfficeUpstream, classifyOfficeAuditPath, parseOfficeUpstreamAuditArguments } from '../office/upstream-audit.mjs'

const project = fileURLToPath(new URL('../../', import.meta.url))
const write = (file, bytes) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes) }
const hash = value => createHash('sha256').update(value).digest('hex')
function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, `${args[0]}: ${result.stderr}`)
  return result.stdout.trimEnd()
}
function fixture(t, { dirty = true, shallow = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-upstream-audit-'))
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('friday-upstream-audit-'))
    fs.rmSync(root, { recursive: true, force: true })
  })
  const source = path.join(root, 'official-source'), officialRoot = path.join(root, '官方 bare.git')
  const projectRoot = path.join(root, 'Friday 项目'), vendorRoot = path.join(projectRoot, 'vendor/happyoffice')
  fs.mkdirSync(source)
  git(source, ['init', '--quiet'])
  git(source, ['config', 'user.name', 'Office audit fixture'])
  git(source, ['config', 'user.email', 'office-audit@example.invalid'])
  for (const [file, text] of Object.entries({ 'package.json': '{"version":"1","dependencies":{"core":"^1","removed":"1"},"scripts":{"build":"private script body"}}', 'package-lock.json': '{"lockfileVersion":3}',
    'apps/pdf/src/main/index.ts': 'base\n', 'LICENSE': 'Apache fixture\n', 'old name 中文.txt': 'rename marker\n', 'scripts/build.mjs': 'base build\n', 'staged.txt': 'staged base\n' })) write(path.join(source, file), text)
  git(source, ['add', '.']); git(source, ['commit', '--quiet', '-m', 'old official'])
  const oldSha = git(source, ['rev-parse', 'HEAD'])
  git(source, ['tag', 'v0.10.0'])
  write(path.join(source, 'package.json'), '{"version":"2","dependencies":{"core":"^2","added":"https://user:password@example.com/pkg?token=secret"},"scripts":{"build":"changed private script body"}}')
  write(path.join(source, 'package-lock.json'), '{"lockfileVersion":3,"packages":{"new":{}}}')
  write(path.join(source, 'apps/pdf/src/main/index.ts'), 'upstream\n')
  write(path.join(source, 'LICENSE'), 'Apache fixture\nNOTICE added\n')
  write(path.join(source, 'image.bin'), Buffer.from([0, 1, 2, 3, 0, 255]))
  fs.renameSync(path.join(source, 'old name 中文.txt'), path.join(source, 'new name 中文.txt'))
  git(source, ['add', '.']); git(source, ['commit', '--quiet', '-m', 'new official'])
  const targetSha = git(source, ['rev-parse', 'HEAD'])
  git(source, ['tag', '-a', 'v0.12.0', '-m', 'fixed annotated target'])
  const tagObjectSha = git(source, ['rev-parse', 'refs/tags/v0.12.0'])
  fs.mkdirSync(path.dirname(vendorRoot), { recursive: true })
  git(root, ['clone', '--quiet', source, vendorRoot])
  git(vendorRoot, ['checkout', '--quiet', '-b', 'friday', oldSha])
  git(vendorRoot, ['config', 'user.name', 'Office audit fixture'])
  git(vendorRoot, ['config', 'user.email', 'office-audit@example.invalid'])
  write(path.join(vendorRoot, 'apps/pdf/src/main/index.ts'), 'Friday adapter\n')
  write(path.join(vendorRoot, 'private-hook.ts'), 'private source\n')
  git(vendorRoot, ['add', '.']); git(vendorRoot, ['commit', '--quiet', '-m', 'Friday hooks'])
  const vendorSha = git(vendorRoot, ['rev-parse', 'HEAD'])
  if (dirty) {
    write(path.join(vendorRoot, 'staged.txt'), 'staged change\n'); git(vendorRoot, ['add', 'staged.txt'])
    write(path.join(vendorRoot, 'scripts/build.mjs'), 'unstaged build change\n')
    write(path.join(vendorRoot, '未跟踪 空格.txt'), 'untracked body must not be printed\n')
  }
  git(root, ['clone', '--quiet', '--bare', ...(shallow ? ['--depth=1', '--single-branch'] : []), shallow ? pathToFileURL(source).href : source, officialRoot])
  const options = { projectRoot, officialRoot, vendorRoot, oldRef: 'v0.10.0', targetRef: 'v0.12.0' }
  const createLock = patch => {
    const file = path.join(projectRoot, 'office-upstream.lock.json')
    write(file, JSON.stringify({ schemaVersion: 1, officialRepository: 'https://github.com/genspark-ai/genoffice.git',
      vendorPath: 'vendor/happyoffice', vendorHeadSha: vendorSha, vendorBaseSha: oldSha, approvedTarget: null,
      observedCandidate: { tag: 'v0.12.0', commitSha: targetSha, tagObjectSha, tagKind: 'annotated' }, ...patch }))
    return file
  }
  return { root, source, officialRoot, projectRoot, vendorRoot, oldSha, targetSha, tagObjectSha, vendorSha, options, createLock }
}

test('three-way audit compares separate official/vendor repositories, preserves refs/index/lock and records dirty/untracked evidence without source bodies', t => {
  const f = fixture(t)
  const lockFile = f.createLock()
  const indexFile = path.join(f.vendorRoot, '.git/index')
  const before = { refs: git(f.vendorRoot, ['show-ref']), index: hash(fs.readFileSync(indexFile)), lock: fs.readFileSync(lockFile, 'utf8') }
  const result = auditOfficeUpstream(f.options)
  assert.equal(result.ok, true)
  assert.equal(result.vendor.headSha, f.vendorSha)
  assert.equal(result.references.newOfficialTarget.commitSha, f.targetSha)
  assert.equal(result.references.newOfficialTarget.objectSha, f.tagObjectSha)
  assert.equal(result.references.newOfficialTarget.tagKind, 'annotated')
  assert.deepEqual(result.mergeBases.oldTarget, [f.oldSha])
  assert.deepEqual(result.mergeBases.oldVendor, [f.oldSha])
  assert.deepEqual(result.mergeBases.targetVendor, [f.oldSha])
  assert.equal(result.mergeBaseHistoryComplete, true)
  assert.equal(result.workingTree.dirty, true)
  assert.ok(result.workingTree.files.some(file => file.path === 'staged.txt' && file.indexStatus === 'M'))
  assert.ok(result.workingTree.files.some(file => file.path === 'scripts/build.mjs' && file.worktreeStatus === 'M'))
  assert.ok(result.workingTree.untracked.some(file => file.path === '未跟踪 空格.txt' && file.sha256 === hash('untracked body must not be printed\n')))
  assert.equal(JSON.stringify(result).includes('untracked body must not be printed'), false)
  assert.notEqual(result.workingTree.stagedDiff.sha256, result.workingTree.unstagedDiff.sha256)
  assert.deepEqual(result.reviewSignals.overlappingPaths, ['apps/pdf/src/main/index.ts'])
  assert.equal(result.reviewSignals.semanticConflictAssessment, 'not-performed')
  const diff = result.comparisons.oldToTarget
  assert.ok(diff.files.some(file => file.status === 'R100' && file.previousPath === 'old name 中文.txt' && file.path === 'new name 中文.txt'))
  assert.ok(diff.files.some(file => file.path === 'image.bin' && file.binary && file.additions === null))
  assert.equal(diff.criticalChanges.dependencies[0].path, 'package.json')
  const dependency = diff.criticalChanges.dependencies[0].manifestChange
  assert.deepEqual(dependency.version, { before: '1', after: '2' })
  assert.deepEqual(dependency.dependencyChanges.dependencies.changed, [{ name: 'core', before: '^1', after: '^2' }])
  assert.deepEqual(dependency.scripts.changed, ['build'])
  assert.equal(dependency.dependencyChanges.dependencies.added[0].spec, 'https://example.com/pkg')
  assert.equal(JSON.stringify(result).includes('token=secret'), false)
  assert.equal(JSON.stringify(result).includes('private script body'), false)
  assert.equal(diff.criticalChanges.lockfiles[0].path, 'package-lock.json')
  assert.equal(diff.criticalChanges.licenses[0].path, 'LICENSE')
  assert.equal(diff.criticalChanges.buildEntries[0].path, 'apps/pdf/src/main/index.ts')
  assert.match(diff.summary.patchSha256, /^[a-f0-9]{64}$/)
  assert.deepEqual({ refs: git(f.vendorRoot, ['show-ref']), index: hash(fs.readFileSync(indexFile)), lock: fs.readFileSync(lockFile, 'utf8') }, before)
})

test('lock selection verifies tag object and peeled commit, never treats candidate as integrated and requires an explicit missing baseline', t => {
  const f = fixture(t, { dirty: false })
  f.createLock()
  const options = { projectRoot: f.projectRoot, officialRoot: f.officialRoot }
  const result = auditOfficeUpstream(options)
  assert.equal(result.lock.selection, 'observedCandidate')
  assert.equal(result.lock.modifiesApproval, false)
  assert.equal(result.reviewState, 'review-required')
  assert.equal(result.references.lockedTag.objectSha, f.tagObjectSha)
  assert.equal(result.workingTree.dirty, false)
  f.createLock({ observedCandidate: { tag: 'v0.12.0', commitSha: f.oldSha, tagObjectSha: f.tagObjectSha, tagKind: 'annotated' } })
  assert.throws(() => auditOfficeUpstream(options), { code: 'OFFICE_AUDIT_REF_LOCK_MISMATCH' })
  f.createLock({ observedCandidate: { tag: 'v0.12.0', commitSha: f.targetSha, tagObjectSha: f.oldSha, tagKind: 'annotated' } })
  assert.throws(() => auditOfficeUpstream(options), { code: 'OFFICE_AUDIT_REF_LOCK_MISMATCH' })
  f.createLock({ vendorBaseSha: null })
  assert.throws(() => auditOfficeUpstream(options), { code: 'OFFICE_AUDIT_OLD_BASE_REQUIRED' })
})

test('shallow official bare still permits tree evidence but marks ancestry incomplete and vendor-only baseline unapproved', t => {
  const f = fixture(t, { shallow: true, dirty: false })
  const result = auditOfficeUpstream(f.options)
  assert.equal(result.official.bare, true)
  assert.equal(result.official.shallow, true)
  assert.equal(result.references.oldOfficialBaseline.resolvedRepository, 'vendor')
  assert.equal(result.references.oldOfficialBaseline.approval, 'comparison-start-only-not-approved-fork-base')
  assert.equal(result.mergeBaseHistoryComplete, false)
  assert.deepEqual(result.reviewSignals.unrelatedPairs, [])
  assert.deepEqual(result.reviewSignals.incompleteHistoryPairs, ['oldTarget', 'oldVendor', 'targetVendor'])
  assert.ok(result.comparisons.oldToTarget.summary.files > 0)
})

test('invalid refs, movable branches, mismatched pins, malformed locks and missing repositories fail closed', t => {
  const f = fixture(t, { dirty: false })
  assert.throws(() => auditOfficeUpstream({ ...f.options, targetRef: 'v99.0.0' }), { code: 'OFFICE_AUDIT_REF_UNAVAILABLE' })
  assert.throws(() => auditOfficeUpstream({ ...f.options, targetRef: 'HEAD' }), { code: 'OFFICE_AUDIT_IMMUTABLE_REF_REQUIRED' })
  assert.throws(() => auditOfficeUpstream({ ...f.options, targetRef: 'refs/heads/main' }), { code: 'OFFICE_AUDIT_IMMUTABLE_REF_REQUIRED' })
  assert.throws(() => auditOfficeUpstream({ ...f.options, targetRef: 'v0.12.0~1' }), { code: 'OFFICE_AUDIT_IMMUTABLE_REF_REQUIRED' })
  assert.throws(() => auditOfficeUpstream({ ...f.options, targetSha: f.oldSha }), { code: 'OFFICE_AUDIT_REF_LOCK_MISMATCH' })
  assert.throws(() => auditOfficeUpstream({ ...f.options, vendorRoot: f.officialRoot }), { code: 'OFFICE_AUDIT_VENDOR_WORKTREE_REQUIRED' })
  assert.throws(() => auditOfficeUpstream({ ...f.options, officialRoot: path.join(f.root, 'absent') }), { code: 'OFFICE_AUDIT_REPOSITORY_UNAVAILABLE' })
  write(path.join(f.projectRoot, 'office-upstream.lock.json'), '{malformed')
  assert.throws(() => auditOfficeUpstream(f.options), { code: 'OFFICE_AUDIT_LOCK_INVALID' })
})

test('CLI has strict absolute path and immutable input arguments', () => {
  const absolute = path.resolve('fixture')
  assert.deepEqual(parseOfficeUpstreamAuditArguments(['--official', absolute, '--old', 'v1.0.0', '--target', 'a'.repeat(40)]), { officialRoot: absolute, oldRef: 'v1.0.0', targetRef: 'a'.repeat(40) })
  for (const args of [['--old'], ['--fetch'], ['--old', 'v1', '--old', 'v2'], ['--official', 'relative'], ['--old', '--target']]) assert.throws(() => parseOfficeUpstreamAuditArguments(args))
  assert.ok(classifyOfficeAuditPath('apps/html/electron.vite.config.ts').includes('buildEntries'))
  assert.ok(classifyOfficeAuditPath('ee/LICENSE').includes('licenses'))
  assert.ok(classifyOfficeAuditPath('packages/native/Cargo.lock').includes('lockfiles'))
})

test('real CLI emits auditable JSON from an unrelated cwd and a nonzero JSON failure without fetching missing objects', t => {
  const f = fixture(t, { dirty: false })
  const unrelated = path.join(f.root, '无关 中文工作目录')
  fs.mkdirSync(unrelated)
  const invoke = args => {
    const child = spawnSync(process.execPath, [path.join(project, 'scripts/audit-office-upstream.mjs'), ...args], { cwd: unrelated, encoding: 'utf8', windowsHide: true, timeout: 30000 })
    assert.equal(child.error, undefined, child.error?.stack)
    return { status: child.status, value: JSON.parse(child.stdout), stderr: child.stderr }
  }
  const args = ['--project', f.projectRoot, '--official', f.officialRoot, '--vendor', f.vendorRoot, '--old', f.oldSha, '--target', f.targetSha]
  const valid = invoke(args)
  assert.equal(valid.status, 0, JSON.stringify(valid.value))
  assert.equal(valid.value.ok, true)
  const invalid = invoke([...args.slice(0, -1), 'f'.repeat(40)])
  assert.equal(invalid.status, 1)
  assert.equal(invalid.value.ok, false)
  assert.equal(invalid.value.code, 'OFFICE_AUDIT_REF_UNAVAILABLE')
  assert.equal(invalid.value.reviewState, 'blocked-no-audit-conclusion')
  assert.equal(invalid.stderr, '')
})
