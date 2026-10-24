// 独立数据库和生成的 PPTX，验证原版画布菜单的真实输入与模型修改。
import { app, BrowserWindow, clipboard } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import PptxGenJS from 'pptxgenjs'
import { setDataDir } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import { initOfficeHost, openOfficeFile, getOfficeUiTarget, setOfficeContentBounds, shutdownOfficeHost, queryOfficeDirty } from '../src-electron/office/office-host.js'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-slides-context-'))
app.setPath('userData', path.join(data, 'profile'))
app.on('window-all-closed', () => {})
let win, wc
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const run = code => wc.executeJavaScript(code, true)
const selection = () => run('window.__genofficeControl({cmd:"selection"})')
async function until(check, label) {
  for (let i = 0; i < 300; i++) { if (await check()) return; await pause(100) }
  throw new Error('Slides 菜单验收超时: ' + label)
}
async function openMenu(kind = 'canvas') {
  const relative = kind === 'element' ? { x: 9, y: 2 } : kind === 'table' ? { x: 2, y: 3.4 } : { x: 11, y: 6.5 }
  const point = await run('(() => { const r=document.querySelector(".stage-rel").getBoundingClientRect();const p=' + JSON.stringify(relative) + ';return {x:Math.round(r.left+r.width*p.x/13.333333),y:Math.round(r.top+r.height*p.y/7.5)} })()')
  wc.focus()
  wc.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...point })
  wc.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...point })
  await until(() => run('Boolean(document.querySelector(".ctx-menu"))'), '真实右键 ' + kind)
}
async function command(labels) {
  await run('(() => {const labels=' + JSON.stringify(labels) + ';const button=[...document.querySelectorAll(".ctx-menu .ctx-item")].find(b=>labels.includes(b.firstElementChild?.textContent));if(!button||button.disabled)throw new Error("命令不可用: "+labels+"; "+document.querySelector(".ctx-menu")?.innerText);button.click()})()')
  await until(() => run('!document.querySelector(".ctx-menu")'), '菜单关闭')
}
async function selectAllCount() {
  await openMenu(); await command(['全选', 'Select All'])
  return (await selection()).result.elements.length
}
async function main() {
  let ok = false
  const deadline = setTimeout(() => app.exit(1), 160000)
  try {
    setDataDir(data); db.setDataDir(data); await db.initDb()
    const source = path.join(data, '幻灯片菜单.pptx')
    const deck = new PptxGenJS(); deck.layout = 'LAYOUT_WIDE'
    const slide = deck.addSlide()
    slide.addText('FRIDAY CONTEXT PROBE', { x: 1, y: 1, w: 5, h: 1, fontSize: 28 })
    slide.addShape(deck.ShapeType.rect, { x: 8, y: 1, w: 2, h: 2, fill: { color: '229944' } })
    slide.addTable([['Friday', 'Value'], ['Table', '42']], { x: 1, y: 3, w: 4, h: 2, fontSize: 20 })
    await deck.writeFile({ fileName: source })
    const digest = () => crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex')
    const original = digest()
    win = new BrowserWindow({ show: true, width: 1280, height: 900, title: 'Friday Slides 菜单验收（隔离数据）', webPreferences: { sandbox: true } })
    assert.equal(await initOfficeHost(win), true)
    const layout = () => {const [width,height]=win.getContentSize();setOfficeContentBounds({x:0,y:0,width,height})}
    win.on('resize', layout); layout()
    const opened = await openOfficeFile(source); assert.equal(opened.success, true)
    wc = getOfficeUiTarget().webContents
    await until(async () => (await selection())?.status === 'ok', '文档就绪')
    await until(() => run('Boolean(document.querySelector(".stage-rel .konvajs-content"))'), '画布就绪')
    assert.equal(await queryOfficeDirty(opened.viewId), false)
    await openMenu()
    assert.equal(await run('[...document.querySelectorAll(".ctx-menu button")].find(b=>["撤销","Undo"].includes(b.firstElementChild?.textContent)).disabled'), true)
    await command(['全选', 'Select All'])
    const all = (await selection()).result
    assert.equal(all.elements.length, 3)
    assert.ok(all.text.includes('FRIDAY CONTEXT PROBE'))
    await openMenu('element'); await command(['复制', 'Copy'])
    await until(() => clipboard.readBuffer('io.genoffice.slides.elements').length > 0, '系统剪贴板标记')
    await openMenu(); await command(['粘贴', 'Paste'])
    await until(async () => (await selection()).result.elements.length === 3, '粘贴后选择新增三对象')
    assert.equal(await selectAllCount(), 6)
    assert.equal(await queryOfficeDirty(opened.viewId), true)
    assert.equal(await run('window.slidesApi.isDirty()'), true)
    await openMenu(); await command(['撤销', 'Undo'])
    await until(async () => await selectAllCount() === 3, '撤销恢复原三对象')
    assert.equal(await queryOfficeDirty(opened.viewId), false)
    await openMenu(); await command(['恢复', '重做', 'Redo'])
    await until(async () => await selectAllCount() === 6, '重做恢复六对象')
    assert.equal(await queryOfficeDirty(opened.viewId), true)
    // 回到原三对象，再在窄窗口检查表格长菜单的实际滚动。
    await openMenu(); await command(['撤销', 'Undo'])
    await until(async () => await selectAllCount() === 3, '撤销粘贴')
    await openMenu(); await command(['查找/替换', 'Find/Replace'])
    await until(() => run('Boolean(document.querySelector(".find-panel input"))'), '原查找面板')
    await run('document.querySelector(".find-panel-close").click()')
    win.setSize(900, 640); await pause(300)
    await run('document.documentElement.setAttribute("data-theme","dark")')
    await openMenu('table')
    const menu = await run('(() => {const m=document.querySelector(".ctx-menu"),r=m.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:innerWidth,height:innerHeight,scroll:m.scrollHeight,client:m.clientHeight,count:m.querySelectorAll("button").length}})()')
    assert.ok(menu.count > 30, JSON.stringify(menu))
    assert.ok(menu.top >= 0 && menu.left >= 0 && menu.bottom <= menu.height && menu.right <= menu.width, JSON.stringify(menu))
    assert.ok(menu.scroll > menu.client)
    const wheel = await run('(() => {const r=document.querySelector(".ctx-menu").getBoundingClientRect();return {x:Math.round(r.left+30),y:Math.round(r.top+80)}})()')
    wc.sendInputEvent({ type: 'mouseWheel', deltaX: 0, deltaY: -200, canScroll: true, ...wheel })
    await until(() => run('document.querySelector(".ctx-menu")?.scrollTop > 0'), '菜单滚轮保留并滚动')
    wc.sendInputEvent({type:'keyDown',keyCode:'END'});wc.sendInputEvent({type:'keyUp',keyCode:'END'})
    await until(() => run('document.activeElement===[...document.querySelectorAll(".ctx-menu button:not(:disabled)")].at(-1)'), 'End定位末个可用命令')
    fs.writeFileSync(path.join(root, 'app-data/diagnostics/slides-context-menu-dark.png'), (await wc.capturePage()).toPNG())
    wc.sendInputEvent({type:'keyDown',keyCode:'ESC'});wc.sendInputEvent({type:'keyUp',keyCode:'ESC'})
    await until(() => run('!document.querySelector(".ctx-menu")'), 'Esc关闭')
    assert.equal(digest(), original)
    console.log(JSON.stringify({ok:true,realRightClick:true,selectAll:true,copyPasteObjects:true,history:true,dirtyUndoRedo:true,find:true,longTableMenuWheel:true,keyboard:true,narrowDark:true,sourceUnchanged:true}))
    ok = true
  } catch (error) { console.error(error.stack) }
  finally {
    clearTimeout(deadline); shutdownOfficeHost(); db.closeDb()
    if(win&&!win.isDestroyed())win.destroy()
    try {removePathNoFollowSync(data,{root:os.tmpdir()})}catch{}
    app.exit(ok?0:1)
  }
}
app.whenReady().then(main).catch(error=>{console.error(error.stack);app.exit(1)})
