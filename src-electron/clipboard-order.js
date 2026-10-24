export function compareClipboardOrder(a, b) {
  return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
    (b.manualOrder ?? Date.parse(b.capturedAt)) - (a.manualOrder ?? Date.parse(a.capturedAt)) ||
    a.id.localeCompare(b.id)
}

export function reorderClipboardItems(items, id, beforeId, after = false, now = Date.now) {
  const live = items.filter(item => !item.deletedAt).sort(compareClipboardOrder)
  const item = live.find(entry => entry.id === id)
  const target = live.find(entry => entry.id === beforeId)
  if (!item || !target || Boolean(item.pinned) !== Boolean(target.pinned)) {
    throw Object.assign(new Error('CLIPBOARD_ORDER_INVALID'), { code: 'CLIPBOARD_ORDER_INVALID' })
  }
  if (id === beforeId) return { ok: true, changed: false, orderedIds: live.map(entry => entry.id) }

  live.splice(live.indexOf(item), 1)
  live.splice(live.indexOf(target) + (after ? 1 : 0), 0, item)
  const base = now()
  live.forEach((entry, index) => { entry.manualOrder = base - index })
  return { ok: true, changed: true, orderedIds: live.map(entry => entry.id) }
}
