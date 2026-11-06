import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { OFFICE_ADAPTER_VERSION, OFFICE_HOST_PROTOCOL_VERSION, OFFICE_REQUIRED_RESOURCES, OFFICE_SUPPORT_SERVICES, getEnabledOfficeEditors } from '../../src-electron/office/editor-registry.js'
import { captureOfficeSources, writeOfficeBundleManifest } from '../office/integration-manifest.mjs'
import { captureOfficeUpstreamProvenance, OFFICIAL_GENOFFICE_REPOSITORY, sha256File, validateOfficeUpstreamLock } from '../office/upstream-lock.mjs'
import { parseOfficeUpstreamArguments } from '../verify-office-upstream-lock.mjs'
import { parseOfficeVerifyArguments, verifyOfficeIntegration } from '../verify-office-integration.mjs'

const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value) }
const json = (file, value) => write(file, JSON.stringify(value, null, 2) + '\n')
const has = (result, code) => assert.ok(result.issues.some(item => item.code === code), JSON.stringify(result.issues))
const git = (directory, args) => {
  const result = spawnSync('git', ['-C', directory, ...args], { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function fixture(t) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-office-upstream-'))
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }))
  const vendorRoot = path.join(projectRoot, 'vendor', 'happyoffice')
  for (const directory of [projectRoot, vendorRoot]) {
    fs.mkdirSync(directory, { recursive: true })
    git(directory, ['init', '--quiet'])
    git(directory, ['config', 'user.name', 'Office upstream fixture'])
    git(directory, ['config', 'user.email', 'office-upstream@example.invalid'])
    if (directory === projectRoot) {
      json(path.join(directory, 'package.json'), { type: 'module', releaseVersion: 'fixture-preview' })
      json(path.join(directory, 'package-lock.json'), { lockfileVersion: 3 })
      write(path.join(directory, 'src-electron/fixture.js'), 'host')
    } else {
      write(path.join(directory, 'apps/pdf/src/main.ts'), 'vendor')
      json(path.join(directory, 'package-lock.json'), { lockfileVersion: 3, name: 'vendor-fixture' })
    }
    git(directory, ['add', '.'])
    git(directory, ['commit', '--quiet', '-m', 'fixture'])
  }
  const head = git(vendorRoot, ['rev-parse', 'HEAD'])
  const lockPath = path.join(projectRoot, 'office-upstream.lock.json')
  const patchManifestPath = path.join(projectRoot, 'office-vendor-patches.json')
  const patchManifest = { schemaVersion: 1, officialRepository: OFFICIAL_GENOFFICE_REPOSITORY, patchSetId: 'fixture-v1', reviewStatus: 'inventory-pending', patches: [{
    id: 'FIXTURE-001', scope: 'vendor', files: ['apps/pdf/src/main.ts'], purpose: 'fixture integration', upstreamHooks: ['exportPdfSnapshot'], adapterImpact: 'snapshot API', protocolImpact: '1.0',
    owner: 'fixture maintainer', verification: [{ command: 'node --test fixture', result: 'pending-for-approved-target' }], upstreamEquivalent: 'review pending', retentionReason: 'host embedding', removalCondition: 'equivalent upstream API', reviewStatus: 'inventory-pending',
  }] }
  const lock = { schemaVersion: 1, officialRepository: OFFICIAL_GENOFFICE_REPOSITORY, observedAt: new Date().toISOString(),
    observedCandidate: { tag: 'v0.12.852', tagObjectSha: head, commitSha: head, tagKind: 'lightweight' }, approvedTarget: null,
    integrationState: 'current-vendor-not-latest-claim', vendorHeadSha: head, vendorBaseSha: null, integrationCommit: null, integrationMethod: 'pending-three-way-audit',
    patchSetId: 'fixture-v1', patchManifestSha256: null, hostProtocolVersion: OFFICE_HOST_PROTOCOL_VERSION, adapterVersion: OFFICE_ADAPTER_VERSION,
    packageLockSha256: sha256File(path.join(projectRoot, 'package-lock.json')), vendorPackageLockSha256: sha256File(path.join(vendorRoot, 'package-lock.json')), requiredEditors: getEnabledOfficeEditors().map(editor => editor.id) }
  const save = () => { json(patchManifestPath, patchManifest); lock.patchManifestSha256 = sha256File(patchManifestPath); json(lockPath, lock) }
  const saveLock = () => json(lockPath, lock)
  save()
  const approve = () => {
    lock.approvedTarget = { ...lock.observedCandidate, status: 'integrated' }
    lock.integrationState = 'integrated'
    lock.integrationCommit = head
    lock.vendorBaseSha = head
    lock.integrationMethod = 'merge'
    patchManifest.reviewStatus = 'reviewed'
    for (const patch of patchManifest.patches) {
      patch.reviewStatus = 'reviewed'
      for (const check of patch.verification) { check.result = 'passed'; check.evidence = 'fixture-report.json' }
    }
    save()
  }
  const matchingRemote = { resolveRemoteTag: () => ({ tagObjectSha: head, commitSha: head }) }
  return { projectRoot, vendorRoot, lockPath, patchManifestPath, head, lock, patchManifest, save, saveLock, approve, matchingRemote }
}

