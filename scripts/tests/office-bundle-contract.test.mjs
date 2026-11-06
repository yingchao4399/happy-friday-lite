import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { OFFICE_EDITOR_REGISTRY, OFFICE_EDITORS, OFFICE_EXT_TO_TYPE, OFFICE_REQUIRED_RESOURCES, OFFICE_SUPPORT_SERVICES, getEnabledOfficeEditors, getBuildOfficeEditors } from '../../src-electron/office/editor-registry.js'
import { calculateOfficeSourceIdentity, validateLoadedOfficeModule, validateLoadedOfficeService, validateOfficeBundle } from '../../src-electron/office/bundle-contract.js'
import { captureOfficeSources, publishOfficeBundle, writeOfficeBundleManifest } from '../office/integration-manifest.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const write = (file, content) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content) }
const temporary = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-office-contract-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}
const sourceFixture = () => {
  const sources = Object.fromEntries(['main', 'vendor'].map((key, index) => [key, {
    sha: String(index + 1).repeat(40), describe: 'fixture', scope: key + '-source-v1', dirty: false, repositoryDirty: false,
    diffDigest: hash(''), untrackedSourceDigest: hash('[]'), remotes: {},
  }]))
  return { ...sources, identityDigest: calculateOfficeSourceIdentity(sources) }
}
function fixture(t, { experimentalHtml = false } = {}) {
  const root = temporary(t)
  for (const editor of getBuildOfficeEditors({ experimentalHtml })) {
    for (const file of [`main/${editor.id}-main.cjs`, `${editor.id}/preload/index.js`, `${editor.id}/renderer/index.html`]) write(path.join(root, file), `fixture:${file}`)
  }
  for (const service of OFFICE_SUPPORT_SERVICES) write(path.join(root, service.main), 'service-fixture')
  for (const resource of OFFICE_REQUIRED_RESOURCES) write(path.join(root, resource), 'wasm-fixture')
  const sources = sourceFixture()
  if (experimentalHtml) {
    sources.html = { ...sources.vendor, scope: 'genoffice-html-source-v1', lockSha256: hash('fixture-html-lock') }
    sources.identityDigest = calculateOfficeSourceIdentity(sources)
  }
  const manifest = writeOfficeBundleManifest({ root, sources, releaseVersion: 'fixture-preview', experimentalHtml })
  return { root, manifest, save() { fs.writeFileSync(path.join(root, 'integration-manifest.json'), JSON.stringify(manifest)) } }
}
const issue = (result, code) => assert.ok(result.issues.some(item => item.code === code), JSON.stringify(result.issues))

test('shared registry enables four proven editors and keeps full-app candidates disabled', () => {
  assert.deepEqual(OFFICE_EDITORS, ['docs', 'sheets', 'slides', 'pdf'])
  assert.equal(OFFICE_EXT_TO_TYPE['.pdf'], 'pdf')
  assert.equal(OFFICE_EXT_TO_TYPE['.md'], undefined)
  assert.equal(OFFICE_EXT_TO_TYPE['.html'], undefined)
  for (const id of ['markdown', 'html']) assert.equal(OFFICE_EDITOR_REGISTRY.find(item => item.id === id).candidateReason, 'FULL_APP_PARITY_PENDING')
  assert.ok(Object.isFrozen(OFFICE_EDITOR_REGISTRY))
})

test('matched fresh resources pass editor and complete release validation', t => {
  const { root } = fixture(t)
  assert.equal(validateOfficeBundle(root, { editor: 'pdf' }).ok, true)
  assert.equal(validateOfficeBundle(root, { verifyAll: true, requireClean: true }).ok, true)
  issue(validateOfficeBundle(root, { editor: 'markdown' }), 'OFFICE_EDITOR_NOT_INTEGRATED')
})

test('experimental HTML requires host opt-in and never enables default associations or clean release', t => {
  const f = fixture(t, { experimentalHtml: true })
  assert.deepEqual(getBuildOfficeEditors().map(item => item.id), OFFICE_EDITORS)
  assert.deepEqual(getBuildOfficeEditors({ experimentalHtml: true }).map(item => item.id), [...OFFICE_EDITORS, 'html'])
  assert.equal(OFFICE_EXT_TO_TYPE['.html'], undefined)
  assert.equal(f.manifest.editors.find(item => item.id === 'html').releaseState, 'experimental')
  assert.equal(validateOfficeBundle(f.root, { verifyAll: true }).ok, true)
  assert.equal(validateOfficeBundle(f.root, { editor: 'pdf' }).ok, true)
  issue(validateOfficeBundle(f.root, { editor: 'html' }), 'OFFICE_EDITOR_NOT_INTEGRATED')
  assert.equal(validateOfficeBundle(f.root, { editor: 'html', allowExperimental: true }).ok, true)
  issue(validateOfficeBundle(f.root, { editor: 'html', allowExperimental: 'true' }), 'OFFICE_EDITOR_NOT_INTEGRATED')
  issue(validateOfficeBundle(f.root, { requireClean: true }), 'OFFICE_EXPERIMENTAL_NOT_RELEASE_READY')
  issue(validateOfficeBundle(f.root, { editor: 'markdown', allowExperimental: true }), 'OFFICE_EDITOR_NOT_INTEGRATED')
})

