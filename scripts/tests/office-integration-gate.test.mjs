import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { OFFICE_REQUIRED_RESOURCES, OFFICE_SUPPORT_SERVICES, getEnabledOfficeEditors } from '../../src-electron/office/editor-registry.js'
import { captureOfficeSources, writeOfficeBundleManifest } from '../office/integration-manifest.mjs'
import { parseOfficeVerifyArguments, verifyOfficeIntegration } from '../verify-office-integration.mjs'

const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value) }
function fixture(t, { cli = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-office-gate-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const projectRoot = path.join(root, 'friday')
  const vendorRoot = cli ? path.join(projectRoot, 'vendor', 'happyoffice') : path.join(root, 'genoffice')
  const bundleRoot = path.join(projectRoot, 'resources', 'office')
  for (const directory of [projectRoot, vendorRoot]) {
    fs.mkdirSync(directory, { recursive: true })
    const git = args => {
      const result = spawnSync('git', ['-C', directory, ...args], { encoding: 'utf8', windowsHide: true })
      assert.equal(result.status, 0, result.stderr)
    }
    git(['init', '--quiet'])
    git(['config', 'user.name', 'Office integration fixture'])
    git(['config', 'user.email', 'office-integration@example.invalid'])
    if (directory === projectRoot) {
      write(path.join(directory, 'package.json'), JSON.stringify({ type: 'module', releaseVersion: 'fixture-preview' }))
      write(path.join(directory, 'src-electron/office.js'), 'host-source')
      if (cli) {
        // 复制真实 CLI 与其纯 Node 依赖，保留实际 import/entrypoint/路径行为。
        for (const relative of ['scripts/verify-office-integration.mjs', 'scripts/office/integration-manifest.mjs', 'scripts/office/upstream-lock.mjs', 'scripts/office/html-upstream.mjs', 'src-electron/office/bundle-contract.js', 'src-electron/office/editor-registry.js']) {
          write(path.join(directory, relative), fs.readFileSync(new URL(`../../${relative}`, import.meta.url)))
        }
      }
    } else write(path.join(directory, 'apps/pdf/src/main.ts'), 'vendor-source')
    git(['add', '.'])
    git(['commit', '--quiet', '-m', 'fixture'])
  }
  for (const editor of getEnabledOfficeEditors()) {
    for (const file of [`main/${editor.id}-main.cjs`, `${editor.id}/preload/index.js`, `${editor.id}/renderer/index.html`]) write(path.join(bundleRoot, file), `fixture:${file}`)
  }
  for (const service of OFFICE_SUPPORT_SERVICES) write(path.join(bundleRoot, service.main), 'service-fixture')
  for (const resource of OFFICE_REQUIRED_RESOURCES) write(path.join(bundleRoot, resource), 'resource-fixture')
  const regenerate = options => writeOfficeBundleManifest({ root: bundleRoot, sources: captureOfficeSources(projectRoot, vendorRoot), releaseVersion: 'fixture-preview', ...options })
  regenerate()
  return { root, projectRoot, vendorRoot, bundleRoot, regenerate }
}
const has = (result, code) => assert.ok(result.issues.some(issue => issue.code === code), JSON.stringify(result))

test('package gate accepts matching sources and detects same-version host or vendor drift', t => {
  const f = fixture(t)
  assert.equal(verifyOfficeIntegration({ ...f, requireClean: true }).ok, true)
  write(path.join(f.projectRoot, 'src-electron/office.js'), 'host-source-changed')
  has(verifyOfficeIntegration(f), 'OFFICE_BUNDLE_SOURCE_STALE')
  f.regenerate()
  assert.equal(verifyOfficeIntegration(f).ok, true)
  has(verifyOfficeIntegration({ ...f, requireClean: true }), 'OFFICE_CURRENT_SOURCES_NOT_CLEAN')
  write(path.join(f.vendorRoot, 'apps/pdf/src/main.ts'), 'vendor-source-changed')
  has(verifyOfficeIntegration(f), 'OFFICE_BUNDLE_SOURCE_STALE')
})

test('package gate verifies a copied output and fails closed on damaged or mismatched resources', t => {
  const f = fixture(t)
  const packaged = path.join(path.dirname(f.projectRoot), 'packaged-office')
  fs.cpSync(f.bundleRoot, packaged, { recursive: true })
  assert.equal(verifyOfficeIntegration({ ...f, bundleRoot: packaged }).ok, true)
  write(path.join(packaged, 'main/pdf-converter.cjs'), 'damaged')
  has(verifyOfficeIntegration({ ...f, bundleRoot: packaged }), 'OFFICE_RESOURCE_MISMATCH')
  const manifestFile = path.join(f.bundleRoot, 'integration-manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  manifest.releaseVersion = 'older-preview'
  write(manifestFile, JSON.stringify(manifest))
  has(verifyOfficeIntegration(f), 'OFFICE_RELEASE_COMBINATION_MISMATCH')
})

test('package gate reports missing checkout or release metadata rather than accepting an untraceable bundle', t => {
  const f = fixture(t)
  assert.equal(verifyOfficeIntegration({ ...f, vendorRoot: path.join(f.vendorRoot, 'absent') }).code, 'OFFICE_SOURCE_IDENTITY_UNAVAILABLE')
  write(path.join(f.projectRoot, 'package.json'), '{}')
  assert.equal(verifyOfficeIntegration(f).code, 'OFFICE_RELEASE_VERSION_UNAVAILABLE')
})

test('verification detects source changes while resource verification is running', t => {
  const f = fixture(t)
  let captures = 0
  const result = verifyOfficeIntegration(f, { captureSources(project, vendor) {
    if (++captures === 2) write(path.join(vendor, 'apps/pdf/src/main.ts'), 'vendor-changed-during-verification')
    return captureOfficeSources(project, vendor)
  } })
  assert.equal(captures, 2)
  assert.equal(result.ok, false)
  has(result, 'OFFICE_SOURCES_CHANGED_DURING_VERIFICATION')
})

test('verification fails closed if checkout disappears during verification', t => {
  const f = fixture(t)
  let captures = 0
  const result = verifyOfficeIntegration(f, { captureSources(project, vendor) {
    if (++captures === 2) throw new Error('OFFICE_SOURCE_IDENTITY_UNAVAILABLE: missing checkout')
    return captureOfficeSources(project, vendor)
  } })
  assert.equal(captures, 2)
  assert.equal(result.ok, false)
  has(result, 'OFFICE_SOURCE_IDENTITY_UNAVAILABLE')
})

test('CLI requires an absolute bundle directory and rejects missing, repeated and unknown arguments', () => {
  const absolute = path.resolve('copied-office')
  assert.deepEqual(parseOfficeVerifyArguments(['--bundle', absolute, '--require-clean']), { bundleRoot: absolute, requireClean: true })
  assert.throws(() => parseOfficeVerifyArguments(['--bundle']), { code: 'OFFICE_VERIFY_BUNDLE_REQUIRED' })
  assert.throws(() => parseOfficeVerifyArguments(['--bundle', '--require-clean']), { code: 'OFFICE_VERIFY_BUNDLE_REQUIRED' })
  assert.throws(() => parseOfficeVerifyArguments(['--bundle', 'relative-office']), { code: 'OFFICE_VERIFY_BUNDLE_ABSOLUTE_REQUIRED' })
  assert.throws(() => parseOfficeVerifyArguments(['--bundle', absolute, '--bundle', absolute]), { code: 'OFFICE_VERIFY_ARGUMENT_INVALID' })
  assert.throws(() => parseOfficeVerifyArguments(['--require-clean', '--require-clean']), { code: 'OFFICE_VERIFY_ARGUMENT_INVALID' })
  assert.throws(() => parseOfficeVerifyArguments(['--ignore-hashes']), { code: 'OFFICE_VERIFY_ARGUMENT_INVALID' })
})

test('real CLI verifies a copied bundle from an unrelated Chinese cwd and returns a nonzero status for drift or invalid arguments', t => {
  const f = fixture(t, { cli: true })
  const unrelated = path.join(f.root, '无关中文 工作目录')
  const packaged = path.join(f.root, '复制的 安装资源')
  fs.mkdirSync(unrelated)
  fs.cpSync(f.bundleRoot, packaged, { recursive: true })
  const invoke = args => {
    const child = spawnSync(process.execPath, [path.join(f.projectRoot, 'scripts/verify-office-integration.mjs'), ...args], { cwd: unrelated, encoding: 'utf8', windowsHide: true, timeout: 30000 })
    assert.equal(child.error, undefined, child.error?.stack)
    assert.ok(child.stdout.trim().startsWith('{'), `CLI 没有输出 JSON: ${child.stderr}`)
    return { status: child.status, result: JSON.parse(child.stdout) }
  }
  const verified = invoke(['--bundle', packaged, '--require-clean'])
  assert.equal(verified.status, 0, JSON.stringify(verified.result))
  assert.equal(verified.result.ok, true)
  assert.equal(verified.result.projectRoot, f.projectRoot)
  assert.equal(verified.result.vendorRoot, f.vendorRoot)
  assert.equal(verified.result.bundleRoot, packaged)
  assert.equal(verified.result.releaseVersion, 'fixture-preview')
  const resource = path.join(packaged, 'main/pdf-converter.cjs')
  const original = fs.readFileSync(resource)
  fs.writeFileSync(resource, Buffer.alloc(original.length, 65))
  const damaged = invoke(['--bundle', packaged])
  assert.equal(damaged.status, 1)
  has(damaged.result, 'OFFICE_RESOURCE_MISMATCH')
  const missingValue = invoke(['--bundle'])
  assert.equal(missingValue.status, 1)
  assert.equal(missingValue.result.code, 'OFFICE_VERIFY_BUNDLE_REQUIRED')
  const relative = invoke(['--bundle', '../office'])
  assert.equal(relative.status, 1)
  assert.equal(relative.result.code, 'OFFICE_VERIFY_BUNDLE_ABSOLUTE_REQUIRED')
})
