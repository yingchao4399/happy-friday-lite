import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import AdmZip from 'adm-zip'
import { acknowledgeOfficeDelivery, deliverOfficeArtifact, officeFault, prepareOfficeTarget, sha256, validateDocx, recoverOfficeDeliveries } from '../../src-electron/office/artifact-delivery.js'

function docxBytes(text = 'delivery fixture', relationshipTarget = 'word/document.xml') {
  const zip = new AdmZip()
  zip.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'))
  zip.addFile('_rels/.rels', Buffer.from(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${relationshipTarget}"/></Relationships>`))
  zip.addFile('word/document.xml', Buffer.from(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`))
  return zip.toBuffer()
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-office-delivery-'))
  const journalDir = path.join(root, 'journal')
  await fs.mkdir(journalDir)
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return { root, journalDir }
}

test('DOCX validation rejects malformed XML, missing relationships and unsafe targets', () => {
  assert.equal(validateDocx(docxBytes()).valid, true)
  const malformed = new AdmZip(docxBytes())
  malformed.updateFile('word/document.xml', Buffer.from('<w:document>'))
  assert.throws(() => validateDocx(malformed.toBuffer()), { code: 'OFFICE_DOCX_XML_INVALID' })
  assert.throws(() => validateDocx(docxBytes('x', '../word/document.xml')), { code: 'OFFICE_DOCX_RELATIONSHIP_INVALID' })
  assert.throws(() => validateDocx(Buffer.from('not a zip')), { code: 'OFFICE_DOCX_ZIP_INVALID' })
})

test('target preparation freezes source identity and rejects source overwrite', async t => {
  const f = await fixture(t)
  const source = path.join(f.root, 'source.docx')
  await fs.writeFile(source, docxBytes('source'))
  await assert.rejects(prepareOfficeTarget(source, { sourcePath: source }), { code: 'OFFICE_SOURCE_OVERWRITE' })
  const target = await prepareOfficeTarget(path.join(f.root, 'result.docx'), { sourcePath: source, allowedRoot: f.root })
  await fs.writeFile(path.join(f.root, 'result.docx'), docxBytes('raced target'))
  await assert.rejects(deliverOfficeArtifact({ bytes: docxBytes(), target, taskId: 'task-source-race', operationIdentity: 'op-source-race', journalDir: f.journalDir }), { code: 'OFFICE_TARGET_CHANGED' })
})

test('cancel before commit leaves no target while cancel after commit preserves delivery', async t => {
  const f = await fixture(t)
  const before = await prepareOfficeTarget(path.join(f.root, 'before.docx'), { allowedRoot: f.root })
  const signalBefore = new AbortController()
  await assert.rejects(deliverOfficeArtifact({ bytes: docxBytes(), target: before, taskId: 'task-before', operationIdentity: 'op-before', journalDir: f.journalDir,
    onPhase: async phase => { if (phase === 'committing') signalBefore.abort() }, signal: signalBefore.signal }), { code: 'OFFICE_OPERATION_CANCELLED' })
  await assert.rejects(fs.stat(before.path), { code: 'ENOENT' })

  const after = await prepareOfficeTarget(path.join(f.root, 'after.docx'), { allowedRoot: f.root })
  const signalAfter = new AbortController()
  const delivered = await deliverOfficeArtifact({ bytes: docxBytes('after'), target: after, taskId: 'task-after', operationIdentity: 'op-after', journalDir: f.journalDir,
    faultInjection: async phase => { if (phase === 'committed') signalAfter.abort() }, signal: signalAfter.signal })
  assert.equal(delivered.persisted, true)
  assert.equal(sha256(await fs.readFile(after.path)), delivered.sha256)
  await acknowledgeOfficeDelivery({ journalDir: f.journalDir, artifact: delivered })
})

test('journal recovery restores an old target and reconciles a committed artifact', async t => {
  const f = await fixture(t)
  const original = docxBytes('original')
  const targetPath = path.join(f.root, 'existing.docx')
  await fs.writeFile(targetPath, original)
  const target = await prepareOfficeTarget(targetPath, { allowedRoot: f.root, allowOverwrite: true })
  await assert.rejects(deliverOfficeArtifact({ bytes: docxBytes('replacement'), target, taskId: 'task-backup', operationIdentity: 'op-backup', journalDir: f.journalDir,
    faultInjection: async phase => { if (phase === 'backed-up') throw officeFault('TEST_CRASH') } }), { code: 'TEST_CRASH' })
  assert.deepEqual(await fs.readFile(targetPath), original)
  assert.equal((await fs.readdir(f.journalDir)).length, 0)

  const target2 = await prepareOfficeTarget(path.join(f.root, 'committed.docx'), { allowedRoot: f.root })
  await assert.rejects(deliverOfficeArtifact({ bytes: docxBytes('committed'), target: target2, taskId: 'task-commit', operationIdentity: 'op-commit', journalDir: f.journalDir,
    faultInjection: async phase => { if (phase === 'committed') throw officeFault('TEST_CRASH_AFTER_COMMIT') } }), { code: 'TEST_CRASH_AFTER_COMMIT' })
  const recovered = await recoverOfficeDeliveries(f.journalDir, { scope: { actorId: 'user:local', spaceId: 'friday' } })
  // 无所属空间的 journal 不得由某个空间的恢复流程处理。
  assert.deepEqual(recovered, [])
  const all = await recoverOfficeDeliveries(f.journalDir)
  assert.equal(all[0].status, 'delivered')
  assert.equal(all[0].operationIdentity, 'op-commit')
  await acknowledgeOfficeDelivery({ journalDir: f.journalDir, artifact: all[0].artifact })
  assert.deepEqual(await fs.readdir(f.journalDir), [])
})

test('a real process exit at every durable phase preserves old files or a verified new delivery', async t => {
  const f = await fixture(t)
  const childFile = path.join(f.root, 'crash-delivery.mjs')
  const deliveryUrl = new URL('../../src-electron/office/artifact-delivery.js', import.meta.url).href
  // 子进程直接退出，不执行 catch/finally；验证的是启动恢复而非异常回滚。
  await fs.writeFile(childFile, `
import fs from 'node:fs/promises'
import { deliverOfficeArtifact, prepareOfficeTarget } from ${JSON.stringify(deliveryUrl)}
const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'))
const bytes = await fs.readFile(config.bytesFile)
const target = await prepareOfficeTarget(config.targetPath, { allowedRoot: config.directory, allowOverwrite: config.overwrite })
await deliverOfficeArtifact({ bytes, target, taskId: config.taskId, operationIdentity: config.operationIdentity,
  scope: { actorId: 'user:local', spaceId: 'friday' }, journalDir: config.journalDir,
  faultInjection: async phase => { if (phase === config.phase) process.exit(73) } })
process.exit(74)
`)
  const original = docxBytes('original crash fixture')
  const replacement = docxBytes('replacement crash fixture')
  const bytesFile = path.join(f.root, 'replacement.docx')
  await fs.writeFile(bytesFile, replacement)
  const phases = ['prepared', 'temp-written', 'backup-planned', 'backed-up', 'commit-planned', 'committed', 'verified']
  for (const overwrite of [false, true]) {
    for (const phase of phases.filter(phase => overwrite || !['backup-planned', 'backed-up'].includes(phase))) {
      await t.test(`${overwrite ? 'existing' : 'new'} target: ${phase}`, async () => {
        const directory = path.join(f.root, `${overwrite ? 'existing' : 'new'}-${phase}`)
        await fs.mkdir(directory)
        const journalDir = path.join(directory, 'journal')
        const targetPath = path.join(directory, 'result.docx')
        const sentinel = path.join(directory, 'unrelated.txt')
        await fs.writeFile(sentinel, 'unrelated user file')
        if (overwrite) await fs.writeFile(targetPath, original)
        const taskId = `task-${overwrite}-${phase}`
        const operationIdentity = `operation-${overwrite}-${phase}`
        const configFile = path.join(directory, 'config.json')
        await fs.writeFile(configFile, JSON.stringify({ bytesFile, targetPath, overwrite, directory, journalDir, phase, taskId, operationIdentity }))
        const crashed = spawnSync(process.execPath, [childFile, configFile], { encoding: 'utf8', timeout: 15000, windowsHide: true, cwd: f.root })
        assert.equal(crashed.status, 73, crashed.stderr || String(crashed.error))
        const journals = (await fs.readdir(journalDir)).filter(name => name.endsWith('.json'))
        assert.equal(journals.length, 1)
        assert.equal(JSON.parse(await fs.readFile(path.join(journalDir, journals[0]), 'utf8')).phase, phase)
        const recovered = await recoverOfficeDeliveries(journalDir, { scope: { actorId: 'user:local', spaceId: 'friday' } })
        assert.equal(recovered.length, 1)
        assert.equal(recovered[0].taskId, taskId)
        assert.equal(recovered[0].operationIdentity, operationIdentity)
        const committed = ['committed', 'verified'].includes(phase)
        assert.equal(recovered[0].status, committed ? 'delivered' : overwrite && ['backed-up', 'commit-planned'].includes(phase) ? 'restored' : 'interrupted')
        if (committed) {
          assert.deepEqual(await fs.readFile(targetPath), replacement)
          assert.equal(recovered[0].artifact.sha256, sha256(replacement))
          assert.equal(recovered[0].artifact.validation.valid, true)
          assert.equal((await fs.readdir(journalDir)).filter(name => name.endsWith('.json')).length, 1, '任务持久化确认前必须保留交付 journal')
          await acknowledgeOfficeDelivery({ journalDir, artifact: recovered[0].artifact })
        } else if (overwrite) assert.deepEqual(await fs.readFile(targetPath), original)
        else await assert.rejects(fs.stat(targetPath), { code: 'ENOENT' })
        assert.equal(await fs.readFile(sentinel, 'utf8'), 'unrelated user file')
        assert.deepEqual(await fs.readdir(journalDir), [])
        assert.deepEqual((await fs.readdir(directory)).filter(name => name.startsWith('.friday-office-')), [])
        assert.deepEqual(await recoverOfficeDeliveries(journalDir), [], '恢复再次执行必须无副作用')
      })
    }
  }
})

test('a replaced target directory is rejected before any output is written', async t => {
  const f = await fixture(t)
  const directory = path.join(f.root, 'target-directory')
  await fs.mkdir(directory)
  const target = await prepareOfficeTarget(path.join(directory, 'result.docx'), { allowedRoot: f.root })
  await fs.rename(directory, path.join(f.root, 'original-directory'))
  await fs.mkdir(directory)
  await assert.rejects(deliverOfficeArtifact({ bytes: docxBytes(), target, taskId: 'task-directory-race', journalDir: f.journalDir }), { code: 'OFFICE_TARGET_CHANGED' })
  assert.deepEqual(await fs.readdir(directory), [])
  assert.deepEqual(await fs.readdir(f.journalDir), [])
})

test('sandbox junctions cannot escape during preparation or replace a frozen directory', async t => {
  const f = await fixture(t)
  const sandbox = path.join(f.root, 'sandbox')
  const outside = path.join(f.root, 'outside')
  await fs.mkdir(sandbox)
  await fs.mkdir(outside)
  const sentinel = path.join(outside, 'sentinel.txt')
  await fs.writeFile(sentinel, 'outside must stay unchanged')
  const linked = path.join(sandbox, 'linked')
  await fs.symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(prepareOfficeTarget(path.join(linked, 'escape.docx'), { allowedRoot: sandbox }), { code: 'OFFICE_OUTPUT_OUTSIDE_SANDBOX' })
  const directory = path.join(sandbox, 'frozen')
  await fs.mkdir(directory)
  const target = await prepareOfficeTarget(path.join(directory, 'result.docx'), { allowedRoot: sandbox })
  await fs.rename(directory, path.join(sandbox, 'original-frozen'))
  await fs.symlink(outside, directory, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(deliverOfficeArtifact({ bytes: docxBytes(), target, taskId: 'task-junction-race', journalDir: f.journalDir }), { code: 'OFFICE_TARGET_CHANGED' })
  assert.deepEqual(await fs.readdir(outside), ['sentinel.txt'])
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'outside must stay unchanged')
})

test('a hard link to the source is never accepted as an overwrite destination', async t => {
  const f = await fixture(t)
  const source = path.join(f.root, 'source.docx')
  const alias = path.join(f.root, 'alias.docx')
  const bytes = docxBytes('source hard link fixture')
  await fs.writeFile(source, bytes)
  await fs.link(source, alias)
  await assert.rejects(prepareOfficeTarget(alias, { sourcePath: source, allowOverwrite: true }), { code: 'OFFICE_SOURCE_OVERWRITE' })
  assert.deepEqual(await fs.readFile(source), bytes)
})

test('concurrent deliveries to the same target cannot replace the running owner', async t => {
  const f = await fixture(t)
  const target = await prepareOfficeTarget(path.join(f.root, 'shared.docx'), { allowedRoot: f.root })
  let started, resume
  const prepared = new Promise(resolve => { started = resolve })
  const proceed = new Promise(resolve => { resume = resolve })
  const ownerBytes = docxBytes('first delivery owns this target')
  const owner = deliverOfficeArtifact({ bytes: ownerBytes, target, taskId: 'task-lock-owner', journalDir: f.journalDir,
    faultInjection: async phase => { if (phase === 'prepared') { started(); await proceed } } })
  await prepared
  try {
    await assert.rejects(deliverOfficeArtifact({ bytes: docxBytes('second must not write'), target, taskId: 'task-lock-contender', journalDir: f.journalDir }), { code: 'OFFICE_TARGET_BUSY' })
  } finally { resume() }
  const artifact = await owner
  assert.equal(artifact.persisted, true)
  assert.deepEqual(await fs.readFile(target.path), ownerBytes)
  await acknowledgeOfficeDelivery({ journalDir: f.journalDir, artifact })
  assert.deepEqual(await fs.readdir(f.journalDir), [])
})

test('recovery preserves target, backup and journal when a committed target was externally replaced', async t => {
  const f = await fixture(t)
  const targetPath = path.join(f.root, 'changed-after-commit.docx')
  const original = docxBytes('original preserved backup')
  await fs.writeFile(targetPath, original)
  const target = await prepareOfficeTarget(targetPath, { allowedRoot: f.root, allowOverwrite: true })
  await assert.rejects(deliverOfficeArtifact({ bytes: docxBytes('committed output'), target, taskId: 'task-changed-after-commit', journalDir: f.journalDir,
    faultInjection: async phase => { if (phase === 'committed') throw officeFault('TEST_CRASH_AFTER_COMMIT') } }), { code: 'TEST_CRASH_AFTER_COMMIT' })
  const [journalName] = (await fs.readdir(f.journalDir)).filter(name => name.endsWith('.json'))
  const journalPath = path.join(f.journalDir, journalName)
  const journal = JSON.parse(await fs.readFile(journalPath, 'utf8'))
  const external = docxBytes('external content must not be overwritten')
  // 先解除目标的 hard link，再模拟另一个应用保存新文件。
  await fs.unlink(targetPath)
  await fs.writeFile(targetPath, external)
  const [recovered] = await recoverOfficeDeliveries(f.journalDir)
  assert.equal(recovered.status, 'recovery-required')
  assert.equal(recovered.code, 'OFFICE_RECOVERY_REQUIRES_REVIEW')
  assert.deepEqual(await fs.readFile(targetPath), external)
  assert.deepEqual(await fs.readFile(journal.backup), original)
  assert.equal((await fs.stat(journalPath)).isFile(), true)
  assert.equal((await fs.stat(journal.temporary)).isFile(), true)
})

test('recovery refuses to delete a backup whose original identity changed', async t => {
  const f = await fixture(t)
  const targetPath = path.join(f.root, 'backup-changed.docx')
  await fs.writeFile(targetPath, docxBytes('original'))
  const replacement = docxBytes('committed output')
  const target = await prepareOfficeTarget(targetPath, { allowedRoot: f.root, allowOverwrite: true })
  await assert.rejects(deliverOfficeArtifact({ bytes: replacement, target, taskId: 'task-backup-changed', journalDir: f.journalDir,
    faultInjection: async phase => { if (phase === 'committed') throw officeFault('TEST_CRASH_AFTER_COMMIT') } }), { code: 'TEST_CRASH_AFTER_COMMIT' })
  const [journalName] = (await fs.readdir(f.journalDir)).filter(name => name.endsWith('.json'))
  const journalPath = path.join(f.journalDir, journalName)
  const journal = JSON.parse(await fs.readFile(journalPath, 'utf8'))
  const changedBackup = docxBytes('externally changed backup must remain')
  await fs.writeFile(journal.backup, changedBackup)
  const [recovered] = await recoverOfficeDeliveries(f.journalDir)
  assert.equal(recovered.status, 'recovery-required')
  assert.equal(recovered.code, 'OFFICE_RECOVERY_BACKUP_CHANGED')
  assert.deepEqual(await fs.readFile(targetPath), replacement)
  assert.deepEqual(await fs.readFile(journal.backup), changedBackup)
  assert.equal((await fs.stat(journalPath)).isFile(), true)
})

test('verified journals survive process exits after delivery return and recovery return until task persistence is acknowledged', async t => {
  const f = await fixture(t)
  const childFile = path.join(f.root, 'exit-after-return.mjs')
  const deliveryUrl = new URL('../../src-electron/office/artifact-delivery.js', import.meta.url).href
  await fs.writeFile(childFile, `
import fs from 'node:fs/promises'
import { deliverOfficeArtifact, prepareOfficeTarget, recoverOfficeDeliveries } from ${JSON.stringify(deliveryUrl)}
const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'))
const scope = { actorId: 'user:local', spaceId: 'friday' }
if (config.mode === 'deliver') {
  const target = await prepareOfficeTarget(config.targetPath, { allowedRoot: config.root, allowOverwrite: true })
  const artifact = await deliverOfficeArtifact({ bytes: await fs.readFile(config.bytesFile), target, taskId: 'task-return-gap', operationIdentity: 'operation-return-gap', scope, journalDir: config.journalDir })
  await fs.writeFile(config.returnedFile, JSON.stringify(artifact))
  process.exit(83)
}
const recovered = await recoverOfficeDeliveries(config.journalDir, { scope })
await fs.writeFile(config.returnedFile, JSON.stringify(recovered))
process.exit(84)
`)
  const targetPath = path.join(f.root, 'returned.docx')
  const bytesFile = path.join(f.root, 'new-bytes.docx')
  const original = docxBytes('original before cross-layer gap')
  const replacement = docxBytes('verified artifact before task persistence')
  await fs.writeFile(targetPath, original)
  await fs.writeFile(bytesFile, replacement)
  const configFile = path.join(f.root, 'config.json')
  const returnedFile = path.join(f.root, 'returned.json')
  const config = { root: f.root, journalDir: f.journalDir, targetPath, bytesFile, returnedFile }
  await fs.writeFile(configFile, JSON.stringify({ ...config, mode: 'deliver' }))
  const first = spawnSync(process.execPath, [childFile, configFile], { encoding: 'utf8', timeout: 15000, windowsHide: true })
  assert.equal(first.status, 83, first.stderr || String(first.error))
  const returned = JSON.parse(await fs.readFile(returnedFile, 'utf8'))
  assert.equal(returned.persisted, true)
  assert.deepEqual(await fs.readFile(targetPath), replacement)
  const [journalName] = (await fs.readdir(f.journalDir)).filter(name => name.endsWith('.json'))
  const journalPath = path.join(f.journalDir, journalName)
  const journal = JSON.parse(await fs.readFile(journalPath, 'utf8'))
  assert.equal(journal.phase, 'verified')
  assert.deepEqual(await fs.readFile(journal.backup), original)

  await fs.writeFile(configFile, JSON.stringify({ ...config, mode: 'recover' }))
  const second = spawnSync(process.execPath, [childFile, configFile], { encoding: 'utf8', timeout: 15000, windowsHide: true })
  assert.equal(second.status, 84, second.stderr || String(second.error))
  const [firstRecovery] = JSON.parse(await fs.readFile(returnedFile, 'utf8'))
  assert.equal(firstRecovery.status, 'delivered')
  assert.equal(firstRecovery.artifact.id, returned.id)
  assert.equal((await fs.stat(journalPath)).isFile(), true, '恢复返回之后、任务持久化之前仍须保留 journal')
  assert.deepEqual(await fs.readFile(journal.backup), original)

  const [secondRecovery] = await recoverOfficeDeliveries(f.journalDir, { scope: { actorId: 'user:local', spaceId: 'friday' } })
  assert.equal(secondRecovery.status, 'delivered')
  assert.equal(secondRecovery.artifact.id, returned.id)
  assert.equal(secondRecovery.artifact.sha256, sha256(replacement))
  await acknowledgeOfficeDelivery({ journalDir: f.journalDir, artifact: secondRecovery.artifact })
  assert.deepEqual(await fs.readdir(f.journalDir), [])
  await assert.rejects(fs.stat(journal.backup), { code: 'ENOENT' })
  await assert.rejects(fs.stat(journal.temporary), { code: 'ENOENT' })
  assert.deepEqual(await recoverOfficeDeliveries(f.journalDir), [])
  assert.deepEqual(await fs.readFile(targetPath), replacement)
})
