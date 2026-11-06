import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isProbeArtifactContained, parseRealModelProbeArguments, readConfiguredModel, safeModelFailure } from '../probe-office-real-model-delivery.mjs'

const directory = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-real-model-probe-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

test('real model probe separates absolute read-only config argument from shared runtime flags', t => {
  const root = directory(t)
  const config = path.join(root, 'config.json')
  const report = path.join(root, 'report.json')
  assert.deepEqual(parseRealModelProbeArguments(['--config', config, `--report=${report}`]), { configFile: config, runtimeArgs: [`--report=${report}`] })
  assert.equal(parseRealModelProbeArguments([`--config=${config}`]).configFile, config)
  assert.throws(() => parseRealModelProbeArguments(['--config', 'relative.json']), { code: 'OFFICE_REAL_MODEL_CONFIG_ABSOLUTE_REQUIRED' })
  assert.throws(() => parseRealModelProbeArguments(['--config']), { code: 'OFFICE_REAL_MODEL_CONFIG_ABSOLUTE_REQUIRED' })
  assert.throws(() => parseRealModelProbeArguments(['--config', config, '--config', config]), { code: 'OFFICE_REAL_MODEL_ARGUMENT_REPEATED' })
})

test('existing selected model is read without writing credentials or exposing endpoint in selection evidence', t => {
  const root = directory(t)
  const config = path.join(root, 'config.json')
  const secret = 'synthetic-test-only-secret-9182'
  const endpoint = 'https://synthetic-endpoint.invalid/v1'
  const bytes = JSON.stringify({ selectedModelId: 'current', customModels: [{ id: 'old', apiKey: '', modelName: 'old', baseUrl: endpoint }, { id: 'current', apiKey: secret, modelName: 'test-model', baseUrl: endpoint }] })
  fs.writeFileSync(config, bytes)
  const loaded = readConfiguredModel(config)
  assert.equal(loaded.model.id, 'current')
  assert.equal(loaded.selection.selectedConfiguredModel, true)
  assert.equal(JSON.stringify(loaded.selection).includes(secret), false)
  assert.equal(JSON.stringify(loaded.selection).includes(endpoint), false)
  assert.equal(fs.readFileSync(config, 'utf8'), bytes)
  assert.deepEqual(fs.readdirSync(root), ['config.json'])
})

test('missing and malformed model configuration fail closed', t => {
  const root = directory(t)
  const file = path.join(root, 'config.json')
  for (const contents of [null, '{bad', '{}', JSON.stringify({ customModels: [{ modelName: 'no-key', baseUrl: 'https://fixture.invalid' }] })]) {
    if (contents !== null) fs.writeFileSync(file, contents)
    assert.throws(() => readConfiguredModel(file), { code: 'MODEL_REQUIRED' })
  }
})

test('external model errors include only whitelisted classification and HTTP metadata', () => {
  const safe = safeModelFailure({ errorCode: 'auth', error: 'secret https://private.invalid', diagnostic: { status: 401, phase: 'response', url: 'https://private.invalid', apiKey: 'secret', providerCode: 'secret' } })
  assert.deepEqual(safe, { code: 'MODEL_EXTERNAL_FAILURE', errorCode: 'auth', httpStatus: 401, phase: 'response' })
  assert.equal(JSON.stringify(safe).includes('secret'), false)
  assert.equal(JSON.stringify(safe).includes('https:'), false)
  assert.deepEqual(safeModelFailure({ errorCode: 'https://private.invalid', diagnostic: { status: 'secret', phase: 'secret' } }), { code: 'MODEL_EXTERNAL_FAILURE', errorCode: 'unspecified' })
})

test('artifact containment resolves real paths and rejects missing or outside files', t => {
  const root = directory(t)
  const inside = path.join(root, 'result.docx')
  const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.docx`)
  fs.writeFileSync(inside, 'synthetic')
  fs.writeFileSync(outside, 'synthetic')
  t.after(() => fs.rmSync(outside, { force: true }))
  assert.equal(isProbeArtifactContained(root, inside), true)
  assert.equal(isProbeArtifactContained(root, fs.realpathSync.native(inside)), true)
  assert.equal(isProbeArtifactContained(root, root), false)
  assert.equal(isProbeArtifactContained(root, outside), false)
  assert.equal(isProbeArtifactContained(root, path.join(root, 'missing.docx')), false)
  if (process.platform === 'win32') assert.equal(isProbeArtifactContained(root.toUpperCase(), inside.toLowerCase()), true)
})

test('real CLI writes MODEL_REQUIRED report without launching a model when config is absent', t => {
  const root = directory(t)
  const report = path.join(root, 'report.json')
  const missing = path.join(root, 'absent.json')
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('../probe-office-real-model-delivery.mjs', import.meta.url)), '--config', missing, `--report=${report}`], { encoding: 'utf8', windowsHide: true, timeout: 30000 })
  assert.equal(child.status, 1, child.stderr)
  const result = JSON.parse(fs.readFileSync(report, 'utf8'))
  assert.equal(result.code, 'MODEL_REQUIRED')
  assert.equal(result.modelContacted, false)
  assert.deepEqual(fs.readdirSync(root), ['report.json'])
})
