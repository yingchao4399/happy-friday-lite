import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import yaml from 'js-yaml'

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const retryableRenameErrors = new Set(['EACCES', 'EBUSY', 'EPERM', 'UNKNOWN'])
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const fail = (code, message) => Object.assign(new Error(message), { code })
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const identity = stat => Object.fromEntries(['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs', 'mode'].map(key => [key, stat[key]]))
const sameIdentity = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function snapshotFile(file, code) {
  const stat = regularFile(file, code)
  return { path: path.resolve(file), realPath: fs.realpathSync(file), identity: identity(stat) }
}

function assertFileSnapshot(snapshot, code) {
  const current = snapshotFile(snapshot.path, code)
  if (snapshot.realPath !== current.realPath || !sameIdentity(snapshot.identity, current.identity)) {
    throw fail(code, `Release input identity changed: ${snapshot.path}`)
  }
}

function captureJsonInput(file) {
  const before = snapshotFile(file, 'RELEASE_INPUT_INVALID')
  const bytes = fs.readFileSync(file)
  assertFileSnapshot(before, 'RELEASE_INPUT_CHANGED')
  if (bytes.length !== before.identity.size) throw fail('RELEASE_INPUT_CHANGED', `Release input changed while reading: ${file}`)
  return { value: JSON.parse(bytes), snapshot: { ...before, sha256: digest(bytes) } }
}

function assertReleaseInputs(description) {
  for (const snapshot of description.context.inputSnapshots) {
    assertFileSnapshot(snapshot, 'RELEASE_INPUT_CHANGED')
    const bytes = fs.readFileSync(snapshot.path)
    assertFileSnapshot(snapshot, 'RELEASE_INPUT_CHANGED')
    if (digest(bytes) !== snapshot.sha256) throw fail('RELEASE_INPUT_CHANGED', `Release input contents changed: ${snapshot.path}`)
  }
  for (const artifact of [description.installer, description.blockmap]) assertFileSnapshot(artifact.snapshot, 'RELEASE_FILE_CHANGED')
}

function requireValue(value, name) {
  if (typeof value !== 'string' || !/^[0-9][0-9A-Za-z.+_-]*$/.test(value)) {
    throw fail('RELEASE_VERSION_INVALID', `${name} must be a non-empty release version`)
  }
  return value
}

function expandArtifactName(template, packageJson) {
  if (typeof template !== 'string') throw fail('RELEASE_ARTIFACT_NAME_REQUIRED', 'Windows NSIS artifactName is required')
  const values = { name: packageJson.name, productName: packageJson.build?.productName, version: packageJson.version, arch: 'x64', ext: 'exe', os: 'win' }
  const name = template.replace(/\$\{([^}]+)\}/g, (_, key) => {
    if (typeof values[key] !== 'string') throw fail('RELEASE_ARTIFACT_MACRO_UNSUPPORTED', `Unsupported artifactName macro: ${key}`)
    return values[key]
  })
  if (path.basename(name) !== name || /[\\/\r\n]/.test(name)) throw fail('RELEASE_ARTIFACT_NAME_INVALID', 'artifactName must be a filename')
  return name
}

function regularFile(file, code) {
  let stat
  try { stat = fs.lstatSync(file) } catch { throw fail(code, `Required release file is missing: ${file}`) }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) throw fail(code, `Required release file is not a non-empty regular file: ${file}`)
  return stat
}

