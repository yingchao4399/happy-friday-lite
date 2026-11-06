import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { OFFICE_REQUIRED_RESOURCES, OFFICE_SUPPORT_SERVICES, getEnabledOfficeEditors } from '../../src-electron/office/editor-registry.js'
import { calculateOfficeSourceIdentity } from '../../src-electron/office/bundle-contract.js'
import { writeOfficeBundleManifest } from '../office/integration-manifest.mjs'

const project = fileURLToPath(new URL('../../', import.meta.url))
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value) }
const hash = text => createHash('sha256').update(text).digest('hex')

test('包内 Office、宿主、来源锁和 patch 账本必须属于同一组合', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-packaged-provenance-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const app = path.join(root, 'resources', 'app')
  const office = path.join(root, 'resources', 'office')
  const pkg = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'))
  write(path.join(app, 'package.json'), JSON.stringify({ version: pkg.version, releaseVersion: pkg.releaseVersion }))
  for (const file of ['office-upstream.lock.json', 'office-vendor-patches.json']) write(path.join(app, file), fs.readFileSync(path.join(project, file)))
  for (const editor of getEnabledOfficeEditors()) {
    for (const file of [`main/${editor.id}-main.cjs`, `${editor.id}/preload/index.js`, `${editor.id}/renderer/index.html`]) write(path.join(office, file), file)
  }
  for (const resource of [...OFFICE_REQUIRED_RESOURCES, ...OFFICE_SUPPORT_SERVICES.map(service => service.main)]) write(path.join(office, resource), resource)
  const sources = Object.fromEntries(['main', 'vendor'].map((key, index) => [key, { sha: String(index + 1).repeat(40), scope: key, dirty: false, diffDigest: hash(''), untrackedSourceDigest: hash('[]') }]))
  sources.identityDigest = calculateOfficeSourceIdentity(sources)
  writeOfficeBundleManifest({ root: office, projectRoot: app, sources, releaseVersion: pkg.releaseVersion })
  const invoke = () => {
    const result = spawnSync(process.execPath, [path.join(project, 'scripts/verify-packaged-office.mjs'), office], { cwd: root, encoding: 'utf8', windowsHide: true })
    return { ...result, report: JSON.parse(result.status === 0 ? result.stdout : result.stderr) }
  }
  assert.equal(invoke().status, 0)
  const lockFile = path.join(app, 'office-upstream.lock.json')
  const original = fs.readFileSync(lockFile)
  fs.appendFileSync(lockFile, '\n')
  const changed = invoke()
  assert.equal(changed.status, 1)
  assert.equal(changed.report.code, 'OFFICE_PACKAGED_UPSTREAM_MISMATCH')
  fs.writeFileSync(lockFile, original)
  write(path.join(app, 'package.json'), JSON.stringify({ version: '0.0.0', releaseVersion: pkg.releaseVersion }))
  const hostChanged = invoke()
  assert.equal(hostChanged.status, 1)
  assert.equal(hostChanged.report.code, 'OFFICE_PACKAGED_HOST_MISMATCH')
  write(path.join(app, 'package.json'), JSON.stringify({ version: pkg.version, releaseVersion: pkg.releaseVersion }))
  // HTML 来自另一棵固定源码树，安装包也必须携带同一份来源锁。
  const htmlLock = fs.readFileSync(path.join(project, 'office-html-upstream.lock.json'))
  write(path.join(app, 'office-html-upstream.lock.json'), htmlLock)
  for (const file of ['main/html-main.cjs', 'html/preload/index.js', 'html/renderer/index.html']) write(path.join(office, file), file)
  sources.html = { ...sources.vendor, scope: 'genoffice-html-source-v1', lockSha256: hash(htmlLock) }
  sources.identityDigest = calculateOfficeSourceIdentity(sources)
  writeOfficeBundleManifest({ root: office, projectRoot: app, sources, releaseVersion: pkg.releaseVersion, experimentalHtml: true })
  assert.equal(invoke().status, 0)
  fs.appendFileSync(path.join(app, 'office-html-upstream.lock.json'), '\n')
  const htmlChanged = invoke()
  assert.equal(htmlChanged.status, 1)
  assert.equal(htmlChanged.report.code, 'OFFICE_PACKAGED_HTML_UPSTREAM_MISMATCH')
})
