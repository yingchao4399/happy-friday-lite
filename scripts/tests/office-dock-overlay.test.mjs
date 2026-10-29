import test from 'node:test'
import assert from 'node:assert/strict'
import { officeDockBounds } from '../../src-electron/office/dock-overlay-layout.js'

test('Office Dock collapsed bounds only cover the trigger', () => {
  assert.deepEqual(officeDockBounds({ x: 200, y: 40, width: 800, height: 600 }), {
    x: 930, y: 570, width: 48, height: 48
  })
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
