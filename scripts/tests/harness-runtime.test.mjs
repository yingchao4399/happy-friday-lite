import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { resolveDshRuntimeEntry } from '../../src-electron/harness/runtime.js'

test('resolves the DSH CLI from bin rather than its absent package main', () => {
  assert.equal(resolveDshRuntimeEntry('@deepseek-ai/dsh', { bin: { dsh: 'lib/bin.js' } }, 'C:/app/node_modules/@deepseek-ai/dsh'), path.resolve('C:/app/node_modules/@deepseek-ai/dsh/lib/bin.js'))
  assert.equal(resolveDshRuntimeEntry('@deepseek-ai/dsh', { bin: 'cli.js' }, '/app/dsh'), path.resolve('/app/dsh/cli.js'))
})

test('resolves normal DSH plugin entry points and rejects a package without one', () => {
  assert.equal(resolveDshRuntimeEntry('@deepseek-ai/dsh-mcp-client', { main: 'lib/index.js' }, '/app/mcp'), path.resolve('/app/mcp/lib/index.js'))
  assert.throws(() => resolveDshRuntimeEntry('@deepseek-ai/dsh', { name: 'dsh' }, '/app/dsh'), /does not declare/)
})
