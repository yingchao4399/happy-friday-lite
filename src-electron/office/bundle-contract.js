import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { OFFICE_ADAPTER_VERSION, OFFICE_HOST_PROTOCOL_VERSION, OFFICE_REQUIRED_RESOURCES, OFFICE_SUPPORT_SERVICES, getEnabledOfficeEditors, getOfficeEditorDefinition } from './editor-registry.js'

export const OFFICE_MANIFEST_FILE = 'integration-manifest.json'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const fail = (code, pathValue = null) => ({ code, ...(pathValue ? { path: pathValue } : {}) })
const compatible = (actual, expected) => typeof actual === 'string' && /^\d+\.\d+$/.test(actual) && actual.split('.')[0] === expected.split('.')[0]
const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const sameStrings = (a, b) => Array.isArray(a) && a.length === b.length && a.every((value, index) => value === b[index])

// electron-builder excludes zero-byte .gitkeep placeholders from packaged
// dependencies. They preserve empty source directories but are not runtime
// Office resources, so both build-time and packaged inventories ignore them.
export function isOfficeInventoryPlaceholder(relative, byteLength) {
  return typeof relative === 'string' && relative.startsWith('cli/node_modules/') &&
    relative.split('/').at(-1) === '.gitkeep' && byteLength === 0
}

// 只包含真实源码输入；生成物造成的全仓库 dirty、remote URL 和 describe
// 变化不改变构建输入。审计字段仍完整保存在 sources 中。
export function calculateOfficeSourceIdentity(sources) {
  return hash(JSON.stringify(Object.fromEntries(['main', 'vendor', ...(sources?.html !== undefined ? ['html'] : [])].map(key => {
    const source = sources?.[key]
    return [key, { sha: source?.sha, scope: source?.scope, dirty: source?.dirty, diffDigest: source?.diffDigest, untrackedSourceDigest: source?.untrackedSourceDigest }]
  }))))
}

function validSources(sources) {
  return sources && ['main', 'vendor', ...(sources?.html !== undefined ? ['html'] : [])].every(key => {
    const source = sources[key]
    return source && /^[a-f0-9]{40}$/.test(source.sha || '') && typeof source.dirty === 'boolean' &&
      typeof source.scope === 'string' && sha256(source.diffDigest) && sha256(source.untrackedSourceDigest)
  }) && sha256(sources.identityDigest) && calculateOfficeSourceIdentity(sources) === sources.identityDigest
}

export function readOfficeBundleManifest(root) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, OFFICE_MANIFEST_FILE), 'utf8'))
    return manifest && typeof manifest === 'object' && !Array.isArray(manifest) ? manifest : null
  } catch { return null }
}

function safeResource(root, relative) {
  if (typeof relative !== 'string' || !relative || /[\\:\0]/.test(relative) || relative.startsWith('/') || relative.split('/').some(part => part === '..' || part === '.' || !part)) return null
  const resolved = path.resolve(root, relative)
  const boundary = path.resolve(root) + path.sep
  return resolved.startsWith(boundary) ? resolved : null
}

function hasSymlinkAncestor(root, relative) {
  let current = path.resolve(root)
  for (const part of relative.split('/')) {
    current = path.join(current, part)
    if (fs.lstatSync(current).isSymbolicLink()) return true
  }
  return false
}

function diskInventory(root) {
  const files = []
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      const relative = path.relative(root, absolute).split(path.sep).join('/')
      if (relative === OFFICE_MANIFEST_FILE) continue
      if (entry.isSymbolicLink()) throw new Error('OFFICE_RESOURCE_SYMLINK')
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) {
        if (!isOfficeInventoryPlaceholder(relative, entry.name === '.gitkeep' ? fs.statSync(absolute).size : -1)) files.push(relative)
      }
      else throw new Error('OFFICE_RESOURCE_TYPE_INVALID')
    }
  }
  visit(root)
  return files
}

