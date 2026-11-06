import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { OFFICE_ADAPTER_VERSION, OFFICE_HOST_PROTOCOL_VERSION, getEnabledOfficeEditors } from '../../src-electron/office/editor-registry.js'

export const OFFICE_UPSTREAM_LOCK_FILE = 'office-upstream.lock.json'
export const OFFICE_PATCH_MANIFEST_FILE = 'office-vendor-patches.json'
export const OFFICIAL_GENOFFICE_REPOSITORY = 'https://github.com/genspark-ai/genoffice.git'

const sha256 = value => createHash('sha256').update(value).digest('hex')
const isSha40 = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
const isSha64 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0

const issue = (code, detail = null) => ({ code, ...(detail ? { detail } : {}) })

function readJson(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

function jsonSnapshot(file) {
  try {
    const bytes = fs.readFileSync(file)
    const value = JSON.parse(bytes.toString('utf8'))
    return { value: value && typeof value === 'object' && !Array.isArray(value) ? value : null, sha256: sha256(bytes) }
  } catch { return { value: null, sha256: null } }
}

function optionalDigest(file) {
  try { return sha256(fs.readFileSync(file)) } catch { return null }
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
  return result.status === 0 ? result.stdout.trim() : null
}

function normalizedOfficialRepository(value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.href.replace(/\/$/, '')
  } catch { return null }
}

function validTag(value) {
  return typeof value === 'string' && /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)
}

function validEditorList(value) {
  const expected = getEnabledOfficeEditors().map(editor => editor.id).sort(compare)
  return Array.isArray(value) && value.length === expected.length && [...value].sort(compare).every((id, index) => id === expected[index])
}

function addIssue(issues, code, detail) { issues.push(issue(code, detail)) }

