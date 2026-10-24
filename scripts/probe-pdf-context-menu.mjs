// 隔离用户数据和生成文档，使用真实 PDF.js、菜单、preload、IPC 和系统剪贴板。
import { app, BrowserWindow, dialog, clipboard } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { setDataDir } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import { initOfficeSession } from '../src-electron/office/office-session.js'
import { registerOfficeIpc } from '../src-electron/office/office-ipc.js'
import { openOfficeFile, getOfficeUiTarget, getOfficeDocumentSelection, setOfficeContentBounds, shutdownOfficeHost, queryOfficeDirty } from '../src-electron/office/office-host.js'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(path.join(root, 'vendor/happyoffice/apps/pdf/package.json'))
const { PDFDocument, StandardFonts } = require('pdf-lib')
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-pdf-context-'))
app.setPath('userData', path.join(data, 'profile'))
app.on('window-all-closed', () => {})
let win, wc, saveChoice
const originalSave = dialog.showSaveDialog
dialog.showSaveDialog = async () => { assert.ok(saveChoice, '未预期的保存对话框'); const choice = saveChoice; saveChoice = null; return choice }
const run = code => wc.executeJavaScript(code, true)
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check, label) {
  for (let index = 0; index < 350; index++) { if (await check()) return; await pause(100) }
  throw new Error('PDF 右键验收超时: ' + label)
}
async function click(selector) {
  const point = await run(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el)throw new Error('按钮不存在');el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)} })()`)
  wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
  wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
  await pause(80)
}
async function selectWords() {
  await run(`window.__genofficeControl({cmd:'goto',target:{kind:'page',page:1}})`)
  await until(() => run(`Boolean(document.querySelector('.pdf-page[data-page="1"] .textLayer span'))`), '文本层')
  const points = await run(`(() => {
    const span=[...document.querySelectorAll('.pdf-page[data-page="1"] .textLayer span')].find(el=>el.textContent==='FRIDAY selected words remain');
    const point=offset=>{const r=document.createRange();r.setStart(span.firstChild,offset);r.setEnd(span.firstChild,offset+1);const b=r.getBoundingClientRect();return {x:Math.round(b.left+1),y:Math.round(b.top+b.height/2)}};
    return {a:point(7),b:point(21)};
  })()`)
  // 已选文字上再次按住拖动会启动 Chromium 的原生文字拖放；先点空白取消旧选区。
  const blank = { x: points.a.x - 15, y: points.a.y + 35 }
  wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...blank })
  wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...blank })
  await pause(50)
  wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...points.a })
  wc.sendInputEvent({ type: 'mouseMove', ...points.b, movementX: points.b.x - points.a.x, movementY: 0 })
  wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...points.b })
  await pause(100)
  const selected = await getOfficeDocumentSelection()
  assert.equal(selected.text, 'selected words', '真实拖选应精确止于字符边界')
  return selected
}
async function context() {
  win.focus(); wc.focus()
  // 为异步焦点、菜单销毁与原生输入留出正常操作间隔。
  await pause(550)
  const point = await run(`(() => { const s=window.getSelection(); const r=s?.rangeCount?s.getRangeAt(0).getBoundingClientRect():document.querySelector('.pdf-page').getBoundingClientRect(); return {x:Math.round(r.x+8),y:Math.round(r.y+r.height/2)} })()`)
  console.log(JSON.stringify({ stage: 'context-target', point, surface: await run(`(() => {const el=document.elementFromPoint(${point.x},${point.y});return {tag:el?.tagName,classes:typeof el?.className==='string'?el.className:'svg',focused:document.hasFocus()}})()`) }))
  wc.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...point })
  await pause(25)
  wc.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...point })
  try { await until(() => run('Boolean(document.querySelector(".pdf-document-menu"))'), '真实右键菜单') }
  catch (error) { console.error(await run('JSON.stringify(window.__contextProbeEvents)')); throw error }
}
async function action(id) {
  await click(`[data-pdf-context-action="${id}"]`)
  await until(() => run('!document.querySelector(".pdf-document-menu")'), '菜单命令已触发 ' + id)
}

async function main() {
  let ok = false
  const deadline = setTimeout(() => app.exit(1), 180000)
  try {
    setDataDir(data); db.setDataDir(data); await db.initDb()
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica)
    pdf.addPage([612, 792]).drawText('FRIDAY selected words remain', { x: 40, y: 700, size: 18, font })
    pdf.addPage([612, 792]).drawText('Second source page', { x: 40, y: 700, size: 18, font })
    for (let page = 3; page <= 12; page++) pdf.addPage([612, 792]).drawText('DOCUMENT PAGE ' + page, { x: 40, y: 700, size: 18, font })
    const source = path.join(data, '右键菜单.pdf'); fs.writeFileSync(source, await pdf.save())
    const sourceHash = hash(source)
    win = new BrowserWindow({ title: 'Friday PDF 右键验收（隔离数据）', show: false, width: 1200, height: 1000, webPreferences: { sandbox: true } })
    assert.equal(await initOfficeSession(win), true); registerOfficeIpc()
    const layout = () => { const [width, height] = win.getContentSize(); setOfficeContentBounds({ x: 0, y: 0, width, height }) }
    win.on('resize', layout); layout()
    const opened = await openOfficeFile(source); assert.equal(opened.success, true)
    wc = getOfficeUiTarget().webContents; win.show(); win.focus(); wc.focus()
    await until(() => run('window.__genofficeControl?.({cmd:"selection"})?.status === "ok"'), 'PDF 已加载')
    await run(`(() => {window.__contextProbeEvents=[];for(const type of ['contextmenu','blur'])window.addEventListener(type,event=>{const item={type,at:performance.now(),tag:event.target?.tagName,classes:typeof event.target?.className==='string'?event.target.className:'other'};window.__contextProbeEvents.push(item);setTimeout(()=>{item.prevented=event.defaultPrevented;item.menu=!!document.querySelector('.pdf-document-menu')},100)},true)})()`)
    await selectWords(); await context()
    fs.writeFileSync(path.join(root, 'app-data/diagnostics/pdf-document-menu.png'), (await wc.capturePage()).toPNG())
    assert.deepEqual(await run(`['cut','paste'].filter(id=>document.querySelector('[data-pdf-context-action="'+id+'"]'))`), [], '阅读面不出现文字剪切/粘贴')
    await action('copy')
    await until(() => clipboard.readText() === 'selected words', '系统剪贴板精确复制')
    await context(); await action('select-all')
    await until(async () => (await getOfficeDocumentSelection())?.text?.includes('DOCUMENT PAGE 12'), '全文选区包含未挂载末页')
    const all = await getOfficeDocumentSelection()
    assert.equal(all.anchor.page, 1); assert.equal(all.focus.page, 12)
    assert.ok(all.text.startsWith('FRIDAY selected words remain'))
    await context(); await action('copy')
    await pause(250)
    assert.equal(clipboard.readText().replace(/\r\n/g, '\n'), all.text, '全文系统复制与逻辑选区一致（Windows 换行归一化）')
    await run('window.__genofficeControl({cmd:"goto",target:{kind:"page",page:12}})')
    await until(() => run('Boolean([...document.querySelectorAll(".pdf-page")].find(el=>el.dataset.page==="12")?.querySelector(".textLayer span"))'), '滚动到全文末页')
    assert.equal((await getOfficeDocumentSelection()).text, all.text, '虚拟页面卸载不能丢失全文选区')
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await until(async () => !(await getOfficeDocumentSelection())?.text, 'Esc 清除全文选区')
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] })
    await until(async () => (await getOfficeDocumentSelection())?.text === all.text, 'Ctrl+A 全文选择')
    clipboard.writeText('COPY SENTINEL')
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'C', modifiers: ['control'] }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'C', modifiers: ['control'] })
    await until(() => clipboard.readText().replace(/\r\n/g, '\n') === all.text, 'Ctrl+C 全文复制')
    await run('window.__genofficeControl({cmd:"goto",target:{kind:"page",page:1}})')
    await until(() => run('Boolean(document.querySelector(".pdf-page .textLayer span"))'), '返回首页继续全文菜单验收')
    await pause(150)
    await context()
    const allTarget = path.join(data, '全文.txt')
    saveChoice = { canceled: false, filePath: allTarget }; await action('export-text')
    await until(() => fs.existsSync(allTarget), '全文 TXT 落盘')
    assert.equal(fs.readFileSync(allTarget, 'utf8'), '\ufeff' + all.text)
    await context(); await action('ai')
    await until(() => run('Boolean(document.querySelector(".ai-ask-pop"))'), '全文 AI 引用')
    assert.ok(await run('document.querySelector(".ai-ask-pop-sub").textContent.includes("FRIDAY selected words remain")'))
    assert.equal((await getOfficeDocumentSelection()).text, all.text, 'AI 浮窗摘要截短不能截断全文选区')
    await click('.ai-ask-pop-close')
    await selectWords()
    await context(); await action('search')
    await until(() => run('document.querySelector(".pdf-search-input")?.value === "selected words"'), '选中文字搜索')
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await selectWords(); await context()
    const target = path.join(data, '精确选区.txt')
    saveChoice = { canceled: false, filePath: target }; await action('export-text')
    await until(() => fs.existsSync(target), '选区 TXT 落盘')
    assert.equal(fs.readFileSync(target, 'utf8'), '\ufeffselected words')
    assert.equal(await queryOfficeDirty(opened.viewId), false)
    await selectWords(); await context(); saveChoice = { canceled: true }; await action('export-text')
    await until(() => saveChoice === null, '取消系统保存')
    assert.equal(fs.readFileSync(target, 'utf8'), '\ufeffselected words')
    await selectWords(); await context(); await action('highlight')
    await until(() => queryOfficeDirty(opened.viewId), '批注产生未保存修改')
    await context(); await action('undo')
    await until(async () => !await queryOfficeDirty(opened.viewId), '撤销批注恢复未修改状态')
    await selectWords(); await context(); await action('ai')
    await until(() => run('Boolean(document.querySelector(".ai-ask-pop"))'), 'AI 引用弹窗')
    assert.ok(await run('document.querySelector(".ai-ask-pop").textContent.includes("selected words")'))
    await click('.ai-ask-pop-close')
    await selectWords(); await context(); await action('rotate-right')
    await until(() => queryOfficeDirty(opened.viewId), '旋转修改')
    assert.equal(hash(source), sourceHash)
    // 真实加密 PDF 的口令为四个空格，仅测试仓库夹具，不涉及用户文件。
    const encrypted = path.join(data, '加密只读.pdf')
    fs.copyFileSync(path.join(root, 'vendor/happyoffice/apps/shell/tests/fixtures/testPassword4Spaces.pdf'), encrypted)
    assert.equal((await openOfficeFile(encrypted)).success, true); wc = getOfficeUiTarget().webContents
    await until(() => run('Boolean(document.querySelector("input[type=password]"))'), '加密口令弹窗')
    await run(`(() => {const input=document.querySelector('input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'    ');input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
    await run(`document.querySelector('input[type=password]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`)
    await until(() => run('Boolean(document.querySelector(".tb-readonly")) && Boolean(document.querySelector(".textLayer span"))'), '加密只读页面')
    win.setContentSize(760, 700)
    await until(() => run('innerWidth === 760 && innerHeight === 700'), '窄窗口内容区')
    await run(`(() => {const p=document.querySelector('.pdf-page');p.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:400,clientY:350}));})()`)
    await until(() => run('Boolean(document.querySelector(".pdf-document-menu"))'), '只读菜单')
    assert.equal(await run(`['highlight','underline','strikeout','rotate-left','rotate-right','undo','redo'].every(id=>{const b=document.querySelector('[data-pdf-context-action="'+id+'"]');return b.disabled&&b.title.length>0})`), true)
    assert.equal(await run(`(() => {const r=document.querySelector('.pdf-document-menu').getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`), true, '窄窗口菜单必须位于视口内')
    fs.writeFileSync(path.join(root, 'app-data/diagnostics/pdf-document-menu-readonly-narrow.png'), (await wc.capturePage()).toPNG())
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await until(() => run('!document.querySelector(".pdf-document-menu")'), 'Esc 关闭')
    assert.equal(hash(source), sourceHash)
    ok = true
    console.log(JSON.stringify({ ok, wholeDocumentSelection: true, unmountedLastPage: true, keyboardSelectAllCopy: true, wholeTextExport: true, wholeTextAiReference: true, realMouseDrag: true, exactSystemCopy: true, searchSelection: true, txtExport: true, cancelPreservesTarget: true, annotationUndo: true, aiExcerpt: true, sourceUnchanged: true, encryptedReadOnlyCommands: true }))
  } catch (error) { console.error(error.stack); if (wc && !wc.isDestroyed()) fs.writeFileSync(path.join(root, 'app-data/diagnostics/pdf-context-failure.png'), (await wc.capturePage()).toPNG()) }
  finally {
    clearTimeout(deadline); dialog.showSaveDialog = originalSave
    shutdownOfficeHost(); db.closeDb(); if (win && !win.isDestroyed()) win.destroy()
    try { removePathNoFollowSync(data, { root: os.tmpdir() }) } catch {}
    app.exit(ok ? 0 : 1)
  }
}
app.whenReady().then(main).catch(error => { console.error(error); app.exit(1) })
