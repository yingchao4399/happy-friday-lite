import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { captureOfficeHtmlUpstreamSource, OFFICIAL_HTML_REPOSITORY, readOfficeHtmlUpstreamLock,
  syncOfficeHtmlUpstream, validateOfficeHtmlUpstream } from '../office/html-upstream.mjs'
import { parseOfficeHtmlUpstreamArguments } from '../sync-office-html-upstream.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
const has = (result, code) => assert.ok(result.issues.some(item => item.code === code), JSON.stringify(result.issues))
const git = (root, ...args) => {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, timeout: 30000 })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trimEnd()
}

function fixture(t) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-html-upstream-'))
  t.after(() => {
    assert.equal(path.dirname(projectRoot), path.resolve(os.tmpdir()))
    fs.rmSync(projectRoot, { recursive: true, force: true })
  })
  const seedRepository = path.join(projectRoot, 'seed')
  const sourceRoot = path.join(projectRoot, 'vendor', 'genoffice-html')
  const lockFile = path.join(projectRoot, 'office-html-upstream.lock.json')
  fs.mkdirSync(seedRepository)
  git(seedRepository, 'init', '--quiet')
  git(seedRepository, 'config', 'user.name', 'HTML upstream fixture')
  git(seedRepository, 'config', 'user.email', 'html-upstream@example.invalid')
  git(seedRepository, 'config', 'commit.gpgsign', 'false')
  git(seedRepository, 'config', 'core.autocrlf', 'false')
  fs.writeFileSync(path.join(seedRepository, '.gitignore'), 'node_modules/\nout/\n')
  fs.writeFileSync(path.join(seedRepository, 'source.ts'), 'export const html = true\n')
  json(path.join(seedRepository, 'package-lock.json'), { lockfileVersion: 3, name: 'html-fixture' })
  git(seedRepository, 'add', '.')
  git(seedRepository, 'commit', '--quiet', '-m', 'fixed fixture')
  const sha = git(seedRepository, 'rev-parse', 'HEAD')
  git(seedRepository, 'tag', 'v0.12.852')
  const lock = { schemaVersion: 1, officialRepository: OFFICIAL_HTML_REPOSITORY, tag: 'v0.12.852', sha,
    sourceRoot: 'vendor/genoffice-html', purpose: 'html-only', editors: ['html'],
    packageLockSha256: digest(fs.readFileSync(path.join(seedRepository, 'package-lock.json'))) }
  const saveLock = () => json(lockFile, lock)
  saveLock()
  const options = { projectRoot, seedRepository }
  const sync = () => syncOfficeHtmlUpstream(options)
  const create = () => {
    const result = sync()
    assert.equal(result.ok, true, JSON.stringify(result))
    return result
  }
  return { projectRoot, seedRepository, sourceRoot, lockFile, lock, sha, saveLock, options, sync, create }
}

test('固定源码通过独立 clone 获取并可脱离 seed 使用，重复同步只读复用', t => {
  const f = fixture(t)
  const created = f.create()
  assert.equal(created.created, true)
  assert.equal(created.source.sha, f.sha)
  assert.equal(created.source.scope, 'genoffice-html-source-v1')
  assert.equal(created.source.dirty, false)
  assert.equal(created.source.lockSha256, digest(fs.readFileSync(f.lockFile)))
  assert.equal(git(f.sourceRoot, 'remote', 'get-url', 'origin'), OFFICIAL_HTML_REPOSITORY)
  assert.equal(fs.existsSync(path.join(f.sourceRoot, '.git', 'objects', 'info', 'alternates')), false)
  fs.rmSync(f.seedRepository, { recursive: true, force: true })
  const checked = validateOfficeHtmlUpstream({ projectRoot: f.projectRoot })
  assert.equal(checked.ok, true, JSON.stringify(checked.issues))
  const reused = f.sync()
  assert.equal(reused.ok, true)
  assert.equal(reused.created, false)
  assert.equal(reused.reused, true)
  assert.deepEqual(captureOfficeHtmlUpstreamSource({ projectRoot: f.projectRoot }), checked.source)
})

test('真实 tracked 与 untracked 修改进入摘要并阻止同步覆盖', t => {
  const f = fixture(t)
  f.create()
  const before = captureOfficeHtmlUpstreamSource(f.options)
  const tracked = path.join(f.sourceRoot, 'source.ts')
  const untracked = path.join(f.sourceRoot, '新建 文件.ts')
  fs.appendFileSync(tracked, 'export const local = true\n')
  fs.writeFileSync(untracked, 'first')
  const changed = captureOfficeHtmlUpstreamSource(f.options)
  assert.equal(changed.dirty, true)
  assert.notEqual(changed.diffDigest, before.diffDigest)
  assert.notEqual(changed.untrackedSourceDigest, before.untrackedSourceDigest)
  fs.writeFileSync(untracked, 'second')
  assert.notEqual(captureOfficeHtmlUpstreamSource(f.options).untrackedSourceDigest, changed.untrackedSourceDigest)
  const expected = fs.readFileSync(tracked)
  has(f.sync(), 'OFFICE_HTML_SOURCE_DIRTY')
  assert.deepEqual(fs.readFileSync(tracked), expected)
  assert.equal(fs.readFileSync(untracked, 'utf8'), 'second')
})

