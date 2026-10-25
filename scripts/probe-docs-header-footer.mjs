// 真实 Electron 页眉/页脚交互验收：空白区域双击进入编辑，Ribbon 自动切换，
// 只有编辑时显示虚线，输入后保存到 DOCX。使用隔离数据，不接触用户文件。
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { setDataDir } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import { initOfficeHost, openOfficeFile, getOfficeUiTarget, setOfficeContentBounds, shutdownOfficeHost } from '../src-electron/office/office-host.js'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-header-footer-'))
app.setPath('userData', path.join(data, 'profile'))
app.on('window-all-closed', () => {})
let win, wc
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const run = (code) => wc.executeJavaScript(code, true)
async function until(check, label, timeout = 30000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await pause(100)
  }
  throw new Error(`页眉页脚验收超时: ${label}`)
}

async function main() {
  let ok = false
  const timer = setTimeout(() => app.exit(1), 120000)
  try {
    setDataDir(data); db.setDataDir(data); await db.initDb()
    const source = path.join(data, '页眉页脚.docx')
    fs.copyFileSync(path.join(root, 'vendor/happyoffice/fixtures/generated/kitchen-sink.docx'), source)
    win = new BrowserWindow({ show: true, width: 1280, height: 900, title: 'Friday 页眉页脚验收', webPreferences: { sandbox: true } })
    assert.equal(await initOfficeHost(win), true)
    const layout = () => { const [width, height] = win.getContentSize(); setOfficeContentBounds({ x: 0, y: 0, width, height }) }
    win.on('resize', layout); layout()
    assert.equal((await openOfficeFile(source)).success, true)
    wc = getOfficeUiTarget().webContents
    await until(() => run('Boolean(window.__aidocs?.editor?.state.doc.content.size > 10)'), '正文就绪')
    await run('window.__aidocs.whenReady()')
    await until(() => run('Boolean(document.querySelector(".page-hf-header"))'), '空白页眉可交互区域')
    const before = await run('(() => { const h=document.querySelector(".page-hf-header"), r=h.getBoundingClientRect(); return { className:h.className, border:getComputedStyle(h).borderBottomStyle, rect:{x:r.x,y:r.y,width:r.width,height:r.height}, contextual:Boolean([...document.querySelectorAll(".ribbon-tab")].find(x=>x.textContent?.includes("页眉和页脚"))) } })()')
    assert.ok(before.rect.height >= 20, JSON.stringify(before))
    assert.equal(before.border, 'none', JSON.stringify(before))
    assert.equal(before.contextual, false, JSON.stringify(before))
    const point = { x: Math.round(before.rect.x + before.rect.width / 2), y: Math.round(before.rect.y + Math.max(10, before.rect.height / 2)) }
    wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
    wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
    wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 2, ...point })
    wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 2, ...point })
    await until(() => run('Boolean(document.querySelector(".page-hf-header.page-hf-editing .page-hf-edit-surface"))'), '双击进入页眉编辑')
    await until(() => run('Boolean(document.querySelector(".ribbon-tab-contextual.active"))'), '自动切换页眉页脚选项卡')
    const editing = await run('(() => ({ active:Boolean(document.querySelector(".ribbon-tab-contextual.active")), border:getComputedStyle(document.querySelector(".page-hf-header")).borderBottomStyle, tab:document.querySelector(".ribbon-tab-contextual.active")?.textContent?.trim(), tabs:[...document.querySelectorAll(".ribbon-tab")].map(x=>({text:x.textContent?.trim(),class:x.className})) }))()')
    assert.equal(editing.active, true, JSON.stringify(editing))
    assert.equal(editing.border, 'dashed', JSON.stringify(editing))
    assert.equal(editing.tab, '页眉和页脚', JSON.stringify(editing))
    await wc.insertText('Friday 页眉验收')
    await run('document.querySelector(".page-hf-edit-surface").blur()')
    await until(() => run('document.querySelector(".page-hf-header")?.textContent?.includes("Friday 页眉验收")'), '页眉文本提交')
    await run('window.__aidocs.save()')
    await pause(1200)
    const require = createRequire(import.meta.url)
    const AdmZip = require('adm-zip')
    const zip = new AdmZip(source)
    const headerEntry = zip.getEntries().find((entry) => /^word\/header\d+\.xml$/i.test(entry.entryName))
    assert.ok(headerEntry, '保存后应存在 Word 页眉部件')
    assert.match(headerEntry.getData().toString('utf8'), /Friday 页眉验收/)
    const after = await run('(() => ({ editing:Boolean(document.querySelector(".page-hf-editing")), border:getComputedStyle(document.querySelector(".page-hf-header")).borderBottomStyle, active:document.querySelector(".ribbon-tab-contextual.active")?.textContent?.trim() || null }))()')
    assert.equal(after.editing, false, JSON.stringify(after))
    assert.equal(after.border, 'none', JSON.stringify(after))
    console.log(JSON.stringify({ ok: true, emptyAreaDoubleClick: true, autoRibbon: true, dashedOnlyWhileEditing: true, savedHeaderPart: headerEntry.entryName }))
    ok = true
  } catch (error) { console.error(error.stack) }
  finally {
    clearTimeout(timer); shutdownOfficeHost(); db.closeDb()
    if (win && !win.isDestroyed()) win.destroy()
    try { removePathNoFollowSync(data, { root: os.tmpdir() }) } catch {}
    app.exit(ok ? 0 : 1)
  }
}
app.whenReady().then(main).catch((error) => { console.error(error.stack); app.exit(1) })
