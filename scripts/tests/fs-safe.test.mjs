import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { removePathNoFollowSync, removePathNoFollow } from '../../src-electron/fs-safe.js'

test('清理 DSH profile 不穿透依赖 junction 或悬空链接', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-fs-safe-'))
  try {
    const source = path.join(root, 'installation')
    const profile = path.join(root, 'profile')
    fs.mkdirSync(source)
    fs.mkdirSync(path.join(profile, 'node_modules'), { recursive: true })
    fs.writeFileSync(path.join(source, 'package.json'), 'preserved')
    fs.symlinkSync(source, path.join(profile, 'node_modules', 'dep'), 'junction')
    fs.symlinkSync(path.join(root, 'missing'), path.join(profile, 'broken'), 'junction')
    fs.writeFileSync(path.join(profile, 'config.json'), 'fixture')
    removePathNoFollowSync(profile, { root })
    assert.equal(fs.existsSync(profile), false)
    assert.equal(fs.readFileSync(path.join(source, 'package.json'), 'utf8'), 'preserved')
    removePathNoFollowSync(profile, { root })
  } finally { removePathNoFollowSync(root, { root: os.tmpdir() }) }
})

test('删除拒绝边界本身、外部目标和中间 junction', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-fs-bounds-'))
  try {
    const source = path.join(root, 'installation')
    const profile = path.join(root, 'profile')
    fs.mkdirSync(source)
    fs.mkdirSync(profile)
    fs.writeFileSync(path.join(source, 'package.json'), 'preserved')
    fs.symlinkSync(source, path.join(profile, 'link'), 'junction')
    assert.throws(() => removePathNoFollowSync(root, { root }), /超出/)
    assert.throws(() => removePathNoFollowSync(os.tmpdir(), { root }), /超出/)
    assert.throws(() => removePathNoFollowSync(profile), /所属目录/)
    assert.throws(() => removePathNoFollowSync(path.join(profile, 'link', 'package.json'), { root: profile }), /父级/)
    assert.equal(fs.readFileSync(path.join(source, 'package.json'), 'utf8'), 'preserved')
  } finally { removePathNoFollowSync(root, { root: os.tmpdir() }) }
})

test('清理普通只读文件保持原先强制删除行为，链接目标保持只读且完整', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-readonly-'))
  try {
    for (const remove of [removePathNoFollowSync, removePathNoFollow]) {
      const directory = fs.mkdtempSync(path.join(root, 'owned-'))
      const filename = path.join(directory, 'readonly.txt')
      fs.writeFileSync(filename, 'fixture')
      fs.chmodSync(filename, 0o444)
      try { await remove(directory, { root }); assert.equal(fs.existsSync(directory), false) }
      finally { if (fs.existsSync(filename)) fs.chmodSync(filename, 0o666) }
    }
  } finally { removePathNoFollowSync(root, { root: os.tmpdir() }) }
})

test('Windows 所属目录大小写不同仍正确识别边界', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-fs-case-'))
  try {
    const target = path.join(root, 'owned', 'nested')
    fs.mkdirSync(target, { recursive: true })
    removePathNoFollowSync(target, { root: root.toUpperCase() })
    assert.equal(fs.existsSync(target), false)
  } finally { removePathNoFollowSync(root, { root: os.tmpdir() }) }
})
