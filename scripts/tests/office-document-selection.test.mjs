import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOfficeDocumentSelection } from '../../src-electron/office/document-selection.js'

const entry = (type, viewId = `${type}-1`) => ({ type, viewId })

test('normalizes Word text offsets and paragraph range without inventing paste/copy state', () => {
  const selection = normalizeOfficeDocumentSelection(entry('docs'), {
    status: 'ok',
    result: { from: 4, to: 15, anchor: { offset: 15 }, focus: { offset: 4 }, blocks: [2, 3], text: 'selected text', collapsed: false }
  })
  assert.deepEqual(selection, {
    documentId: 'docs-1', kind: 'docs', anchor: { offset: 15 }, focus: { offset: 4 }, text: 'selected text',
    range: { from: 4, to: 15 }, page: null, paragraph: { start: 2, end: 3 }, cell: null, shape: null, sourceRect: null,
    canCopy: true, canCut: true, canPaste: true, canSelectAll: true, warnings: []
  })
})

test('normalizes sheet values as tab-separated text while preserving range and bounds', () => {
  const selection = normalizeOfficeDocumentSelection(entry('sheets', 'sheets-7'), {
    status: 'ok', result: { sheet: '销售', range: 'B2:C3', bounds: { startRow: 1, startColumn: 1, endRow: 2, endColumn: 2 }, values: [['商品', '数量'], ['书', 3]] }
  })
  assert.equal(selection.documentId, 'sheets-7')
  assert.equal(selection.text, '商品\t数量\n书\t3')
  assert.deepEqual(selection.cell, { sheet: '销售', range: 'B2:C3' })
  assert.deepEqual(selection.anchor, { sheet: '销售', address: { row: 1, column: 1 } })
  assert.deepEqual(selection.focus, { sheet: '销售', address: { row: 2, column: 2 } })
  assert.equal(selection.canCut, true)
})

test('normalizes slide object selection and PDF text selection with editing capabilities filtered', () => {
  const slide = normalizeOfficeDocumentSelection(entry('slides'), {
    status: 'ok', result: { slide: 2, elements: ['shape-1'], types: ['shape'], shapeTexts: ['Heading'], text: '' }
  })
  assert.deepEqual(slide.shape, { ids: ['shape-1'], types: ['shape'], texts: ['Heading'] })
  assert.equal(slide.page, 3)
  assert.equal(slide.canCut, true)

  const pdf = normalizeOfficeDocumentSelection(entry('pdf'), {
    status: 'ok', result: { page: 4, lastPage: 5, text: 'quoted text', anchorOffset: 2, focusOffset: 9, sourceRect: { x: 1, y: 2, width: 30, height: 8 } }
  })
  assert.equal(pdf.page, 4)
  assert.deepEqual(pdf.focus, { page: 5, offset: 9 })
  assert.deepEqual(pdf.sourceRect, { x: 1, y: 2, width: 30, height: 8 })
  assert.equal(pdf.canCopy, true)
  assert.equal(pdf.canCut, false)
  assert.equal(pdf.canPaste, false)
})

test('rejects incomplete or unknown editor replies and caps transported text', () => {
  assert.equal(normalizeOfficeDocumentSelection(entry('docs'), { status: 'not_ready' }), null)
  assert.equal(normalizeOfficeDocumentSelection(entry('unknown'), { status: 'ok', result: {} }), null)
  const selection = normalizeOfficeDocumentSelection(entry('docs'), { status: 'ok', result: { text: 'x'.repeat(20_000) } })
  assert.equal(selection.text.length, 12_000)
  assert.deepEqual(selection.warnings, ['selection_text_truncated'])
})

test('PDF 反向跨页选择保留文本项及页内偏移，并过滤无效定位', () => {
  const anchor = { page: 5, item: 2, offset: 3, pageOffset: 41 }
  const focus = { page: 4, item: 1, offset: 7, pageOffset: 19 }
  const valid = { page: 4, item: 1, from: 7, to: 12, pageOffset: 12 }
  const selection = normalizeOfficeDocumentSelection(entry('pdf'), { status: 'ok', result: {
    page: 5, lastPage: 4, text: '范围文本', anchor, focus, items: [valid, { ...valid, from: -1 }, { ...valid, to: 1 }]
  } })
  assert.deepEqual(selection.anchor, anchor)
  assert.deepEqual(selection.focus, focus)
  assert.deepEqual(selection.range.items, [valid])
  assert.equal(selection.canCut, false)
})
