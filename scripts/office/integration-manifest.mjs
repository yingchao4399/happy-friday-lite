import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { OFFICE_ADAPTER_VERSION, OFFICE_HOST_PROTOCOL_VERSION, OFFICE_REQUIRED_RESOURCES, OFFICE_SUPPORT_SERVICES, getBuildOfficeEditors } from '../../src-electron/office/editor-registry.js'
import { calculateOfficeSourceIdentity, isOfficeInventoryPlaceholder, OFFICE_MANIFEST_FILE } from '../../src-electron/office/bundle-contract.js'
import { captureOfficeUpstreamProvenance } from './upstream-lock.mjs'
import { captureOfficeHtmlUpstreamSource } from './html-upstream.mjs'

const digest = value => createHash('sha256').update(value).digest('hex')
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
const portable = value => value.split(path.sep).join('/')

function git(root, args, { optional = false, raw = false } = {}) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: raw ? null : 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true })
  if (result.status !== 0) {
    if (optional) return raw ? Buffer.alloc(0) : ''
    throw new Error(`OFFICE_SOURCE_IDENTITY_UNAVAILABLE: ${args[0]}`)
  }
  return raw ? result.stdout : result.stdout.trimEnd()
}

function sanitizedRemote(value) {
  // 元数据不保留 URL 内的用户名、口令、查询或片段。
  try { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href } catch {
    return /^git@[\w.-]+:[\w./-]+$/.test(value) ? value : null
  }
}

function sourceIdentity(root, main = false) {
  const sha = git(root, ['rev-parse', 'HEAD'])
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('OFFICE_SOURCE_IDENTITY_INVALID')
  // dirty 用于发布门禁；repositoryDirty 保留全仓库审计事实。构建输入身份不
  // 包括 resources/、out/、stageSkill 等生成物，防止生成自身改变构建身份。
  const inputs = main ? ['src-electron', 'scripts', 'src', 'main.js', 'preload.cjs', 'package.json', 'package-lock.json', 'office-upstream.lock.json', 'office-vendor-patches.json', 'office-html-upstream.lock.json'] : [
    '.', ':(exclude)**/out/**', ':(exclude)**/dist/**', ':(exclude)**/target/**',
    ':(exclude)packages/electron-utils/native/system-print.exe',
    ':(exclude)packages/pdf2docx/ocr-helper/win-ocr.exe', ':(exclude)packages/pdf2docx/ocr-helper/vision-ocr',
  ]
  const repositoryStatus = git(root, ['status', '--porcelain=v1', '--untracked-files=normal', '-z'], { raw: true })
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all', '-z', '--', ...inputs], { raw: true })
  const changes = git(root, ['diff', '--binary', 'HEAD', '--', ...inputs], { raw: true })
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...inputs], { raw: true }).toString('utf8').split('\0').filter(Boolean)
  const files = untracked.sort(compare).map(file => {
    const absolute = path.join(root, file)
    const stat = fs.lstatSync(absolute)
    return { path: file, sha256: digest(stat.isSymbolicLink() ? fs.readlinkSync(absolute) : fs.readFileSync(absolute)) }
  })
  const remotes = Object.fromEntries(git(root, ['remote']).split(/\r?\n/).filter(Boolean).sort(compare)
    .map(name => [name, sanitizedRemote(git(root, ['remote', 'get-url', name], { optional: true }))]))
  return { sha, describe: git(root, ['describe', '--tags', '--always'], { optional: true }) || sha,
    scope: main ? 'friday-runtime-and-build-v1' : 'vendor-source-v1', dirty: status.length > 0,
    repositoryDirty: repositoryStatus.length > 0, diffDigest: digest(changes), untrackedSourceDigest: digest(JSON.stringify(files)), remotes }
}

export function captureOfficeSources(root, vendorRoot, { experimentalHtml = false } = {}) {
  const sources = { main: sourceIdentity(root, true), vendor: sourceIdentity(vendorRoot) }
  if (experimentalHtml === true) sources.html = captureOfficeHtmlUpstreamSource({ projectRoot: root })
  return { ...sources, identityDigest: calculateOfficeSourceIdentity(sources) }
}

