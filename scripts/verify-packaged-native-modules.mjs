// Audit every native binary and every platform package in an unpacked Electron
// app. Linux remains the strict ELF audit; Windows uses the same entry point
// and validates PE helpers in the final win-unpacked directory.
import { existsSync, openSync, readSync, closeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { auditNativeArtifact } from './native-artifact-audit.cjs'
import { verifyDeepseekImports } from './afterpack.cjs'

const args = process.argv.slice(2)
const appDirArgIndex = args.indexOf('--appDir')
const appDir = appDirArgIndex >= 0
  ? resolve(args[appDirArgIndex + 1])
  : (() => {
      const targetArch = args[0] || process.arch
      const outputDir = args[1] || 'release'
      const unpackedDir = targetArch === 'x64' ? 'linux-unpacked' : `linux-${targetArch}-unpacked`
      return resolve(outputDir, unpackedDir)
    })()
const targetArch = args[0] === '--appDir' ? process.arch : (args[0] || process.arch)
const isWindowsArtifact = /(^|[\\/])win(?:32)?-unpacked$/.test(appDir)
const packagedModules = join(appDir, 'resources', 'app', 'node_modules')

if (!existsSync(packagedModules)) {
  throw new Error(`Unpacked app not found: ${packagedModules}`)
}

verifyDeepseekImports(packagedModules)
console.log('[verify-packaged-native-modules] Verified packaged Harness imports')

if (!isWindowsArtifact) {
  const audit = auditNativeArtifact(appDir, targetArch)
  console.log(`[verify-packaged-native-modules] Verified ${audit.binaries.length} native binaries are Linux ${targetArch}`)
  console.log(`[verify-packaged-native-modules] Verified ${audit.specs.length} target runtime packages`)
  console.log(`[verify-packaged-native-modules] Verified ${audit.platformOptionals.length} platform-specific optional dependency edges`)
  for (const warning of audit.warnings) {
    console.warn(`[verify-packaged-native-modules] WARNING: ${warning}`)
  }
}

const requireBuiltinProbe = spawnSync(process.execPath, ['-e', `
  const requireBuiltin = require(process.argv[1]);
  const info = requireBuiltin.getBindingInfo();
  if (!info.bindingPath || info.product !== 'require-builtin') process.exit(1);
`, join(packagedModules, 'node-addon-require-builtin')], {
  encoding: 'utf8',
  timeout: 30000,
})
if (requireBuiltinProbe.error || requireBuiltinProbe.status !== 0) {
  throw new Error(`Packaged Node addon probe failed: ${requireBuiltinProbe.error || requireBuiltinProbe.stderr || requireBuiltinProbe.stdout}`)
}
console.log('[verify-packaged-native-modules] Verified node-addon-require-builtin binding loads in Node')

if (process.platform === 'linux' && process.arch === targetArch) {
  const executable = join(appDir, 'happy-friday-lite')
  const probeScript = fileURLToPath(new URL('./probe-packaged-native-modules.cjs', import.meta.url))
  const probe = spawnSync(executable, [probeScript, packagedModules, '--include-lazy'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 60000,
  })
  if (probe.error || probe.status !== 0) {
    throw new Error(`Packaged Electron native probe failed: ${probe.error || probe.stderr || probe.stdout}`)
  }
  process.stdout.write(probe.stdout)
}

if (isWindowsArtifact) {
  const resources = join(appDir, 'resources')
  const required = [
    join(resources, 'office', 'native', 'system-print.exe'),
    join(resources, 'office', 'native', 'xlsx-sidecar.exe'),
    join(resources, 'office', 'ocr', 'win-ocr.exe'),
  ]
  const failures = []
  for (const file of required) {
    if (!existsSync(file)) {
      failures.push(`missing Windows native helper: ${file}`)
      continue
    }
    const header = Buffer.alloc(2)
    const fd = openSync(file, 'r')
    readSync(fd, header, 0, header.length, 0)
    closeSync(fd)
    const descriptor = header.toString('ascii')
    if (descriptor !== 'MZ') failures.push(`not a PE executable: ${file}`)
  }
  if (failures.length) throw new Error(`Windows native artifact audit failed:\n${failures.map(value => `- ${value}`).join('\n')}`)
  console.log(`[verify-packaged-native-modules] Verified ${required.length} Windows native helpers are PE executables`)
}
