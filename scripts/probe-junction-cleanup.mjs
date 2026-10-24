// 最小复现：测试清理临时 DSH profile 是否会穿透 Windows junction。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app as electronApp } from 'electron'
import { removePathNoFollowSync, removePathNoFollow } from '../src-electron/fs-safe.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-junction-repro-'))
const target = path.join(root, 'installation', 'package')
const profile = path.join(root, 'profile')
const link = path.join(profile, 'node_modules', 'package')
async function main() {
let ok = false
try {
  fs.mkdirSync(target, { recursive: true })
  fs.mkdirSync(path.dirname(link), { recursive: true })
  fs.writeFileSync(path.join(target, 'package.json'), '{"name":"fixture"}')
  fs.symlinkSync(target, link, 'junction')
  const before = { isSymbolicLink: fs.lstatSync(link).isSymbolicLink(), target: fs.readlinkSync(link) }
  if (process.argv.includes('--unsafe-repro')) fs.rmSync(profile, { recursive: true, force: true })
  else removePathNoFollowSync(profile, { root })
  ok = fs.existsSync(path.join(target, 'package.json'))
  if (ok && !process.argv.includes('--unsafe-repro')) {
    fs.mkdirSync(path.dirname(link), { recursive: true })
    fs.symlinkSync(target, link, 'junction')
    fs.writeFileSync(path.join(profile, 'readonly.txt'), 'fixture')
    fs.chmodSync(path.join(profile, 'readonly.txt'), 0o444)
    await removePathNoFollow(profile, { root })
    ok = fs.existsSync(path.join(target, 'package.json'))
  }
  console.log(JSON.stringify({ ok, node: process.versions.node, electron: process.versions.electron || null, before, targetPreserved: ok }))
} finally {
  // 所有路径均为本脚本刚创建的 fixture，不触及真实安装/用户数据。
  try { if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link) } catch {}
  removePathNoFollowSync(root, { root: os.tmpdir() })
  if (electronApp?.exit) electronApp.exit(ok ? 0 : 1)
  else if (!ok) process.exitCode = 1
}
}
if (electronApp?.whenReady) electronApp.whenReady().then(main)
else main()
