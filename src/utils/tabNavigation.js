export function wheelIntent({ scrollWidth, clientWidth, deltaX = 0, deltaY = 0, lastSwitchAt = -Infinity, now = Date.now() }) {
  const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY
  if (scrollWidth > clientWidth + 1) return { scroll: delta, switchBy: 0 }
  if (Math.abs(delta) < 4 || now - lastSwitchAt < 250) return { scroll: 0, switchBy: 0 }
  return { scroll: 0, switchBy: Math.sign(delta) }
}

/**
 * Locate the scroll container under the pointer that can actually scroll
 * horizontally.  This is intentionally DOM-light so it also works for
 * markdown tables and code blocks rendered by third-party components.
 */
export function findHorizontalWheelTarget(start, root = typeof document !== 'undefined' ? document : null) {
  if (!start || !root) return null
  let element = start.nodeType === 1 ? start : start.parentElement
  while (element && element !== root) {
    const style = typeof getComputedStyle === 'function'
      ? getComputedStyle(element)
      : (element.style || {})
    const overflowX = style?.overflowX || element.style?.overflowX || ''
    const canScroll = Number(element.scrollWidth) > Number(element.clientWidth) + 1
    if (canScroll && /^(auto|scroll|overlay)$/i.test(overflowX)) return element
    element = element.parentElement
  }
  return null
}

/**
 * Route a normal mouse wheel gesture to a horizontal overflow area.  A
 * vertical wheel delta is used when it is the dominant axis, which makes
 * tables and long code blocks usable with a regular mouse.  Native tab
 * scrolling and explicit opt-out regions remain untouched.
 */
export function routeHorizontalWheel(event, { root = typeof document !== 'undefined' ? document : null } = {}) {
  if (!event || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey) return false
  const target = findHorizontalWheelTarget(event.target, root)
  if (!target) return false
  if (target.closest?.('.tabs-scroll, [data-horizontal-wheel-native]')) return false
  const delta = Math.abs(event.deltaX || 0) > Math.abs(event.deltaY || 0)
    ? Number(event.deltaX || 0)
    : Number(event.deltaY || 0)
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.01) return false

  const before = Number(target.scrollLeft) || 0
  target.scrollLeft = before + delta
  const after = Number(target.scrollLeft) || 0
  if (Math.abs(after - before) < 0.01) return false
  event.preventDefault?.()
  return true
}