// 启动检查目标编辑器入口和共享服务；安装/CI 用 verifyAll 检查完整资源集合。
export function validateOfficeBundle(root, { editor, verifyHashes = true, verifyAll = false, requireClean = false, expectedReleaseVersion, allowExperimental = false } = {}) {
  const manifest = readOfficeBundleManifest(root)
  const issues = []
  if (!manifest) return { ok: false, code: 'OFFICE_MANIFEST_MISSING', issues: [fail('OFFICE_MANIFEST_MISSING')], manifest: null, editor: null }
  if (manifest.schemaVersion !== 1 || !compatible(manifest.hostProtocolVersion, OFFICE_HOST_PROTOCOL_VERSION) || !compatible(manifest.adapterVersion, OFFICE_ADAPTER_VERSION)) issues.push(fail('OFFICE_PROTOCOL_INCOMPATIBLE'))
  if (!validSources(manifest.sources) || typeof manifest.releaseVersion !== 'string' || !manifest.releaseVersion) issues.push(fail('OFFICE_SOURCE_IDENTITY_INVALID'))
  if (expectedReleaseVersion !== undefined && manifest.releaseVersion !== expectedReleaseVersion) issues.push(fail('OFFICE_RELEASE_COMBINATION_MISMATCH'))
  if (manifest.build?.platform !== process.platform || manifest.build?.arch !== process.arch) issues.push(fail('OFFICE_BUILD_TARGET_INCOMPATIBLE'))
  if (!['fresh', 'cached-unverified'].includes(manifest.build?.renderer) || !['fresh', 'cached-unverified'].includes(manifest.build?.cli) ||
    !['fresh', 'cached-unverified', 'unavailable'].includes(manifest.build?.native)) issues.push(fail('OFFICE_BUILD_METADATA_INVALID'))
  if (requireClean && (manifest.sources?.main?.dirty !== false || manifest.sources?.vendor?.dirty !== false || manifest.build?.renderer !== 'fresh' || manifest.build?.cli !== 'fresh' || manifest.build?.native !== 'fresh')) issues.push(fail('OFFICE_BUILD_NOT_RELEASE_READY'))
  const definition = editor ? getOfficeEditorDefinition(editor) : null
  if (editor && !definition?.enabled && !(allowExperimental === true && definition?.experimental === true)) issues.push(fail('OFFICE_EDITOR_NOT_INTEGRATED'))
  const declaredEditors = Array.isArray(manifest.editors) ? manifest.editors : []
  const declaredServices = Array.isArray(manifest.services) ? manifest.services : []
  if (new Set(declaredEditors.map(item => item?.id)).size !== declaredEditors.length || declaredEditors.some(item => {
    const expected = getOfficeEditorDefinition(item?.id)
    return !expected || (!expected.enabled && !(expected.experimental === true && item.releaseState === 'experimental')) ||
      (expected.enabled && item.releaseState !== undefined && item.releaseState !== 'enabled')
  })) issues.push(fail('OFFICE_MANIFEST_INVALID'))
  // 产物可包含待验收应用，但 manifest 自报不能批准普通入口或正式发布。
  if (requireClean && declaredEditors.some(item => getOfficeEditorDefinition(item?.id)?.enabled !== true)) issues.push(fail('OFFICE_EXPERIMENTAL_NOT_RELEASE_READY'))
  const entries = (editor ? [editor] : getEnabledOfficeEditors().map(item => item.id)).map(id => declaredEditors.find(item => item?.id === id))
  if (entries.some(item => !item)) issues.push(fail('OFFICE_EDITOR_RESOURCES_MISSING'))
  const contractEntries = declaredEditors.filter(item => getOfficeEditorDefinition(item?.id))
  if (contractEntries.some(item => item.id === 'html') && (!manifest.sources?.html || manifest.sources.html.scope !== 'genoffice-html-source-v1' || !sha256(manifest.sources.html.lockSha256))) issues.push(fail('OFFICE_HTML_SOURCE_IDENTITY_INVALID'))
  for (const item of contractEntries) {
    const expected = getOfficeEditorDefinition(item.id)
    if (item.main !== `main/${item.id}-main.cjs` || item.preload !== `${item.id}/preload/index.js` || item.renderer !== `${item.id}/renderer/index.html` ||
      !sameStrings(item.extensions, expected.extensions) || !sameStrings(item.requiredExports, expected.requiredExports)) issues.push(fail('OFFICE_EDITOR_CONTRACT_MISMATCH', item.id))
  }
  const services = OFFICE_SUPPORT_SERVICES.map(service => declaredServices.find(item => item?.id === service.id))
  if (services.some((service, index) => !service || service.main !== OFFICE_SUPPORT_SERVICES[index].main || !sameStrings(service.requiredExports, OFFICE_SUPPORT_SERVICES[index].requiredExports)) ||
    declaredServices.length !== OFFICE_SUPPORT_SERVICES.length || !sameStrings(manifest.requiredResources, OFFICE_REQUIRED_RESOURCES)) issues.push(fail('OFFICE_SERVICE_CONTRACT_MISMATCH'))
  const resources = Array.isArray(manifest.resources) ? manifest.resources : []
  const resourceMap = new Map()
  for (const resource of resources) {
    if (!resource || !safeResource(root, resource.path) || resourceMap.has(resource.path) || !Number.isSafeInteger(resource.bytes) || resource.bytes < 0 || !/^[a-f0-9]{64}$/.test(resource.sha256 || '')) {
      issues.push(fail('OFFICE_MANIFEST_INVALID'))
      continue
    }
    resourceMap.set(resource.path, resource)
  }
  if (resources.length === 0 || hash(JSON.stringify(resources)) !== manifest.resourcesDigest) issues.push(fail('OFFICE_MANIFEST_INVALID'))
  const requiredPaths = [...(verifyAll ? contractEntries : entries.filter(Boolean)).flatMap(item => [item.main, item.preload, item.renderer]), ...OFFICE_SUPPORT_SERVICES.map(service => service.main), ...OFFICE_REQUIRED_RESOURCES]
  const paths = verifyAll ? [...new Set([...resourceMap.keys(), ...requiredPaths])] : requiredPaths
  for (const relative of new Set(paths)) {
    const resolved = safeResource(root, relative)
    const resource = resourceMap.get(relative)
    if (!resolved || !resource) { issues.push(fail('OFFICE_RESOURCE_UNDECLARED', relative)); continue }
    try {
      const stat = fs.lstatSync(resolved)
      if (!stat.isFile() || hasSymlinkAncestor(root, relative) || stat.size !== resource.bytes) { issues.push(fail('OFFICE_RESOURCE_MISMATCH', relative)); continue }
      if (verifyHashes && hash(fs.readFileSync(resolved)) !== resource.sha256) issues.push(fail('OFFICE_RESOURCE_MISMATCH', relative))
    } catch { issues.push(fail('OFFICE_RESOURCE_MISSING', relative)) }
  }
  if (verifyAll) {
    try {
      for (const relative of diskInventory(root)) if (!resourceMap.has(relative)) issues.push(fail('OFFICE_RESOURCE_UNDECLARED', relative))
    } catch { issues.push(fail('OFFICE_RESOURCE_INVENTORY_INVALID')) }
  }
  return { ok: issues.length === 0, code: issues[0]?.code || null, issues, manifest, editor: editor ? entries[0] || null : null }
}