test('candidate-only offline preview reports actual vendor and preserves the unapproved boundary', t => {
  const f = fixture(t)
  const result = validateOfficeUpstreamLock(f)
  assert.equal(result.ok, true, JSON.stringify(result.issues))
  assert.equal(result.audit.targetStatus, 'candidate-only')
  assert.equal(result.audit.remoteVerified, false)
  assert.equal(result.audit.vendorHeadSha, f.head)
  const provenance = captureOfficeUpstreamProvenance(f.projectRoot)
  assert.equal(provenance.targetTag, null)
  assert.equal(provenance.targetSha, null)
  assert.equal(provenance.observedCandidate.tag, 'v0.12.852')
  assert.equal(provenance.lockSha256, sha256File(f.lockPath))
})

test('formal gate rejects candidate-only targets and pending patch review', t => {
  const f = fixture(t)
  const result = validateOfficeUpstreamLock({ ...f, requireApproved: true }, f.matchingRemote)
  has(result, 'OFFICE_APPROVED_UPSTREAM_REQUIRED')
  has(result, 'OFFICE_INTEGRATED_UPSTREAM_REQUIRED')
  has(result, 'OFFICE_PATCH_REVIEW_INCOMPLETE')
})

test('官方核对期间修改来源输入会失败，审计摘要绑定实际解析的旧字节', async t => {
  for (const changed of ['lockPath', 'patchManifestPath', 'hostDependencies', 'vendorDependencies', 'vendorHead']) await t.test(changed, () => {
    const f = fixture(t)
    f.approve()
    const beforeLock = sha256File(f.lockPath)
    const beforePatch = sha256File(f.patchManifestPath)
    const result = validateOfficeUpstreamLock({ ...f, requireApproved: true }, { resolveRemoteTag() {
      if (changed === 'lockPath') { f.lock.hostProtocolVersion = '99.0'; f.saveLock() }
      else if (changed === 'patchManifestPath') fs.appendFileSync(f.patchManifestPath, '\n')
      else if (changed === 'hostDependencies') fs.appendFileSync(path.join(f.projectRoot, 'package-lock.json'), '\n')
      else if (changed === 'vendorDependencies') fs.appendFileSync(path.join(f.vendorRoot, 'package-lock.json'), '\n')
      else { write(path.join(f.vendorRoot, 'new.txt'), 'new commit'); git(f.vendorRoot, ['add', '.']); git(f.vendorRoot, ['commit', '--quiet', '-m', 'changed-during-check']) }
      return { tagObjectSha: f.head, commitSha: f.head }
    } })
    assert.equal(result.ok, false)
    has(result, 'OFFICE_UPSTREAM_CHANGED_DURING_VERIFICATION')
    assert.equal(result.audit.lockSha256, beforeLock)
    assert.equal(result.audit.patchManifestSha256, beforePatch)
  })
})

test('missing, malformed and wrong-shaped JSON documents fail closed', async t => {
  for (const [fileKey, code] of [['lockPath', 'OFFICE_UPSTREAM_LOCK'], ['patchManifestPath', 'OFFICE_PATCH_MANIFEST']]) {
    for (const contents of [null, '{bad', '[]', 'null']) await t.test(`${fileKey}:${contents}`, () => {
      const f = fixture(t)
      if (contents === null) fs.unlinkSync(f[fileKey])
      else write(f[fileKey], contents)
      assert.doesNotThrow(() => validateOfficeUpstreamLock(f))
      has(validateOfficeUpstreamLock(f), `${code}_${contents === null ? 'MISSING' : 'INVALID'}`)
    })
  }
})

