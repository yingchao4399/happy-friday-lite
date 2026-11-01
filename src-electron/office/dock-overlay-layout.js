/** Office 内的 Dock 只占用自身可点击区域，透明部分不覆盖编辑器。 */
export function officeDockBounds(workspace, { expanded = false, panelHeight = 0, position = null } = {}) {
  if (!workspace || ![workspace.x, workspace.y, workspace.width, workspace.height].every(Number.isFinite)) return null
  if (workspace.width < 80 || workspace.height < 80) return null

  // Electron screen/window/view bounds and Chromium screenX/screenY are all
  // expressed in logical pixels (DIP/CSS px). Let Windows scale the rendered
  // pixels; multiplying geometry by display.scaleFactor causes drift/clipping.
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

// 位移始终从实际可见矩形开始；抵达边缘后不积累越界距离。
export function moveOfficeDockPosition(workspace, state, dx, dy) {
  const before = officeDockBounds(workspace, state)
  if (!before) return null
  const next = officeDockBounds(workspace, { ...state, position: { x: before.x - workspace.x + dx, y: before.y - workspace.y + dy } })
  return { x: next.x - workspace.x, y: next.y - workspace.y }
}

// 收起按钮位于视图右下角；内容高度变化时保持该锚点，避免打开面板后按钮跳走。
export function resizeOfficeDockPosition(workspace, before, state) {
  const after = officeDockBounds(workspace, state)
  if (!before || !after) return state.position
  const next = officeDockBounds(workspace, { ...state, position: { x: before.x + before.width - after.width - workspace.x, y: before.y + before.height - after.height - workspace.y } })
  return { x: next.x - workspace.x, y: next.y - workspace.y }
}
