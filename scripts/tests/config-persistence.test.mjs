import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadConfig, saveConfig, setDataDir } from '../../src-electron/config.js'

test('partial config writes preserve unrelated settings and nested branches', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-config-'))
  try {
    setDataDir(dir)
    saveConfig({
      language: 'en-US',
      fontSize: 18,
      globalAgentDock: { visible: false, appearance: 'compact' },
      sidebarModules: { office: false }
    })

    saveConfig({ globalAgentDock: { visible: true } })
    const config = loadConfig()

    assert.equal(config.language, 'en-US')
    assert.equal(config.fontSize, 18)
    assert.equal(config.globalAgentDock.visible, true)
    assert.equal(config.globalAgentDock.appearance, 'compact')
    assert.equal(config.globalAgentDock.mode, 'auto')
    assert.equal(config.sidebarModules.office, false)
    assert.equal(config.sidebarModules.drawing, true)
  } finally {
    setDataDir(null)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
