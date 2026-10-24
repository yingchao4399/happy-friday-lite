import path from 'node:path'

export function resolveDshRuntimeEntry(name, pkg, packageDirectory) {
  const entry = name === '@deepseek-ai/dsh'
    ? (typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.dsh)
    : (pkg.main || 'lib/index.js')
  if (typeof entry !== 'string' || !entry.trim()) throw new Error(`DSH package does not declare a runtime entry: ${name}`)
  return path.resolve(packageDirectory, entry)
}
