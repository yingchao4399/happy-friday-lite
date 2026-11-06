import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import yaml from 'js-yaml'
import { atomicReplaceText, parseReleaseMetadataArguments, resolveReleaseArtifacts, verifyReleaseMetadata, writeReleaseMetadata } from '../write-release-metadata.mjs'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const write = (file, contents) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, contents) }
const json = (file, value) => write(file, JSON.stringify(value))
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-发布元数据-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const releaseDir = path.join(root, 'release')
  const releaseVersion = '3.0.7.01-preview.36'
  const installerName = `Happy-Friday-Lite-${releaseVersion}-win-x64-setup.exe`
  const template = `Happy-Friday-Lite-${releaseVersion}-win-\${arch}-setup.\${ext}`
  const packageJson = { name: 'happy-friday-lite', version: '3.0.8-preview.36', releaseVersion, build: { productName: 'Happy Friday Lite', directories: { output: 'release' }, win: { artifactName: template, publish: { provider: 'github', publishAutoUpdate: false } }, nsis: { artifactName: template } } }
  const packageFile = path.join(root, 'package.json')
  json(packageFile, packageJson)
  const installer = path.join(releaseDir, installerName)
  write(installer, Buffer.from('MZ synthetic installer bytes for release metadata checks'))
  write(`${installer}.blockmap`, Buffer.from('synthetic blockmap bytes'))
  const appFile = path.join(releaseDir, 'win-unpacked/resources/app/package.json')
  const manifestFile = path.join(releaseDir, 'win-unpacked/resources/office/integration-manifest.json')
  json(appFile, { version: packageJson.version, releaseVersion })
  const office = { releaseVersion, sources: { identityDigest: 'a'.repeat(64), vendor: { sha: 'c'.repeat(40) } }, resourcesDigest: 'b'.repeat(64), resources: [{ path: 'fixture' }], upstream: { integrationState: 'current-vendor-not-latest-claim' } }
  json(manifestFile, office)
  return { root, releaseDir, packageJson, packageFile, installer, installerName, appFile, manifestFile, office, releaseVersion }
}

test('measured installer and blockmap produce verifiable metadata, replacing stale latest atomically', async t => {
  const f = fixture(t)
  const latest = path.join(f.releaseDir, 'latest.yml')
  write(latest, 'version: old\npath: old.exe\n')
  const result = await writeReleaseMetadata({ projectRoot: f.root })
  assert.equal(result.ok, true)
  assert.equal(result.installer.size, fs.statSync(f.installer).size)
  assert.equal(result.installer.sha512, createHash('sha512').update(fs.readFileSync(f.installer)).digest('base64'))
  const actual = yaml.load(fs.readFileSync(latest, 'utf8'))
  assert.equal(actual.version, '3.0.8-preview.36')
  assert.equal(actual.releaseVersion, f.releaseVersion)
  assert.equal(actual.path, f.installerName)
  assert.equal(actual.files[0].size, result.installer.size)
  assert.equal(actual.files[0].sha512, actual.sha512)
  assert.equal((await verifyReleaseMetadata({ projectRoot: f.root })).ok, true)
  assert.match(fs.readFileSync(result.files.buildInfo, 'utf8'), /does not attest installation, signing, upstream feature parity or publication/)
  assert.equal(fs.readFileSync(result.files.checksums, 'utf8').trim().split('\n').length, 2)
  assert.equal(fs.readdirSync(f.releaseDir).some(name => name.endsWith('.tmp')), false)
})