/** Resolve the configured release, never the newest file in a directory of old installers. */
export function resolveReleaseArtifacts(projectRoot = defaultProjectRoot) {
  const project = path.resolve(projectRoot)
  const packageInput = captureJsonInput(path.join(project, 'package.json'))
  const packageJson = packageInput.value
  const version = requireValue(packageJson.version, 'package.version')
  const releaseVersion = requireValue(packageJson.releaseVersion, 'package.releaseVersion')
  const publish = packageJson.build?.win?.publish
  const providers = Array.isArray(publish) ? publish : [publish]
  if (!providers.length || providers.some(provider => provider?.publishAutoUpdate !== false)) {
    throw fail('RELEASE_BUILDER_METADATA_NOT_DISABLED', 'Every Windows publish provider must set publishAutoUpdate: false')
  }
  const releaseDir = path.resolve(project, packageJson.build?.directories?.output || 'release')
  const winName = expandArtifactName(packageJson.build?.win?.artifactName, packageJson)
  const installerName = expandArtifactName(packageJson.build?.nsis?.artifactName || packageJson.build?.win?.artifactName, packageJson)
  if (winName !== installerName || !installerName.endsWith(`-${releaseVersion}-win-x64-setup.exe`)) {
    throw fail('RELEASE_ARTIFACT_VERSION_MISMATCH', 'Windows and NSIS artifactName must identify the current releaseVersion and win-x64 installer')
  }
  const candidates = fs.existsSync(releaseDir)
    ? fs.readdirSync(releaseDir).filter(name => name.endsWith(`-${releaseVersion}-win-x64-setup.exe`))
    : []
  if (candidates.length !== 1 || candidates[0] !== installerName) {
    throw fail(candidates.length > 1 ? 'RELEASE_INSTALLER_AMBIGUOUS' : 'RELEASE_INSTALLER_MISSING', `Expected exactly one current installer (${installerName}); found ${candidates.length}`)
  }
  const installer = path.join(releaseDir, installerName)
  regularFile(installer, 'RELEASE_INSTALLER_INVALID')
  const signature = Buffer.alloc(2)
  const descriptor = fs.openSync(installer, 'r')
  try { fs.readSync(descriptor, signature, 0, 2, 0) } finally { fs.closeSync(descriptor) }
  if (signature.toString('ascii') !== 'MZ') throw fail('RELEASE_INSTALLER_INVALID', 'Windows installer does not have an MZ signature')
  const blockmap = `${installer}.blockmap`
  regularFile(blockmap, 'RELEASE_BLOCKMAP_MISSING')
  const packagedRoot = path.join(releaseDir, 'win-unpacked', 'resources')
  let packagedApp, office, packagedInput, officeInput
  try {
    packagedInput = captureJsonInput(path.join(packagedRoot, 'app', 'package.json'))
    officeInput = captureJsonInput(path.join(packagedRoot, 'office', 'integration-manifest.json'))
    packagedApp = packagedInput.value
    office = officeInput.value
  } catch (error) { throw fail('RELEASE_PACKAGED_IDENTITY_MISSING', `Cannot read packaged application/Office identity: ${error.message}`) }
  if (packagedApp.version !== version || packagedApp.releaseVersion !== releaseVersion || office.releaseVersion !== releaseVersion) {
    throw fail('RELEASE_PACKAGED_VERSION_MISMATCH', 'Application, Office bundle and configured release must have matching versions')
  }
  if (!/^[a-f0-9]{64}$/.test(office.sources?.identityDigest || '') || !/^[a-f0-9]{64}$/.test(office.resourcesDigest || '') || !Array.isArray(office.resources)) {
    throw fail('RELEASE_OFFICE_IDENTITY_INVALID', 'Packaged Office must provide source/resource digests and a resource list')
  }
  const suffix = /-(preview\.[0-9]+)$/.exec(releaseVersion)?.[1] || releaseVersion
  return { projectRoot: project, packageJson, version, releaseVersion, releaseDir, installerName, installer, blockmap, office, suffix,
    inputSnapshots: [packageInput.snapshot, packagedInput.snapshot, officeInput.snapshot] }
}

export async function measureReleaseFile(file) {
  const before = snapshotFile(file, 'RELEASE_FILE_INVALID')
  const sha256 = createHash('sha256')
  const sha512 = createHash('sha512')
  const handle = await fs.promises.open(file, 'r')
  try {
    if (!sameIdentity(before.identity, identity(await handle.stat()))) throw fail('RELEASE_FILE_CHANGED', `Release artifact changed before hashing: ${file}`)
    // Hash the opened identity, not a pathname that can be replaced between the
    // initial stat and stream creation. The descriptor stays owned by this call.
    for await (const chunk of fs.createReadStream(file, { fd: handle.fd, autoClose: false })) { sha256.update(chunk); sha512.update(chunk) }
    if (!sameIdentity(before.identity, identity(await handle.stat()))) throw fail('RELEASE_FILE_CHANGED', `Release artifact changed while hashing: ${file}`)
    assertFileSnapshot(before, 'RELEASE_FILE_CHANGED')
  } finally {
    await handle.close()
  }
  return { name: path.basename(file), size: before.identity.size, sha256: sha256.digest('hex').toUpperCase(), sha512: sha512.digest('base64'), releaseDate: new Date(before.identity.mtimeMs).toISOString(), snapshot: before }
}

async function describeRelease(projectRoot) {
  const context = resolveReleaseArtifacts(projectRoot)
  const installer = await measureReleaseFile(context.installer)
  const blockmap = await measureReleaseFile(context.blockmap)
  const info = { version: context.version, files: [{ url: installer.name, sha512: installer.sha512, size: installer.size }], path: installer.name, sha512: installer.sha512, releaseDate: installer.releaseDate, releaseVersion: context.releaseVersion }
  const checksums = `${installer.sha256}  ${installer.name}\n${blockmap.sha256}  ${blockmap.name}\n`
  const buildInfo = [
    `Happy Friday Lite ${context.releaseVersion} Windows x64 candidate`,
    `Application version: ${context.version}`,
    `Release version: ${context.releaseVersion}`,
    `Installer timestamp (UTC): ${installer.releaseDate}`,
    `Installer: ${installer.name}`,
    `Size: ${installer.size} bytes`,
    `SHA256: ${installer.sha256}`,
    `SHA512: ${installer.sha512}`,
    `Blockmap: ${blockmap.name}`,
    `Blockmap size: ${blockmap.size} bytes`,
    `Blockmap SHA256: ${blockmap.sha256}`,
    `Office resources: ${context.office.resources.length}`,
    `Office source identity: ${context.office.sources.identityDigest}`,
    `Office resources digest: ${context.office.resourcesDigest}`,
    `Office vendor commit: ${context.office.sources.vendor?.sha || 'not recorded'}`,
    `Office upstream state: ${context.office.upstream?.integrationState || 'not recorded'}`,
    'Metadata is generated from measured local artifacts; it does not attest installation, signing, upstream feature parity or publication.',
    '',
  ].join('\n')
  return { context, installer, blockmap, info, checksums, buildInfo }
}

