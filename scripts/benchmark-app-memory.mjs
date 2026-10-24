// 完整 main.js + 生产前端 + Office，独立数据；Windows 统计整个进程树，含 DSH。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { spawn, execFileSync } from 'node:child_process'

const filename = fileURLToPath(import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))
const argument = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const outputRoot = path.join(root, 'app-data/diagnostics/performance', argument('label') || '')

if (!process.versions.electron) {
  const baseline = argument('official-root')
  const previewRoot = argument('preview-root') || root
  const dataset = argument('database')
  assert.ok(baseline && dataset, '--official-root 和 --database 必须显式指定')
  fs.mkdirSync(outputRoot, { recursive: true })
  const require = createRequire(import.meta.url)
  const rounds = Number(argument('rounds') || 3)
  const results = []
  for (let round = 0; round < rounds; round++) {
    for (const variant of round % 2 ? ['preview', 'official'] : ['official', 'preview']) {
      const data = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-app-memory-'))
      fs.copyFileSync(dataset, path.join(data, 'friday.db'))
      const resultFile = path.join(outputRoot, `${variant}-${round}.json`)
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
      const child = spawn(require('electron'), [filename, `--app-root=${variant === 'official' ? baseline : previewRoot}`, `--data=${data}`, `--result=${resultFile}`, `--variant=${variant}`, ...(argument('pdf') ? [`--pdf=${argument('pdf')}`] : [])], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      // 不向终端输出应用正文、路径日志或模型配置，仅保留独立诊断文件。
      const log = fs.createWriteStream(path.join(outputRoot, `${variant}-${round}.log`))
      child.stdout.pipe(log); child.stderr.pipe(log)
      const timeout = setTimeout(() => child.kill(), 180000)
      const code = await new Promise(resolve => { child.once('error', () => resolve(1)); child.once('exit', resolve) })
      clearTimeout(timeout); log.end()
      assert.equal(code, 0, `${variant} failed; inspect isolated log`)
      const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'))
      results.push({ round, ...result }); console.log(JSON.stringify({ round, ...result }))
      // 保留隔离数据库，便于核对结果；从不删除/覆盖用户数据。
      await sleep(1500)
    }
  }
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
  const scenarios = [...new Set(results[0].samples.map(sample => sample.scenario))]
  const comparisons = scenarios.map(scenario => {
    const values = variant => results.filter(result => result.variant === variant).flatMap(result => result.samples.filter(sample => sample.scenario === scenario))
    const official = values('official'), preview = values('preview')
    return { scenario, officialPrivateMB: median(official.map(s => s.privateMB)), previewPrivateMB: median(preview.map(s => s.privateMB)), officialWorkingSetMB: median(official.map(s => s.workingSetMB)), previewWorkingSetMB: median(preview.map(s => s.workingSetMB)) }
  })
  const summary = { benchmark: 'whole-app-memory', rounds, baseline: path.basename(baseline), datasetBytes: fs.statSync(dataset).size, comparisons,
    passed: comparisons.every(item => item.previewPrivateMB < item.officialPrivateMB && item.previewWorkingSetMB < item.officialWorkingSetMB) }
  fs.writeFileSync(path.join(outputRoot, 'summary.json'), JSON.stringify({ ...summary, results }, null, 2))
  console.log(JSON.stringify(summary))
  if (!summary.passed) process.exitCode = 1
} else {
  const { app, BrowserWindow, webContents } = await import('electron')
  const appRoot = argument('app-root'), data = argument('data'), variant = argument('variant')
  app.setPath('userData', data)
  Object.defineProperty(app, 'isPackaged', { configurable: true, value: true })
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: fs.existsSync(path.join(appRoot, 'resources/office')) ? path.join(appRoot, 'resources') : path.dirname(appRoot) })
  // 验收窗口正常可见但不抢用户当前输入焦点。
  BrowserWindow.prototype.show = BrowserWindow.prototype.showInactive
  const samples = []
  let pdfResult = null
  let ok = false
  const load = relative => import(pathToFileURL(path.join(appRoot, relative)).href)
  const before = performance.now()
  async function until(fn, message, timeout = 60000) {
    const end = Date.now() + timeout
    while (Date.now() < end) { try { const value = await fn(); if (value) return value } catch {} await sleep(100) }
    throw new Error(message)
  }
  function memory(scenario) {
    // 只输出本次测试进程树的数值；不枚举用户其他应用的命令行。
    const command = `$all = Get-CimInstance Win32_Process
$ids = [System.Collections.Generic.HashSet[int]]::new()
[void]$ids.Add(${process.pid})
do {
  $changed = $false
  foreach ($p in $all) {
    if ($p.ProcessId -ne $PID -and $ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) { $changed = $true }
  }
} while ($changed)
$rows = foreach ($id in $ids) {
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($p) { [pscustomobject]@{ privateBytes=$p.PrivateMemorySize64; workingBytes=$p.WorkingSet64 } }
}
$physical = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $ids.Contains([int]$_.IDProcess) }
[pscustomobject]@{
  processCount=@($rows).Count
  privateMB=[math]::Round(($rows | Measure-Object privateBytes -Sum).Sum/1MB,1)
  workingSetMB=[math]::Round(($rows | Measure-Object workingBytes -Sum).Sum/1MB,1)
  privateWorkingSetMB=[math]::Round(($physical | Measure-Object WorkingSetPrivate -Sum).Sum/1MB,1)
} | ConvertTo-Json -Compress`
    return { scenario, ...JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true })) }
  }
  async function sample(scenario) {
    await sleep(4000)
    for (let index = 0; index < 3; index++) { samples.push(memory(scenario)); await sleep(600) }
  }
  async function runBenchmark() {
  try {
    await load('main.js')
    await app.whenReady()
    const win = await until(() => BrowserWindow.getAllWindows().find(w => !w.isDestroyed()), '主窗口未创建')
    const run = code => win.webContents.executeJavaScript(code)
    await until(() => run('!!(window.electronAPI && document.querySelector("#app")?.children.length)'), '主界面未就绪')
    await until(() => run('window.electronAPI.invoke("get_notes", {}).then(x=>Array.isArray(x))'), '笔记 IPC 未就绪')
    await sample('home')
    if (process.argv.includes('--idle-only')) {
      await sleep(10000)
      await sample('idle')
      ok = true
      const rendererMemory = await run('({usedJSHeapSize:performance.memory?.usedJSHeapSize,totalJSHeapSize:performance.memory?.totalJSHeapSize,domNodes:document.querySelectorAll("*").length,resources:performance.getEntriesByType("resource").map(x=>({type:x.initiatorType,bytes:x.decodedBodySize}))})')
      fs.writeFileSync(path.join(outputRoot, 'idle-current.png'), (await win.webContents.capturePage()).toPNG())
      fs.writeFileSync(argument('result'), JSON.stringify({ variant, samples, processes: app.getAppMetrics(), mainMemory: process.memoryUsage(), rendererMemory }, null, 2))
      return
    }
    await run('location.hash = "#/note"')
    await until(() => run('!!document.querySelector(".note-item")'), '笔记列表未渲染')
    await run('document.querySelector(".note-item").click()')
    await until(() => run('!!document.querySelector(".tiptap, .ProseMirror")'), '笔记编辑器未渲染')
    await sample('note')
    const host = await load('src-electron/office/office-host.js')
    const document = path.join(data, 'memory-benchmark.docx')
    fs.copyFileSync(path.join(root, 'vendor/happyoffice/fixtures/generated/kitchen-sink.docx'), document)
    const result = await host.openOfficeFile(document, { notifyOpened: true })
    assert.equal(result.success, true)
    const wc = await until(async () => {
      for (const contents of webContents.getAllWebContents()) {
        if (contents.id !== win.webContents.id && !contents.isDestroyed() && await contents.executeJavaScript('!!window.__aidocs').catch(() => false)) return contents
      }
      return null
    }, 'Office 视图未创建')
    await until(() => wc.executeJavaScript('!!(window.__aidocs?.editor?.isEditable && window.__aidocs.editor.state.doc.content.size > 10)'), 'Office 文档未可编辑')
    await sample('word-open')
    assert.equal(await wc.executeJavaScript('window.__aidocs.editor.getText().length > 10'), true)
    await host.closeOfficeFile(result.viewId)
    await run('location.hash = "#/note"')
    await sample('word-closed')
    if (argument('pdf')) {
      // 两版均打开独立文件副本，关闭后再统计整个应用；原 PDF 从不写入。
      const original = argument('pdf')
      const hash = file => new Promise((resolve, reject) => {
        const digest = crypto.createHash('sha256'), stream = fs.createReadStream(file)
        stream.on('data', chunk => digest.update(chunk)); stream.on('error', reject); stream.on('end', () => resolve(digest.digest('hex')))
      })
      const sourceHash = await hash(original), pdf = path.join(data, 'memory-benchmark.pdf')
      fs.copyFileSync(original, pdf)
      const started = performance.now()
      win.setAlwaysOnTop(true)
      const opened = await host.openOfficeFile(pdf, { notifyOpened: true })
      assert.equal(opened.success, true)
      const pdfContents = await until(async () => {
        for (const contents of webContents.getAllWebContents()) {
          if (contents.id !== win.webContents.id && !contents.isDestroyed() && await contents.executeJavaScript('!!document.querySelector(".pdf-page canvas")').catch(() => false)) return contents
        }
      }, 'PDF 页面未渲染', 90000)
      const readyMs = Math.round(performance.now() - started)
      const pages = await pdfContents.executeJavaScript('document.querySelector(".tb-page-total")?.textContent')
      await sample('pdf-open')
      const point = await pdfContents.executeJavaScript('({x:Math.round(innerWidth/2),y:Math.round(innerHeight/2)})')
      const wheel = setInterval(() => pdfContents.sendInputEvent({ type: 'mouseWheel', ...point, deltaY: -65, deltaX: 0, canScroll: true }), 40)
      try { await sleep(10000) } finally { clearInterval(wheel) }
      await sample('pdf-scrolled')
      await host.closeOfficeFile(opened.viewId)
      await run('location.hash = "#/note"')
      await sample('pdf-closed')
      assert.equal(await hash(original), sourceHash, '原 PDF 哈希改变')
      pdfResult = { readyMs, pages, bytes: fs.statSync(original).size, sourceHashUnchanged: true }
      win.setAlwaysOnTop(false)
    }
    ok = true
    fs.writeFileSync(argument('result'), JSON.stringify({ variant, runtime: process.versions.electron, samples, pdf: pdfResult, elapsedMs: Math.round(performance.now() - before) }, null, 2))
  } catch (error) { console.error('[memory-benchmark]', error.stack) }
  finally { app.exit(ok ? 0 : 1) }
  }
  // 不在 ESM 顶层等待 ready：Electron 要等入口模块求值结束才触发 ready。
  runBenchmark()
}