// 默认离线核对；正式门禁额外验证官方 tag，避免日常预览依赖网络。
export function validateOfficeUpstreamLock({
  projectRoot = fileURLToPath(new URL('../../', import.meta.url)),
  vendorRoot,
  lockPath,
  patchManifestPath,
  requireApproved = false,
  verifyRemote = false,
} = {}, { resolveRemoteTag = resolveOfficialTag } = {}) {
  const shouldVerifyRemote = verifyRemote || requireApproved
  const project = path.resolve(projectRoot)
  const vendor = path.resolve(vendorRoot || path.join(project, 'vendor', 'happyoffice'))
  const lockFile = path.resolve(lockPath || path.join(project, OFFICE_UPSTREAM_LOCK_FILE))
  const patchFile = path.resolve(patchManifestPath || path.join(project, OFFICE_PATCH_MANIFEST_FILE))
  const issues = []
  const lockSnapshot = jsonSnapshot(lockFile)
  const patchSnapshot = jsonSnapshot(patchFile)
  const lock = lockSnapshot.value
  const patchManifest = patchSnapshot.value
  const inputDigests = [[lockFile, lockSnapshot.sha256], [patchFile, patchSnapshot.sha256],
    [path.join(project, 'package-lock.json'), optionalDigest(path.join(project, 'package-lock.json'))],
    [path.join(vendor, 'package-lock.json'), optionalDigest(path.join(vendor, 'package-lock.json'))]]
  if (!lock) addIssue(issues, fs.existsSync(lockFile) ? 'OFFICE_UPSTREAM_LOCK_INVALID' : 'OFFICE_UPSTREAM_LOCK_MISSING')
  if (!patchManifest) addIssue(issues, fs.existsSync(patchFile) ? 'OFFICE_PATCH_MANIFEST_INVALID' : 'OFFICE_PATCH_MANIFEST_MISSING')
  if (!lock || !patchManifest) return { ok: issues.length === 0, code: issues[0]?.code || null, issues, lock, patchManifest, lockPath: lockFile, patchManifestPath: patchFile }

  if (lock.schemaVersion !== 1) addIssue(issues, 'OFFICE_UPSTREAM_LOCK_SCHEMA_UNSUPPORTED')
  if (patchManifest.schemaVersion !== 1) addIssue(issues, 'OFFICE_PATCH_MANIFEST_SCHEMA_UNSUPPORTED')
  if (typeof lock.observedAt !== 'string' || !Number.isFinite(Date.parse(lock.observedAt))) addIssue(issues, 'OFFICE_UPSTREAM_OBSERVED_AT_INVALID')
  if (!['inventory-pending', 'reviewed', 'approved'].includes(patchManifest.reviewStatus)) addIssue(issues, 'OFFICE_PATCH_REVIEW_STATUS_INVALID')
  if (normalizedOfficialRepository(lock.officialRepository) !== OFFICIAL_GENOFFICE_REPOSITORY) addIssue(issues, 'OFFICE_UPSTREAM_REPOSITORY_MISMATCH')
  if (normalizedOfficialRepository(patchManifest.officialRepository) !== OFFICIAL_GENOFFICE_REPOSITORY) addIssue(issues, 'OFFICE_PATCH_REPOSITORY_MISMATCH')
  if (lock.hostProtocolVersion !== OFFICE_HOST_PROTOCOL_VERSION || lock.adapterVersion !== OFFICE_ADAPTER_VERSION) addIssue(issues, 'OFFICE_UPSTREAM_PROTOCOL_MISMATCH')
  if (!validEditorList(lock.requiredEditors)) addIssue(issues, 'OFFICE_UPSTREAM_EDITORS_MISMATCH')
  if (typeof lock.patchSetId !== 'string' || !lock.patchSetId) addIssue(issues, 'OFFICE_PATCH_SET_ID_MISSING')
  if (patchManifest.patchSetId !== lock.patchSetId) addIssue(issues, 'OFFICE_PATCH_SET_ID_MISMATCH')
  if (!Array.isArray(patchManifest.patches) || patchManifest.patches.length === 0) addIssue(issues, 'OFFICE_PATCH_MANIFEST_EMPTY')
  const patches = Array.isArray(patchManifest.patches) ? patchManifest.patches : []
  const patchIds = patches.map(item => item?.id)
  if (new Set(patchIds).size !== patchIds.length || patchIds.some(id => typeof id !== 'string' || !id)) addIssue(issues, 'OFFICE_PATCH_MANIFEST_IDS_INVALID')
  for (const patch of patches) {
    if (!patch || !['vendor', 'host', 'build'].includes(patch.scope) || !['inventory-pending', 'reviewed', 'approved'].includes(patch.reviewStatus) ||
      !Array.isArray(patch.files) || patch.files.length === 0 || patch.files.some(file => typeof file !== 'string' || !file || /[\\:\0]/.test(file) || file.startsWith('/') || file.split('/').includes('..')) ||
      !Array.isArray(patch.upstreamHooks) || patch.upstreamHooks.some(hook => typeof hook !== 'string' || !hook) || !Array.isArray(patch.verification) || patch.verification.length === 0 ||
      patch.verification.some(check => !check || typeof check.command !== 'string' || !check.command || !['pending-for-approved-target', 'passed', 'failed'].includes(check.result)) ||
      ['purpose', 'adapterImpact', 'protocolImpact', 'owner', 'upstreamEquivalent', 'retentionReason', 'removalCondition'].some(key => typeof patch[key] !== 'string' || !patch[key].trim())) {
      addIssue(issues, 'OFFICE_PATCH_RECORD_INVALID', patch?.id)
    }
    if (requireApproved && !['reviewed', 'approved'].includes(patch?.reviewStatus)) addIssue(issues, 'OFFICE_PATCH_REVIEW_INCOMPLETE', patch?.id)
    if (requireApproved && (!Array.isArray(patch?.verification) || patch.verification.some(check => check?.result !== 'passed' || typeof check.evidence !== 'string' || !check.evidence))) addIssue(issues, 'OFFICE_PATCH_VERIFICATION_INCOMPLETE', patch?.id)
  }
  if (!isSha64(lock.patchManifestSha256)) addIssue(issues, 'OFFICE_PATCH_MANIFEST_DIGEST_INVALID')
  else {
    try {
      const actual = patchSnapshot.sha256
      if (actual !== lock.patchManifestSha256) addIssue(issues, 'OFFICE_PATCH_MANIFEST_DIGEST_MISMATCH')
    } catch { addIssue(issues, 'OFFICE_PATCH_MANIFEST_READ_FAILED') }
  }

  const target = lock.approvedTarget || lock.observedCandidate || {}
  const targetStatus = lock.approvedTarget?.status || 'candidate-only'
  if (!['candidate-only', 'approved', 'integrated'].includes(targetStatus)) addIssue(issues, 'OFFICE_UPSTREAM_TARGET_STATUS_INVALID')
  if (lock.approvedTarget !== null && (!lock.approvedTarget || !['approved', 'integrated'].includes(lock.approvedTarget.status))) addIssue(issues, 'OFFICE_UPSTREAM_APPROVAL_STATE_INVALID')
  if (!validTag(target.tag)) addIssue(issues, 'OFFICE_UPSTREAM_TARGET_TAG_INVALID')
  if (!isSha40(target.tagObjectSha) || !isSha40(target.commitSha)) addIssue(issues, 'OFFICE_UPSTREAM_TARGET_SHA_INVALID')
  if (!['lightweight', 'annotated'].includes(target.tagKind) || (target.tagKind === 'lightweight' && target.tagObjectSha !== target.commitSha) || (target.tagKind === 'annotated' && target.tagObjectSha === target.commitSha)) addIssue(issues, 'OFFICE_UPSTREAM_TAG_KIND_INCONSISTENT')
  if (targetStatus === 'candidate-only' && lock.integrationState !== 'current-vendor-not-latest-claim') addIssue(issues, 'OFFICE_UPSTREAM_STATE_INCONSISTENT')
  if (targetStatus !== 'candidate-only' && targetStatus !== lock.integrationState) addIssue(issues, 'OFFICE_UPSTREAM_STATE_INCONSISTENT')
  if (requireApproved && targetStatus === 'candidate-only') addIssue(issues, 'OFFICE_APPROVED_UPSTREAM_REQUIRED')
  if (requireApproved && targetStatus !== 'integrated') addIssue(issues, 'OFFICE_INTEGRATED_UPSTREAM_REQUIRED')
  if (requireApproved && !['reviewed', 'approved'].includes(patchManifest.reviewStatus)) addIssue(issues, 'OFFICE_PATCH_REVIEW_INCOMPLETE')

  const actualHead = git(vendor, ['rev-parse', 'HEAD'])
  if (!isSha40(actualHead)) addIssue(issues, 'OFFICE_VENDOR_CHECKOUT_UNAVAILABLE')
  else {
    if (lock.vendorHeadSha !== actualHead) addIssue(issues, 'OFFICE_VENDOR_HEAD_MISMATCH')
    if (lock.integrationCommit && lock.integrationCommit !== actualHead) addIssue(issues, 'OFFICE_INTEGRATION_COMMIT_MISMATCH')
  }
  if (lock.vendorBaseSha !== null && lock.vendorBaseSha !== undefined && !isSha40(lock.vendorBaseSha)) addIssue(issues, 'OFFICE_VENDOR_BASE_SHA_INVALID')
  if (!isSha40(lock.vendorHeadSha)) addIssue(issues, 'OFFICE_VENDOR_HEAD_SHA_INVALID')
  if (lock.integrationCommit !== null && !isSha40(lock.integrationCommit)) addIssue(issues, 'OFFICE_INTEGRATION_COMMIT_INVALID')
  if (!['pending-three-way-audit', 'three-way-audited', 'cherry-pick', 'merge', 'rebase', 'submodule-fast-forward'].includes(lock.integrationMethod)) addIssue(issues, 'OFFICE_INTEGRATION_METHOD_INVALID')
  if (targetStatus === 'integrated') {
    if (!isSha40(lock.vendorBaseSha) || !isSha40(lock.integrationCommit) || lock.integrationMethod === 'pending-three-way-audit') addIssue(issues, 'OFFICE_UPSTREAM_INTEGRATION_INCOMPLETE')
    // merge/rebase/快进必须在真实 git 图上成立。cherry-pick/审计快照需要
    // 提交映射与审计报告摘要；本版尚未实现该证明，明确拒绝伪通过。
    if (['cherry-pick', 'three-way-audited'].includes(lock.integrationMethod)) addIssue(issues, 'OFFICE_UPSTREAM_METHOD_REQUIRES_MAPPING')
    else if (isSha40(target.commitSha) && git(vendor, ['merge-base', '--is-ancestor', target.commitSha, 'HEAD']) === null) addIssue(issues, 'OFFICE_UPSTREAM_COMMIT_NOT_IN_VENDOR')
    if (isSha40(lock.vendorBaseSha) && git(vendor, ['merge-base', '--is-ancestor', lock.vendorBaseSha, 'HEAD']) === null) addIssue(issues, 'OFFICE_VENDOR_BASE_NOT_IN_VENDOR')
  }
  if (!isSha64(lock.packageLockSha256)) addIssue(issues, 'OFFICE_PACKAGE_LOCK_DIGEST_INVALID')
  else {
    try {
      const actual = sha256(fs.readFileSync(path.join(project, 'package-lock.json')))
      if (actual !== lock.packageLockSha256) addIssue(issues, 'OFFICE_PACKAGE_LOCK_DIGEST_MISMATCH')
    } catch { addIssue(issues, 'OFFICE_PACKAGE_LOCK_READ_FAILED') }
  }
  if (!isSha64(lock.vendorPackageLockSha256)) addIssue(issues, 'OFFICE_VENDOR_PACKAGE_LOCK_DIGEST_INVALID')
  else {
    try {
      if (sha256File(path.join(vendor, 'package-lock.json')) !== lock.vendorPackageLockSha256) addIssue(issues, 'OFFICE_VENDOR_PACKAGE_LOCK_DIGEST_MISMATCH')
    } catch { addIssue(issues, 'OFFICE_VENDOR_PACKAGE_LOCK_READ_FAILED') }
  }

  if (shouldVerifyRemote && validTag(target.tag)) {
    let remote
    try { remote = resolveRemoteTag(target.tag) } catch {}
    if (!remote) addIssue(issues, 'OFFICE_UPSTREAM_REMOTE_UNAVAILABLE')
    else if (remote.tagObjectSha !== target.tagObjectSha || remote.commitSha !== target.commitSha) addIssue(issues, 'OFFICE_UPSTREAM_REMOTE_REF_MISMATCH')
  }

  // 网络核对可能等待数十秒；结论只绑定本轮解析的字节，不能混用旧内容与新摘要。
  if (inputDigests.some(([file, before]) => optionalDigest(file) !== before) || git(vendor, ['rev-parse', 'HEAD']) !== actualHead) addIssue(issues, 'OFFICE_UPSTREAM_CHANGED_DURING_VERIFICATION')
  return { ok: issues.length === 0, code: issues[0]?.code || null, issues, lock, patchManifest, lockPath: lockFile, patchManifestPath: patchFile, vendorHeadSha: actualHead,
    audit: { lockSha256: lockSnapshot.sha256, patchManifestSha256: patchSnapshot.sha256, packageLockSha256: lock.packageLockSha256, vendorPackageLockSha256: lock.vendorPackageLockSha256,
      officialRepository: lock.officialRepository, targetStatus, targetTag: target.tag, targetCommitSha: target.commitSha, vendorHeadSha: actualHead,
      integrationState: lock.integrationState, patchSetId: lock.patchSetId, patchReviewStatus: patchManifest.reviewStatus,
      hostProtocolVersion: lock.hostProtocolVersion, adapterVersion: lock.adapterVersion, requiredEditors: lock.requiredEditors, remoteVerified: shouldVerifyRemote && validTag(target.tag) && !issues.some(item => item.code.startsWith('OFFICE_UPSTREAM_REMOTE_')) } }
}

