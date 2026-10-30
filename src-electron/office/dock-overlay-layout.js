/** Office 内的 Dock 只占用自身可点击区域，透明部分不覆盖编辑器。 */
export function officeDockBounds(workspace, { expanded = false, panelHeight = 0, position = null } = {}) {
  if (!workspace || ![workspace.x, workspace.y, workspace.width, workspace.height].every(Number.isFinite)) return null
  if (workspace.width < 80 || workspace.height < 80) return null

  const margin = 22
  const width = expanded ? Math.min(360, Math.floor(workspace.width - 32)) : 48
  const requestedHeight = expanded ? Math.max(120, Math.min(520, Math.ceil(panelHeight || 360))) + 60 : 48
  const height = Math.min(requestedHeight, Math.floor(workspace.height - 32))

  const defaultX = Math.max(workspace.x, Math.floor(workspace.x + workspace.width - margin - width))
  const defaultY = Math.max(workspace.y, Math.floor(workspace.y + workspace.height - margin - height))
  const x = Number.isFinite(position?.x)
    ? Math.max(workspace.x, Math.min(workspace.x + workspace.width - width, Math.floor(workspace.x + position.x)))
    : defaultX
  const y = Number.isFinite(position?.y)
    ? Math.max(workspace.y, Math.min(workspace.y + workspace.height - height, Math.floor(workspace.y + position.y)))
    : defaultY
  return {
    x,
    y,
    width,
    height
  }
}
