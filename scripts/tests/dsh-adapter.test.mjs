import test from 'node:test'
import assert from 'node:assert/strict'
import { createDshCoreContext } from '../../src-electron/ai-core/dsh-adapter.js'

test('DSH adapter creates an isolated read-only Core context', () => {
  const context = createDshCoreContext({
    clientId: 'legacy',
    requestId: 'req-dsh-1',
    scopes: ['read', 'write', 'ui'],
    context: { resourceUris: ['friday://note/1', 42] }
  })
  assert.deepEqual(context.actor, { id: 'mcp:legacy', type: 'dsh', clientId: 'legacy' })
  assert.equal(context.spaceId, 'external:dsh:legacy')
  assert.equal(context.runtime, 'dsh')
  assert.deepEqual(context.scopes, ['read', 'ui'])
  assert.deepEqual(context.resourceUris, ['friday://note/1'])
})

test('DSH adapter accepts an explicit external workspace without inheriting write scope', () => {
  const context = createDshCoreContext({
    clientId: 'dsh-7',
    requestId: 'req-dsh-2',
    scopes: ['write'],
    context: { source: 'dsh', spaceId: 'external:dsh:workspace-7', sessionId: 'session-7' }
  })
  assert.equal(context.spaceId, 'external:dsh:workspace-7')
  assert.equal(context.sessionId, 'session-7')
  assert.deepEqual(context.scopes, ['read'])
})
