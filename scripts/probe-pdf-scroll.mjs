// 大文件连续滚轮验收：生成 220 页图文 PDF，不读取用户文档。
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { setDataDir } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import { initOfficeSession } from '../src-electron/office/office-session.js'
import { openOfficeFile, getOfficeUiTarget, setOfficeContentBounds, shutdownOfficeHost } from '../src-electron/office/office-host.js'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(path.join(root, 'vendor/happyoffice/apps/pdf/package.json'))
const { PDFDocument, StandardFonts } = require('pdf-lib')
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-large-pdf-'))
app.setPath('userData', path.join(data, 'profile'))
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.on('window-all-closed', () => {})
let win, wc, wheel
const run = code => wc.executeJavaScript(code, true)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function main() {
  let ok = false
  const deadline = setTimeout(() => app.exit(1), 240000)
  try {
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
    const source = path.join(data, '220页大型图文.pdf')
    fs.writeFileSync(source, await pdf.save())
    const size = fs.statSync(source).size
    assert.ok(size > 20 * 1024 * 1024, '测试文件至少 20MiB')
    console.log(JSON.stringify({ stage: 'fixture-ready', pages: 220, bytes: size }))
    setDataDir(data); db.setDataDir(data); await db.initDb()
    win = new BrowserWindow({ show: false, width: 1320, height: 1000, webPreferences: { sandbox: true } })
    assert.equal(await initOfficeSession(win), true)
    const [width, height] = win.getContentSize(); setOfficeContentBounds({ x: 0, y: 0, width, height })
    const started = performance.now()
    assert.equal((await openOfficeFile(source)).success, true)
    wc = getOfficeUiTarget().webContents; win.showInactive()
    let ready = false
    for (let i = 0; i < 900; i++) {
      ready = await run('window.__genofficeControl?.({cmd:"selection"})?.status === "ok" && Boolean(document.querySelector(".textLayer span"))')
      if (ready) break
      await pause(100)
    }
    assert.equal(ready, true)
    const readyMs = Math.round(performance.now() - started)
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
    console.log(JSON.stringify({ stage: 'scroll-metrics', readyMs, bytes: size, pages: 220, ...result }))
    assert.ok(result.durationMs >= 10000 && result.frames >= 200, '至少连续滚动 10 秒并收集足够帧')
    assert.ok(result.travel > 5000, '滚轮必须实际滚过多个页面')
    assert.ok(result.p95Ms <= 50 && result.maxMs < 250, '连续滚动的帧停顿不能明显卡顿')
    fs.writeFileSync(path.join(root, 'app-data/diagnostics/pdf-large-scroll.png'), (await wc.capturePage()).toPNG())
    ok = true; console.log(JSON.stringify({ ok, pages: 220, bytes: size, readyMs, ...result }))
  } catch (error) { console.error(error.stack) }
  finally {
    clearTimeout(deadline); if (wheel) clearInterval(wheel)
    shutdownOfficeHost(); db.closeDb(); if (win && !win.isDestroyed()) win.destroy()
    try { removePathNoFollowSync(data, { root: os.tmpdir() }) } catch {}
    app.exit(ok ? 0 : 1)
  }
}
app.whenReady().then(main).catch(error => { console.error(error); app.exit(1) })
