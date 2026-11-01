export function calculateHistoryPanelPosition({ viewportWidth, viewportHeight, triggerRect, panelWidth = 330, panelHeight = 440, margin = 12, gap = 6 }) {
  const width = Math.min(panelWidth, Math.max(80, viewportWidth - margin * 2))
  const height = Math.min(panelHeight, Math.max(96, viewportHeight - margin * 2))
  // Keep the panel visually attached to the trigger's left edge whenever there
  // is room.  Right-aligning against the trigger makes a narrow header button
  // push a wide panel far across the page and, in Office side panes, puts the
  // panel underneath the editor instead of beside the button.
  const left = Math.max(margin, Math.min(triggerRect.left, viewportWidth - width - margin))
  const spaceBelow = viewportHeight - triggerRect.bottom - margin
  const spaceAbove = triggerRect.top - margin
  const below = spaceBelow >= height || spaceBelow >= spaceAbove
  const top = below ? triggerRect.bottom + gap : Math.max(margin, triggerRect.top - height - gap)
  return { left, top, width, height, below }
}