export function inventoryOfficeResources(root) {
  const resources = []
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => compare(a.name, b.name))) {
      const absolute = path.join(directory, entry.name)
      const relative = portable(path.relative(root, absolute))
      if (relative === OFFICE_MANIFEST_FILE) continue
      if (entry.isSymbolicLink()) throw new Error(`OFFICE_RESOURCE_SYMLINK: ${relative}`)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(absolute)
        if (isOfficeInventoryPlaceholder(relative, bytes.length)) continue
        resources.push({ path: relative, bytes: bytes.length, sha256: digest(bytes) })
      }
    }
  }
  visit(root)
  return resources.sort((a, b) => compare(a.path, b.path))
}

// 同父目录 rename 保持匹配组合。候选从未完成时不清理/覆盖上一组合；
// 回退也失败时留下精确恢复路径，不能把原始发布错误掩盖为普通构建失败。
export function publishOfficeBundle({ stagingRoot, finalRoot, backupRoot }, io = fs) {
  const [staging, final, backup] = [stagingRoot, finalRoot, backupRoot].map(value => path.resolve(value))
  const parent = path.dirname(final)
  if (path.basename(final) !== 'office' || path.dirname(staging) !== parent || path.dirname(backup) !== parent ||
    !/^\.office-stage-\d+$/.test(path.basename(staging)) || !/^\.office-previous-\d+$/.test(path.basename(backup))) throw new Error('OFFICE_PUBLISH_PATH_INVALID')
  if (io.existsSync(backup)) throw new Error('OFFICE_BACKUP_ALREADY_EXISTS')
  for (const directory of [staging, final].filter(directory => io.existsSync(directory))) {
    const stat = io.lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('OFFICE_PUBLISH_PATH_INVALID')
  }
  const hadPrevious = io.existsSync(final)
  if (hadPrevious) io.renameSync(final, backup)
  try { io.renameSync(staging, final) } catch (error) {
    if (hadPrevious) {
      try { io.renameSync(backup, final) } catch (recoveryError) {
        throw Object.assign(new Error('OFFICE_PUBLISH_RECOVERY_REQUIRED'), { cause: error, recoveryError, recoveryPath: backup, finalPath: final })
      }
    }
    throw error
  }
  let backupCleanupError = null
  if (hadPrevious) {
    try { io.rmSync(backup, { recursive: true, force: true }) } catch (error) { backupCleanupError = error.code || error.message }
  }
  return { published: true, hadPrevious, backupCleanupError }
}

export function writeOfficeBundleManifest({ root, projectRoot, sources, releaseVersion, renderer = 'fresh', cli = 'fresh', native = 'fresh', platform = process.platform, arch = process.arch, experimentalHtml = false }) {
  const resources = inventoryOfficeResources(root)
  const manifest = {
    schemaVersion: 1,
    hostProtocolVersion: OFFICE_HOST_PROTOCOL_VERSION,
    adapterVersion: OFFICE_ADAPTER_VERSION,
    builtAt: new Date().toISOString(),
    releaseVersion,
    sources,
    build: { renderer, cli, native, platform, arch },
    // 官方目标升级单独冻结；此构建身份只证明当前实际 vendor 来源。
    upstream: projectRoot ? captureOfficeUpstreamProvenance(projectRoot) : { officialRepository: 'https://github.com/genspark-ai/genoffice.git', targetTag: null, targetSha: null, integrationState: 'current-vendor-not-latest-claim' },
    editors: getBuildOfficeEditors({ experimentalHtml }).map(editor => ({
      id: editor.id,
      ...(!editor.enabled ? { releaseState: 'experimental' } : {}),
      extensions: [...editor.extensions],
      main: `main/${editor.id}-main.cjs`,
      preload: `${editor.id}/preload/index.js`,
      renderer: `${editor.id}/renderer/index.html`,
      requiredExports: [...editor.requiredExports],
    })),
    services: OFFICE_SUPPORT_SERVICES.map(service => ({ ...service, requiredExports: [...service.requiredExports] })),
    requiredResources: [...OFFICE_REQUIRED_RESOURCES],
    optionalResources: { ocr: resources.some(resource => /^ocr\/(win-ocr\.exe|vision-ocr)$/.test(resource.path)),
      sheetsNative: resources.some(resource => /^native\/xlsx-sidecar(\.exe)?$/.test(resource.path)) },
    resources,
    resourcesDigest: digest(JSON.stringify(resources)),
  }
  fs.writeFileSync(path.join(root, OFFICE_MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}