test('已暂存改动仍是 dirty，生成依赖和 out 保持在源码身份之外', t => {
  const f = fixture(t)
  f.create()
  fs.mkdirSync(path.join(f.sourceRoot, 'node_modules'))
  fs.mkdirSync(path.join(f.sourceRoot, 'out'))
  fs.writeFileSync(path.join(f.sourceRoot, 'node_modules', 'generated.js'), 'dependency')
  fs.writeFileSync(path.join(f.sourceRoot, 'out', 'generated.js'), 'bundle')
  assert.equal(validateOfficeHtmlUpstream(f.options).ok, true)
  fs.appendFileSync(path.join(f.sourceRoot, 'source.ts'), 'staged\n')
  git(f.sourceRoot, 'add', 'source.ts')
  has(validateOfficeHtmlUpstream(f.options), 'OFFICE_HTML_SOURCE_DIRTY')
})

test('已有不同 SHA 的 clean tree 不被 checkout 或 reset', t => {
  const f = fixture(t)
  f.create()
  git(f.sourceRoot, 'config', 'user.name', 'HTML fixture')
  git(f.sourceRoot, 'config', 'user.email', 'html-fixture@example.invalid')
  git(f.sourceRoot, 'config', 'commit.gpgsign', 'false')
  fs.appendFileSync(path.join(f.sourceRoot, 'source.ts'), 'another commit\n')
  git(f.sourceRoot, 'add', '.')
  git(f.sourceRoot, 'commit', '--quiet', '-m', 'different source')
  const next = git(f.sourceRoot, 'rev-parse', 'HEAD')
  has(f.sync(), 'OFFICE_HTML_HEAD_MISMATCH')
  assert.equal(git(f.sourceRoot, 'rev-parse', 'HEAD'), next)
  assert.equal(git(f.sourceRoot, 'status', '--porcelain'), '')
})

test('origin 必须是官方精确 URL，返回的诊断不泄露凭据', t => {
  const f = fixture(t)
  f.create()
  git(f.sourceRoot, 'remote', 'set-url', 'origin', 'https://private-user:private-password@github.com/genspark-ai/genoffice.git')
  const result = validateOfficeHtmlUpstream(f.options)
  has(result, 'OFFICE_HTML_ORIGIN_MISMATCH')
  assert.equal(JSON.stringify(result).includes('private-user'), false)
  assert.equal(JSON.stringify(result).includes('private-password'), false)
  assert.equal(result.source.remotes.origin, OFFICIAL_HTML_REPOSITORY)
})

test('本地 tag 必须与锁定 commit 一致，不能只看 HEAD', t => {
  const f = fixture(t)
  f.create()
  git(f.sourceRoot, 'tag', '-d', 'v0.12.852')
  has(validateOfficeHtmlUpstream(f.options), 'OFFICE_HTML_TAG_MISMATCH')
})

test('真实 package-lock 缺失或被替换时锁校验失败', t => {
  const f = fixture(t)
  f.create()
  const file = path.join(f.sourceRoot, 'package-lock.json')
  fs.writeFileSync(file, '{}\n')
  has(validateOfficeHtmlUpstream(f.options), 'OFFICE_HTML_PACKAGE_LOCK_MISMATCH')
  fs.unlinkSync(file)
  has(validateOfficeHtmlUpstream(f.options), 'OFFICE_HTML_PACKAGE_LOCK_MISSING')
})

test('已有空目录或普通文件不被当成可覆盖的同步目标', async t => {
  for (const kind of ['directory', 'file']) await t.test(kind, () => {
    const f = fixture(t)
    fs.mkdirSync(path.dirname(f.sourceRoot))
    if (kind === 'directory') fs.mkdirSync(f.sourceRoot)
    else fs.writeFileSync(f.sourceRoot, 'keep-existing-file')
    assert.equal(f.sync().ok, false)
    if (kind === 'directory') assert.deepEqual(fs.readdirSync(f.sourceRoot), [])
    else assert.equal(fs.readFileSync(f.sourceRoot, 'utf8'), 'keep-existing-file')
  })
})

