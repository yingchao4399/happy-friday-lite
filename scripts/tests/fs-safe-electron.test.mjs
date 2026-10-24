import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const cli = fileURLToPath(new URL('../../node_modules/electron/cli.js', import.meta.url))
test('真实 Electron 清理临时目录后保留 junction 指向的安装文件', { skip: process.platform !== 'win32' || !fs.existsSync(cli), timeout: 25000 }, () => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const output = execFileSync(process.execPath, [cli, 'scripts/probe-junction-cleanup.mjs'], {
    cwd: root, env, encoding: 'utf8', timeout: 20000, windowsHide: true
  })
  const result = output.trim().split(/\r?\n/).map(line => {
    try { return JSON.parse(line) } catch { return null }
  }).find(value => value?.targetPreserved !== undefined)
  assert.equal(result?.targetPreserved, true, output)
})
