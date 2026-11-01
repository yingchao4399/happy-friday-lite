import test from 'node:test'
import assert from 'node:assert/strict'
import { officeDockBounds, moveOfficeDockPosition, resizeOfficeDockPosition } from '../../src-electron/office/dock-overlay-layout.js'

test('Office Dock collapsed bounds only cover the trigger', () => {
  assert.deepEqual(officeDockBounds({ x: 200, y: 40, width: 800, height: 600 }), {
    x: 930, y: 570, width: 48, height: 48
  })
})

test('首次拖动从右下角实际位置起算，边缘反向拖动立即响应', () => {
  const workspace = { x: 200, y: 40, width: 800, height: 600 }
  const position = moveOfficeDockPosition(workspace, { expanded: false }, -10, -20)
  assert.deepEqual(position, { x: 720, y: 510 })
  const edge = moveOfficeDockPosition(workspace, { expanded: false, position }, 10000, 10000)
  assert.deepEqual(edge, { x: 752, y: 552 })
  assert.deepEqual(moveOfficeDockPosition(workspace, { expanded: false, position: edge }, -1, -1), { x: 751, y: 551 })
})

test('拖动后展开、内容高度变化与收起均保持右下角按钮锚点', () => {
  const workspace = { x: 10, y: 20, width: 1200, height: 900 }
  const collapsed = officeDockBounds(workspace, { position: { x: 900, y: 700 } })
  const expandedState = { expanded: true, panelHeight: 300, position: { x: 900, y: 700 } }
  const position = resizeOfficeDockPosition(workspace, collapsed, expandedState)
  const expanded = officeDockBounds(workspace, { ...expandedState, position })
  assert.equal(expanded.x + expanded.width, collapsed.x + collapsed.width)
  assert.equal(expanded.y + expanded.height, collapsed.y + collapsed.height)
  const tallerState = { ...expandedState, panelHeight: 450, position }
  const tallerPosition = resizeOfficeDockPosition(workspace, expanded, tallerState)
  const taller = officeDockBounds(workspace, { ...tallerState, position: tallerPosition })
  const restoredPosition = resizeOfficeDockPosition(workspace, taller, { expanded: false, position: tallerPosition })
  assert.deepEqual(officeDockBounds(workspace, { position: restoredPosition }), collapsed)
})

test('Office Dock expanded bounds follow measured panel height and stay within workspace', () => {
  const workspace = { x: 220, y: 45, width: 500, height: 400 }
  const bounds = officeDockBounds(workspace, { expanded: true, panelHeight: 270 })
  assert.deepEqual(bounds, { x: 338, y: 93, width: 360, height: 330 })
  const narrow = officeDockBounds({ x: 80, y: 40, width: 310, height: 270 }, { expanded: true, panelHeight: 1000 })
  assert.equal(narrow.x >= 80 && narrow.y >= 40, true)
  assert.equal(narrow.x + narrow.width <= 390, true)
  assert.equal(narrow.y + narrow.height <= 310, true)
})

test('Office Dock geometry and drag deltas stay in logical pixels at every DPI', () => {
  const workspace = { x: 80, y: 40, width: 1080, height: 780 }
  const layouts = [1, 1.25, 1.5].map(() => officeDockBounds(workspace, { expanded: true, panelHeight: 360 }))
  assert.deepEqual(layouts[1], layouts[0])
  assert.deepEqual(layouts[2], layouts[0])
  const positions = [1, 1.25, 1.5].map(() => moveOfficeDockPosition(workspace, { expanded: false }, -12, -8))
  assert.deepEqual(positions[1], positions[0])
  assert.deepEqual(positions[2], positions[0])
})

test('Office Dock accepts a persisted position and clamps it to the workspace', () => {
  const workspace = { x: 10, y: 20, width: 800, height: 600 }
  assert.deepEqual(officeDockBounds(workspace, { expanded: false, position: { x: 100, y: 120 } }), {
    x: 110, y: 140, width: 48, height: 48
  })
  const clamped = officeDockBounds(workspace, { expanded: true, panelHeight: 260, position: { x: 900, y: 900 } })
  assert.equal(clamped.x + clamped.width <= 810, true)
  assert.equal(clamped.y + clamped.height <= 620, true)
})