test('schema, official repository, SHA, protocol and editor drift are explicit', async t => {
  const mutations = [
    ['schemaVersion', 99, 'OFFICE_UPSTREAM_LOCK_SCHEMA_UNSUPPORTED'],
    ['officialRepository', 'https://example.invalid/genoffice.git', 'OFFICE_UPSTREAM_REPOSITORY_MISMATCH'],
    ['vendorHeadSha', 'bad', 'OFFICE_VENDOR_HEAD_SHA_INVALID'],
    ['vendorBaseSha', 'bad', 'OFFICE_VENDOR_BASE_SHA_INVALID'],
    ['integrationCommit', 'bad', 'OFFICE_INTEGRATION_COMMIT_INVALID'],
    ['hostProtocolVersion', '99.0', 'OFFICE_UPSTREAM_PROTOCOL_MISMATCH'],
    ['adapterVersion', '99.0', 'OFFICE_UPSTREAM_PROTOCOL_MISMATCH'],
    ['requiredEditors', ['docs', 'pdf', 'markdown'], 'OFFICE_UPSTREAM_EDITORS_MISMATCH'],
    ['requiredEditors', ['docs', 'sheets', 'slides', 'slides'], 'OFFICE_UPSTREAM_EDITORS_MISMATCH'],
    ['packageLockSha256', 'bad', 'OFFICE_PACKAGE_LOCK_DIGEST_INVALID'],
    ['vendorPackageLockSha256', 'bad', 'OFFICE_VENDOR_PACKAGE_LOCK_DIGEST_INVALID'],
    ['patchManifestSha256', 'bad', 'OFFICE_PATCH_MANIFEST_DIGEST_INVALID'],
  ]
  for (const [key, value, code] of mutations) await t.test(key, () => {
    const f = fixture(t)
    f.lock[key] = value
    f.saveLock()
    has(validateOfficeUpstreamLock(f), code)
  })
})

test('candidate target SHA and target/state declarations cannot contradict one another', t => {
  const f = fixture(t)
  f.lock.observedCandidate.commitSha = 'short'
  f.lock.integrationState = 'integrated'
  f.saveLock()
  has(validateOfficeUpstreamLock(f), 'OFFICE_UPSTREAM_TARGET_SHA_INVALID')
  has(validateOfficeUpstreamLock(f), 'OFFICE_UPSTREAM_STATE_INCONSISTENT')
})

test('patch file mutation and package lock mutation invalidate the recorded digests', t => {
  const f = fixture(t)
  fs.appendFileSync(f.patchManifestPath, '\n')
  has(validateOfficeUpstreamLock(f), 'OFFICE_PATCH_MANIFEST_DIGEST_MISMATCH')
  f.save()
  fs.appendFileSync(path.join(f.projectRoot, 'package-lock.json'), '\n')
  has(validateOfficeUpstreamLock(f), 'OFFICE_PACKAGE_LOCK_DIGEST_MISMATCH')
  fs.appendFileSync(path.join(f.vendorRoot, 'package-lock.json'), '\n')
  has(validateOfficeUpstreamLock(f), 'OFFICE_VENDOR_PACKAGE_LOCK_DIGEST_MISMATCH')
})

test('patch inventory rejects malformed shape, duplicate IDs and incomplete records without throwing', async t => {
  for (const value of [{}, null, [null], [], [{ id: 'only-id' }]]) await t.test(JSON.stringify(value), () => {
    const f = fixture(t)
    f.patchManifest.patches = value
    f.save()
    assert.doesNotThrow(() => validateOfficeUpstreamLock(f))
    assert.equal(validateOfficeUpstreamLock(f).ok, false)
  })
  const f = fixture(t)
  f.patchManifest.patches.push({ ...f.patchManifest.patches[0] })
  f.patchManifest.patchSetId = 'different'
  f.save()
  has(validateOfficeUpstreamLock(f), 'OFFICE_PATCH_MANIFEST_IDS_INVALID')
  has(validateOfficeUpstreamLock(f), 'OFFICE_PATCH_SET_ID_MISMATCH')
})