test('experimental manifest cannot approve an editor or omit its resource and hook contracts', t => {
  const f = fixture(t, { experimentalHtml: true })
  const entry = f.manifest.editors.find(item => item.id === 'html')
  entry.releaseState = 'enabled'
  f.save()
  issue(validateOfficeBundle(f.root, { editor: 'html', allowExperimental: true }), 'OFFICE_MANIFEST_INVALID')
  entry.releaseState = 'experimental'
  entry.requiredExports = []
  f.save()
  issue(validateOfficeBundle(f.root, { editor: 'html', allowExperimental: true }), 'OFFICE_EDITOR_CONTRACT_MISMATCH')
  entry.requiredExports = [...OFFICE_EDITOR_REGISTRY.find(item => item.id === 'html').requiredExports]
  f.save()
  fs.unlinkSync(path.join(f.root, 'html/preload/index.js'))
  issue(validateOfficeBundle(f.root, { verifyAll: true }), 'OFFICE_RESOURCE_MISSING')
})

test('experimental module loading checks actual HTML functions after explicit admission', () => {
  const definition = OFFICE_EDITOR_REGISTRY.find(item => item.id === 'html')
  const bundle = Object.fromEntries(definition.requiredExports.map(name => [name, () => {}]))
  assert.equal(validateLoadedOfficeModule('html', bundle).code, 'OFFICE_EDITOR_NOT_INTEGRATED')
  assert.equal(validateLoadedOfficeModule('html', bundle, { allowExperimental: true }).ok, true)
  delete bundle.configureHtmlRuntime
  assert.deepEqual(validateLoadedOfficeModule('html', bundle, { allowExperimental: true }).missingExports, ['configureHtmlRuntime'])
  assert.equal(validateLoadedOfficeModule('markdown', {}, { allowExperimental: true }).code, 'OFFICE_EDITOR_NOT_INTEGRATED')
})

test('experimental HTML requires its own source identity and changing that tree invalidates the digest', t => {
  const f = fixture(t, { experimentalHtml: true })
  const original = f.manifest.sources.identityDigest
  f.manifest.sources.html.sha = 'f'.repeat(40)
  f.save()
  assert.notEqual(calculateOfficeSourceIdentity(f.manifest.sources), original)
  issue(validateOfficeBundle(f.root, { editor: 'html', allowExperimental: true }), 'OFFICE_SOURCE_IDENTITY_INVALID')
  delete f.manifest.sources.html
  f.manifest.sources.identityDigest = calculateOfficeSourceIdentity(f.manifest.sources)
  f.save()
  issue(validateOfficeBundle(f.root, { editor: 'html', allowExperimental: true }), 'OFFICE_HTML_SOURCE_IDENTITY_INVALID')
})

test('empty npm .gitkeep markers are excluded from the runtime inventory and remain package-verifiable', t => {
  const { root } = fixture(t)
  write(path.join(root, 'cli/node_modules/cssstyle/lib/generated/.gitkeep'), '')
  const manifest = writeOfficeBundleManifest({ root, sources: sourceFixture(), releaseVersion: 'fixture-preview' })
  assert.equal(manifest.resources.some(resource => resource.path.endsWith('/.gitkeep')), false)
  assert.equal(validateOfficeBundle(root, { verifyAll: true }).ok, true)
  fs.writeFileSync(path.join(root, 'cli/node_modules/cssstyle/lib/generated/.gitkeep'), 'runtime data')
  assert.equal(validateOfficeBundle(root, { verifyAll: true }).ok, false)
})

test('missing and malformed manifests fail closed without throwing', t => {
  const root = temporary(t)
  assert.equal(validateOfficeBundle(root).code, 'OFFICE_MANIFEST_MISSING')
  write(path.join(root, 'integration-manifest.json'), '{bad-json')
  assert.equal(validateOfficeBundle(root).code, 'OFFICE_MANIFEST_MISSING')
  write(path.join(root, 'integration-manifest.json'), JSON.stringify({ editors: {}, services: {}, resources: [null] }))
  assert.doesNotThrow(() => validateOfficeBundle(root, { verifyAll: true }))
  assert.equal(validateOfficeBundle(root).ok, false)
})

