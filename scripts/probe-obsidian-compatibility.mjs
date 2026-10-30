import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setDataDir } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import { fetchBytes } from '../src-electron/plugins/catalog.js'
import { registerPluginCommands } from '../src-electron/plugins/manager.js'

const candidates = [
  { id: 'calendar-beta', catalogId: 'calendar', repo: 'liamcain/obsidian-calendar-plugin', tag: '2.0.0-beta.2', license: 'MIT' },
  { id: 'dataview', repo: 'blacksmithgu/obsidian-dataview', tag: '0.5.70', license: 'MIT' },
  { id: 'obsidian-outliner', repo: 'vslinko/obsidian-outliner', tag: '4.10.2', license: 'MIT' },
  { id: 'obsidian-admonition', repo: 'ebullient/obsidian-admonition', tag: '12.0.11', license: 'MIT' },
  { id: 'obsidian-tasks-plugin', repo: 'obsidian-tasks-group/obsidian-tasks', tag: '8.6.0', license: 'MIT' },
  { id: 'obsidian-linter', repo: 'platers/obsidian-linter', tag: '1.34.2', license: 'MIT' },
  { id: 'obsidian-sort-and-permute-lines', repo: 'vinzent03/obsidian-sort-and-permute-lines', tag: '0.9.0', license: 'MIT' },
  { id: 'better-word-count', repo: 'lukeleppan/better-word-count', tag: '0.10.1', license: 'MIT' },
  { id: 'quickadd', repo: 'chhoumann/quickadd', tag: '2.33.1', license: 'MIT' },
  { id: 'cmdr', repo: 'jsmorabito/obsidian-commander', tag: '0.7.0', license: 'MIT' },
]

async function releaseFiles({ repo, tag }) {
  const url = `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`
  const release = JSON.parse((await fetchBytes(url, 2 * 1024 * 1024)).toString())
  const files = {}
  for (const name of ['manifest.json', 'main.js', 'styles.css']) {
    const asset = release.assets?.find(item => item.name === name)
    if (!asset) {
      if (name !== 'styles.css') throw new Error(`PLUGIN_RELEASE_INCOMPLETE: ${name}`)
      continue
    }
    try { files[name] = await fetchBytes(asset.browser_download_url) }
    catch (error) { if (name !== 'styles.css') throw error }
  }
  return files
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-obsidian-compat-'))
const report = { ok: false, generatedAt: new Date().toISOString(), platform: process.platform, profile: temp, plugins: [] }
app.setPath('userData', path.join(temp, 'profile'))
app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  let owner
  let manager
  let exitCode = 1
  const deadline = setTimeout(() => app.exit(1), 15 * 60 * 1000)
  try {
    setDataDir(temp)
    db.setDataDir(temp)
    await db.initDb()
    owner = new BrowserWindow({ show: false, webPreferences: { preload: path.resolve('preload.cjs'), sandbox: true, contextIsolation: true } })
    manager = registerPluginCommands(owner)
    await owner.loadURL('data:text/html,<html><body>Plugin compatibility probe</body></html>')

    for (const candidate of candidates) {
      const row = { ...candidate, installed: false, started: false, restarted: false, commands: [] }
      report.plugins.push(row)
      try {
        const files = await releaseFiles(candidate)
        const manifest = JSON.parse(files['manifest.json'].toString())
        if (manifest.id !== candidate.id) throw new Error(`PLUGIN_ID_MISMATCH: ${manifest.id}`)
        const record = await manager.installPackage(files, { kind: 'compat-probe', repo: candidate.repo, release: candidate.tag })
        row.installed = true
        row.version = manifest.version
        row.mainSha256 = record.hashes['main.js']
        await manager.enable(candidate.id)
        row.started = true
        row.commands = manager.hosts.get(candidate.id)?.commands.map(command => command.id) || []
        await manager.disable(candidate.id)
        await manager.enable(candidate.id)
        row.restarted = true
        await manager.disable(candidate.id)
      } catch (error) {
        row.error = String(error?.message || error)
        await manager.disable(candidate.id).catch(() => {})
      }
      row.compatibility = row.restarted ? 'verified' : row.installed ? 'unsupported' : 'blocked'
      console.log(JSON.stringify({ id: row.id, installed: row.installed, started: row.started, restarted: row.restarted, error: row.error || null }))
    }
    report.gate = {
      requiredCommunitySamples: candidates.length,
      evaluated: report.plugins.length,
      verified: report.plugins.filter(plugin => plugin.compatibility === 'verified').length,
      blocking: report.plugins.filter(plugin => plugin.compatibility !== 'verified').map(plugin => ({ id: plugin.id, compatibility: plugin.compatibility, error: plugin.error })),
      pass: report.plugins.length === candidates.length && report.plugins.every(plugin => plugin.compatibility === 'verified'),
    }
    // A complete matrix is a successful probe even when the release gate is
    // intentionally red because a plugin needs another shim or review.
    report.ok = report.plugins.length === candidates.length
    exitCode = report.ok ? 0 : 1
  } catch (error) {
    report.error = error.stack
    console.error(error.stack)
  } finally {
    clearTimeout(deadline)
    fs.mkdirSync('artifacts/typewriter', { recursive: true })
    fs.writeFileSync('artifacts/typewriter/obsidian-compatibility-report.json', JSON.stringify(report, null, 2))
    await manager?.dispose().catch(() => {})
    db.closeDb()
    owner?.destroy()
    app.exit(exitCode)
  }
})
