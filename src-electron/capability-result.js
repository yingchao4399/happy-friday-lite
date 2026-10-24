export const capabilityEvents = Object.freeze([
  'resource-changed', 'document-selection-changed', 'clipboard-item-added',
  'clipboard-item-used', 'trash-changed', 'task-progress', 'capability-error'
])

export function commandResult(data = null, { warnings = [], affectedResources = [], undo = null } = {}) {
  return { ok: true, data, warnings, error: null, affectedResources, undo }
}

export function commandFailure({ code = 'OPERATION_FAILED', message, stage = 'execute', nextStep = 'retry', recoverable = true, resource = null }) {
  return { ok: false, data: null, warnings: [], error: { code, message, stage, nextStep, recoverable, resource }, affectedResources: [], undo: null }
}
