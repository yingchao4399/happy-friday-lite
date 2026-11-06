// 隔离真实 PDF renderer/preload/宿主，验证跨编辑器创建和转换交付。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import AdmZip from 'adm-zip'
import { officeProbeRuntime } from './lib/office-probe-runtime.mjs'

const filename = fileURLToPath(import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))
const runtime = officeProbeRuntime(root)
if (!process.versions.electron) {
  const { spawn } = await import('node:child_process')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(createRequire(import.meta.url)('electron'), [filename, ...process.argv.slice(2)], { cwd: root, env, windowsHide: true, stdio: 'inherit' })
  const deadline = setTimeout(() => child.kill(), 240000)
  process.exitCode = await new Promise(resolve => {
    child.once('error', error => { console.error(error); resolve(1) })
    child.once('exit', code => resolve(code ?? 1))
  })
  clearTimeout(deadline)
} else {
  const { app, BrowserWindow, ipcMain, dialog } = await import('electron')
  runtime.configure(app)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-pdf-ai-delivery-'))
  app.setPath('userData', path.join(temp, 'profile'))
  app.on('window-all-closed', () => {})
  const db = await runtime.load('src-electron/db.js')
  const { setDataDir } = await runtime.load('src-electron/config.js')
  const host = await runtime.load('src-electron/office/office-host.js')
  const report = { ok: false, checkedAt: new Date().toISOString(), runtime: runtime.evidence(), steps: [] }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  let win
  const originalMessageBox = dialog.showMessageBox
  const originalSaveDialog = dialog.showSaveDialog
  app.whenReady().then(async () => {
  try {
    setDataDir(temp)
    db.setDataDir(temp)
    await db.initDb()
    ipcMain.handle('project:resolveChat', () => null)
    win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { sandbox: true } })
    // 仅此隔离进程替代原生交互；产品仍经过实际registry审批入口。
    dialog.showMessageBox = async (_parent, options) => {
      assert.match(options.detail || '', /office_document_(create|convert)/)
      report.steps.push({ name: 'native approval requested', approved: true })
      return { response: 1 }
    }
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(temp, 'menu-result.docx') })
    assert.equal(await host.initOfficeHost(win), true)
    host.setOfficeContentBounds({ x: 0, y: 0, width: 1200, height: 860 })
    const require = createRequire(path.join(root, 'vendor/happyoffice/apps/pdf/package.json'))
    const pdf = await require('pdf-lib').PDFDocument.create()
    pdf.addPage().drawText('Friday PDF to Word acceptance')
    const source = path.join(temp, 'source.pdf')
    fs.writeFileSync(source, await pdf.save())
    const sourceHash = createHash('sha256').update(fs.readFileSync(source)).digest('hex')
    const opened = await host.openOfficeFile(source)
    assert.equal(opened.success, true)
    const wc = host.getOfficeUiTarget().webContents
    for (let i = 0; ; i++) {
      if (await wc.executeJavaScript('Boolean(window.pdfApi?.createDocument)')) break
      assert.ok(i < 200, 'PDF preload 未就绪')
      await pause(50)
    }
    assert.deepEqual(host.getOfficeLoadedEditors(), ['pdf'], '应从仅加载 PDF 的冷启动开始')
    const result = await wc.executeJavaScript(`window.pdfApi.createDocument(${JSON.stringify({
      type: 'docx', title: 'PDF AI 创建验收', content: '<h1>PDF AI delivery</h1><p>Unique delivery marker 2468</p>',
    })})`)
    report.steps.push({ name: 'PDF renderer → create_document → Friday host', result })
    console.log(JSON.stringify(report.steps.at(-1)))
    assert.equal(result.ok, true, result.error || 'create_document 未成功')
    const verify = (result, marker) => {
      assert.equal(result.ok, true, result.error || result.code)
      assert.equal(result.data.artifact.persisted, true)
      assert.equal(result.data.artifact.validation.valid, true)
      const bytes = fs.readFileSync(result.data.path)
      assert.equal(createHash('sha256').update(bytes).digest('hex'), result.data.artifact.sha256)
      const xml = new AdmZip(bytes).readAsText('word/document.xml')
      assert.ok(xml.includes(marker), `DOCX 缺少正文 ${marker}`)
      assert.equal(result.data.artifact.open.status, 'opened', JSON.stringify(result.data.artifact.open))
      assert.equal(createHash('sha256').update(fs.readFileSync(source)).digest('hex'), sourceHash, '转换不得保存源 PDF')
    }
    verify(result, 'Unique delivery marker 2468')
    const converted = await wc.executeJavaScript('window.pdfApi.convertDocument({targetFormat:"docx",title:"PDF AI conversion"})')
    report.steps.push({ name: 'PDF renderer → convert_document → worker → verified DOCX', result: converted })
    verify(converted, 'Friday PDF to Word acceptance')
    const menu = await wc.executeJavaScript('window.pdfApi.convertOffice("docx")')
    report.steps.push({ name: 'PDF menu → shared service → verified DOCX', result: menu })
    verify(menu, 'Friday PDF to Word acceptance')
    const { executeCapability } = await runtime.load('src-electron/agent/tools/registry.js')
    const mainAssistant = await executeCapability('office_document_convert', { source: { resourceId: opened.viewId },
      target: { format: 'docx', title: 'Friday main assistant' }, idempotencyKey: 'probe-main-conversion' },
      { actor: 'user:local', spaceId: 'friday', sourceEntry: 'main-assistant', mainWindow: win, requestId: 'probe-main-conversion', agentRootDir: path.join(temp, 'knowledge', 'agent') },
      { actor: 'user:local', scopes: ['write'], requireApproval: true })
    report.steps.push({ name: 'Friday assistant registry → shared service → verified DOCX', result: mainAssistant })
    verify(mainAssistant, 'Friday PDF to Word acceptance')
    const capabilities = await wc.executeJavaScript('window.pdfApi.getCapabilities()')
    const conversion = capabilities.find(item => item.operationId === 'office.document.convert')
    assert.equal(conversion.available, true)
    assert.deepEqual(conversion.targetFormats, ['docx'])
    report.steps.push({ name: 'installed capability projection declares the actual DOCX route', capabilities })
    for (const targetFormat of ['xlsx', 'pptx', 'invalid']) {
      const rejected = await wc.executeJavaScript(`window.pdfApi.convertDocument({targetFormat:${JSON.stringify(targetFormat)}})`)
      assert.equal(rejected.ok, false)
      assert.equal(Boolean(rejected.data?.artifact?.persisted), false)
      if (!runtime.packaged && targetFormat !== 'invalid') assert.equal(rejected.code, 'OFFICE_OPERATION_UNSUPPORTED')
      report.steps.push({ name: `unsupported ${targetFormat} conversion is rejected`, result: rejected })
    }
    for (const content of ['', '<script>private unsafe body</script>']) {
      const rejected = await wc.executeJavaScript(`window.pdfApi.createDocument(${JSON.stringify({ type: 'docx', content, title: 'Invalid content probe' })})`)
      assert.equal(rejected.ok, false)
      assert.equal(Boolean(rejected.data?.artifact?.persisted), false)
      report.steps.push({ name: content ? 'active-only HTML cannot create a success artifact' : 'empty content cannot create a success artifact', result: rejected })
    }
    const cancelledPath = path.join(temp, 'cancelled-save.docx')
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: cancelledPath })
    const cancelled = await wc.executeJavaScript('window.pdfApi.convertOffice("docx")')
    assert.equal(cancelled.ok, false)
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(fs.existsSync(cancelledPath), false)
    report.steps.push({ name: 'save dialog cancellation produces no final file', result: cancelled, finalFileAbsent: true })
    assert.equal(createHash('sha256').update(fs.readFileSync(source)).digest('hex'), sourceHash)
    report.ok = true
  } catch (error) {
    report.error = error.stack || String(error)
    console.error(report.error)
  } finally {
    dialog.showMessageBox = originalMessageBox
    dialog.showSaveDialog = originalSaveDialog
    fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true })
    const reportFile = runtime.reportFile || path.join(root, 'artifacts/office-pdf-ai-delivery-report.json')
    fs.mkdirSync(path.dirname(reportFile), { recursive: true })
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2))
    host.shutdownOfficeHost()
    db.closeDb()
    if (win && !win.isDestroyed()) win.destroy()
    app.exit(report.ok ? 0 : 1)
  }
  })
}
