// 同一 Electron、同一生成文档、独立数据，交替比较已安装源码与预览源码。
// 已安装 Office 资源只读，绝不启动真实用户的 app/main.js。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'

const root = fileURLToPath(new URL('../', import.meta.url)), filename = fileURLToPath(import.meta.url)
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/baseline-3.0.6-manifest.json'), 'utf8'))
const variant = process.argv.find(arg => arg.startsWith('--variant='))?.slice(10)
const profileEnabled = process.argv.includes('--profile')
const uiChecks = process.argv.includes('--ui-checks')
const bootLanguage = process.argv.find(arg => arg.startsWith('--lang='))?.slice(7)
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

if (!process.versions.electron) {
  const { spawn } = await import('node:child_process')
  const require = createRequire(import.meta.url), samples = []
  for (let round = 0; round < 3; round++) {
    for (const kind of round % 2 ? ['preview', 'installed'] : ['installed', 'preview']) {
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
      const child = spawn(require('electron'), [filename, '--variant=' + kind], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = '', errors = ''
      child.stdout.on('data', chunk => { output += chunk })
      child.stderr.on('data', chunk => { errors += chunk })
      const timer = setTimeout(() => child.kill('SIGKILL'), 90000)
      const code = await new Promise(resolve => { child.once('error', () => resolve(1)); child.once('exit', resolve) })
      clearTimeout(timer)
      assert.equal(code, 0, output + errors.slice(-1500))
      const sample = output.split(/\r?\n/).map(line => { try { return JSON.parse(line) } catch { return null } }).find(item => item?.benchmark === 'office-startup')
      assert.ok(sample, output)
      samples.push(sample); console.log(JSON.stringify(sample))
    }
  }
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
  const medians = Object.fromEntries(['installed', 'preview'].map(kind => [kind, Object.fromEntries(['moduleMs', 'hostMs', 'ribbonMs', 'editableMs', 'totalMs'].map(key => [key, median(samples.filter(item => item.variant === kind).map(item => item[key]))]))]))
  const ratios = Object.fromEntries(Object.keys(medians.installed).map(key => [key, Number((medians.preview[key] / medians.installed[key]).toFixed(3))]))
  console.log(JSON.stringify({ benchmark: 'office-startup-summary', medians, ratios, target: 0.8, targetMet: ratios.ribbonMs <= .8 && ratios.editableMs <= .8 && ratios.totalMs <= .8, scope: 'isolated-host-development-comparison' }))
} else {
  const { app, BrowserWindow, dialog, ipcMain } = await import('electron')
  const profilers = new Map()
  if (profileEnabled) app.on('web-contents-created', (_event, contents) => {
    contents.debugger.attach('1.3')
    profilers.set(contents.id, contents.debugger.sendCommand('Profiler.enable')
      .then(() => contents.debugger.sendCommand('Performance.enable'))
      .then(() => contents.debugger.sendCommand('Profiler.start')).then(() => true)
      .catch(() => false))
  })
  assert.ok(['installed', 'preview'].includes(variant))
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-office-startup-'))
  app.setPath('userData', path.join(data, 'profile'))
  app.on('window-all-closed', () => {})
  const moduleRoot = variant === 'installed' ? manifest.baseline : root
  const baselineHashes = manifest.entries.map(entry => [path.join(manifest.baseline, entry.path), hash(path.join(manifest.baseline, entry.path))])
  if (variant === 'installed') {
    // 独立进程内模拟安装资源布局，使原 host 正确读取 resources/office；
    // userData 已在上面独立设置，源文件和资源本身不改动。
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: path.dirname(manifest.baseline) })
    Object.defineProperty(app, 'isPackaged', { configurable: true, value: true })
  }
  let win, host, db, ok = false
  const load = relative => import(pathToFileURL(path.join(moduleRoot, relative)).href)
  const config = await load('src-electron/config.js'); config.setDataDir(data)
  db = await load('src-electron/db.js'); db.setDataDir(data)
  // host 在 ready 前注册自定义协议，必须保持与正式 main.js 相同的加载顺序。
  const initial = performance.now()
  host = await load('src-electron/office/office-host.js')
  const moduleMs = performance.now() - initial
  dialog.showMessageBox = async () => { throw new Error('未修改文档不应弹保存确认') }
  async function main() {
    try {
      await db.initDb()
      win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { sandbox: true } })
      const beforeHost = performance.now()
      assert.equal(await host.initOfficeHost(win), true)
      const hostMs = performance.now() - beforeHost
      if (bootLanguage) {
        ipcMain.removeHandler('app:get-language')
        ipcMain.handle('app:get-language', () => bootLanguage)
      }
      const [width, height] = win.getContentSize(); host.setOfficeContentBounds({ x: 0, y: 0, width, height })
      const source = path.join(data, '普通文档.docx')
      fs.copyFileSync(path.join(root, 'vendor/happyoffice/fixtures/generated/kitchen-sink.docx'), source)
      win.showInactive()
      const beforeOpen = performance.now()
      assert.equal((await host.openOfficeFile(source)).success, true)
      const wc = host.getOfficeUiTarget().webContents
      let ribbonMs, editableMs
      for (let attempt = 0; attempt < 1000; attempt++) {
        const state = await wc.executeJavaScript('({ribbon:Boolean(document.querySelector(".ribbon-tab")),editable:Boolean(window.__aidocs?.editor?.isEditable && window.__aidocs?.editor?.state.doc.content.size > 10 && window.__aidocs.editor.view.dom.isConnected && window.__aidocs.editor.view.dom.getBoundingClientRect().width > 0)})')
        if (state.ribbon && ribbonMs === undefined) ribbonMs = performance.now() - beforeOpen
        if (state.editable) {
          // 两版使用共同的实际输入能力，不能依赖新版才有的 whenReady 调试接口。
          wc.focus()
          await wc.executeJavaScript('window.__aidocs.editor.view.focus()')
          await wc.insertText('FRIDAY_STARTUP_PROBE')
          assert.equal(await wc.executeJavaScript('window.__aidocs.editor.getText().includes("FRIDAY_STARTUP_PROBE")'), true)
          editableMs = performance.now() - beforeOpen; break
        }
        await new Promise(resolve => setTimeout(resolve, 15))
      }
      assert.ok(ribbonMs > 0 && editableMs > 0)
      const stages = await wc.executeJavaScript('performance.getEntriesByType("measure").filter(e=>e.name.startsWith("office.docs.")).map(e=>({name:e.name,ms:Math.round(e.duration)}))')
      const mainStages = performance.getEntriesByType('measure').filter(e => e.name.startsWith('office.docs.')).map(e => ({ name: e.name, ms: Math.round(e.duration) }))
      if (profileEnabled) {
        assert.equal(await profilers.get(wc.id), true, '当前编辑器 CPU 采样必须实际启动')
        const { profile } = await wc.debugger.sendCommand('Profiler.stop')
        fs.writeFileSync(path.join(root, 'app-data/diagnostics/office-startup-' + variant + '-cpu.json'), JSON.stringify(profile))
        const total = profile.nodes.reduce((sum, node) => sum + (node.hitCount || 0), 0)
        const top = profile.nodes.filter(node => node.hitCount).sort((a, b) => b.hitCount - a.hitCount).slice(0, 20)
          .map(node => ({ fn: node.callFrame.functionName, url: node.callFrame.url, line: node.callFrame.lineNumber + 1, selfPercent: Math.round(node.hitCount / total * 1000) / 10 }))
        console.log(JSON.stringify({ benchmark: 'office-startup-cpu', variant, top }))
        const metrics = await wc.debugger.sendCommand('Performance.getMetrics')
        const fonts = await wc.executeJavaScript('({faces:[...document.fonts].filter(f=>f.status!=="unloaded").map(f=>({family:f.family,status:f.status})),resources:performance.getEntriesByType("resource").filter(e=>/\\.(woff2?|ttf|otf)(?:$|\\?)/i.test(e.name)).map(e=>({name:e.name.split("/").pop(),start:Math.round(e.startTime),ms:Math.round(e.duration)}))})')
        console.log(JSON.stringify({ benchmark: 'office-startup-layout', variant, metrics: metrics.metrics.filter(entry => /^(Layout|RecalcStyle|Script|Task|Nodes|Documents)/.test(entry.name)), fonts }))
      }
      ok = true
      console.log(JSON.stringify({ benchmark: 'office-startup', variant, runtime: process.versions.electron, moduleMs: Math.round(moduleMs), hostMs: Math.round(hostMs), ribbonMs: Math.round(ribbonMs), editableMs: Math.round(editableMs), totalMs: Math.round(performance.now() - initial), stages, mainStages, sourceSha256: hash(source) }))
      if (uiChecks) {
        ok = false
        const checkLanguage = async lang => {
          const tags = { fr: 'fr-FR', ja: 'ja-JP', 'zh-TW': 'zh-TW', zh: 'zh-CN' }
          const shard = fs.readFileSync(path.join(root, 'vendor/happyoffice/apps/docs/src/renderer/i18n/ribbon', lang + '.ts'), 'utf8')
          const expected = shard.match(/ribbonTabFile:\s*'([^']+)'/)[1]
          for (let attempt = 0; attempt < 200; attempt++) {
            const state = await wc.executeJavaScript('({lang:document.documentElement.lang,file:document.querySelector(".ribbon-tab")?.textContent?.trim()})')
            if (state.lang === tags[lang] && state.file === expected) return
            await new Promise(resolve => setTimeout(resolve, 20))
          }
          assert.fail('语言包未通过真实本地协议加载: ' + lang)
        }
        await checkLanguage(bootLanguage || 'zh')
        for (const lang of ['ja', 'zh-TW', 'zh']) { wc.send('app:language-changed', lang); await checkLanguage(lang) }
        const layout = await wc.executeJavaScript('({client:document.querySelector(".editor-scroll").clientWidth,scroll:document.querySelector(".editor-scroll").scrollWidth,left:document.querySelector(".editor-scroll").scrollLeft,zoom:Number(document.querySelector(".doc-zoom").style.zoom),dock:document.querySelector(".ai-dock").clientWidth})')
        assert.ok(layout.scroll <= layout.client + 1, JSON.stringify(layout))
        assert.equal(layout.left, 0, '首次打开不应横向偏移')
        assert.ok(layout.zoom > 0 && layout.dock >= 280)
        console.log(JSON.stringify({ benchmark: 'office-startup-ui', ok: true, languages: [bootLanguage || 'zh', 'ja', 'zh-TW', 'zh'], layout }))
        ok = true
      }
    } catch (error) { console.error(error.stack) }
    finally {
      host?.shutdownOfficeHost(); db?.closeDb(); if (win && !win.isDestroyed()) win.destroy()
      for (const [file, before] of baselineHashes) assert.equal(hash(file), before, '已安装基线文件不得被验收修改')
      try { removePathNoFollowSync(data, { root: os.tmpdir() }) } catch {}
      app.exit(ok ? 0 : 1)
    }
  }
  app.whenReady().then(main).catch(error => { console.error(error); app.exit(1) })
}
