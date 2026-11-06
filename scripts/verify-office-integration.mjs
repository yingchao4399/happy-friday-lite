#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { captureOfficeSources } from './office/integration-manifest.mjs'
import { readOfficeBundleManifest, validateOfficeBundle, OFFICE_MANIFEST_FILE } from '../src-electron/office/bundle-contract.js'
import { captureOfficeUpstreamProvenance, validateOfficeUpstreamLock } from './office/upstream-lock.mjs'

const issue = (code, detail = null) => ({ code, ...(detail ? { detail } : {}) })

function releaseVersion(projectRoot) {
  const file = path.join(projectRoot, 'package.json')
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')).releaseVersion
    if (typeof value !== 'string' || !value) return null
    return value
  } catch { return null }
}

function sameSourceIdentity(a, b) {
  return Boolean(a && b && a.sha === b.sha && a.scope === b.scope && a.dirty === b.dirty &&
    a.diffDigest === b.diffDigest && a.untrackedSourceDigest === b.untrackedSourceDigest)
}

/**
 * 打包前的 Office 组合门禁：当前主仓库、GenOffice 子模块、资源包和
 * releaseVersion 必须属于同一份构建组合。只读，不改写资源。
 */
export function verifyOfficeIntegration({ projectRoot = fileURLToPath(new URL('../', import.meta.url)), vendorRoot, bundleRoot, requireClean = false, verifyUpstreamLock = false, requireApprovedUpstream = false } = {}, { captureSources = captureOfficeSources, verifyUpstream = validateOfficeUpstreamLock } = {}) {
  const issues = []
  const project = path.resolve(projectRoot)
  const vendor = path.resolve(vendorRoot || path.join(project, 'vendor', 'happyoffice'))
  const bundle = path.resolve(bundleRoot || path.join(project, 'resources', 'office'))
  const expectedReleaseVersion = releaseVersion(project)
  const sourceManifest = readOfficeBundleManifest(bundle)
  const sourceOptions = { experimentalHtml: Array.isArray(sourceManifest?.editors) && sourceManifest.editors.some(editor => editor?.id === 'html') }
  if (!expectedReleaseVersion) issues.push(issue('OFFICE_RELEASE_VERSION_UNAVAILABLE'))
  let upstream
  if (verifyUpstreamLock || requireApprovedUpstream) {
    upstream = verifyUpstream({ projectRoot: project, vendorRoot: vendor, requireApproved: requireApprovedUpstream, verifyRemote: requireApprovedUpstream })
    issues.push(...(upstream.issues || []))
  }

  let current
  try { current = captureSources(project, vendor, sourceOptions) } catch (error) {
    issues.push(issue(error?.message?.split(':')[0] || 'OFFICE_SOURCE_IDENTITY_UNAVAILABLE'))
  }
  if (current && expectedReleaseVersion) {
    const result = validateOfficeBundle(bundle, { verifyHashes: true, verifyAll: true, requireClean, expectedReleaseVersion })
    issues.push(...(result.issues || []))
    let manifest = result.manifest
    if (!manifest) {
      try { manifest = JSON.parse(fs.readFileSync(path.join(bundle, OFFICE_MANIFEST_FILE), 'utf8')) } catch {}
    }
    if (manifest?.sources && (!sameSourceIdentity(manifest.sources.main, current.main) || !sameSourceIdentity(manifest.sources.vendor, current.vendor) || manifest.sources.identityDigest !== current.identityDigest)) {
      issues.push(issue('OFFICE_BUNDLE_SOURCE_STALE'))
    }
    if (upstream?.ok) {
      const provenance = captureOfficeUpstreamProvenance(project)
      if (JSON.stringify(manifest?.upstream) !== JSON.stringify(provenance)) issues.push(issue('OFFICE_BUNDLE_UPSTREAM_STALE'))
      // 验证期间来源锁/patch 改变，旧资源组合不能继续被判为有效。
      if (provenance.lockSha256 !== upstream.audit?.lockSha256 || provenance.patchManifestSha256 !== upstream.audit?.patchManifestSha256) issues.push(issue('OFFICE_UPSTREAM_CHANGED_DURING_VERIFICATION'))
    }
    // repositoryDirty 可包含 resources/ 等生成物；只有构建输入范围的 dirty
    // 才能阻止正式发布。
    if (requireClean && (current.main.dirty || current.vendor.dirty)) issues.push(issue('OFFICE_CURRENT_SOURCES_NOT_CLEAN'))
    // 资源读取与摘要计算可能较慢；检查期间源码发生变化时，本次结论失效。
    // 与构建脚本相同，只比较真实输入范围，不受生成物状态变化影响。
    try {
      const after = captureSources(project, vendor, sourceOptions)
      if (current.identityDigest !== after.identityDigest || !sameSourceIdentity(current.main, after.main) || !sameSourceIdentity(current.vendor, after.vendor)) issues.push(issue('OFFICE_SOURCES_CHANGED_DURING_VERIFICATION'))
    } catch (error) { issues.push(issue(error?.message?.split(':')[0] || 'OFFICE_SOURCE_IDENTITY_UNAVAILABLE')) }
  }
  return { ok: issues.length === 0, code: issues[0]?.code || null, issues, projectRoot: project, vendorRoot: vendor, bundleRoot: bundle, releaseVersion: expectedReleaseVersion,
    ...(upstream ? { upstreamAudit: upstream.audit || null } : {}) }
}

export function parseOfficeVerifyArguments(args) {
  const options = {}
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--require-clean' && options.requireClean !== true) options.requireClean = true
    else if (argument === '--verify-upstream-lock' && options.verifyUpstreamLock !== true) options.verifyUpstreamLock = true
    else if (argument === '--require-approved-upstream' && options.requireApprovedUpstream !== true) options.requireApprovedUpstream = true
    else if (argument === '--bundle' && options.bundleRoot === undefined) {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw Object.assign(new Error('OFFICE_VERIFY_BUNDLE_REQUIRED'), { code: 'OFFICE_VERIFY_BUNDLE_REQUIRED' })
      if (!path.isAbsolute(value) || value.includes('\0')) throw Object.assign(new Error('OFFICE_VERIFY_BUNDLE_ABSOLUTE_REQUIRED'), { code: 'OFFICE_VERIFY_BUNDLE_ABSOLUTE_REQUIRED' })
      options.bundleRoot = path.normalize(value)
    } else throw Object.assign(new Error('OFFICE_VERIFY_ARGUMENT_INVALID'), { code: 'OFFICE_VERIFY_ARGUMENT_INVALID' })
  }
  return options
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let result
  try { result = verifyOfficeIntegration(parseOfficeVerifyArguments(process.argv.slice(2))) } catch (error) {
    const code = error?.code || 'OFFICE_VERIFY_FAILED'
    result = { ok: false, code, issues: [issue(code)] }
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  process.exitCode = result.ok ? 0 : 1
}
