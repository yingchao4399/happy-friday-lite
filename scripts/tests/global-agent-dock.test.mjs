import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('Global Agent Dock exposes route context without fabricating agents or task resources', async () => {
  const source = await readFile(path.join(root, 'src/components/ai-core/GlobalAgentDock.vue'), 'utf8')
  assert.match(source, /useRoute\(\)/)
  assert.match(source, /aiCoreListCapabilities\(\)/)
  assert.match(source, /route\.path/)
  assert.match(source, /params\[name\]/)
  assert.match(source, /agentRoutingActive/)
  assert.match(source, /officeOverlay/)
  assert.match(source, /office-dock-set-expanded/)
  assert.match(source, /office-dock-open-friday/)
  assert.match(source, /queueOfficeMove/)
  assert.match(source, /officeMoveInFlight/)
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
  for (const channel of ['chat-chunk', 'chat-done', 'chat-error', 'chat-session-created', 'session-title-updated', 'config-changed']) {
    assert.match(preload, new RegExp(`['"]${channel}['"]`), `missing event channel ${channel}`)
  }
  assert.match(preload, /on\s*\(channel, callback\)/)
})