/** Same-directory rename is the commit. A locked destination fails without deleting the previous metadata. */
export async function atomicReplaceText(file, content, { rename = fs.promises.rename, pause = wait } = {}) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`)
  let handle
  try {
    handle = await fs.promises.open(temporary, 'wx')
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, file); break } catch (error) {
        if (!retryableRenameErrors.has(error.code) || attempt >= 4) throw error
        await pause(50 * (attempt + 1))
      }
    }
  } finally {
    await handle?.close()
    await fs.promises.rm(temporary, { force: true })
  }
}

function metadataPaths(context) {
  return { latest: path.join(context.releaseDir, 'latest.yml'), checksums: path.join(context.releaseDir, `SHA256SUMS-${context.suffix}.txt`), buildInfo: path.join(context.releaseDir, `${context.suffix}-build-info.txt`) }
}

function verifyContents(description) {
  const { context, installer, info, checksums, buildInfo } = description
  const files = metadataPaths(context)
  let actual
  try { actual = yaml.load(fs.readFileSync(files.latest, 'utf8')) } catch (error) { throw fail('RELEASE_METADATA_INVALID', `Cannot read latest.yml: ${error.message}`) }
  if (actual?.version !== info.version || actual?.releaseVersion !== info.releaseVersion || actual?.path !== installer.name || actual?.sha512 !== installer.sha512 || actual?.releaseDate !== installer.releaseDate || actual?.files?.length !== 1 || actual.files[0]?.url !== installer.name || actual.files[0]?.size !== installer.size || actual.files[0]?.sha512 !== installer.sha512) {
    throw fail('RELEASE_METADATA_MISMATCH', 'latest.yml does not match the current measured installer and release')
  }
  for (const [key, expected] of [['checksums', checksums], ['buildInfo', buildInfo]]) {
    let value
    try { value = fs.readFileSync(files[key], 'utf8') } catch { throw fail('RELEASE_METADATA_MISSING', `Missing ${key} metadata`) }
    if (value !== expected) throw fail('RELEASE_METADATA_MISMATCH', `${path.basename(files[key])} does not match the current measured artifacts`)
  }
  assertReleaseInputs(description)
  return { ok: true, releaseVersion: context.releaseVersion, applicationVersion: context.version, platform: 'win32-x64', installer, blockmap: description.blockmap, files }
}

export async function verifyReleaseMetadata({ projectRoot = defaultProjectRoot } = {}) {
  return verifyContents(await describeRelease(projectRoot))
}

export async function writeReleaseMetadata({ projectRoot = defaultProjectRoot } = {}) {
  const description = await describeRelease(projectRoot)
  const files = metadataPaths(description.context)
  // latest.yml is committed last, after the companion audit files are complete.
  await atomicReplaceText(files.checksums, description.checksums)
  await atomicReplaceText(files.buildInfo, description.buildInfo)
  assertReleaseInputs(description)
  await atomicReplaceText(files.latest, yaml.dump(description.info, { lineWidth: -1, noRefs: true }))
  // Preserve the original input snapshot across both writes and a fresh rehash;
  // restarting validation alone would silently accept same-version JSON drift.
  verifyContents(description)
  const result = await verifyReleaseMetadata({ projectRoot })
  assertReleaseInputs(description)
  return result
}

export function parseReleaseMetadataArguments(args) {
  const options = { check: false }
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--check' && !options.check) options.check = true
    else if (args[index] === '--project' && !options.projectRoot && args[index + 1] && path.isAbsolute(args[index + 1])) options.projectRoot = args[++index]
    else throw fail('RELEASE_METADATA_ARGUMENT_INVALID', 'Usage: node scripts/write-release-metadata.mjs [--check] [--project <absolute-directory>]')
  }
  return options
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { check, ...options } = parseReleaseMetadataArguments(process.argv.slice(2))
    const result = await (check ? verifyReleaseMetadata(options) : writeReleaseMetadata(options))
    process.stdout.write(JSON.stringify({ ...result, mode: check ? 'check' : 'write' }, null, 2) + '\n')
  } catch (error) {
    process.stderr.write(JSON.stringify({ ok: false, code: error.code || 'RELEASE_METADATA_FAILED', message: error.message }, null, 2) + '\n')
    process.exitCode = 1
  }
}
