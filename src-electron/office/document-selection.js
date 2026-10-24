const MAX_SELECTION_TEXT = 12_000

function boundedText(value) {
  return typeof value === 'string' ? value.slice(0, MAX_SELECTION_TEXT) : ''
}

function selectionWarnings(value) {
  return typeof value === 'string' && value.length > MAX_SELECTION_TEXT ? ['selection_text_truncated'] : []
}

function valuesToText(values) {
  if (!Array.isArray(values)) return ''
  return boundedText(values.map(row => Array.isArray(row) ? row.map(value => value == null ? '' : String(value)).join('\t') : String(row ?? '')).join('\n'))
}

function sourceRectangle(value) {
  if (!value || typeof value !== 'object') return null
  const rect = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number(value[key])]))
  return Object.values(rect).every(Number.isFinite) ? rect : null
}

function pdfPosition(value) {
  if (!value || !['page', 'item', 'offset', 'pageOffset'].every(key => Number.isSafeInteger(value[key]) && value[key] >= (key === 'page' ? 1 : 0))) return null
  return { page: value.page, item: value.item, offset: value.offset, pageOffset: value.pageOffset }
}

function base(entry, fields = {}) {
  return {
    documentId: entry.viewId,
    kind: entry.type,
    anchor: null,
    focus: null,
    text: '',
    range: null,
    page: null,
    paragraph: null,
    cell: null,
    shape: null,
    sourceRect: null,
    canCopy: false,
    canCut: false,
    canPaste: false,
    canSelectAll: false,
    warnings: [],
    ...fields
  }
}

export function normalizeOfficeDocumentSelection(entry, reply) {
  if (!entry || !reply || reply.status !== 'ok' || !reply.result || typeof reply.result !== 'object') return null
  const result = reply.result
  if (entry.type === 'docs') {
    const blocks = Array.isArray(result.blocks) && result.blocks.length === 2 ? result.blocks : null
    const text = boundedText(result.text)
    const selected = result.collapsed !== true && text.length > 0
    const editable = result.editable !== false
    return base(entry, {
      text,
      range: Number.isInteger(result.from) && Number.isInteger(result.to) ? { from: result.from, to: result.to } : null,
      paragraph: blocks ? { start: blocks[0], end: blocks[1] } : null,
      sourceRect: sourceRectangle(result.sourceRect),
      anchor: result.anchor && Number.isInteger(result.anchor.offset) ? { offset: result.anchor.offset } : blocks ? { block: blocks[0] } : null,
      focus: result.focus && Number.isInteger(result.focus.offset) ? { offset: result.focus.offset } : blocks ? { block: blocks[1] } : null,
      canCopy: selected,
      canCut: selected && editable,
      canPaste: editable,
      canSelectAll: true,
      warnings: selectionWarnings(result.text)
    })
  }
  if (entry.type === 'sheets') {
    const cell = result.sheet && result.range ? { sheet: String(result.sheet), range: String(result.range) } : null
    const text = valuesToText(result.values)
    const selected = Boolean(cell && !result.none)
    return base(entry, {
      text,
      range: cell ? { ...cell, bounds: result.bounds || null } : null,
      cell,
      anchor: cell ? { sheet: cell.sheet, address: result.bounds ? { row: result.bounds.startRow, column: result.bounds.startColumn } : cell.range.split(':')[0] } : null,
      focus: cell ? { sheet: cell.sheet, address: result.bounds ? { row: result.bounds.endRow, column: result.bounds.endColumn } : cell.range.split(':').at(-1) } : null,
      warnings: Number.isInteger(result.cells) && result.cells > 200 ? ['selection_range_too_large_for_inline_values'] : [],
      canCopy: selected,
      canCut: selected,
      canPaste: true,
      canSelectAll: true
    })
  }
  if (entry.type === 'slides') {
    const elements = Array.isArray(result.elements) ? result.elements.filter(id => typeof id === 'string') : []
    const text = boundedText(result.text)
    const selected = elements.length > 0 || Boolean(text.trim())
    return base(entry, {
      text,
      range: elements.length ? { elements } : null,
      page: Number.isInteger(result.slide) ? result.slide + 1 : null,
      shape: elements.length ? { ids: elements, types: Array.isArray(result.types) ? result.types : [], texts: Array.isArray(result.shapeTexts) ? result.shapeTexts : [] } : null,
      warnings: selectionWarnings(result.text),
      canCopy: selected,
      canCut: selected,
      canPaste: true,
      canSelectAll: true
    })
  }
  if (entry.type === 'pdf') {
    const text = boundedText(result.text)
    const selected = Boolean(text.trim())
    const page = Number.isInteger(result.page) ? result.page : null
    const items = Array.isArray(result.items) ? result.items.slice(0, 2000).filter(item => item && ['page', 'item', 'from', 'to', 'pageOffset'].every(key => Number.isSafeInteger(item[key]) && item[key] >= (key === 'page' ? 1 : 0)) && item.to > item.from).map(({ page, item, from, to, pageOffset }) => ({ page, item, from, to, pageOffset })) : null
    return base(entry, {
      text,
      page,
      range: selected ? { page, lastPage: Number.isInteger(result.lastPage) ? result.lastPage : page, textLength: text.length, ...(items ? { items } : {}) } : null,
      anchor: pdfPosition(result.anchor) || (page ? { page, ...(Number.isInteger(result.anchorOffset) ? { offset: result.anchorOffset } : {}) } : null),
      focus: pdfPosition(result.focus) || (page ? { page: Number.isInteger(result.lastPage) ? result.lastPage : page, ...(Number.isInteger(result.focusOffset) ? { offset: result.focusOffset } : {}) } : null),
      sourceRect: sourceRectangle(result.sourceRect),
      warnings: selectionWarnings(result.text),
      canCopy: selected,
      canCut: false,
      canPaste: false,
      canSelectAll: true
    })
  }
  return null
}
