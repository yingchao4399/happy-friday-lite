// 大文件连续滚轮验收：默认生成夹具，也可用 --file 指定原文件的独立副本。
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'
import { ipcMain } from 'electron'

const root = fileURLToPath(new URL('../', import.meta.url))
const appRoot = process.argv.find(value => value.startsWith('--app-root='))?.slice(11) || root
if (appRoot !== root) {
  Object.defineProperty(app, 'isPackaged', { configurable: true, value: true })
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: path.dirname(appRoot) })
}
const load = relative => import(pathToFileURL(path.join(appRoot, relative)).href)
const { setDataDir } = await load('src-electron/config.js')
const db = await load('src-electron/db.js')
const { initOfficeSession } = await load('src-electron/office/office-session.js')
const { openOfficeFile, closeOfficeFile, getOfficeUiTarget, setOfficeContentBounds, shutdownOfficeHost } = await load('src-electron/office/office-host.js')
const { installIpcCapabilityGateway } = await load('src-electron/agent/ipcGateway.js')
const require = createRequire(path.join(root, 'vendor/happyoffice/apps/pdf/package.json'))
const { PDFDocument, StandardFonts } = require('pdf-lib')
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-large-pdf-'))
app.setPath('userData', path.join(data, 'profile'))
app.on('window-all-closed', () => {})
let win, wc, wheel
const suppliedFile = process.argv.find(value => value.startsWith('--file='))?.slice(7)
const fileHash = file => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256'), stream = fs.createReadStream(file)
  stream.on('data', chunk => hash.update(chunk)); stream.on('error', reject); stream.on('end', () => resolve(hash.digest('hex')))
})
installIpcCapabilityGateway(ipcMain, () => win)
const run = code => wc.executeJavaScript(code, true)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function main() {
  let ok = false
  const deadline = setTimeout(() => app.exit(1), 240000)
  let originalHash
  try {
    const source = path.join(data, 'performance-test.pdf')
    if (suppliedFile) {
      originalHash = await fileHash(suppliedFile)
      fs.copyFileSync(suppliedFile, source)
      assert.equal(await fileHash(source), originalHash)
    } else {
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica)
    const images = []
    for (let i = 0; i < 32; i++) {
      const jpeg = await sharp(crypto.randomBytes(1000 * 1400 * 3), { raw: { width: 1000, height: 1400, channels: 3 } }).jpeg({ quality: 70 }).toBuffer()
      images.push(await pdf.embedJpg(jpeg))
    }
    for (let i = 0; i < 220; i++) {
      const page = pdf.addPage([612, 792])
      page.drawImage(images[i % images.length], { x: 35, y: 30, width: 240, height: 335 })
      for (let line = 0; line < 46; line++) page.drawText(`PAGE ${i + 1} line ${line + 1} Friday PDF scrolling text and layout acceptance.`, { x: 35, y: 750 - line * 8, size: 7, font })
    }
    fs.writeFileSync(source, await pdf.save())
    }
    const size = fs.statSync(source).size
    if (!suppliedFile) assert.ok(size > 20 * 1024 * 1024, '测试文件至少 20MiB')
    console.log(JSON.stringify({ stage: 'fixture-ready', userSupplied: !!suppliedFile, bytes: size }))
    setDataDir(data); db.setDataDir(data); await db.initDb()
    win = new BrowserWindow({ show: false, width: 1320, height: 1000, webPreferences: { sandbox: true } })
    // 前台性能采样要求页面实际可见，不能把被其他窗口完全遮挡后的正常后台限流当成卡顿。
    win.setAlwaysOnTop(true)
    assert.equal(await initOfficeSession(win), true)
    const [width, height] = win.getContentSize(); setOfficeContentBounds({ x: 0, y: 0, width, height })
    const started = performance.now()
    const opened = await openOfficeFile(source)
    assert.equal(opened.success, true)
    wc = getOfficeUiTarget().webContents; win.showInactive()
    let ready = false
    for (let i = 0; i < 900; i++) {
      ready = await run('window.__genofficeControl?.({cmd:"selection"})?.status === "ok" && Boolean(document.querySelector(".pdf-page canvas"))')
      if (ready) break
      await pause(100)
    }
    if (!ready) {
      console.log(JSON.stringify({ stage: 'not-ready', state: await run('({visibility:document.visibilityState,controlReady:!!window.__genofficeControl,spans:document.querySelectorAll(".textLayer span").length,canvases:document.querySelectorAll(".pdf-page canvas").length})') }))
      fs.writeFileSync(path.join(root, 'app-data/diagnostics/pdf-large-not-ready.png'), (await wc.capturePage()).toPNG())
    }
    assert.equal(ready, true)
    const readyMs = Math.round(performance.now() - started)
    let textSelection = null
    if (suppliedFile) {
      // 这份红书第 15 页有正文；实际验证选区及来源页，不能用仅显示画布代替。
      await run('window.__genofficeControl({cmd:"goto",target:{kind:"pdf",page:15}})')
      let selectable = false
      for (let attempt = 0; attempt < 600; attempt++) {
        selectable = await run('Array.from(document.querySelectorAll(".pdf-page[data-page=\\"15\\"] .textLayer span, .pdf-page[data-page=\\"15\\"] .pdf-ocr-layer span")).some(x=>x.firstChild?.nodeType===3 && x.textContent.trim().length>=2)')
        if (selectable) break
        await pause(100)
      }
      assert.ok(selectable, '正文页必须生成可选择文字层（原生或 OCR）')
      textSelection = await run(`(() => {
        const span=Array.from(document.querySelectorAll('.pdf-page[data-page="15"] .textLayer span, .pdf-page[data-page="15"] .pdf-ocr-layer span')).find(x=>x.firstChild?.nodeType===3 && x.textContent.trim().length>=2);
        const node=span.firstChild, end=Math.min(2,node.textContent.length), range=document.createRange();
        range.setStart(node,0);range.setEnd(node,end);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
        const expected=node.textContent.slice(0,end),reply=window.__genofficeControl({cmd:'selection'});
        const result={matches:reply.result?.text===expected,page:reply.result?.page,characters:expected.length};
        selection.removeAllRanges();return result;
      })()`)
      assert.equal(textSelection.matches, true, '复制来源文字必须与字符范围一致')
      assert.equal(textSelection.page, 15)
    }
    const documentInfo = await run('({pages:document.querySelector(".tb-page-total")?.textContent,textSpans:document.querySelectorAll(".textLayer span").length,ocrSpans:document.querySelectorAll(".pdf-ocr-layer span").length})')
    const memoryOpen = app.getAppMetrics().reduce((sum, item) => sum + item.memory.workingSetSize, 0)
    const point = await run(`(() => {const r=document.querySelector('.pdf-page').getBoundingClientRect();return {x:Math.round(Math.min(innerWidth-50,r.x+r.width/2)),y:Math.round(innerHeight/2)}})()`)
    // 用浏览器帧时钟统计滚轮期间的停顿，排除生成夹具与初次启动。
    const metrics = run(`new Promise(resolve=>{
      const frames=[],start=performance.now();let previous=start,scroll=null,maxCanvases=0;
      const element=document.querySelector('.pdf-page').closest('.pdf-scroll');
      if(!element){resolve({error:'scroll-root-missing'});return}
      const initial=element.scrollTop;
      const tick=now=>{frames.push(now-previous);previous=now;maxCanvases=Math.max(maxCanvases,document.querySelectorAll('.pdf-page canvas').length);
        if(now-start<10000)requestAnimationFrame(tick);else{const sorted=[...frames].sort((a,b)=>a-b);resolve({durationMs:now-start,frames:frames.length,p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:Math.max(...frames),over100Ms:frames.filter(v=>v>100).length,travel:element.scrollTop-initial,maxCanvases})}};
      requestAnimationFrame(tick);
    })`)
    wheel = setInterval(() => wc.sendInputEvent({ type: 'mouseWheel', ...point, deltaY: -65, deltaX: 0, canScroll: true }), 40)
    const result = await metrics
    clearInterval(wheel); wheel = null
    console.log(JSON.stringify({ stage: 'scroll-metrics', readyMs, bytes: size, documentInfo, memoryOpenKB: memoryOpen, ...result }))
    assert.ok(result.durationMs >= 10000 && result.frames >= 200, '至少连续滚动 10 秒并收集足够帧')
    assert.ok(result.travel > 5000, '滚轮必须实际滚过多个页面')
    assert.ok(result.p95Ms <= 50 && result.maxMs < 250, '连续滚动的帧停顿不能明显卡顿')
    fs.writeFileSync(path.join(root, 'app-data/diagnostics/pdf-large-scroll.png'), (await wc.capturePage()).toPNG())
    if (suppliedFile) assert.equal(await fileHash(suppliedFile), originalHash, '原文件必须保持不变')
    const audit = db.queryAllRaw('SELECT count(*) AS rows, max(length(arguments)) AS maxArguments, max(length(output)) AS maxOutput FROM agent_tool_logs')[0]
    assert.ok((audit.maxArguments || 0) <= 8192 && (audit.maxOutput || 0) <= 8192)
    await closeOfficeFile(opened.viewId)
    await pause(1500)
    assert.equal(wc.isDestroyed(), true, '关闭 PDF 必须销毁对应页面')
    const memoryClosed = app.getAppMetrics().reduce((sum, item) => sum + item.memory.workingSetSize, 0)
    ok = true; console.log(JSON.stringify({ ok, userSupplied: !!suppliedFile, sourceHashUnchanged: !!originalHash, bytes: size, readyMs, documentInfo, textSelection, audit, memoryOpenKB: memoryOpen, memoryClosedKB: memoryClosed, viewDestroyed: wc.isDestroyed(), ...result }))
  } catch (error) { console.error(error.stack) }
  finally {
    clearTimeout(deadline); if (wheel) clearInterval(wheel)
    shutdownOfficeHost(); db.closeDb(); if (win && !win.isDestroyed()) win.destroy()
    try { removePathNoFollowSync(data, { root: os.tmpdir() }) } catch {}
    app.exit(ok ? 0 : 1)
  }
}
app.whenReady().then(main).catch(error => { console.error(error); app.exit(1) })