test('protocol, source identity and target mismatches are explicit', t => {
  const f = fixture(t)
  f.manifest.hostProtocolVersion = '2.0'
  f.manifest.sources.vendor.sha = 'f'.repeat(40)
  f.manifest.build.arch = process.arch === 'x64' ? 'arm64' : 'x64'
  f.save()
  const result = validateOfficeBundle(f.root)
  issue(result, 'OFFICE_PROTOCOL_INCOMPATIBLE')
  issue(result, 'OFFICE_SOURCE_IDENTITY_INVALID')
  issue(result, 'OFFICE_BUILD_TARGET_INCOMPATIBLE')
  issue(validateOfficeBundle(f.root, { expectedReleaseVersion: 'different-preview' }), 'OFFICE_RELEASE_COMBINATION_MISMATCH')
})

test('editor entry paths, hooks, service and extension contracts cannot be self-declared around registry', t => {
  const f = fixture(t)
  f.manifest.editors.find(item => item.id === 'pdf').main = 'main/docs-main.cjs'
  f.manifest.editors.find(item => item.id === 'docs').requiredExports.pop()
  f.manifest.services = []
  f.save()
  const result = validateOfficeBundle(f.root)
  issue(result, 'OFFICE_EDITOR_CONTRACT_MISMATCH')
  issue(result, 'OFFICE_SERVICE_CONTRACT_MISMATCH')
})

test('same-length artifact tampering and missing resources are detected', t => {
  const f = fixture(t)
  const file = path.join(f.root, 'main/pdf-main.cjs')
  fs.writeFileSync(file, Buffer.alloc(fs.statSync(file).size, 88))
  fs.unlinkSync(path.join(f.root, 'wasm/pdfium.wasm'))
  const result = validateOfficeBundle(f.root, { editor: 'pdf' })
  issue(result, 'OFFICE_RESOURCE_MISMATCH')
  issue(result, 'OFFICE_RESOURCE_MISSING')
})

test('unsafe and duplicate paths are rejected even when digest is recomputed', t => {
  const f = fixture(t)
  f.manifest.resources.push({ ...f.manifest.resources[0] }, { path: '../outside.cjs', bytes: 1, sha256: hash('x') })
  f.manifest.resourcesDigest = hash(JSON.stringify(f.manifest.resources))
  f.save()
  issue(validateOfficeBundle(f.root, { verifyAll: true }), 'OFFICE_MANIFEST_INVALID')
})

test('complete validation rejects stale extra files omitted from the manifest', t => {
  const f = fixture(t)
  write(path.join(f.root, 'main/stale-old-handler.cjs'), 'stale')
  assert.equal(validateOfficeBundle(f.root, { editor: 'pdf' }).ok, true)
  issue(validateOfficeBundle(f.root, { verifyAll: true }), 'OFFICE_RESOURCE_UNDECLARED')
})

test('a symlinked resource ancestor cannot redirect a declared entry outside the bundle', t => {
  const f = fixture(t)
  const outside = temporary(t)
  const preload = path.join(f.root, 'pdf/preload')
  fs.copyFileSync(path.join(preload, 'index.js'), path.join(outside, 'index.js'))
  fs.rmSync(preload, { recursive: true, force: true })
  try { fs.symlinkSync(outside, preload, process.platform === 'win32' ? 'junction' : 'dir') } catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('platform does not permit symlink fixtures'); return }
    throw error
  }
  issue(validateOfficeBundle(f.root, { editor: 'pdf' }), 'OFFICE_RESOURCE_MISMATCH')
})

test('dirty or cached builds remain usable previews but cannot pass clean release gate', t => {
  const f = fixture(t)
  f.manifest.sources.vendor.dirty = true
  f.manifest.sources.identityDigest = calculateOfficeSourceIdentity(f.manifest.sources)
  f.manifest.build.renderer = 'cached-unverified'
  f.save()
  assert.equal(validateOfficeBundle(f.root, { editor: 'pdf' }).ok, true)
  issue(validateOfficeBundle(f.root, { verifyAll: true, requireClean: true }), 'OFFICE_BUILD_NOT_RELEASE_READY')
})

test('loaded module hooks are checked against actual functions, not manifest assertions', () => {
  const docs = Object.fromEntries(getEnabledOfficeEditors().find(item => item.id === 'docs').requiredExports.map(name => [name, () => {}]))
  assert.equal(validateLoadedOfficeModule('docs', docs).ok, true)
  delete docs.serializeDocsAiContent
  assert.deepEqual(validateLoadedOfficeModule('docs', docs).missingExports, ['serializeDocsAiContent'])
  assert.equal(validateLoadedOfficeService('pdf-converter', { convertSnapshot() {} }).ok, true)
  assert.equal(validateLoadedOfficeService('pdf-converter', { convertSnapshot: true }).ok, false)
})

