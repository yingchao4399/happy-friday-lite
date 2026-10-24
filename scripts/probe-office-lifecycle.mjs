// Node 父进程提供独立超时，避免关闭 renderer 的已知问题卡住验收本身。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'

const filename = fileURLToPath(import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))
const mode = process.argv.find(value => value.startsWith('--mode='))?.slice(7) || 'host'
const kind = process.argv.find(value => value.startsWith('--kind='))?.slice(7) || 'docs'
const iterations = Number(process.argv.find(value => value.startsWith('--iterations='))?.slice(13) || 3)
assert.ok(['host', 'direct'].includes(mode) && Number.isInteger(iterations) && iterations >= 1 && iterations <= 20)
assert.ok(['docs', 'sheets', 'slides', 'pdf'].includes(kind))

if (!process.versions.electron) {
  const { spawn } = await import('node:child_process')
  const require = createRequire(import.meta.url)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [filename, ...process.argv.slice(2)], { cwd: root, env, windowsHide: true, stdio: 'inherit' })
  const deadline = setTimeout(() => { console.error(JSON.stringify({ ok: false, mode, runnerTimeout: true })); child.kill('SIGKILL') }, Math.max(45000, iterations * 12000))
  process.exitCode = await new Promise(resolve => { child.once('error', () => resolve(1)); child.once('exit', code => resolve(code ?? 1)) })
  clearTimeout(deadline)
} else {
  const { app, BrowserWindow, webContents, dialog } = await import('electron')
  const { setDataDir } = await import('../src-electron/config.js')
  const db = await import('../src-electron/db.js')
  const { initOfficeSession } = await import('../src-electron/office/office-session.js')
  const { openOfficeFile, closeOfficeFile, getOfficeUiTarget, shutdownOfficeHost, setOfficeContentBounds } = await import('../src-electron/office/office-host.js')
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-office-lifecycle-'))
  app.setPath('userData', path.join(data, 'profile'))
  app.on('window-all-closed', () => {})
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  dialog.showMessageBox = async () => { throw new Error('未修改的临时文档不应触发保存确认') }
  let win, ok = false
  async function main() {
  try {
    setDataDir(data); db.setDataDir(data); await db.initDb()
    win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { sandbox: true } })
    assert.equal(await initOfficeSession(win), true)
    const [width, height] = win.getContentSize(); setOfficeContentBounds({ x: 0, y: 0, width, height })
    const baseline = webContents.getAllWebContents().length
    const source = path.join(data, '生命周期验收.' + { docs: 'docx', sheets: 'xlsx', slides: 'pptx', pdf: 'pdf' }[kind])
    if (kind === 'docs') fs.copyFileSync(path.join(root, 'vendor', 'happyoffice', 'fixtures', 'generated', 'kitchen-sink.docx'), source)
    else if (kind === 'sheets') {
      const XLSX = (await import('xlsx')).default
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['项目', '值'], ['生命周期', 42]]), '验收')
      XLSX.writeFile(book, source)
    } else if (kind === 'slides') {
      const PptxGenJS = (await import('pptxgenjs')).default
      const deck = new PptxGenJS()
      deck.addSlide().addText('生命周期验收', { x: 1, y: 1, w: 6, h: 2 })
      await deck.writeFile({ fileName: source })
    } else {
      const require = createRequire(path.join(root, 'vendor/happyoffice/apps/pdf/package.json'))
      const { PDFDocument } = require('pdf-lib')
      const pdf = await PDFDocument.create()
      pdf.addPage().drawText('FRIDAY lifecycle PDF')
      fs.writeFileSync(source, await pdf.save())
    }
    const samples = []
    for (let index = 0; index < iterations; index++) {
      const started = performance.now()
      const result = await openOfficeFile(source)
      assert.equal(result.success, true)
      const wc = getOfficeUiTarget().webContents
      let ready = false
      for (let attempt = 0; attempt < 300; attempt++) {
        ready = await wc.executeJavaScript(kind === 'docs'
          ? 'Boolean(window.__aidocs?.editor?.state.doc.content.size > 10)'
          : 'window.__genofficeControl?.({cmd:"selection"})?.status === "ok"')
        if (ready) break
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      assert.equal(ready, true, kind + ' 编辑器必须实际就绪')
      if (kind === 'docs') await wc.executeJavaScript('window.__aidocs.whenReady()')
      const readyMs = performance.now() - started
      assert.equal(await closeOfficeFile(result.viewId), true)
      if (mode === 'direct') {
        console.log(JSON.stringify({ stage: 'closing', iteration: index + 1, contentsId: wc.id }))
        wc.close({ waitForBeforeUnload: false })
        for (let attempt = 0; attempt < 100 && !wc.isDestroyed(); attempt++) await new Promise(resolve => setTimeout(resolve, 25))
        assert.equal(wc.isDestroyed(), true, '关闭后 WebContents 必须销毁')
      }
      await new Promise(resolve => setTimeout(resolve, 200))
      const sample = {
        kind, iteration: index + 1, readyMs: Math.round(readyMs),
        contents: webContents.getAllWebContents().length,
        workingSetKB: app.getAppMetrics().reduce((sum, process) => sum + process.memory.workingSetSize, 0),
      }
      samples.push(sample); console.log(JSON.stringify(sample))
    }
    let memoryTrend = null
    if (mode === 'direct' || iterations === 20) assert.ok(samples.every(sample => sample.contents === baseline), '每次关闭都必须回到初始 WebContents 数量')
    if (iterations === 20) {
      const steady = samples.slice(5)
      const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length
      const xMean = mean(steady.map(sample => sample.iteration)), yMean = mean(steady.map(sample => sample.workingSetKB))
      const slopeKB = steady.reduce((sum, sample) => sum + (sample.iteration - xMean) * (sample.workingSetKB - yMean), 0) / steady.reduce((sum, sample) => sum + (sample.iteration - xMean) ** 2, 0)
      const growthKB = mean(steady.slice(-5).map(sample => sample.workingSetKB)) - mean(steady.slice(0, 5).map(sample => sample.workingSetKB))
      memoryTrend = { slopeKBPerCycle: Math.round(slopeKB), growthKB: Math.round(growthKB) }
      assert.ok(slopeKB < 2048 && growthKB < 65536, '预热后的内存不能持续按文件数量增加')
    }
    ok = true
    console.log(JSON.stringify({ ok, kind, mode, baseline, samples, memoryTrend }))
  } catch (error) { console.error(error.stack) }
  finally {
    shutdownOfficeHost(); db.closeDb(); if (win && !win.isDestroyed()) win.destroy()
    try { removePathNoFollowSync(data, { root: os.tmpdir() }) } catch {}
    app.exit(ok ? 0 : 1)
  }
  }
  app.whenReady().then(main).catch(error => { console.error(error); app.exit(1) })
}
