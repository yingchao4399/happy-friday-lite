import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHtmlArtifact } from '../../src-electron/office/html-artifact.js'

test('HTML 原始源码逐字节保存，原子交付后真实回读，不执行作者脚本', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'html-artifact-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const source = '<!doctype html><h1>中文</h1><script>window.attack=1</script>'
  const artifact = await createHtmlArtifact({ directory: root, source, title: '../report', id: () => 'test' })
  assert.equal(await fs.readFile(artifact.path, 'utf8'), source)
  assert.equal(path.dirname(artifact.path), await fs.realpath(root))
  assert.equal(artifact.validation.sourceBytesMatch, true)
  assert.equal(artifact.persisted, true)
  assert.equal((await fs.readdir(root)).some(file => file.endsWith('.tmp')), false)
  await assert.rejects(createHtmlArtifact({ directory: root, source: '<p>overwrite</p>', title: '../report', id: () => 'test' }), { code: 'EEXIST' })
  assert.equal(await fs.readFile(artifact.path, 'utf8'), source)
})

test('预先取消或无效内容不生成文件', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'html-artifact-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(createHtmlArtifact({ directory: root, source: '<p>no write</p>', signal: controller.signal }), { code: 'OFFICE_OPERATION_CANCELLED' })
  await assert.rejects(createHtmlArtifact({ directory: root, source: '\0' }), { code: 'OFFICE_HTML_CONTENT_INVALID' })
  assert.deepEqual(await fs.readdir(root), [])
})
