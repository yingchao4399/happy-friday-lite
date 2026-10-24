import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import XLSX from 'xlsx'
import PptxGenJS from 'pptxgenjs'
import AdmZip from 'adm-zip'
import { setDataDir } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import { initOfficeSession } from '../src-electron/office/office-session.js'
import { registerOfficeIpc } from '../src-electron/office/office-ipc.js'
import { getOfficeUiTarget, getOfficeLoadedEditors, showOfficeView, shutdownOfficeHost, openOfficeFile, queryOfficeDirty } from '../src-electron/office/office-host.js'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const vendorRequire = createRequire(path.join(root, 'vendor', 'happyoffice', 'apps', 'pdf', 'package.json'))
const { PDFDocument } = vendorRequire('pdf-lib')
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-secondary-menus-'))
app.setPath('userData', path.join(data, 'profile'))
app.on('window-all-closed', () => {})
let win, wc, selected
const originalSave = dialog.showSaveDialog
dialog.showSaveDialog = async () => { assert.ok(selected, '预期保存对话框'); const value = selected; selected = null; return value }
const run = code => wc.executeJavaScript(code, true)
const digest = filename => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex')
const ready = new Set(), replies = new Map()
ipcMain.on('sheets:mcp-ready', event => ready.add(event.sender.id))
ipcMain.on('sheets:mcp-result', (_event, result) => replies.set(result.requestId, result))
async function until(check, label, count = 500) {
  for (let i = 0; i < count; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error('未达到状态: ' + label)
}
async function sheetCommand(command, payload) {
  const requestId = crypto.randomUUID()
  wc.send('sheets:mcp-command', { requestId, command, payload })
  await until(() => replies.has(requestId), command)
  const result = replies.get(requestId)
  assert.equal(result.ok, true, JSON.stringify(result))
  return result.result
}
async function exportMenu(format, target) {
  selected = { canceled: false, filePath: target }
  await run(`document.querySelector('.ribbon-tab-file').click()`)
  await until(() => run('Boolean(document.querySelector("[data-office-file-action=export]"))'), '文件菜单')
  const group = format === 'potx' ? 'change-type' : 'export'
  await until(() => run(`!document.querySelector('[data-office-file-action="${group}"]').disabled`), '前一次导出已完成')
  await run(`document.querySelector('[data-office-file-action="${group}"]').click()`)
  await run(`document.querySelector('[data-office-file-action="export:${format}"]').click()`)
  await until(() => fs.existsSync(target), '导出 ' + format)
  await until(() => run('!document.body.innerText.includes("正在导出…") && !document.body.innerText.includes("Exporting…")'), '导出完成')
}
async function main() {
  let ok = false
  const deadline = setTimeout(() => app.exit(1), 180000)
  try {
    setDataDir(data); db.setDataDir(data); await db.initDb()
    win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { sandbox: true } })
    assert.equal(await initOfficeSession(win), true); registerOfficeIpc()
    assert.deepEqual(getOfficeLoadedEditors(), ['docs'], 'Office 启动只加载最近文件所需的文档引擎')
    const wordSource = path.join(data, '保持打开的文档.docx')
    fs.copyFileSync(path.join(root, 'vendor/happyoffice/fixtures/generated/kitchen-sink.docx'), wordSource)
    const wordHash = digest(wordSource)
    const word = await openOfficeFile(wordSource)
    assert.equal(word.success, true)
    wc = getOfficeUiTarget().webContents
    await until(() => run('Boolean(window.__aidocs?.editor?.state.doc.content.size > 10)'), '文档就绪')
    await run('window.__aidocs.whenReady()')
    await run(`window.__aidocs.editor.commands.insertContent('FRIDAY_LAZY_KEEP_WORD')`)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['项目', '值'], ['原值', 12]]), '数据')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['汇总保留']]), '汇总')
    const source = path.join(data, '表格.xlsx')
    XLSX.writeFile(workbook, source)
    const originalHash = digest(source)
    const [opened, duplicate] = await Promise.all([openOfficeFile(source), openOfficeFile(source)])
    assert.equal(opened.success, true)
    assert.equal(duplicate.viewId, opened.viewId, '并发首开应共用一次引擎加载和同一文件视图')
    assert.deepEqual(getOfficeLoadedEditors(), ['docs', 'sheets'])
    wc = getOfficeUiTarget().webContents
    await until(() => ready.has(wc.id), '表格就绪')
    const applied = await sheetCommand('apply_ops', { ops: [{ op: 'set_cell', sheet: '数据', address: 'A2', value: 'FRIDAY_UNSAVED_SHEET' }] })
    assert.notEqual(applied?.ok, false, JSON.stringify(applied))
    for (const format of ['xlsx', 'txt', 'md']) {
      const target = path.join(data, '表格副本.' + format)
      await exportMenu(format, target)
      if (format === 'xlsx') {
        const exported = XLSX.readFile(target)
        assert.equal(exported.Sheets['数据'].A2.v, 'FRIDAY_UNSAVED_SHEET')
        assert.equal(exported.SheetNames.length, 2)
      } else assert.ok(fs.readFileSync(target, 'utf8').includes('FRIDAY_UNSAVED_SHEET'))
    }
    assert.equal(digest(source), originalHash)
    assert.equal(await queryOfficeDirty(opened.viewId), true)
    const presentation = new PptxGenJS()
    presentation.addSlide().addText('FRIDAY_SLIDE_ORIGINAL', { x: 1, y: 1, w: 7, h: 2, fontSize: 26 })
    presentation.addSlide().addText('第二张', { x: 1, y: 1, w: 7, h: 2, fontSize: 26 })
    const pptxSource = path.join(data, '演示.pptx')
    await presentation.writeFile({ fileName: pptxSource })
    const slideHash = digest(pptxSource)
    const deck = await openOfficeFile(pptxSource)
    assert.equal(deck.success, true)
    assert.deepEqual(getOfficeLoadedEditors(), ['docs', 'sheets', 'slides'])
    wc = getOfficeUiTarget().webContents
    await until(() => run('window.__genofficeControl?.({cmd:"selection"})?.status === "ok"'), '演示就绪')
    await run(`window.slidesApi.setNotes({slideIndex:0,text:'FRIDAY_UNSAVED_NOTES 讲稿备注'})`)
    for (const format of ['pptx', 'handout.docx', 'potx']) {
      const target = path.join(data, '演示副本.' + format)
      // Konva 离屏绘制需要活动的渲染表面，不抢占焦点。
      win.showInactive()
      await exportMenu(format, target)
      const archive = new AdmZip(target)
      if (format !== 'handout.docx') {
        assert.ok(archive.getEntries().some(entry => /notesSlides\/notesSlide\d+\.xml$/.test(entry.entryName) && archive.readAsText(entry).includes('FRIDAY_UNSAVED_NOTES')))
        if (format === 'potx') assert.ok(archive.readAsText('[Content_Types].xml').includes('presentationml.template.main+xml'))
      }
      else {
        assert.ok(archive.readAsText('word/document.xml').includes('FRIDAY_UNSAVED_NOTES'))
        assert.equal(archive.getEntries().filter(entry => entry.entryName.startsWith('word/media/')).length, 2)
      }
    }
    assert.equal(digest(pptxSource), slideHash)
    assert.equal(await queryOfficeDirty(deck.viewId), true)
    const cancelledVideo = path.join(data, '取消的视频.mp4')
    fs.writeFileSync(cancelledVideo, 'ORIGINAL_TARGET')
    selected = { canceled: false, filePath: cancelledVideo }
    await run(`document.querySelector('.ribbon-tab-file').click()`)
    await until(() => run('Boolean(document.querySelector("[data-office-file-action=export]"))'), '视频导出菜单')
    await until(() => run('!document.querySelector("[data-office-file-action=export]").disabled'), '前一次类型转换已完成')
    await run(`document.querySelector('[data-office-file-action=export]').click()`)
    await run(`document.querySelector('[data-office-file-action="export:mp4"]').click()`)
    await until(() => selected === null, '视频导出对话框已处理')
    await run(`document.querySelector('.ribbon-tab-file').click()`)
    await until(() => run('Boolean(document.querySelector("[data-office-file-action=cancel-export]"))'), '取消导出入口')
    await run(`document.querySelector('[data-office-file-action=cancel-export]').click()`)
    await until(() => run('document.body.innerText.includes("已取消导出") || document.body.innerText.includes("Export cancelled")'), '视频取消完成')
    assert.equal(fs.readFileSync(cancelledVideo, 'utf8'), 'ORIGINAL_TARGET')
    assert.equal(digest(pptxSource), slideHash)
    const generator = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    await generator.loadURL('data:text/html;charset=utf-8,<h1>FRIDAY PDF SOURCE</h1><p>Save copy acceptance.</p>')
    const pdfSource = path.join(data, '原PDF.pdf')
    fs.writeFileSync(pdfSource, await generator.webContents.printToPDF({}))
    generator.destroy()
    const pdfHash = digest(pdfSource)
    const pdf = await openOfficeFile(pdfSource)
    assert.equal(pdf.success, true)
    assert.deepEqual(getOfficeLoadedEditors(), ['docs', 'sheets', 'slides', 'pdf'])
    wc = getOfficeUiTarget().webContents
    await until(() => run('window.__genofficeControl?.({cmd:"selection"})?.status === "ok"'), 'PDF 就绪')
    await run(`document.querySelector('.ribbon-tab-file').click()`)
    await until(() => run('Boolean(document.querySelector("[data-office-file-action=save]"))'), 'PDF 文件菜单')
    assert.equal(await run('document.querySelector("[data-office-file-action=save]").disabled'), true)
    assert.ok(await run('document.querySelector("[data-office-file-action=save]").title.length > 0'))
    selected = { canceled: false, filePath: path.join(data, 'PDF副本.pdf') }
    await run(`document.querySelector('[data-office-file-action=saveAs]').click()`)
    await until(() => fs.existsSync(path.join(data, 'PDF副本.pdf')), 'PDF 另存副本')
    assert.equal(fs.readFileSync(path.join(data, 'PDF副本.pdf')).subarray(0, 4).toString(), '%PDF')
    assert.equal(digest(pdfSource), pdfHash)
    await run(`(() => { const button=[...document.querySelectorAll('.ribbon-tab')].find(el => ['页面','Pages'].includes(el.textContent.trim())); if(!button) throw new Error('Page tab missing'); button.click(); })()`)
    await run(`(() => { const button=[...document.querySelectorAll('button.rb-big')].find(el => ['向右旋转','Rotate right'].includes(el.textContent.trim())); if(!button) throw new Error('Rotate button missing'); button.click(); })()`)
    await until(() => queryOfficeDirty(pdf.viewId), 'PDF 旋转未保存状态')
    const rotatedPath = path.join(data, '旋转副本.pdf')
    selected = { canceled: false, filePath: rotatedPath }
    await run(`document.querySelector('.ribbon-tab-file').click()`)
    await until(() => run('Boolean(document.querySelector("[data-office-file-action=saveAs]"))'), 'PDF 另存菜单')
    await run(`document.querySelector('[data-office-file-action=saveAs]').click()`)
    await until(() => fs.existsSync(rotatedPath), 'PDF 旋转副本写入')
    assert.equal((await PDFDocument.load(fs.readFileSync(rotatedPath))).getPage(0).getRotation().angle, 90)
    assert.equal(digest(pdfSource), pdfHash)
    assert.equal(await queryOfficeDirty(pdf.viewId), true)
    assert.equal(showOfficeView(word.viewId), true)
    wc = getOfficeUiTarget().webContents
    assert.ok(await run('window.__aidocs.editor.getText().includes("FRIDAY_LAZY_KEEP_WORD")'))
    const wordTarget = path.join(data, '延迟加载后文档.txt')
    await exportMenu('txt', wordTarget)
    assert.ok(fs.readFileSync(wordTarget, 'utf8').includes('FRIDAY_LAZY_KEEP_WORD'))
    assert.equal(digest(wordSource), wordHash)
    assert.equal(await queryOfficeDirty(word.viewId), true)
    ok = true
    console.log(JSON.stringify({ ok, lazyEditorRegistration: true, concurrentFirstOpen: true, existingWordSurvivesLazyLoad: true, sheetsLiveJournal: true, sheetsAllSheetsPreserved: true, sheetsXlsxTxtMd: true, slidesUnsavedNotes: true, slidesPptxHandout: true, slidesChangeFileType: true, slidesCancelVideo: true, pdfUnmodifiedReadOnly: true, pdfSaveCopy: true, pdfRotatedCopy: true, sourcesUnchanged: true, dirtyPreserved: true }))
  } catch (error) { console.error(error.stack); if (wc && !wc.isDestroyed()) console.error(await run('document.body.innerText.slice(-800)')) }
  finally {
    clearTimeout(deadline); dialog.showSaveDialog = originalSave
    shutdownOfficeHost(); db.closeDb(); if (win && !win.isDestroyed()) win.destroy()
    try { removePathNoFollowSync(data, { root: os.tmpdir() }) } catch {}
    app.exit(ok ? 0 : 1)
  }
}
app.whenReady().then(main).catch(() => app.exit(1))
