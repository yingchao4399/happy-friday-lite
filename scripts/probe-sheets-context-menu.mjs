// 真实 Univer 菜单、单元格编辑与历史；只使用生成的工作簿和隔离数据库。
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import XLSX from 'xlsx'
import { setDataDir } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import { initOfficeHost, openOfficeFile, getOfficeUiTarget, setOfficeContentBounds, shutdownOfficeHost } from '../src-electron/office/office-host.js'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-sheets-context-'))
process.env.GENOFFICE_DEBUG_HOOKS = '1'
app.setPath('userData', path.join(data, 'profile'))
app.on('window-all-closed', () => {})
let win, wc
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const run = code => wc.executeJavaScript(code, true)
const api = 'window.__genofficeDebug.univerAPI'
const menuSelector = 'section > .univer-grid.univer-overflow-y-auto'
async function until(check, label) {
  for(let i=0;i<300;i++){if(await check())return;await pause(100)}
  throw new Error('Excel 菜单验收超时: '+label)
}
async function openMenu(kind = 'cell') {
  await until(()=>run('[...document.querySelectorAll("canvas[data-u-comp=render-canvas]")].some(c=>c.getBoundingClientRect().height>100)'),'主网格画布挂载')
  // Facade 返回画布内坐标；加上实际画布位置，不把它当屏幕坐标。
  const point = await run('(() => {const kind='+JSON.stringify(kind)+';const r='+api+'.getActiveWorkbook().getActiveSheet().getRange("A1").getCellRect();const canvas=[...document.querySelectorAll("canvas")].map(c=>c.getBoundingClientRect()).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return {x:Math.round(canvas.left+(kind==="row"?20:r.left+r.width/2)),y:Math.round(canvas.top+(kind==="column"?10:r.top+r.height/2))}})()')
  console.log(JSON.stringify({stage:'right-click',point,hit:await run('document.elementFromPoint('+point.x+','+point.y+')?.tagName')}))
  wc.focus()
  wc.sendInputEvent({type:'mouseDown',button:'right',clickCount:1,...point})
  wc.sendInputEvent({type:'mouseUp',button:'right',clickCount:1,...point})
  await until(()=>run('Boolean(window.__fridayProbeMenu())'),'真实右键')
}
async function command(labels) {
  await run('(() => {const labels='+JSON.stringify(labels)+';const menu=window.__fridayProbeMenu();const button=[...menu.querySelectorAll("button")].find(b=>labels.includes(b.textContent.trim()));if(!button||button.disabled||button.getAttribute("aria-disabled")==="true")throw new Error("命令不可用: "+labels+"; "+menu.innerText);button.click()})()')
  await until(()=>run('!window.__fridayProbeMenu()'),'菜单关闭')
}
async function main() {
  let ok=false
  const deadline=setTimeout(()=>app.exit(1),150000)
  try {
    setDataDir(data);db.setDataDir(data);await db.initDb()
    const source=path.join(data,'表格菜单.xlsx')
    const book=XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['FRIDAY CONTEXT PROBE',42],['Friday',7]]),'验收')
    XLSX.writeFile(book,source)
    const digest=()=>crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex')
    const original=digest()
    win=new BrowserWindow({show:true,width:1280,height:900,title:'Friday Excel 菜单验收（隔离数据）',webPreferences:{sandbox:true}})
    assert.equal(await initOfficeHost(win),true)
    const layout=()=>{const [width,height]=win.getContentSize();setOfficeContentBounds({x:0,y:0,width,height})}
    win.on('resize',layout);layout()
    assert.equal((await openOfficeFile(source)).success,true)
    wc=getOfficeUiTarget().webContents
    await run('window.__fridayProbeMenu=()=>[...document.querySelectorAll('+JSON.stringify(menuSelector)+')].find(el=>el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&[...el.querySelectorAll("button")].some(b=>["全选","Select All"].includes(b.textContent.trim())));void 0')
    await until(()=>run('Boolean(window.__genofficeDebug?.univerAPI?.getActiveWorkbook()?.getActiveSheet())'),'工作簿就绪')
    await until(()=>run(api+'.getActiveWorkbook().getActiveSheet().getRange("A1").getValue()==="FRIDAY CONTEXT PROBE"'),'加载原始单元格')
    await openMenu()
    assert.equal(await run('[...window.__fridayProbeMenu().querySelectorAll("button")].find(b=>["撤销","Undo"].includes(b.textContent.trim())).disabled'),true,'新打开的表格没有可撤销编辑')
    fs.writeFileSync(path.join(root,'app-data/diagnostics/sheets-context-menu-initial.png'),(await wc.capturePage()).toPNG())
    await command(['全选','Select All'])
    const selected=await run('window.__genofficeControl({cmd:"selection"})')
    assert.equal(selected.status,'ok')
    const dimensions=await run('(()=>{const s='+api+'.getActiveWorkbook().getActiveSheet();return {rows:s.getMaxRows(),cols:s.getMaxColumns()}})()')
    assert.deepEqual(selected.result.bounds,{startRow:0,startColumn:0,endRow:dimensions.rows-1,endColumn:dimensions.cols-1})
    // 经 Facade 执行一次真实编辑；菜单必须走同一原生历史栈。
    await run(api+'.getActiveWorkbook().getActiveSheet().getRange("A1").activate();void 0')
    await run(api+'.getActiveWorkbook().getActiveSheet().getRange("A1").setValue("FRIDAY MENU EDIT");void 0')
    await until(()=>run(api+'.getActiveWorkbook().getActiveSheet().getRange("A1").getValue()==="FRIDAY MENU EDIT"'),'单元格修改')
    await openMenu();await command(['撤销','Undo'])
    await until(()=>run(api+'.getActiveWorkbook().getActiveSheet().getRange("A1").getValue()==="FRIDAY CONTEXT PROBE"'),'撤销单元格修改')
    await openMenu();await command(['恢复','重做','Redo'])
    await until(()=>run(api+'.getActiveWorkbook().getActiveSheet().getRange("A1").getValue()==="FRIDAY MENU EDIT"'),'重做单元格修改')
    await openMenu();await command(['查找','Find'])
    await until(()=>run('Boolean(document.querySelector("[data-u-comp=find-replace-dialog] input"))'),'原查找面板')
    wc.sendInputEvent({type:'keyDown',keyCode:'ESC'});wc.sendInputEvent({type:'keyUp',keyCode:'ESC'})
    await until(()=>run('!document.querySelector("[data-u-comp=find-replace-dialog]")'),'Esc关闭查找')
    // 行列头保留原插入/删除菜单，并具有相同的通用命令。
    for(const kind of ['row','column']){
      await openMenu(kind)
      const labels=await run('[...window.__fridayProbeMenu().querySelectorAll("button")].map(b=>b.textContent.trim())')
      for(const required of ['全选','查找','撤销','重做'])assert.equal(labels.filter(label=>label===required).length,1,kind+': '+required)
      assert.ok(labels.some(label=>/插入|Insert/.test(label)),kind+'原插入命令必须保留')
      wc.sendInputEvent({type:'keyDown',keyCode:'ESC'});wc.sendInputEvent({type:'keyUp',keyCode:'ESC'})
      await until(()=>run('!window.__fridayProbeMenu()'),'Esc关闭行列头菜单')
    }
    wc.send('app:language-changed','en')
    await openMenu()
    await until(()=>run('[...window.__fridayProbeMenu().querySelectorAll("button")].some(b=>b.textContent.trim()==="Select All")'),'英文菜单刷新')
    await until(()=>run('[...window.__fridayProbeMenu().querySelectorAll("button")].some(b=>b.textContent.trim()==="Copy")'),'原网格菜单同步英文')
    const english=await run('[...window.__fridayProbeMenu().querySelectorAll("button")].map(b=>b.textContent.trim())')
    for(const required of ['Select All','Find','Undo','Redo'])assert.equal(english.filter(label=>label===required).length,1)
    for(const required of ['Copy','Cut','Paste'])assert.ok(english.includes(required),required+'原命令同步英文')
    wc.sendInputEvent({type:'keyDown',keyCode:'ESC'});wc.sendInputEvent({type:'keyUp',keyCode:'ESC'})
    await until(()=>run('!window.__fridayProbeMenu()'),'Esc关闭英文菜单')
    win.setSize(900,700);await pause(300)
    wc.send('app:theme-changed','dark');await pause(100)
    await openMenu('row')
    const bounds=await run('(()=>{const r=window.__fridayProbeMenu().getBoundingClientRect();return {top:r.top,left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,theme:document.documentElement.getAttribute("data-theme")}})()')
    assert.equal(bounds.theme,'dark')
    assert.ok(bounds.top>=0&&bounds.left>=0&&bounds.bottom<=bounds.height&&bounds.right<=bounds.width,JSON.stringify(bounds))
    fs.writeFileSync(path.join(root,'app-data/diagnostics/sheets-context-menu-narrow-dark.png'),(await wc.capturePage()).toPNG())
    assert.equal(digest(),original)
    console.log(JSON.stringify({ok:true,realRightClick:true,selectWholeSheet:true,editUndoRedo:true,originalFind:true,rowColumnMenus:true,liveLanguage:true,narrowDark:true,sourceUnchanged:true}))
    ok=true
  }catch(error){
    console.error(error.stack)
    if(wc&&!wc.isDestroyed()){
      console.error(await run('document.body.innerText.slice(-4000)').catch(()=>''))
      fs.writeFileSync(path.join(root,'app-data/diagnostics/sheets-context-menu-failed.png'),(await wc.capturePage()).toPNG())
    }
  }finally{
    clearTimeout(deadline);shutdownOfficeHost();db.closeDb()
    if(win&&!win.isDestroyed())win.destroy()
    try{removePathNoFollowSync(data,{root:os.tmpdir()})}catch{}
    app.exit(ok?0:1)
  }
}
app.whenReady().then(main).catch(error=>{console.error(error.stack);app.exit(1)})
