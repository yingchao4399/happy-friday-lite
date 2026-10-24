// 隔离环境验收表格原菜单 → 真实 PDF 预览 → 本次任务参数 → 正式 preload/IPC。
// 最后的系统打印在本探针返回取消；真实 Windows 打印由 probe-office-print-dialog 单独验收。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const filename = fileURLToPath(import.meta.url)
if (!process.versions.electron) {
  const { spawn } = await import('node:child_process')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const require = createRequire(import.meta.url)
  const child = spawn(require('electron'), [filename], { cwd: root, env, windowsHide: true, stdio: 'inherit' })
  process.exitCode = await new Promise(resolve => child.once('exit', code => resolve(code ?? 1)))
} else {
  const { app, BrowserWindow, ipcMain } = await import('electron')
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-sheet-print-preview-'))
  const source = path.join(data, 'print-preview.xlsx')
  const XLSX = (await import('xlsx')).default
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(Array.from({ length: 140 }, (_, row) =>
    [row === 0 ? 'FRIDAY PRINT PREVIEW' : `Item ${row}`, row, 'Friday', 42, 'Layout', '验收'])), '打印设置')
  XLSX.writeFile(book, source)
  const hash = () => crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex')
  const originalHash = hash()
  process.env.GENOFFICE_USER_DATA = path.join(data, 'profile')
  process.env.GENOFFICE_LANG = 'zh'
  process.env.XLSX_OPEN_PATH = source
  process.env.XLSX_SIDECAR_PATH = path.join(root, 'resources/office/native/xlsx-sidecar.exe')
  let win, ok = false, printed
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async (check, label) => {
    for (let attempt = 0; attempt < 1200; attempt++) { if (await check()) return; await pause(100) }
    throw new Error('打印设置验收超时: ' + label)
  }
  app.on('browser-window-created', (_event, window) => { if (!win) win = window })
  const require = createRequire(import.meta.url)
  require(path.join(root, 'vendor/happyoffice/apps/sheets/out/main/index.js'))
  const main = async () => { try {
    console.log(JSON.stringify({ stage: 'app-ready' }))
    await until(() => win && !win.webContents.isLoading(), '表格窗口')
    const wc = win.webContents
    console.log(JSON.stringify({ stage: 'window-ready' }))
    const run = code => wc.executeJavaScript(code, true)
    await until(() => run('Boolean(window.__genofficeControl)'), '表格编辑器')
    console.log(JSON.stringify({ stage: 'renderer-ready' }))
    // 通过实际菜单打开夹具，不依赖演示工作簿。
    await run('document.querySelector(".ribbon-tab-file").click()')
    await until(() => run('Boolean(document.querySelector("[data-office-file-action=open]"))'), '打开菜单')
    await run('document.querySelector("[data-office-file-action=open]").click()')
    await until(() => run('document.body.innerText.includes("print-preview.xlsx")'), '夹具打开')
    await pause(700)
    ipcMain.removeHandler('workbook:print')
    ipcMain.handle('workbook:print', (_event, request) => { printed = request; return { ok: false } })
    await run('document.querySelector(".ribbon-tab-file").click()')
    await until(() => run('Boolean(document.querySelector("[data-office-file-action=print]"))'), '打印菜单')
    await run('document.querySelector("[data-office-file-action=print]").click()')
    await until(() => run('Boolean(document.querySelector(".sheet-print-dialog .btn-primary:not(:disabled)"))'), '实际 PDF 预览')
    const initial = await run('({ title:document.querySelector("#sheet-print-title").textContent, navigation:document.querySelector(".sheet-print-navigation").innerText, canvas:document.querySelector(".sheet-print-canvas canvas").width, errors:[...document.querySelectorAll(".sheet-print-error")].map(e=>e.textContent) })')
    assert.ok(initial.canvas > 100)
    assert.equal(initial.errors.length, 0)
    const total = Number(initial.navigation.match(/\/\s*(\d+)/)[1]); assert.ok(total > 1)
    fs.writeFileSync(path.join(root, 'app-data/diagnostics/sheets-print-preview-light.png'), (await wc.capturePage()).toPNG())
    const select = async (label, value) => run(`{const label=[...document.querySelectorAll('.sheet-print-settings label')].find(e=>e.firstChild?.textContent===${JSON.stringify(label)});const input=label?.querySelector('select,input');if(!input)throw new Error('Missing field');const proto=input.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));}`)
    await select('纸张方向', 'landscape')
    await select('缩放', 'fit-sheet')
    await until(() => run('Boolean(document.querySelector(".sheet-print-dialog .btn-primary:not(:disabled)")) && document.querySelector(".sheet-print-navigation").innerText.includes("/ 1")'), '横向整表一页预览')
    await select('份数', '3'); await select('颜色', 'mono'); await select('单面 / 双面', 'longEdge')
    await select('打印页码', 'custom'); await select('页码（例如 1-3, 5）', '2')
    assert.equal(await run('document.querySelector(".sheet-print-dialog .btn-primary").disabled'), true)
    await select('页码（例如 1-3, 5）', '1')
    await run('document.querySelector(".sheet-print-dialog .btn-primary").click()')
    await until(() => Boolean(printed), '打印参数 IPC')
    assert.equal(printed.copies, 3); assert.equal(printed.color, false); assert.equal(printed.duplexMode, 'longEdge')
    assert.equal(printed.landscape, true); assert.deepEqual(printed.pageRanges, [{ from: 0, to: 0 }])
    assert.equal(await run('Boolean(document.querySelector(".sheet-print-dialog .btn-primary:not(:disabled)"))'), true)
    win.setMinimumSize(0, 0); win.setSize(640, 760)
    await run('document.documentElement.setAttribute("data-theme","dark")')
    await pause(500)
    const layout = await run('({overflow:document.querySelector(".sheet-print-dialog").scrollWidth>document.querySelector(".sheet-print-dialog").clientWidth, dialog:document.querySelector(".sheet-print-dialog").getBoundingClientRect().toJSON(), viewport:{width:innerWidth,height:innerHeight}})')
    assert.equal(layout.overflow, false)
    assert.ok(layout.dialog.bottom <= layout.viewport.height)
    fs.writeFileSync(path.join(root, 'app-data/diagnostics/sheets-print-preview-narrow-dark.png'), (await wc.capturePage()).toPNG())
    await run('document.querySelector(".sheet-print-dialog .btn-ghost").click()')
    assert.equal(await run('Boolean(document.querySelector(".sheet-print-dialog"))'), false)
    assert.equal(hash(), originalHash)
    console.log(JSON.stringify({ ok: true, initialPages: total, finalPages: 1, nativeDialog: 'stubbed-cancel', preview: 'actual-printToPDF', printParameters: ['copies','color','duplexMode','pageRanges','landscape'], sourceUnchanged: true, narrowDark: layout }))
    ok = true
  } catch (error) { console.error(error.stack) }
  finally {
    for (const window of BrowserWindow.getAllWindows()) window.destroy()
    await pause(200)
    removePathNoFollowSync(data)
    app.exit(ok ? 0 : 1)
  } }
  app.whenReady().then(main).catch(error => { console.error(error.stack); app.exit(1) })
}