test('missing and ambiguous current installers fail while older releases are never selected', async t => {
  const f = fixture(t)
  write(path.join(f.releaseDir, f.installerName.replace('preview.36', 'preview.35')), 'MZ older installer')
  fs.rmSync(f.installer)
  await assert.rejects(writeReleaseMetadata({ projectRoot: f.root }), { code: 'RELEASE_INSTALLER_MISSING' })
  write(f.installer, 'MZ current installer')
  write(path.join(f.releaseDir, f.installerName.replace('Happy-Friday-Lite', 'Other')), 'MZ duplicate current installer')
  await assert.rejects(writeReleaseMetadata({ projectRoot: f.root }), { code: 'RELEASE_INSTALLER_AMBIGUOUS' })
  assert.equal(fs.existsSync(path.join(f.releaseDir, 'latest.yml')), false)
})

test('installer identity, blockmap and configured releaseVersion are mandatory', async t => {
  const f = fixture(t)
  write(f.installer, 'not a PE installer')
  assert.throws(() => resolveReleaseArtifacts(f.root), { code: 'RELEASE_INSTALLER_INVALID' })
  write(f.installer, 'MZ installer')
  fs.rmSync(`${f.installer}.blockmap`)
  assert.throws(() => resolveReleaseArtifacts(f.root), { code: 'RELEASE_BLOCKMAP_MISSING' })
  write(`${f.installer}.blockmap`, 'blockmap')
  f.packageJson.releaseVersion = '3.0.7.01-preview.37'
  json(f.packageFile, f.packageJson)
  assert.throws(() => resolveReleaseArtifacts(f.root), { code: 'RELEASE_ARTIFACT_VERSION_MISMATCH' })
})

test('packaged application and Office must match the configured release and record source digests', t => {
  const f = fixture(t)
  json(f.appFile, { version: '3.0.7', releaseVersion: f.releaseVersion })
  assert.throws(() => resolveReleaseArtifacts(f.root), { code: 'RELEASE_PACKAGED_VERSION_MISMATCH' })
  json(f.appFile, { version: f.packageJson.version, releaseVersion: f.releaseVersion })
  json(f.manifestFile, { ...f.office, releaseVersion: 'older-preview' })
  assert.throws(() => resolveReleaseArtifacts(f.root), { code: 'RELEASE_PACKAGED_VERSION_MISMATCH' })
  json(f.manifestFile, { ...f.office, sources: {} })
  assert.throws(() => resolveReleaseArtifacts(f.root), { code: 'RELEASE_OFFICE_IDENTITY_INVALID' })
  fs.rmSync(f.manifestFile)
  assert.throws(() => resolveReleaseArtifacts(f.root), { code: 'RELEASE_PACKAGED_IDENTITY_MISSING' })
})

test('check rejects mismatched size, SHA-512, filename, version and stale companion audit files', async t => {
  const f = fixture(t)
  const written = await writeReleaseMetadata({ projectRoot: f.root })
  const original = fs.readFileSync(written.files.latest, 'utf8')
  for (const mutate of [data => { data.files[0].size++ }, data => { data.sha512 = 'wrong' }, data => { data.files[0].sha512 = 'wrong' }, data => { data.path = 'old.exe' }, data => { data.version = '3.0.7' }, data => { data.releaseVersion = 'old-preview' }]) {
    const data = yaml.load(original)
    mutate(data)
    write(written.files.latest, yaml.dump(data))
    await assert.rejects(verifyReleaseMetadata({ projectRoot: f.root }), { code: 'RELEASE_METADATA_MISMATCH' })
  }
  write(written.files.latest, original)
  write(written.files.checksums, 'old checksum')
  await assert.rejects(verifyReleaseMetadata({ projectRoot: f.root }), { code: 'RELEASE_METADATA_MISMATCH' })
  await writeReleaseMetadata({ projectRoot: f.root })
  write(written.files.buildInfo, 'old build info')
  await assert.rejects(verifyReleaseMetadata({ projectRoot: f.root }), { code: 'RELEASE_METADATA_MISMATCH' })
})

test('artifact changes after generation invalidate metadata without accepting the old checksum', async t => {
  const f = fixture(t)
  await writeReleaseMetadata({ projectRoot: f.root })
  const contents = fs.readFileSync(f.installer)
  contents[contents.length - 1] ^= 1
  write(f.installer, contents)
  await assert.rejects(verifyReleaseMetadata({ projectRoot: f.root }), { code: 'RELEASE_METADATA_MISMATCH' })
})

