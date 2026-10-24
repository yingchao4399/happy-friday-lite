// 连续运行真实 Electron 启动/任务，再逐文件比较依赖哈希，防止验收破坏运行时。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
function snapshot() {
  const hashes = new Map()
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const filename = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(filename)
      else hashes.set(path.relative(root, filename), crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'))
    }
  }
  for (const scope of ['@deepseek-ai', '@cfworker', '@hono', '@modelcontextprotocol', 'typebox']) visit(path.join(root, 'node_modules', scope))
  return hashes
}
const before = snapshot()
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
function run(script, timeout = 120000) {
  let failure
  try { execFileSync(process.execPath, [path.join(root, 'node_modules', 'electron', 'cli.js'), script], { cwd: root, env, stdio: 'inherit', windowsHide: true, timeout }) } catch (error) { failure = error }
  const after = snapshot()
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter(name => before.get(name) !== after.get(name))
  if (changed.length) throw new Error(`DSH_RUNTIME_MUTATED: ${changed.slice(0, 10).join(', ')}`)
  console.log(JSON.stringify({ ok: true, probe: script, dependencyFilesVerified: before.size, changed: 0 }))
  if (failure) throw failure
}
run('scripts/probe-dsh-startup.mjs')
run('scripts/probe-dsh-startup.mjs')
if (process.argv.includes('--task')) run('scripts/probe-dsh-web-ui.mjs', 200000)
