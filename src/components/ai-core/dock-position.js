export function clampDockPosition(position, viewport, size = { width: 48, height: 48 }, margin = 8) {
  return {
    x: Math.max(margin, Math.min(viewport.width - size.width - margin, position.x)),
    y: Math.max(margin, Math.min(viewport.height - size.height - margin, position.y))
  }
}