test('verification rejects same-version JSON drift and an installer replaced after its hash while reading the blockmap', async t => {
  const cases = [
    { name: 'root package publish configuration', code: 'RELEASE_INPUT_CHANGED', mutate(f) {
      json(f.packageFile, { ...f.packageJson, build: { ...f.packageJson.build, win: { ...f.packageJson.build.win, publish: { provider: 'github', publishAutoUpdate: true } } } })
    } },
    { name: 'packaged application JSON', code: 'RELEASE_INPUT_CHANGED', mutate(f) {
      json(f.appFile, { version: f.packageJson.version, releaseVersion: f.releaseVersion, description: 'changed with the same versions' })
    } },
    { name: 'Office source identity', code: 'RELEASE_INPUT_CHANGED', mutate(f) {
      json(f.manifestFile, { ...f.office, sources: { ...f.office.sources, identityDigest: 'd'.repeat(64) } })
    } },
    { name: 'installer after its completed measurement', code: 'RELEASE_FILE_CHANGED', mutate(f) {
      write(f.installer, 'MZ replaced installer with a different byte length after hashing')
    } },
  ]
  for (const entry of cases) await t.test(entry.name, async () => {
    const f = fixture(t)
    await writeReleaseMetadata({ projectRoot: f.root })
    const original = fs.createReadStream
    let mutated = false
    fs.createReadStream = function (file, ...args) {
      if (file === `${f.installer}.blockmap` && !mutated) { mutated = true; entry.mutate(f) }
      return original.call(this, file, ...args)
    }
    try { await assert.rejects(verifyReleaseMetadata({ projectRoot: f.root }), { code: entry.code }) } finally { fs.createReadStream = original }
    assert.equal(mutated, true, 'the race must run after installer hashing and before overall verification returns')
  })
})

test('writer retains its original full input snapshot through generation instead of accepting unrelated same-version edits on a fresh validation pass', async t => {
  const f = fixture(t)
  const latest = path.join(f.releaseDir, 'latest.yml')
  write(latest, 'previous published metadata\n')
  const original = fs.createReadStream
  let mutated = false
  fs.createReadStream = function (file, ...args) {
    if (file === `${f.installer}.blockmap` && !mutated) {
      mutated = true
      // This field changes neither version, installer naming, nor generated YAML.
      json(f.packageFile, { ...f.packageJson, description: 'edited during generation' })
    }
    return original.call(this, file, ...args)
  }
  try { await assert.rejects(writeReleaseMetadata({ projectRoot: f.root }), { code: 'RELEASE_INPUT_CHANGED' }) } finally { fs.createReadStream = original }
  assert.equal(mutated, true)
  assert.equal(fs.readFileSync(latest, 'utf8'), 'previous published metadata\n')
})

test('atomic replacement retries transient Windows locks and preserves prior metadata on permanent failure', async t => {
  const f = fixture(t)
  const file = path.join(f.releaseDir, 'latest.yml')
  write(file, 'previous metadata')
  let attempts = 0
  await atomicReplaceText(file, 'new metadata', { pause: async () => {}, rename: async (from, to) => {
    if (++attempts < 3) throw Object.assign(new Error('temporarily locked'), { code: 'EPERM' })
    return fs.promises.rename(from, to)
  } })
  assert.equal(attempts, 3)
  assert.equal(fs.readFileSync(file, 'utf8'), 'new metadata')
  await assert.rejects(atomicReplaceText(file, 'uncommitted metadata', { pause: async () => {}, rename: async () => { throw Object.assign(new Error('still locked'), { code: 'UNKNOWN' }) } }), { code: 'UNKNOWN' })
  assert.equal(fs.readFileSync(file, 'utf8'), 'new metadata')
  assert.equal(fs.readdirSync(f.releaseDir).some(name => name.endsWith('.tmp')), false)
})

