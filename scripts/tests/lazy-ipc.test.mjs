import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { registerLazyIpcGroup } from '../../src-electron/lazy-ipc.js'

test('首次并发请求只加载一次，转发真实事件、参数和业务失败', async () => {
  const handlers = new Map(), event = { sender: { id: 7 } }
  let loads = 0
  const group = registerLazyIpcGroup({ handle: (name, fn) => handlers.set(name, fn) }, ['read', 'write'], async ipc => {
    loads++
    await new Promise(resolve => setTimeout(resolve, 5))
    ipc.handle('read', (received, value) => { assert.equal(received, event); return value })
    ipc.handle('write', () => { throw new Error('拒绝写入') })
  })
  assert.equal(loads, 0)
  assert.deepEqual(await Promise.all([handlers.get('read')(event, 2), handlers.get('read')(event, 3)]), [2, 3])
  assert.equal(loads, 1)
  assert.equal(group.isLoaded(), true)
  await assert.rejects(handlers.get('write')(event), /拒绝写入/)
})

test('加载失败不留下半注册入口，下次可以重试', async () => {
  const handlers = new Map()
  let loads = 0
  registerLazyIpcGroup({ handle: (name, fn) => handlers.set(name, fn) }, ['a', 'b'], ipc => {
    loads++
    ipc.handle('a', () => loads)
    if (loads === 1) throw new Error('加载失败')
    ipc.handle('b', () => '完成')
  })
  await assert.rejects(handlers.get('a')({}), /加载失败/)
  assert.equal(await handlers.get('b')({}), '完成')
  assert.equal(await handlers.get('a')({}), 2)
})

test('懒加载清单覆盖所有 Agent 与 Harness 通道，防止新增命令漏注册', () => {
  const lazy = fs.readFileSync(new URL('../../src-electron/lazy-agent-commands.js', import.meta.url), 'utf8')
  for (const module of ['agent/ipc.js', 'harness/index.js']) {
    const source = fs.readFileSync(new URL(`../../src-electron/${module}`, import.meta.url), 'utf8')
    for (const [, channel] of source.matchAll(/ipcMain\.handle\('([^']+)'/g)) assert.ok(lazy.includes(`'${channel}'`), channel)
  }
})