test('a new actual vendor commit must be deliberately frozen in the lock', t => {
  const f = fixture(t)
  write(path.join(f.vendorRoot, 'new.txt'), 'changed')
  git(f.vendorRoot, ['add', '.'])
  git(f.vendorRoot, ['commit', '--quiet', '-m', 'drift'])
  has(validateOfficeUpstreamLock(f), 'OFFICE_VENDOR_HEAD_MISMATCH')
})

test('approved status alone cannot claim an integrated release', t => {
  const f = fixture(t)
  f.approve()
  f.lock.approvedTarget.status = 'approved'
  f.lock.integrationState = 'approved'
  f.saveLock()
  has(validateOfficeUpstreamLock({ ...f, requireApproved: true }, f.matchingRemote), 'OFFICE_INTEGRATED_UPSTREAM_REQUIRED')
})

test('integrated release requires per-patch reviews and the official commit in the real vendor graph', t => {
  const f = fixture(t)
  f.approve()
  assert.equal(validateOfficeUpstreamLock({ ...f, requireApproved: true }, f.matchingRemote).ok, true)
  f.patchManifest.patches[0].reviewStatus = 'inventory-pending'
  f.save()
  has(validateOfficeUpstreamLock({ ...f, requireApproved: true }, f.matchingRemote), 'OFFICE_PATCH_REVIEW_INCOMPLETE')
  f.approve()
  f.lock.approvedTarget.commitSha = 'f'.repeat(40)
  f.saveLock()
  has(validateOfficeUpstreamLock({ ...f, requireApproved: true }, f.matchingRemote), 'OFFICE_UPSTREAM_COMMIT_NOT_IN_VENDOR')
})

test('non-ancestry integration methods require explicit mappings instead of falsely claiming a merge', t => {
  const f = fixture(t)
  f.approve()
  for (const method of ['cherry-pick', 'three-way-audited']) {
    f.lock.integrationMethod = method
    f.saveLock()
    has(validateOfficeUpstreamLock({ ...f, requireApproved: true }, f.matchingRemote), 'OFFICE_UPSTREAM_METHOD_REQUIRES_MAPPING')
  }
})

test('formal API always resolves official refs and requires successful patch verification evidence', t => {
  const f = fixture(t)
  f.approve()
  let calls = 0
  const result = validateOfficeUpstreamLock({ ...f, requireApproved: true, verifyRemote: false }, { resolveRemoteTag() { calls++; return { tagObjectSha: f.head, commitSha: f.head } } })
  assert.equal(result.ok, true)
  assert.equal(calls, 1)
  f.patchManifest.patches[0].verification[0].result = 'pending-for-approved-target'
  f.save()
  has(validateOfficeUpstreamLock({ ...f, requireApproved: true }, f.matchingRemote), 'OFFICE_PATCH_VERIFICATION_INCOMPLETE')
})

test('official remote tag and peeled commit must both match; network failure stays a failure', t => {
  const f = fixture(t)
  f.approve()
  const options = { ...f, requireApproved: true, verifyRemote: true }
  let calls = 0
  const matching = validateOfficeUpstreamLock(options, { resolveRemoteTag(tag) { calls++; assert.equal(tag, 'v0.12.852'); return { tagObjectSha: f.head, commitSha: f.head } } })
  assert.equal(calls, 1)
  assert.equal(matching.ok, true, JSON.stringify(matching.issues))
  assert.equal(matching.audit.remoteVerified, true)
  for (const key of ['tagObjectSha', 'commitSha']) {
    const remote = { tagObjectSha: f.head, commitSha: f.head, [key]: 'f'.repeat(40) }
    has(validateOfficeUpstreamLock(options, { resolveRemoteTag: () => remote }), 'OFFICE_UPSTREAM_REMOTE_REF_MISMATCH')
  }
  has(validateOfficeUpstreamLock(options, { resolveRemoteTag: () => null }), 'OFFICE_UPSTREAM_REMOTE_UNAVAILABLE')
})