export function assertOfficeBundle(root, options) {
  const result = validateOfficeBundle(root, options)
  if (!result.ok) throw Object.assign(new Error(result.code), { code: result.code, issues: result.issues })
  return result
}

export function validateLoadedOfficeModule(editor, bundle, { allowExperimental = false } = {}) {
  const definition = getOfficeEditorDefinition(editor)
  if (!definition?.enabled && !(allowExperimental === true && definition?.experimental === true)) return { ok: false, code: 'OFFICE_EDITOR_NOT_INTEGRATED', missingExports: [] }
  const missingExports = definition.requiredExports.filter(name => typeof bundle?.[name] !== 'function')
  return { ok: missingExports.length === 0, code: missingExports.length ? 'OFFICE_REQUIRED_HOOK_MISSING' : null, missingExports }
}

export function validateLoadedOfficeService(id, bundle) {
  const definition = OFFICE_SUPPORT_SERVICES.find(service => service.id === id)
  if (!definition) return { ok: false, code: 'OFFICE_SERVICE_NOT_INTEGRATED', missingExports: [] }
  const missingExports = definition.requiredExports.filter(name => typeof bundle?.[name] !== 'function')
  return { ok: missingExports.length === 0, code: missingExports.length ? 'OFFICE_REQUIRED_HOOK_MISSING' : null, missingExports }
}