test('CLI works from an unrelated Chinese cwd and returns nonzero for drift or invalid arguments', t => {
  const f = fixture(t)
  const cwd = path.join(f.root, '无关 工作目录')
  fs.mkdirSync(cwd)
  const invoke = args => spawnSync(process.execPath, [path.join(project, 'scripts/write-release-metadata.mjs'), '--project', f.root, ...args], { cwd, encoding: 'utf8', windowsHide: true, timeout: 30000 })
  const generated = invoke([])
  assert.equal(generated.status, 0, generated.stderr)
  assert.equal(JSON.parse(generated.stdout).releaseVersion, f.releaseVersion)
  assert.equal(invoke(['--check']).status, 0)
  write(f.installer, 'MZ changed installer')
  const changed = invoke(['--check'])
  assert.equal(changed.status, 1)
  assert.equal(JSON.parse(changed.stderr).code, 'RELEASE_METADATA_MISMATCH')
  assert.equal(invoke(['--ignore-hashes']).status, 1)
})

test('invalid CLI arguments and builder metadata settings fail closed', t => {
  const f = fixture(t)
  for (const args of [['--project'], ['--project', 'relative'], ['--check', '--check'], ['--force']]) assert.throws(() => parseReleaseMetadataArguments(args), { code: 'RELEASE_METADATA_ARGUMENT_INVALID' })
  f.packageJson.build.win.publish.publishAutoUpdate = true
  json(f.packageFile, f.packageJson)
  assert.throws(() => resolveReleaseArtifacts(f.root), { code: 'RELEASE_BUILDER_METADATA_NOT_DISABLED' })
})

test('installed electron-builder honors publishAutoUpdate false and leaves latest.yml untouched', async t => {
  const f = fixture(t)
  const latest = path.join(f.releaseDir, 'latest.yml')
  write(latest, 'previous metadata')
  const require = createRequire(import.meta.url)
  const { writeUpdateInfoFiles } = require('app-builder-lib/out/publish/updateInfoBuilder.js')
  await writeUpdateInfoFiles([{ file: latest, info: { files: [{ url: f.installerName }] }, publishConfiguration: { provider: 'github', publishAutoUpdate: false } }], { dispatchArtifactCreated() { assert.fail('electron-builder must not emit updater metadata') } })
  assert.equal(fs.readFileSync(latest, 'utf8'), 'previous metadata')
})

test('Windows pipeline runs metadata after package acceptance and never publishes automatically', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'))
  const command = packageJson.scripts['electron:build:win']
  assert.match(command, /electron-builder .*--publish=never/)
  assert.ok(command.indexOf('write-release-metadata.mjs') > command.indexOf('smoke-electron-startup.mjs'))
  assert.equal(packageJson.build.win.publish.publishAutoUpdate, false)
  assert.equal(packageJson.version, JSON.parse(fs.readFileSync(path.join(project, 'package-lock.json'), 'utf8')).version)
})

test('technical application version increases from preview.35 and supports later preview ordering', () => {
  const require = createRequire(import.meta.url)
  const semver = require('semver')
  const packageJson = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'))
  // preview.35 was shipped with this technical version, despite its longer display label.
  const installedPreview35Version = '3.0.7'
  assert.equal(semver.gt(packageJson.version, installedPreview35Version), true, `${packageJson.version} must upgrade ${installedPreview35Version}`)
  assert.equal(semver.gt('3.0.8-preview.37', '3.0.8-preview.36'), true)
  assert.equal(semver.gt('3.0.7-preview.36', installedPreview35Version), false)
  assert.equal(packageJson.releaseVersion, '3.0.7.01-preview.37')
  assert.equal(semver.gt(packageJson.version, '3.0.8-preview.36'), true)
})