export function sha256File(file) { return sha256(fs.readFileSync(file)) }

export function resolveOfficialTag(tag) {
  if (!validTag(tag)) return null
  const result = spawnSync('git', ['ls-remote', OFFICIAL_GENOFFICE_REPOSITORY, `refs/tags/${tag}`, `refs/tags/${tag}^{}`], { encoding: 'utf8', windowsHide: true, timeout: 30000 })
  if (result.status !== 0) return null
  const refs = Object.fromEntries(result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => line.split(/\s+/)).filter(parts => parts.length === 2).map(([sha, ref]) => [ref, sha]))
  const tagObjectSha = refs[`refs/tags/${tag}`]
  return tagObjectSha ? { tagObjectSha, commitSha: refs[`refs/tags/${tag}^{}`] || tagObjectSha } : null
}

// 构建产物保存锁文件摘要与已批准/候选边界，不能把观察记录写成已融合。
export function captureOfficeUpstreamProvenance(projectRoot) {
  const lockFile = path.join(projectRoot, OFFICE_UPSTREAM_LOCK_FILE)
  const snapshot = jsonSnapshot(lockFile)
  const lock = snapshot.value
  if (!lock) throw new Error('OFFICE_UPSTREAM_LOCK_INVALID')
  return { officialRepository: lock.officialRepository, targetTag: lock.approvedTarget?.tag || null, targetSha: lock.approvedTarget?.commitSha || null,
    integrationState: lock.integrationState, lockSha256: snapshot.sha256, patchSetId: lock.patchSetId,
    patchManifestSha256: sha256File(path.join(projectRoot, OFFICE_PATCH_MANIFEST_FILE)), vendorHeadSha: lock.vendorHeadSha,
    observedCandidate: lock.observedCandidate || null }
}
