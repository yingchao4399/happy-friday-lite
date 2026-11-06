import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { clampDockPosition } from '../../src/components/ai-core/dock-position.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('Global Agent Dock exposes route context without fabricating agents or task resources', async () => {
  const source = await readFile(path.join(root, 'src/components/ai-core/GlobalAgentDock.vue'), 'utf8')
  assert.match(source, /useRoute\(\)/)
  assert.match(source, /aiCoreListCapabilities\(\)/)
  assert.match(source, /route\.path/)
  assert.match(source, /params\[name\]/)
  assert.match(source, /agentRoutingActive/)
  assert.match(source, /listen\('office-operation-updated', scheduleOfficeTaskRefresh\)/)
  assert.match(source, /unlistenOfficeOperation\?\.\(\)/)
  assert.match(source, /officeTaskRefreshPending = true/)
  assert.match(source, /officeOverlay/)
  assert.match(source, /office-dock-set-expanded/)
  assert.match(source, /office-dock-open-friday/)
  assert.match(source, /queueOfficeMove/)
  assert.match(source, /officeMoveInFlight/)
  assert.match(source, /addEventListener\('resize', handleDockViewportResize\)/)
  assert.match(source, /removeEventListener\('resize', handleDockViewportResize\)/)
  assert.match(source, /request\('chat_with_memory'/)
  assert.match(source, /normalizeDockModel/)
  assert.doesNotMatch(source, /agent-dock-history-search/)
  assert.doesNotMatch(source, /filteredHistorySessions/)
  assert.doesNotMatch(source, /friday:\/\/route/)
  assert.doesNotMatch(source, /aiCoreListAgents/)
  // The selected profile is forwarded to the backend route and persisted with the session.
  assert.match(source, /assistantSettings[\s\S]*agentId/)
  assert.match(source, /agentRoutingActive/)
})

test('Global Agent Dock restores saved positions inside the current viewport', () => {
  assert.deepEqual(
    clampDockPosition({ x: 1920, y: 1080 }, { width: 1280, height: 720 }),
    { x: 1224, y: 664 }
  )
  assert.deepEqual(
    clampDockPosition({ x: -200, y: -100 }, { width: 1280, height: 720 }),
    { x: 8, y: 8 }
  )
  assert.deepEqual(
    clampDockPosition({ x: 700, y: 500 }, { width: 320, height: 240 }),
    { x: 264, y: 184 }
  )
})

test('Global Agent Dock context copy is present in both locales', async () => {
  const [zh, en] = await Promise.all([
    readFile(path.join(root, 'src/i18n/locales/zh-CN/common.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'src/i18n/locales/en-US/common.json'), 'utf8').then(JSON.parse)
  ])
  for (const locale of [zh, en]) {
    for (const key of ['contextTitle', 'agentLabel', 'coreAgent', 'agentUnavailable', 'agentRoutingActive', 'contextReadonly', 'routeLabel', 'resourceLabel', 'capabilitiesLabel', 'capabilitiesLoading', 'capabilitiesFailed', 'capabilitiesEmpty']) {
      assert.equal(typeof locale.agentDock[key], 'string', `missing common.agentDock.${key}`)
    }
  }
})

test('Office Dock preload exposes the complete conversation contract', async () => {
  const preload = await readFile(path.join(root, 'preload-office-dock.cjs'), 'utf8')
  for (const channel of [
    'get-config',
    'get_sessions',
    'get_sessions_with_stats',
    'get_session',
    'get_session_messages',
    'create_session',
    'update_session_title',
    'delete_session',
    'set_session_pinned',
    'set_session_archived',
    'trash_session',
    'restore_session',
    'save_message',
    'rollback_session',
    'chat_with_memory',
    'chat_without_memory',
    'stop_chat'
  ]) {
    assert.match(preload, new RegExp(`['"]${channel}['"]`), `missing invoke channel ${channel}`)
  }
  for (const channel of ['chat-chunk', 'chat-done', 'chat-error', 'chat-session-created', 'session-title-updated', 'config-changed', 'office-operation-updated', 'office-operation-progress']) {
    assert.match(preload, new RegExp(`['"]${channel}['"]`), `missing event channel ${channel}`)
  }
  assert.match(preload, /on\s*\(channel, callback\)/)
})

test('main and Office Dock preloads forward operation controls and unsubscribe task events', async () => {
  for (const file of ['preload.cjs', 'preload-office-dock.cjs']) {
    const calls = [], subscriptions = new Map()
    let api
    const electron = {
      contextBridge: { exposeInMainWorld(_name, value) { api = value } }, webUtils: {},
      ipcRenderer: {
        invoke(channel, args) { calls.push({ channel, args }); return Promise.resolve({ ok: true }) },
        on(channel, listener) { subscriptions.set(channel, listener) },
        removeListener(channel, listener) { if (subscriptions.get(channel) === listener) subscriptions.delete(channel) }
      }
    }
    vm.runInNewContext(await readFile(path.join(root, file), 'utf8'), {
      require: name => { assert.equal(name, 'electron'); return electron }, process: { platform: process.platform },
      document: { addEventListener() {} }, setTimeout, clearTimeout
    }, { filename: file })
    for (const channel of ['office-get-capabilities', 'office-get-operation-task', 'office-cancel-operation-task', 'office-reopen-artifact']) {
      const args = { taskId: 'task:1' }
      await api.invoke(channel, args)
      assert.equal(calls.at(-1).channel, channel)
      assert.equal(calls.at(-1).args, args)
    }
    for (const channel of ['office-operation-updated', 'office-operation-progress']) {
      let payload
      const off = api.on(channel, value => { payload = value })
      assert.equal(typeof subscriptions.get(channel), 'function', `${file} must allow ${channel}`)
      const update = { taskId: 'task:1', phase: 'committing' }
      subscriptions.get(channel)({ sender: 'hidden' }, update)
      assert.equal(payload, update)
      off()
      assert.equal(subscriptions.has(channel), false)
    }
    api.on('arbitrary-private-channel', () => { throw new Error('must never subscribe') })
    assert.equal(subscriptions.has('arbitrary-private-channel'), false)
  }
})
