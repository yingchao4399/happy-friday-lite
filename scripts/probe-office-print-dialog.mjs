// 隔离窗口从各类 Office 原版文件菜单进入系统打印，核验真实输出或取消。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import crypto from 'node:crypto'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'

const filename = fileURLToPath(import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))
const kind = process.argv.find(arg => arg.startsWith('--kind='))?.slice(7) || 'docs'
const outputArg = process.argv.find(arg => arg.startsWith('--output='))?.slice(9)
assert.ok(['docs', 'sheets', 'slides', 'pdf'].includes(kind))
if (!process.versions.electron) {
  const { spawn } = await import('node:child_process')
  const require = createRequire(import.meta.url)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [filename, '--kind=' + kind, ...(outputArg ? ['--output=' + outputArg] : [])], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr)
  process.exitCode = await new Promise(resolve => { child.once('error', () => resolve(1)); child.once('exit', code => resolve(code ?? 1)) })
} else {
  const { app, BrowserWindow, clipboard } = await import('electron')
  const { setDataDir } = await import('../src-electron/config.js')
  const db = await import('../src-electron/db.js')
  const { initOfficeHost, openOfficeFile, getOfficeUiTarget, setOfficeContentBounds, shutdownOfficeHost, queryOfficeDirty } = await import('../src-electron/office/office-host.js')
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-office-print-dialog-'))
  app.setPath('userData', path.join(data, 'profile'))
  app.on('window-all-closed', () => {})
  let win, ok = false
  let nativeResult
  let nativeError
  const title = `Friday Office 打印验收 ${kind}（隔离数据）`
  app.on('web-contents-created', (_event, contents) => {
    const original = contents.print.bind(contents)
    contents.print = (options, callback) => {
      console.log(JSON.stringify({ stage: 'native-print-called', kind, contents: contents.id, silent: options?.silent === true, landscape: options?.landscape, pageSize: options?.pageSize }))
      if (kind === 'sheets' || kind === 'slides') {
        const helper = BrowserWindow.fromWebContents(contents)
        try {
          assert.ok(helper?.isVisible(), 'Windows 系统打印辅助窗口必须可见')
          assert.equal(helper.getParentWindow(), null, '打印窗口须可独立从任务栏与辅助功能定位')
          assert.equal(win.isEnabled(), false, '打印期间主编辑器必须禁用')
        } catch (error) { nativeError = error; throw error }
        console.log(JSON.stringify({ stage: 'print-owner-verified', kind, independentWindow: true, editorDisabled: true }))
      }
      return original(options, (success, failureReason) => {
        nativeResult = { success, failureReason }
        console.log(JSON.stringify({ stage: 'native-print-returned', kind, ...nativeResult }))
        callback?.(success, failureReason)
      })
    }
  })
  app.on('browser-window-created', (_event, window) => {
    // 仅命名验收宿主；保留产品打印辅助窗口的标题与可访问性。
    if (BrowserWindow.getAllWindows().length === 1) {
      window.on('page-title-updated', event => { event.preventDefault(); window.setTitle(title) })
      window.setTitle(title)
    }
  })
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  async function until(check, label) {
    for (let attempt = 0; attempt < 9000; attempt++) { if (await check()) return; await pause(100) }
    throw new Error('打印验收超时: ' + label)
  }
  const main = async () => { try {
    console.error(JSON.stringify({ stage: 'electron-starting' }))
    console.error(JSON.stringify({ stage: 'electron-ready' }))
    setDataDir(data); db.setDataDir(data); await db.initDb()
    const source = path.join(data, '打印验收.' + { docs: 'docx', sheets: 'xlsx', slides: 'pptx', pdf: 'pdf' }[kind])
    if (kind === 'docs') fs.copyFileSync(path.join(root, 'vendor/happyoffice/fixtures/generated/kitchen-sink.docx'), source)
    else if (kind === 'sheets') {
      const XLSX = (await import('xlsx')).default
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['PRINT PROBE', 'Value'], ['Friday', 42]]), '打印')
      XLSX.writeFile(book, source)
    } else if (kind === 'slides') {
      const PptxGenJS = (await import('pptxgenjs')).default
      const deck = new PptxGenJS(); deck.addSlide().addText('FRIDAY PRINT PROBE', { x: 1, y: 1, w: 6, h: 2 })
      await deck.writeFile({ fileName: source })
    } else {
      const require = createRequire(path.join(root, 'vendor/happyoffice/apps/pdf/package.json'))
      const { PDFDocument } = require('pdf-lib')
      const pdf = await PDFDocument.create(); pdf.addPage().drawText('FRIDAY PRINT PROBE', { x: 50, y: 700, size: 18 })
      fs.writeFileSync(source, await pdf.save())
    }
    const digest = () => crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex')
    const originalHash = digest()
    win = new BrowserWindow({ title, show: true, width: 1280, height: 900, webPreferences: { sandbox: true } })
    console.error(JSON.stringify({ stage: 'window-created' }))
    assert.equal(await initOfficeHost(win), true)
    console.error(JSON.stringify({ stage: 'office-ready' }))
    const layout = () => { const [width, height] = win.getContentSize(); setOfficeContentBounds({ x: 0, y: 0, width, height }) }
    win.on('resize', layout); layout()
    const opened = await openOfficeFile(source); assert.equal(opened.success, true)
    const wc = getOfficeUiTarget().webContents; win.show(); win.focus(); wc.focus()
    const run = code => wc.executeJavaScript(code, true)
    await until(() => run(kind === 'docs' ? 'Boolean(window.__aidocs?.editor?.state.doc.content.size > 10)' : 'window.__genofficeControl?.({cmd:"selection"})?.status === "ok"'), '编辑器就绪')
    if (kind === 'docs') {
      await run('window.__aidocs.whenReady()'); await run('window.__aidocs.editor.view.focus()')
      await wc.insertText('FRIDAY_PRINT_DIALOG_PROBE')
    }
    const dirty = await queryOfficeDirty(opened.viewId)
    // 仅把本次合成夹具的输出路径放入剪贴板，系统保存框仍由原生交互完成。
    if (outputArg) clipboard.writeText(path.resolve(outputArg))
    console.log(JSON.stringify({ stage: 'before-print', kind, title, dirty }))
    if (kind === 'pdf') await run(`window.__printProbeAfter=false;window.addEventListener('afterprint',()=>{window.__printProbeAfter=true},{once:true})`)
    await run(`document.querySelector('.ribbon-tab-file').click()`)
    await until(() => run('Boolean(document.querySelector("[data-office-file-action=print]"))'), '文件打印菜单')
    await run(`document.querySelector('[data-office-file-action=print]').click()`)
    if (kind === 'docs' || kind === 'slides') {
      await until(() => run('Boolean(document.querySelector(".print-dialog .modal-actions .primary:not(:disabled)"))'), '原版打印预览')
      fs.writeFileSync(path.join(root, `app-data/diagnostics/office-print-preview-${kind}.png`), (await wc.capturePage()).toPNG())
      await run(`document.querySelector('.print-dialog .modal-actions .primary').click()`)
    } else if (kind === 'pdf') {
      await until(() => run('Boolean(document.querySelector(".pdf-modal-mask .pdf-modal-btn.primary"))'), 'PDF 打印范围')
      await run(`document.querySelector('.pdf-modal-mask .pdf-modal-btn.primary').click()`)
    }
    await until(() => {
      if (nativeError) throw nativeError
      return kind === 'pdf' ? run('window.__printProbeAfter === true') : Boolean(nativeResult)
    }, '用户完成系统打印')
    if (nativeResult) {
      assert.equal(nativeResult.success, Boolean(outputArg))
      if (!outputArg) assert.match(nativeResult.failureReason, /cancel/i)
    }
    // Chromium 在 afterprint 之后仍会结束原生回调，立即 app.exit 会打断 IO 清理。
    await pause(kind === 'pdf' ? 1000 : 150)
    if (!outputArg && (kind === 'docs' || kind === 'slides')) assert.equal(await run('Boolean(document.querySelector(".print-dialog .primary:not(:disabled)"))'), true, '取消后应保留可用的预览')
    if (outputArg) {
      const output = path.resolve(outputArg)
      await until(() => fs.existsSync(output) && fs.statSync(output).size > 1000, '系统虚拟打印机输出')
      const bytes = fs.readFileSync(output)
      assert.equal(bytes.subarray(0, 4).toString(), '%PDF')
      const require = createRequire(path.join(root, 'vendor/happyoffice/apps/pdf/package.json'))
      const { PDFDocument } = require('pdf-lib')
      const printed = await PDFDocument.load(bytes)
      assert.equal(printed.getPageCount(), 1, '单页夹具应只打印一页')
      if (kind === 'slides') {
        const { width, height } = printed.getPage(0).getSize()
        assert.ok(width > height, '横向幻灯片必须按横向纸张打印，不能旋转内容塞入纵向纸张')
        assert.equal(printed.getPage(0).getRotation().angle % 360, 0, '横向打印页面不应附加旋转')
      }
      {
        const { getDocument } = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href)
        const loading = getDocument({ data: new Uint8Array(bytes) })
        const doc = await loading.promise
        try {
          const page = await doc.getPage(1)
          let text = (await page.getTextContent()).items.map(item => item.str || '').join(' ')
          // Microsoft 虚拟打印机可能将页面栅格化，不能把“无文本层”误判成空白输出。
          // 解码真实打印产物并识别测试标记，同时保留可人工核对的图像。
          if (!text.trim()) {
            const { createCanvas } = require('@napi-rs/canvas')
            const viewport = page.getViewport({ scale: 1.6 })
            const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
            await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise
            const screenshot = path.join(root, 'app-data/diagnostics', 'office-system-printed-' + kind + '.png')
            fs.writeFileSync(screenshot, canvas.toBuffer('image/png'))
            const { recognizeImage } = await import('../src-electron/rag/imageOcr.js')
            text = (await recognizeImage(screenshot)).text
          }
          const normalized = text.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
          assert.ok(normalized.includes(kind === 'docs' ? 'FRIDAYPRINTDIALOGPROBE' : 'PRINTPROBE'), '真实打印产物必须保留夹具内容')
        } finally { await loading.destroy() }
      }
      console.log(JSON.stringify({ stage: 'system-output-verified', kind, path: output, pages: printed.getPageCount(), bytes: bytes.length }))
    }
    assert.equal(await queryOfficeDirty(opened.viewId), dirty)
    assert.equal(win.isEnabled(), true, '打印完成或取消后主编辑器必须恢复输入')
    assert.equal(digest(), originalHash, '取消打印不能写源文件')
    console.log(JSON.stringify({ ok: true, kind, fileMenu: true, mode: outputArg ? 'system-pdf-output' : 'cancel', nativeResult: nativeResult || { afterprint: true }, sourceUnchanged: true, dirtyPreserved: true }))
    ok = true
  } catch (error) { console.error(error.stack) }
  finally {
    shutdownOfficeHost(); db.closeDb(); if (win && !win.isDestroyed()) win.destroy()
    try { removePathNoFollowSync(data, { root: os.tmpdir() }) } catch {}
    app.exit(ok ? 0 : 1)
  }
  }
  app.whenReady().then(main).catch(error => { console.error(error.stack); app.exit(1) })
}
