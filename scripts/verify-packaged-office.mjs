import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { assertOfficeBundle } from '../src-electron/office/bundle-contract.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
if (args.length > 1 || args[0] === '--help') {
  process.stderr.write('Usage: node scripts/verify-packaged-office.mjs [office-bundle-directory]\n')
  process.exit(args[0] === '--help' ? 0 : 2)
}

const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
const bundleRoot = path.resolve(projectRoot, args[0] || 'release/win-unpacked/resources/office')
try {
  const result = assertOfficeBundle(bundleRoot, {
    verifyAll: true,
    expectedReleaseVersion: packageJson.releaseVersion,
  })
  // 安装资源旁保存来源锁和差异账本；只核对打包时已审过的身份，不要求安装机有 Git/vendor。
  const appRoot = path.join(path.dirname(bundleRoot), 'app')
  const packaged = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'))
  if (packaged.version !== packageJson.version || packaged.releaseVersion !== result.manifest.releaseVersion) throw Object.assign(new Error('OFFICE_PACKAGED_HOST_MISMATCH'), { code: 'OFFICE_PACKAGED_HOST_MISMATCH' })
  for (const [file, field] of [['office-upstream.lock.json', 'lockSha256'], ['office-vendor-patches.json', 'patchManifestSha256']]) {
    const actual = createHash('sha256').update(fs.readFileSync(path.join(appRoot, file))).digest('hex')
    if (actual !== result.manifest.upstream?.[field]) throw Object.assign(new Error('OFFICE_PACKAGED_UPSTREAM_MISMATCH'), { code: 'OFFICE_PACKAGED_UPSTREAM_MISMATCH' })
  }
  if (result.manifest.sources.html) {
    const actual = createHash('sha256').update(fs.readFileSync(path.join(appRoot, 'office-html-upstream.lock.json'))).digest('hex')
    if (actual !== result.manifest.sources.html.lockSha256) throw Object.assign(new Error('OFFICE_PACKAGED_HTML_UPSTREAM_MISMATCH'), { code: 'OFFICE_PACKAGED_HTML_UPSTREAM_MISMATCH' })
  }
  process.stdout.write(JSON.stringify({
    ok: true,
    bundleRoot,
    releaseVersion: result.manifest.releaseVersion,
    identityDigest: result.manifest.sources.identityDigest,
    resourcesDigest: result.manifest.resourcesDigest,
    resourceCount: result.manifest.resources.length,
    upstreamLockSha256: result.manifest.upstream.lockSha256,
    patchManifestSha256: result.manifest.upstream.patchManifestSha256,
  }, null, 2) + '\n')
} catch (error) {
  process.stderr.write(JSON.stringify({
    ok: false,
    bundleRoot,
    code: error.code || 'OFFICE_PACKAGED_BUNDLE_INVALID',
    issues: error.issues || [],
  }, null, 2) + '\n')
  process.exitCode = 1
}