test('损坏的锁、用途、路径或官方地址在触碰目标前拒绝', async t => {
  for (const [key, value, code] of [
    ['schemaVersion', 99, 'OFFICE_HTML_LOCK_SCHEMA_UNSUPPORTED'],
    ['officialRepository', 'https://example.invalid/genoffice.git', 'OFFICE_HTML_REPOSITORY_MISMATCH'],
    ['tag', '--upload-pack=bad', 'OFFICE_HTML_TAG_INVALID'],
    ['sha', 'bad', 'OFFICE_HTML_SHA_INVALID'],
    ['sourceRoot', '../elsewhere', 'OFFICE_HTML_SOURCE_PATH_INVALID'],
    ['purpose', 'all-office', 'OFFICE_HTML_PURPOSE_INVALID'],
    ['editors', ['html', 'pdf'], 'OFFICE_HTML_PURPOSE_INVALID'],
    ['packageLockSha256', 'bad', 'OFFICE_HTML_PACKAGE_LOCK_DIGEST_INVALID'],
  ]) await t.test(key, () => {
    const f = fixture(t)
    f.lock[key] = value
    f.saveLock()
    has(f.sync(), code)
    assert.equal(fs.existsSync(f.sourceRoot), false)
  })
  const f = fixture(t)
  fs.writeFileSync(f.lockFile, '{bad')
  has(validateOfficeHtmlUpstream(f.options), 'OFFICE_HTML_LOCK_INVALID')
  fs.unlinkSync(f.lockFile)
  has(f.sync(), 'OFFICE_HTML_LOCK_MISSING')
})

test('clone 或 checkout 失败保留 staging，不发布半成品且释放同步锁', t => {
  const f = fixture(t)
  f.lock.sha = 'f'.repeat(40)
  f.saveLock()
  const result = f.sync()
  assert.equal(result.ok, false)
  assert.equal(result.created, false)
  assert.equal(fs.existsSync(f.sourceRoot), false)
  assert.equal(path.dirname(result.preservedStagingRoot), path.join(f.projectRoot, 'vendor'))
  assert.equal(fs.existsSync(path.join(result.preservedStagingRoot, '.git')), true)
  assert.equal(fs.existsSync(path.join(f.projectRoot, 'vendor', '.genoffice-html-sync.lock')), false)
})

test('独立同步锁阻止并发创建，已有锁不会被删除', t => {
  const f = fixture(t)
  fs.mkdirSync(path.join(f.projectRoot, 'vendor'))
  const guard = path.join(f.projectRoot, 'vendor', '.genoffice-html-sync.lock')
  fs.writeFileSync(guard, 'another synchronization')
  has(f.sync(), 'OFFICE_HTML_SYNC_BUSY')
  assert.equal(fs.readFileSync(guard, 'utf8'), 'another synchronization')
})

test('显式 sourceRoot 不能绕过固定 checkout 路径', t => {
  const f = fixture(t)
  has(syncOfficeHtmlUpstream({ ...f.options, sourceRoot: f.seedRepository }), 'OFFICE_HTML_SOURCE_PATH_MISMATCH')
  assert.equal(git(f.seedRepository, 'rev-parse', 'HEAD'), f.sha)
})

test('CLI 只接受明确的只读验证或绝对路径 seed 参数', () => {
  assert.deepEqual(parseOfficeHtmlUpstreamArguments([]), { verify: false, options: {} })
  assert.deepEqual(parseOfficeHtmlUpstreamArguments(['--verify']), { verify: true, options: {} })
  const seed = path.resolve('seed')
  assert.deepEqual(parseOfficeHtmlUpstreamArguments(['--seed', seed]), { verify: false, options: { seedRepository: seed } })
  for (const args of [['--unknown'], ['--verify', '--verify'], ['--verify', '--seed', seed], ['--seed', seed, '--seed', seed]]) {
    assert.throws(() => parseOfficeHtmlUpstreamArguments(args), { code: 'OFFICE_HTML_SYNC_ARGUMENT_INVALID' })
  }
  for (const args of [['--seed'], ['--seed', 'relative'], ['--seed', '--verify']]) {
    assert.throws(() => parseOfficeHtmlUpstreamArguments(args), { code: 'OFFICE_HTML_SEED_ABSOLUTE_REQUIRED' })
  }
})

test('实际 CLI 的错误是结构化非零退出，不受当前工作目录影响', () => {
  const script = fileURLToPath(new URL('../sync-office-html-upstream.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [script, '--unknown'], { cwd: os.tmpdir(), encoding: 'utf8', windowsHide: true, timeout: 30000 })
  assert.equal(result.status, 1)
  assert.equal(JSON.parse(result.stdout).code, 'OFFICE_HTML_SYNC_ARGUMENT_INVALID')
})
