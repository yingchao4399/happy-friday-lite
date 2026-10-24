import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const developmentRoot = path.resolve(process.argv[2] || '.')
const installedRoot = path.resolve(process.argv[3] || 'C:/Users/Administrator/AppData/Local/Programs/Happy Friday Lite/resources/app')
const included = ['package.json', 'package-lock.json', 'main.js', 'preload.cjs', 'src', 'src-electron', 'resources/office']

function collect(relative) {
  const target = path.join(installedRoot, relative)
  if (!fs.existsSync(target)) return []
  const stat = fs.statSync(target)
  return stat.isFile()
    ? [relative]
    : fs.readdirSync(target, { withFileTypes: true }).flatMap(entry => collect(path.join(relative, entry.name)))
}

function hash(root, relative) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex')
}

const files = [...new Set(included.flatMap(collect))].sort()
const entries = files
  .filter(relative => fs.existsSync(path.join(developmentRoot, relative)))
  .map(relative => {
    const installedSha256 = hash(installedRoot, relative)
    const developmentSha256 = hash(developmentRoot, relative)
    return { path: relative.replaceAll('\\', '/'), installedSha256, developmentSha256, same: installedSha256 === developmentSha256 }
  })
const manifest = {
  generatedAt: new Date().toISOString(),
  baseline: installedRoot,
  developmentRoot,
  version: JSON.parse(fs.readFileSync(path.join(developmentRoot, 'package.json'), 'utf8')).version,
  fileCount: entries.length,
  entries
}
const output = path.join(developmentRoot, 'docs', 'baseline-3.0.6-manifest.json')
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify({ ok: true, fileCount: entries.length, sameCount: entries.filter(entry => entry.same).length, changedCount: entries.filter(entry => !entry.same).length, output }))
