import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { officeProbeRuntime } from '../lib/office-probe-runtime.mjs'

test('安装态验收从指定目录读取业务模块和 manifest，缺失时不回退到开发资源', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-office-probe-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const app = path.join(root, '中文 安装目录', 'resources', 'app')
  const office = path.join(path.dirname(app), 'office')
  fs.mkdirSync(path.join(app, 'src-electron', 'office'), { recursive: true })
  fs.mkdirSync(office, { recursive: true })
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ type: 'module', releaseVersion: 'installed-preview' }))
  fs.writeFileSync(path.join(app, 'src-electron', 'office', 'office-host.js'), 'export const origin = "installed-host"')
  fs.writeFileSync(path.join(office, 'integration-manifest.json'), JSON.stringify({ sources: { identityDigest: 'installed-source' }, resourcesDigest: 'installed-bundle' }))
  const reportFile = path.join(root, 'report.json')
  const runtime = officeProbeRuntime(path.join(root, 'nonexistent-source'), [`--packaged-app=${app}`, `--report=${reportFile}`])
  assert.equal(runtime.packaged, true)
  assert.equal(runtime.reportFile, reportFile)
  assert.equal((await runtime.load('src-electron/office/office-host.js')).origin, 'installed-host')
  assert.equal(runtime.evidence().identityDigest, 'installed-source')
  assert.equal(runtime.evidence().releaseVersion, 'installed-preview')
  assert.equal(runtime.evidence().mode, 'isolated-packaged-modules')
  fs.unlinkSync(path.join(office, 'integration-manifest.json'))
  assert.throws(() => officeProbeRuntime(root, [`--packaged-app=${app}`]), /OFFICE_PROBE_PACKAGED_LAYOUT_INVALID/)
})

test('安装态验收拒绝相对路径、重复参数和未知参数，避免误测开发目录', () => {
  assert.throws(() => officeProbeRuntime('', ['--packaged-app=relative']), /OFFICE_PROBE_ABSOLUTE_PATH_REQUIRED/)
  assert.throws(() => officeProbeRuntime('', ['--report=relative']), /OFFICE_PROBE_ABSOLUTE_PATH_REQUIRED/)
  assert.throws(() => officeProbeRuntime('', ['--skip-validation']), /OFFICE_PROBE_ARGUMENT_INVALID/)
  const report = path.resolve('report.json')
  assert.throws(() => officeProbeRuntime('', [`--report=${report}`, `--report=${report}`]), /OFFICE_PROBE_ARGUMENT_REPEATED/)
})
