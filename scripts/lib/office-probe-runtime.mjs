import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

// 同一验收可加载开发源码或安装目录；后者的业务模块与 Office 资源全部取自该目录。
export function officeProbeRuntime(projectRoot, args = process.argv.slice(2)) {
  let packagedApp = null
  let reportFile = null
  for (const argument of args) {
    const field = argument.startsWith('--packaged-app=') ? 'packagedApp' : argument.startsWith('--report=') ? 'reportFile' : null
    if (!field) throw new Error('OFFICE_PROBE_ARGUMENT_INVALID')
    const value = argument.slice(argument.indexOf('=') + 1)
    if (!path.isAbsolute(value) || value.includes('\0')) throw new Error('OFFICE_PROBE_ABSOLUTE_PATH_REQUIRED')
    if (field === 'packagedApp') {
      if (packagedApp) throw new Error('OFFICE_PROBE_ARGUMENT_REPEATED')
      packagedApp = fs.realpathSync(value)
    } else {
      if (reportFile) throw new Error('OFFICE_PROBE_ARGUMENT_REPEATED')
      reportFile = path.resolve(value)
    }
  }
  const moduleRoot = packagedApp || projectRoot
  const resourcesRoot = packagedApp ? path.dirname(packagedApp) : path.join(projectRoot, 'resources')
  const officeRoot = path.join(resourcesRoot, 'office')
  const packageJson = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'package.json'), 'utf8'))
  if (packagedApp && (path.basename(packagedApp) !== 'app' || !fs.existsSync(path.join(moduleRoot, 'src-electron/office/office-host.js')) || !fs.existsSync(path.join(officeRoot, 'integration-manifest.json')))) {
    throw new Error('OFFICE_PROBE_PACKAGED_LAYOUT_INVALID')
  }
  return {
    moduleRoot, resourcesRoot, officeRoot, reportFile, packaged: Boolean(packagedApp),
    load: relative => import(pathToFileURL(path.join(moduleRoot, relative)).href),
    configure(app) {
      if (packagedApp) {
        // 隔离验收进程中模拟 Electron 的安装布局，不改写安装目录或真实用户数据。
        Object.defineProperty(process, 'resourcesPath', { configurable: true, value: resourcesRoot })
        Object.defineProperty(app, 'isPackaged', { configurable: true, value: true })
      }
    },
    evidence() {
      const manifestFile = path.join(officeRoot, 'integration-manifest.json')
      const bytes = fs.readFileSync(manifestFile)
      const manifest = JSON.parse(bytes)
      return {
        mode: packagedApp ? 'isolated-packaged-modules' : 'source-modules', moduleRoot,
        releaseVersion: packageJson.releaseVersion, electronRuntime: process.versions.electron,
        officeRoot, manifestSha256: createHash('sha256').update(bytes).digest('hex'),
        identityDigest: manifest.sources.identityDigest, resourcesDigest: manifest.resourcesDigest,
        limitation: '确定性隔离驱动；不代替安装器、真实主窗口交互或远端模型工具选择验收',
      }
    },
  }
}
