// 隔离运行真实 HTML renderer/preload/宿主；仅验证基础接入，不冒充完整对等。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import { officeProbeRuntime } from './lib/office-probe-runtime.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const runtime = officeProbeRuntime(root)
const filename = fileURLToPath(import.meta.url)
const hash = value => createHash('sha256').update(value).digest('hex')

if (!process.versions.electron) {
  const { spawn } = await import('node:child_process')
  const env = { ...process.env, FRIDAY_OFFICE_EXPERIMENTAL_HTML: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(createRequire(import.meta.url)('electron'), [filename, ...process.argv.slice(2)], { cwd: root, env, windowsHide: true, stdio: 'inherit' })
  const deadline = setTimeout(() => child.kill(), 360000)
  process.exitCode = await new Promise(resolve => {
    child.once('error', error => { console.error(error); resolve(1) })
    child.once('exit', code => resolve(code ?? 1))
  })
  clearTimeout(deadline)
} else {
  const { app, BrowserWindow, dialog, shell, crashReporter } = await import('electron')
  app.disableHardwareAcceleration()
  runtime.configure(app)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-html-runtime-'))
  app.setPath('userData', path.join(temp, 'profile'))
  app.setPath('crashDumps', path.join(temp, 'crashes'))
  crashReporter.start({ uploadToServer: false, compress: false })
  app.on('window-all-closed', () => {})
  const db = await runtime.load('src-electron/db.js')
  const config = await runtime.load('src-electron/config.js')
  const host = await runtime.load('src-electron/office/office-host.js')
  const report = { ok: false, checkedAt: new Date().toISOString(), runtime: runtime.evidence(), memory: { total: os.totalmem(), free: os.freemem() }, steps: [],
    limitations: ['真实 renderer/preload 与宿主的基础接入、预览和导出探针；不覆盖完整 AI、搜索/图片服务、可视编辑信任边界、复杂导出保真、真实主窗口或安装验收。', '输入使用真实 CodeMirror 接受的键盘/文本事件；保存和导出对话框选择由测试驱动。'] }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const reportFile = runtime.reportFile || path.join(root, 'artifacts/office-html-runtime-report.json')
  const persist = () => {
    fs.mkdirSync(path.dirname(reportFile), { recursive: true })
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2))
  }
  const record = step => {
    report.steps.push(step)
    persist()
    console.log('[HTML runtime probe]', step.name)
  }
  const evaluate = async (target, expression, timeoutMs = 15000) => {
    let timer
    try {
      return await Promise.race([
        target.executeJavaScript(expression),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`HTML renderer evaluate timed out: ${expression.slice(0, 100)}`)), timeoutMs) }),
      ])
    } finally { clearTimeout(timer) }
  }
  const originalMessageBox = dialog.showMessageBox
  const originalSaveDialog = dialog.showSaveDialog
  const originalShowItem = shell.showItemInFolder
  persist()
  let win
  app.whenReady().then(async () => {
    try {
      config.setDataDir(temp)
      db.setDataDir(temp)
      await db.initDb()
      win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { sandbox: true } })
      assert.equal(await host.initOfficeHost(win), true)
      host.setOfficeContentBounds({ x: 0, y: 0, width: 1200, height: 860 })
      process.env.FRIDAY_OFFICE_EXPERIMENTAL_HTML = '0'
      assert.equal((await host.getOfficeEditorCapabilities()).editors.find(editor => editor.id === 'html').available, false)
      process.env.FRIDAY_OFFICE_EXPERIMENTAL_HTML = '1'
      const capability = (await host.getOfficeEditorCapabilities()).editors.find(editor => editor.id === 'html')
      record({ name: '真实 HTML bundle 通过准入，默认公开状态仍关闭', capability })
      assert.equal(capability.available, true, capability.reasonCode)
      assert.equal(capability.enabled, false)

      const source = path.join(temp, '中文 HTML runtime.html')
      const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jU1EAAAAASUVORK5CYII=', 'base64')
      fs.writeFileSync(path.join(temp, 'fixture.png'), imageBytes)
      const text = '<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title></head><body><h1>FRIDAY_HTML_RUNTIME_8197</h1><p>Source remains unchanged.</p><img src="fixture.png" alt="Local fixture" width="16" height="16"><script>document.body.dataset.scriptProbe="FRIDAY_SCRIPT_EXECUTED"</script></body></html>'
      fs.writeFileSync(source, text)
      const sourceHash = hash(fs.readFileSync(source))
      const opened = await host.openOfficeFile(source)
      assert.equal(opened.success, true, JSON.stringify(opened))
      const wc = host.getOfficeUiTarget().webContents
      wc.on('render-process-gone', (_event, details) => { report.rendererCrash = details; persist(); console.error('[HTML runtime probe] renderer crash:', JSON.stringify(details)) })
      for (let attempt = 0; ; attempt++) {
        if (await evaluate(wc, 'Boolean(window.htmlApi?.readFile) && Boolean(document.getElementById("root")?.childElementCount)')) break
        assert.ok(attempt < 200, 'HTML renderer/preload 未就绪')
        await pause(100)
      }
      const buffer = await host.readOfficeHtmlSource(opened.viewId)
      assert.ok(buffer.includes('FRIDAY_HTML_RUNTIME_8197'))
      assert.equal(hash(fs.readFileSync(source)), sourceHash)
      const isolated = await evaluate(wc, '({require:typeof window.require,process:typeof window.process})')
      assert.deepEqual(isolated, { require: 'undefined', process: 'undefined' })
      record({ name: '实际 renderer 源码回读与 Node 隔离', viewId: opened.viewId, sourceHash, bufferHash: hash(buffer), isolated })

      let preview
      for (let attempt = 0; ; attempt++) {
        const frame = wc.mainFrame.frames.find(candidate => candidate.url.startsWith('html-preview://'))
        if (frame) {
          preview = await evaluate(frame, '({text:document.querySelector("h1")?.textContent,script:document.body?.dataset.scriptProbe,require:typeof window.require,process:typeof window.process,api:typeof window.htmlApi,image:document.images[0]?.complete&&document.images[0]?.naturalWidth})')
          if (preview.text?.includes('FRIDAY_HTML_RUNTIME_8197') && preview.image) break
        }
        assert.ok(attempt < 200, 'HTML 预览或本地图片未就绪')
        await pause(100)
      }
      assert.equal(preview.script, undefined, '编辑预览不得执行作者脚本')
      assert.equal(preview.require, 'undefined')
      assert.equal(preview.process, 'undefined')
      assert.equal(preview.api, 'undefined')
      record({ name: '编辑预览隔离作者脚本，本地图片加载且不暴露 preload', preview })

      const beforeOperation = await host.readOfficeHtmlDocument(opened.viewId)
      await assert.rejects(host.executeOfficeHtmlDocument({ documentId: beforeOperation.documentId, kind: 'replace', revision: beforeOperation.revision + 1, source: '<p>STALE_OVERWRITE</p>' }), { code: 'OFFICE_SOURCE_REVISION_CHANGED' })
      const replaced = await host.executeOfficeHtmlDocument({ documentId: beforeOperation.documentId, kind: 'replace', revision: beforeOperation.revision, source: beforeOperation.source + '\n<!-- FRIDAY_MAIN_ASSISTANT_REPLACE -->' })
      assert.equal(replaced.ok, true)
      const afterOperation = await host.readOfficeHtmlDocument(opened.viewId)
      assert.ok(afterOperation.revision > beforeOperation.revision)
      assert.ok(afterOperation.source.includes('FRIDAY_MAIN_ASSISTANT_REPLACE'))
      assert.equal(hash(fs.readFileSync(source)), sourceHash)
      record({ name: '主助手读取权威源码、拒绝过期 revision、精确版本修改保留未保存状态', beforeRevision: beforeOperation.revision, afterRevision: afterOperation.revision, taskId: replaced.taskId })

      // 通过真实编辑器输入，确认宿主读取未保存缓冲，并可将其持久化。
      win.showInactive()
      await evaluate(wc, `(() => { const button = [...document.querySelectorAll('button')].find(node => ['Source','源码'].includes(node.dataset.tip)); if (!button) throw Error('HTML_SOURCE_CONTROL_MISSING'); button.click(); return true })()`)
      await pause(300)
      wc.focus()
      const sourceFocus = await evaluate(wc, '(() => { const node=document.querySelector(".cm-content");node.focus();const rect=node.getBoundingClientRect();return {focused:document.activeElement===node,width:rect.width,height:rect.height} })()')
      assert.equal(sourceFocus.focused, true)
      assert.ok(sourceFocus.width > 0 && sourceFocus.height > 0)
      record({ name: '切换可见源码模式并聚焦 CodeMirror', sourceFocus })
      let insertTimer
      try { await Promise.race([wc.insertText('\n<!-- FRIDAY_HTML_UNSAVED_EDIT_8197 -->'), new Promise((_resolve, reject) => { insertTimer=setTimeout(() => reject(new Error('HTML_NATIVE_INSERT_TIMEOUT')), 10000) })]) }
      finally { clearTimeout(insertTimer) }
      let edited
      for (let attempt = 0; ; attempt++) {
        edited = await host.readOfficeHtmlSource(opened.viewId)
        if (edited.includes('FRIDAY_HTML_UNSAVED_EDIT_8197')) break
        assert.ok(attempt < 100, '真实源码输入未进入 HTML 文档缓冲')
        await pause(100)
      }
      assert.equal(hash(fs.readFileSync(source)), sourceHash)
      assert.equal(await host.queryOfficeDirty(opened.viewId), true)
      const saved = await host.autoSaveOfficeFile(opened.viewId)
      assert.equal(saved.success, true, JSON.stringify(saved))
      assert.ok(fs.readFileSync(source, 'utf8').includes('FRIDAY_HTML_UNSAVED_EDIT_8197'))
      const savedHash = hash(fs.readFileSync(source))
      record({ name: '未保存编辑可回读，真实保存持久化且脏状态清除', beforeSha256: sourceHash, afterSha256: savedHash, saved })

      // 三种导出走生产 IPC 和实际转换器，只替代用户在保存对话框中的路径选择。
      shell.showItemInFolder = () => {}
      const exports = []
      for (const format of ['html', 'pdf', 'docx']) {
        const target = path.join(temp, `runtime-export.${format}`)
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
        const method = { html: 'exportHtml', pdf: 'exportPdf', docx: 'exportDocx' }[format]
        const result = await evaluate(wc, `window.htmlApi.${method}(${JSON.stringify({ html: edited, suggestedName: 'runtime-export' })})`, 120000)
        assert.equal(result.ok, true, JSON.stringify(result))
        assert.equal(result.path, target)
        const bytes = fs.readFileSync(target)
        assert.ok(bytes.length > 0)
        if (format === 'html') {
          assert.ok(bytes.toString('utf8').includes('FRIDAY_HTML_RUNTIME_8197'))
          assert.match(bytes.toString('utf8'), /data:image\/png;base64,/)
        } else if (format === 'pdf') {
          assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
          const pdfLib = createRequire(path.join(root, 'vendor/happyoffice/apps/pdf/package.json'))('pdf-lib')
          const document = await pdfLib.PDFDocument.load(bytes)
          assert.ok(document.getPageCount() > 0)
        } else {
          const zip = new AdmZip(bytes)
          const document = zip.readAsText('word/document.xml')
          assert.ok(document.includes('FRIDAY_HTML_RUNTIME_8197'), 'DOCX 缺少源文档标题')
          assert.ok(zip.getEntry('[Content_Types].xml'))
        }
        exports.push({ format, path: target, bytes: bytes.length, sha256: hash(bytes) })
      }
      dialog.showSaveDialog = originalSaveDialog
      shell.showItemInFolder = originalShowItem
      assert.equal(hash(fs.readFileSync(source)), savedHash)
      record({ name: 'HTML 单文件图片内联、PDF 可解析、DOCX 原生文字回读', exports, sourceUnchanged: true })

      await evaluate(wc, 'window.htmlApi.setDirty(true)')
      await pause(100)
      assert.equal(await host.queryOfficeDirty(opened.viewId), true)
      dialog.showMessageBox = async (...args) => {
        const options = args.at(-1)
        assert.equal(options.cancelId, 2)
        return { response: 2 }
      }
      assert.equal(await host.closeOfficeFile(opened.viewId), false)
      assert.ok(host.getOfficeState().some(view => view.viewId === opened.viewId && view.open))
      assert.equal(hash(fs.readFileSync(source)), savedHash)
      dialog.showMessageBox = async () => ({ response: 1 })
      assert.equal(await host.closeOfficeFile(opened.viewId), true)
      record({ name: '取消关闭保留标签；放弃关闭不保存源文件', sourceHashUnchanged: hash(fs.readFileSync(source)) === savedHash })

      const blank = await host.newOfficeDocument('html', undefined, 'HTML runtime new')
      assert.equal(blank.success, true)
      assert.ok(path.resolve(blank.filePath).startsWith(path.resolve(temp) + path.sep))
      assert.match(fs.readFileSync(blank.filePath, 'utf8'), /<!doctype html>/i)
      assert.equal(await host.closeOfficeFile(blank.viewId), true)
      record({ name: '新建 HTML 真实落盘', filePath: blank.filePath, sha256: hash(fs.readFileSync(blank.filePath)) })

      const require = createRequire(path.join(root, 'vendor/happyoffice/apps/pdf/package.json'))
      const pdf = await require('pdf-lib').PDFDocument.create()
      pdf.addPage().drawText('FRIDAY_HTML_PDF_COEXISTENCE')
      const pdfPath = path.join(temp, 'existing-editor.pdf')
      fs.writeFileSync(pdfPath, await pdf.save())
      const openedPdf = await host.openOfficeFile(pdfPath)
      assert.equal(openedPdf.success, true)
      record({ name: 'HTML 后仍可加载原 PDF 引擎', viewId: openedPdf.viewId, loadedEditors: host.getOfficeLoadedEditors() })
      report.ok = true
    } catch (error) {
      report.error = error.stack || String(error)
      console.error(report.error)
    } finally {
      dialog.showMessageBox = originalMessageBox
      dialog.showSaveDialog = originalSaveDialog
      shell.showItemInFolder = originalShowItem
      persist()
      host.shutdownOfficeHost()
      db.closeDb()
      if (win && !win.isDestroyed()) win.destroy()
      app.exit(report.ok ? 0 : 1)
    }
  })
}
