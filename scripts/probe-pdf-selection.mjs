// 隔离数据、生成 PDF、真实 PDF.js 文本层和 Windows OCR；不读取用户文档。
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { setDataDir } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import { initOfficeSession } from '../src-electron/office/office-session.js'
import { registerOfficeIpc } from '../src-electron/office/office-ipc.js'
import { openOfficeFile, getOfficeUiTarget, getOfficeDocumentSelection, setOfficeContentBounds, shutdownOfficeHost } from '../src-electron/office/office-host.js'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const vendorRequire = createRequire(path.join(root, 'vendor', 'happyoffice', 'apps', 'pdf', 'package.json'))
const { PDFDocument, StandardFonts, degrees } = vendorRequire('pdf-lib')
const require = createRequire(import.meta.url)
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-pdf-selection-'))
app.setPath('userData', path.join(data, 'profile'))
app.on('window-all-closed', () => {})
let win, wc
const run = code => wc.executeJavaScript(code, true)
async function until(check, label) {
  for (let i = 0; i < 500; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error('PDF 验收超时: ' + label)
}
async function select(pageA, textA, from, pageB, textB, to) {
  await until(() => run(`Boolean([...document.querySelectorAll('.pdf-page[data-page="${pageA}"] .textLayer span,.pdf-page[data-page="${pageA}"] .pdf-ocr-layer span')].find(el=>el.firstChild?.nodeType===3 && el.textContent.includes(${JSON.stringify(textA)})))`), '起点文本')
  await until(() => run(`Boolean([...document.querySelectorAll('.pdf-page[data-page="${pageB}"] .textLayer span,.pdf-page[data-page="${pageB}"] .pdf-ocr-layer span')].find(el=>el.firstChild?.nodeType===3 && el.textContent.includes(${JSON.stringify(textB)})))`), '终点文本')
  await run(`(() => {
    const node = (page,text) => [...document.querySelectorAll('.pdf-page[data-page="'+page+'"] .textLayer span,.pdf-page[data-page="'+page+'"] .pdf-ocr-layer span')].find(el=>el.firstChild?.nodeType===3 && el.textContent.includes(text)).firstChild;
    window.getSelection().setBaseAndExtent(node(${pageA},${JSON.stringify(textA)}),${from},node(${pageB},${JSON.stringify(textB)}),${to});
  })()`)
  return getOfficeDocumentSelection()
}

async function selectOcrWord() {
  await run(`(() => {
    const layer=document.querySelector('.pdf-page[data-page="3"] .pdf-ocr-layer');
    const walker=document.createTreeWalker(layer,NodeFilter.SHOW_TEXT), nodes=[]; let node;
    while(node=walker.nextNode()) nodes.push(node);
    const text=nodes.map(node=>node.textContent).join(''), start=text.toLowerCase().indexOf('quick');
    if(start<0) throw new Error('OCR fixture word missing: '+text.slice(0,120));
    const at=offset=>{for(const node of nodes){if(offset<node.length)return [node,offset];offset-=node.length;}return [nodes.at(-1),nodes.at(-1).length]};
    const a=at(start),b=at(start+4);window.getSelection().setBaseAndExtent(a[0],a[1],b[0],b[1]);
  })()`)
  return getOfficeDocumentSelection()
}

async function main() {
  let ok = false
  const deadline = setTimeout(() => app.exit(1), 180000)
  try {
    setDataDir(data); db.setDataDir(data); await db.initDb()
    // 从另一绝对目录加载同一 bundle 和 OCR 引擎，验证没有依赖开发目录定位资源。
    const relocated = path.join(data, '已迁移 Office')
    fs.mkdirSync(path.join(relocated, 'main'), { recursive: true }); fs.mkdirSync(path.join(relocated, 'ocr'))
    fs.copyFileSync(path.join(root, 'resources', 'office', 'main', 'pdf-main.cjs'), path.join(relocated, 'main', 'pdf-main.cjs'))
    fs.copyFileSync(path.join(root, 'resources', 'office', 'ocr', 'win-ocr.exe'), path.join(relocated, 'ocr', 'win-ocr.exe'))
    const png = fs.readFileSync(path.join(root, 'vendor', 'happyoffice', 'packages', 'pdf2docx', 'ocr-helper', 'fixtures', 'smoke-en.png'))
    const module = require(path.join(relocated, 'main', 'pdf-main.cjs'))
    let heartbeatTicks = 0
    const heartbeat = setInterval(() => heartbeatTicks++, 5)
    let lines
    try { lines = await module.recognizePdfPage(png.toString('base64')) }
    finally { clearInterval(heartbeat) }
    assert.ok(lines?.some(line => /quick/i.test(line.text)), '迁移目录里的引擎必须完成实际 OCR')
    assert.ok(lines.some(line => /12345/.test(line.text)))
    assert.ok(heartbeatTicks > 0, 'OCR 等待期间主进程事件循环必须继续运行')

    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const page = pdf.addPage([612, 792])
    for (const [text, x, y] of [
      ['LEFT paragraph alpha beta', 40, 700], ['LEFT second paragraph', 40, 670],
      ['RIGHT column one two', 335, 700], ['RIGHT second column', 335, 670],
      ['CELL_A1', 40, 610], ['CELL_B1', 335, 610], ['CELL_A2', 40, 580], ['CELL_B2', 335, 580],
    ]) page.drawText(text, { x, y, size: 14, font })
    page.drawText('ROTATED TEXT', { x: 290, y: 300, size: 14, font, rotate: degrees(90) })
    const second = pdf.addPage([612, 792]); second.setRotation(degrees(90))
    second.drawText('PAGE_TWO rotated document', { x: 40, y: 700, size: 14, font })
    const scanned = pdf.addPage([612, 792])
    const bitmap = await pdf.embedPng(png)
    const size = bitmap.scaleToFit(530, 500)
    scanned.drawImage(bitmap, { x: 40, y: 792 - size.height - 80, ...size })
    const source = path.join(data, '字符选区与扫描.pdf')
    fs.writeFileSync(source, await pdf.save())
    win = new BrowserWindow({ show: false, width: 1320, height: 1000, webPreferences: { sandbox: true } })
    assert.equal(await initOfficeSession(win), true); registerOfficeIpc()
    const layout = () => { const [width, height] = win.getContentSize(); setOfficeContentBounds({ x: 0, y: 0, width, height }) }
    win.on('resize', layout); layout()
    assert.equal((await openOfficeFile(source)).success, true)
    wc = getOfficeUiTarget().webContents
    win.showInactive()
    await until(() => run('window.__genofficeControl?.({cmd:"selection"})?.status === "ok"'), 'PDF 已加载')

    const paragraph = await select(1, 'LEFT paragraph', 5, 1, 'LEFT second', 11)
    assert.equal(paragraph.anchor.offset, 5)
    assert.equal(paragraph.focus.offset, 11)
    assert.equal(paragraph.range.items.length, 2)
    assert.ok(paragraph.text.startsWith('paragraph alpha beta'))
    assert.ok(paragraph.text.trim().endsWith('LEFT second'))
    const right = await select(1, 'RIGHT column', 6, 1, 'RIGHT column', 12)
    assert.equal(right.text, 'column')
    assert.equal(right.range.items.length, 1)
    const table = await select(1, 'CELL_B1', 5, 1, 'CELL_B1', 7)
    assert.equal(table.text, 'B1')
    const rotated = await select(1, 'ROTATED TEXT', 0, 1, 'ROTATED TEXT', 7)
    assert.equal(rotated.text, 'ROTATED')
    assert.ok(rotated.sourceRect.height > rotated.sourceRect.width)
    const crossPage = await select(1, 'CELL_B2', 5, 2, 'PAGE_TWO', 8)
    assert.equal(crossPage.anchor.page, 1)
    assert.equal(crossPage.focus.page, 2)
    assert.ok(crossPage.range.items.some(item => item.page === 2))
    const reverse = await select(2, 'PAGE_TWO', 8, 1, 'CELL_B2', 5)
    assert.equal(reverse.anchor.page, 2)
    assert.equal(reverse.focus.page, 1)
    const beforeZoom = await select(1, 'RIGHT column', 6, 1, 'RIGHT column', 12)
    await run(`document.querySelectorAll('.zoom-btn')[document.querySelectorAll('.zoom-btn').length-1].click()`)
    await new Promise(resolve => setTimeout(resolve, 250))
    const zoomed = await select(1, 'RIGHT column', 6, 1, 'RIGHT column', 12)
    assert.deepEqual(zoomed.anchor, beforeZoom.anchor)
    assert.deepEqual(zoomed.focus, beforeZoom.focus)

    await run(`window.__genofficeControl({cmd:'goto',target:{kind:'page',page:3}})`)
    await until(() => run(`Boolean(document.querySelector('.pdf-page[data-page="3"] .pdf-ocr-layer span'))`), '扫描页实际 OCR')
    const scannedSelection = await selectOcrWord()
    assert.equal(scannedSelection.text.toLowerCase(), 'quic')
    assert.equal(scannedSelection.anchor.page, 3)
    assert.equal(scannedSelection.canCut, false)
    assert.ok(await run('document.body.innerText.includes("OCR 识别可能有误") || document.body.innerText.includes("OCR text may contain errors")'))
    await run(`(() => [...document.querySelectorAll('.ribbon-tab')].find(el=>['页面','Pages'].includes(el.textContent.trim())).click())()`)
    await run(`(() => [...document.querySelectorAll('button.rb-big')].find(el=>['向右旋转','Rotate right'].includes(el.textContent.trim())).click())()`)
    await until(() => run(`document.querySelector('.pdf-page[data-page="3"] .pdf-ocr-layer span')?.style.transform.startsWith('rotate(90deg)')`), 'OCR 字符随页面旋转')
    const ocrRotated = await selectOcrWord()
    assert.deepEqual(ocrRotated.anchor, scannedSelection.anchor)
    assert.deepEqual(ocrRotated.focus, scannedSelection.focus)
    win.showInactive(); await new Promise(resolve => setTimeout(resolve, 200))
    fs.writeFileSync(path.join(root, 'app-data', 'diagnostics', 'pdf-selection-ocr.png'), (await wc.capturePage()).toPNG())
    ok = true
    console.log(JSON.stringify({ ok, relocatedNativeOcr: true, heartbeatTicks, exactCharacterRanges: true, paragraphs: true, columns: true, table: true, rotatedText: true, crossPage: true, reverseAnchorFocus: true, zoomStable: true, scannedOcr: true, ocrRotationStable: true }))
  } catch (error) {
    console.error(error.stack)
    if (wc && !wc.isDestroyed()) console.error(await run(`JSON.stringify({ width:innerWidth,height:innerHeight,pages:document.querySelectorAll('.pdf-page').length,text:[...document.querySelectorAll('.textLayer span')].slice(0,20).map(el=>el.textContent),ocr:document.querySelector('.pdf-ocr-layer')?.textContent,status:document.querySelector('.status-bar')?.innerText })`))
  }
  finally {
    clearTimeout(deadline); shutdownOfficeHost(); db.closeDb()
    if (win && !win.isDestroyed()) win.destroy()
    try { removePathNoFollowSync(data, { root: os.tmpdir() }) } catch {}
    app.exit(ok ? 0 : 1)
  }
}
app.whenReady().then(main).catch(error => { console.error(error); app.exit(1) })