test('failed promotion restores previous matched directory and preserves the candidate', t => {
  const root = temporary(t)
  const final = path.join(root, 'office')
  const staging = path.join(root, '.office-stage-123')
  const backup = path.join(root, '.office-previous-123')
  write(path.join(final, 'version.txt'), 'old')
  write(path.join(staging, 'version.txt'), 'candidate')
  const io = { ...fs, renameSync(from, to) { if (from === staging) throw Object.assign(new Error('injected-lock'), { code: 'EPERM' }); fs.renameSync(from, to) } }
  assert.throws(() => publishOfficeBundle({ stagingRoot: staging, finalRoot: final, backupRoot: backup }, io), /injected-lock/)
  assert.equal(fs.readFileSync(path.join(final, 'version.txt'), 'utf8'), 'old')
  assert.equal(fs.readFileSync(path.join(staging, 'version.txt'), 'utf8'), 'candidate')
  assert.equal(fs.existsSync(backup), false)
})

test('successful promotion swaps one whole combination and guards recursive cleanup paths', t => {
  const root = temporary(t)
  const final = path.join(root, 'office')
  const staging = path.join(root, '.office-stage-456')
  const backup = path.join(root, '.office-previous-456')
  write(path.join(final, 'version.txt'), 'old')
  write(path.join(staging, 'version.txt'), 'new')
  assert.equal(publishOfficeBundle({ stagingRoot: staging, finalRoot: final, backupRoot: backup }).published, true)
  assert.equal(fs.readFileSync(path.join(final, 'version.txt'), 'utf8'), 'new')
  assert.equal(fs.existsSync(staging), false)
  assert.equal(fs.existsSync(backup), false)
  assert.throws(() => publishOfficeBundle({ stagingRoot: root, finalRoot: final, backupRoot: backup }), /OFFICE_PUBLISH_PATH_INVALID/)
})

test('failed rollback preserves the old combination and reports its exact recovery location', t => {
  const root = temporary(t)
  const final = path.join(root, 'office')
  const staging = path.join(root, '.office-stage-789')
  const backup = path.join(root, '.office-previous-789')
  write(path.join(final, 'version.txt'), 'old')
  write(path.join(staging, 'version.txt'), 'candidate')
  const io = { ...fs, renameSync(from, to) {
    if (from === staging || from === backup) throw Object.assign(new Error('injected-lock'), { code: 'EPERM' })
    fs.renameSync(from, to)
  } }
  assert.throws(() => publishOfficeBundle({ stagingRoot: staging, finalRoot: final, backupRoot: backup }, io), error => {
    assert.equal(error.message, 'OFFICE_PUBLISH_RECOVERY_REQUIRED')
    assert.equal(error.recoveryPath, backup)
    return true
  })
  assert.equal(fs.readFileSync(path.join(backup, 'version.txt'), 'utf8'), 'old')
  assert.equal(fs.readFileSync(path.join(staging, 'version.txt'), 'utf8'), 'candidate')
})

test('source capture ignores generated artifacts but detects actual untracked runtime edits', t => {
  const root = temporary(t)
  const main = path.join(root, 'main')
  const vendor = path.join(root, 'vendor')
  for (const directory of [main, vendor]) {
    fs.mkdirSync(directory)
    const git = args => {
      const result = spawnSync('git', ['-C', directory, ...args], { encoding: 'utf8', windowsHide: true })
      assert.equal(result.status, 0, result.stderr)
    }
    git(['init', '--quiet'])
    git(['config', 'user.name', 'Office contract fixture'])
    git(['config', 'user.email', 'office-fixture@example.invalid'])
    write(path.join(directory, directory === main ? 'src-electron/office.js' : 'apps/docs/src/main.ts'), 'source')
    write(path.join(directory, directory === main ? 'resources/office/main/old.cjs' : 'packages/electron-utils/native/system-print.exe'), 'generated')
    git(['add', '.'])
    git(['commit', '--quiet', '-m', 'fixture'])
  }
  const before = captureOfficeSources(main, vendor)
  write(path.join(main, 'resources/office/main/old.cjs'), 'regenerated')
  write(path.join(main, 'resources/.office-stage-123/main/docs.cjs'), 'staged')
  write(path.join(main, 'public/skills/genoffice/SKILL.md'), 'generated skill')
  write(path.join(vendor, 'packages/electron-utils/native/system-print.exe'), 'regenerated')
  const generated = captureOfficeSources(main, vendor)
  assert.equal(before.identityDigest, generated.identityDigest)
  assert.equal(generated.main.repositoryDirty, true)
  assert.equal(generated.vendor.repositoryDirty, true)
  assert.equal(generated.main.dirty, false)
  assert.equal(generated.vendor.dirty, false)
  write(path.join(main, 'src-electron/office-new.js'), 'actual source')
  const changed = captureOfficeSources(main, vendor)
  assert.notEqual(before.identityDigest, changed.identityDigest)
  assert.equal(changed.main.dirty, true)
})