test('upstream CLI flags are explicit and formal gate enables remote checking', () => {
  assert.deepEqual(parseOfficeUpstreamArguments([]), {})
  assert.deepEqual(parseOfficeUpstreamArguments(['--require-approved-upstream']), { requireApproved: true, verifyRemote: true })
  assert.deepEqual(parseOfficeVerifyArguments(['--verify-upstream-lock', '--require-approved-upstream', '--require-clean']), { verifyUpstreamLock: true, requireApprovedUpstream: true, requireClean: true })
  for (const args of [['--unknown'], ['--verify-remote', '--verify-remote']]) assert.throws(() => parseOfficeUpstreamArguments(args), { code: 'OFFICE_UPSTREAM_ARGUMENT_INVALID' })
  for (const args of [['--verify-upstream-lock', '--verify-upstream-lock'], ['--require-approved-upstream', '--require-approved-upstream']]) assert.throws(() => parseOfficeVerifyArguments(args), { code: 'OFFICE_VERIFY_ARGUMENT_INVALID' })
})

test('resource combination captures exact provenance and detects locks changed after build', t => {
  const f = fixture(t)
  const bundleRoot = path.join(f.projectRoot, 'resources', 'office')
  for (const editor of getEnabledOfficeEditors()) for (const file of [`main/${editor.id}-main.cjs`, `${editor.id}/preload/index.js`, `${editor.id}/renderer/index.html`]) write(path.join(bundleRoot, file), 'fixture')
  for (const service of OFFICE_SUPPORT_SERVICES) write(path.join(bundleRoot, service.main), 'fixture')
  for (const file of OFFICE_REQUIRED_RESOURCES) write(path.join(bundleRoot, file), 'fixture')
  const regenerate = () => writeOfficeBundleManifest({ root: bundleRoot, projectRoot: f.projectRoot, sources: captureOfficeSources(f.projectRoot, f.vendorRoot), releaseVersion: 'fixture-preview' })
  const built = regenerate()
  assert.equal(built.upstream.lockSha256, sha256File(f.lockPath))
  assert.equal(verifyOfficeIntegration({ ...f, bundleRoot, verifyUpstreamLock: true }).ok, true)
  f.lock.observedAt = '2026-11-06T01:00:00Z'
  f.saveLock()
  const stale = verifyOfficeIntegration({ ...f, bundleRoot, verifyUpstreamLock: true })
  has(stale, 'OFFICE_BUNDLE_UPSTREAM_STALE')
  has(stale, 'OFFICE_BUNDLE_SOURCE_STALE')
  regenerate()
  assert.equal(verifyOfficeIntegration({ ...f, bundleRoot, verifyUpstreamLock: true }).ok, true)
})

test('real offline upstream CLI is independent of cwd and reports malformed arguments with nonzero exit', t => {
  const f = fixture(t)
  for (const relative of ['scripts/verify-office-upstream-lock.mjs', 'scripts/office/upstream-lock.mjs', 'src-electron/office/editor-registry.js']) {
    write(path.join(f.projectRoot, relative), fs.readFileSync(new URL(`../../${relative}`, import.meta.url)))
  }
  const unrelated = path.join(f.projectRoot, '无关中文 工作目录')
  fs.mkdirSync(unrelated)
  const invoke = args => {
    const child = spawnSync(process.execPath, [path.join(f.projectRoot, 'scripts/verify-office-upstream-lock.mjs'), ...args], { cwd: unrelated, encoding: 'utf8', windowsHide: true, timeout: 30000 })
    assert.equal(child.error, undefined, child.error?.message)
    return { status: child.status, result: JSON.parse(child.stdout) }
  }
  const checked = invoke([])
  assert.equal(checked.status, 0, JSON.stringify(checked.result.issues))
  assert.equal(checked.result.audit.vendorHeadSha, f.head)
  assert.equal(checked.result.audit.targetStatus, 'candidate-only')
  const invalid = invoke(['--unknown'])
  assert.equal(invalid.status, 1)
  assert.equal(invalid.result.code, 'OFFICE_UPSTREAM_ARGUMENT_INVALID')
  f.lock.hostProtocolVersion = '99.0'
  f.saveLock()
  const stale = invoke([])
  assert.equal(stale.status, 1)
  has(stale.result, 'OFFICE_UPSTREAM_PROTOCOL_MISMATCH')
})
