import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeGeneratedOutputs } from '../write-generated-output.mjs'

test('生成文件内容相同时不替换，变化时完整发布且清理临时文件', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'friday-generated-'))
  const path = join(directory, 'host.js')
  const publish = value => writeGeneratedOutputs([{ path, contents: Buffer.from(value) }])
  try {
    await publish('first')
    const before = await stat(path, { bigint: true })
    await publish('first')
    assert.equal((await stat(path, { bigint: true })).mtimeNs, before.mtimeNs)
    await publish('second')
    assert.equal(await readFile(path, 'utf8'), 'second')
    assert.deepEqual(await readdir(directory), ['host.js'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
