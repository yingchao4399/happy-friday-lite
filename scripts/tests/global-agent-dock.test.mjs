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
  assert.match(source, /agentUnavailable/)
  assert.match(source, /officeOverlay/)
  assert.match(source, /office-dock-set-expanded/)
  assert.match(source, /office-dock-open-friday/)
  assert.doesNotMatch(source, /friday:\/\/route/)
  assert.doesNotMatch(source, /aiCoreListAgents/)
  // The selected agent is a persisted UI preference. The backend remains
  // AI Core auto-routing and the dock must state that fallback explicitly.
  assert.match(source, /assistantSettings[\s\S]*agentId/)
  assert.match(source, /agentUnavailable/)
})

test('Global Agent Dock context copy is present in both locales', async () => {
  const [zh, en] = await Promise.all([
    readFile(path.join(root, 'src/i18n/locales/zh-CN/common.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'src/i18n/locales/en-US/common.json'), 'utf8').then(JSON.parse)
  ])
  for (const locale of [zh, en]) {
    for (const key of ['contextTitle', 'agentLabel', 'coreAgent', 'agentUnavailable', 'contextReadonly', 'routeLabel', 'resourceLabel', 'capabilitiesLabel', 'capabilitiesLoading', 'capabilitiesFailed', 'capabilitiesEmpty']) {
      assert.equal(typeof locale.agentDock[key], 'string', `missing common.agentDock.${key}`)
    }
  }
})
