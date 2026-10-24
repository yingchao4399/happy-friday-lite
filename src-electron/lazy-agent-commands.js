import { ipcMain } from 'electron'
import { registerLazyIpcGroup } from './lazy-ipc.js'

const agentChannels = [
  'agent-invoke', 'agent-stop', 'agent-tool-approval-resume', 'agent-list-tools',
  'agent-list-skills', 'agent-delete-skill', 'agent-import-skill', 'agent-restore-builtin-skills',
  'mcp-list-servers', 'mcp-add-servers', 'mcp-delete-server', 'mcp-refresh-server',
  'mcp-get-local-config', 'mcp-pair-client', 'mcp-list-clients', 'mcp-revoke-client',
  'mcp-local-toggle', 'agent-list-memories', 'agent-read-memory', 'agent-write-memory',
]
const harnessChannels = ['harness-start', 'harness-status', 'harness-restart', 'harness-sync-config']
let agentModule = null, harnessModule = null

export function registerLazyAgentCommands(window) {
  return registerLazyIpcGroup(ipcMain, agentChannels, async ipc => {
    agentModule = await import('./agent/ipc.js')
    agentModule.registerAgentCommands(window, ipc)
  })
}

export function registerLazyHarnessCommands(window) {
  return registerLazyIpcGroup(ipcMain, harnessChannels, async ipc => {
    harnessModule = await import('./harness/index.js')
    harnessModule.registerHarnessCommands(window, ipc)
  })
}

export async function syncLazyHarnessConfigurationIfRunning() {
  return harnessModule?.syncHarnessConfigurationIfRunning()
}

export function stopLazyHarness() { return harnessModule?.stopHarnessSidecar() }
export async function closeLazyAgentConnections() {
  if (agentModule || harnessModule) {
    const { closeAgentMcpConnections } = await import('./agent/mcp.js')
    await closeAgentMcpConnections()
  }
}
