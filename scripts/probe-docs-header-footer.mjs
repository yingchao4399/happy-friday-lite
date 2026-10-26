// 隔离 Electron 验收：真实鼠标逐页双击、页脚定位、Ribbon 焦点与 DOCX 保存。
import { app, BrowserWindow, dialog, shell } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { setDataDir } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import { initOfficeHost, openOfficeFile, getOfficeUiTarget, setOfficeContentBounds, shutdownOfficeHost } from '../src-electron/office/office-host.js'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-header-footer-'))
const reports = path.join(root, 'app-data/diagnostics')
app.setPath('userData', path.join(data, 'profile'))
app.on('window-all-closed', () => {})
let win, wc
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const run = code => wc.executeJavaScript(code, true)
async function until(code, label = code, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (await run(code)) return; await pause(100) }
  throw new Error(`页眉页脚验收超时: ${label}`)
}
async function click(selector, count = 1, fraction = .5) {
  const point = await run(`(async () => {
    const el=document.querySelector(${JSON.stringify(selector)})
    if(!el||el.disabled)throw new Error('控件不可用: '+${JSON.stringify(selector)})
    el.scrollIntoView({block:'center',inline:'nearest'})
    await new Promise(resolve=>setTimeout(resolve,80))
    const r=el.getBoundingClientRect(),left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom)
    const xs=[${fraction},.5,.1,.9,.25,.75],ys=[.5,.25,.75,.1,.9]
    for(const fy of ys)for(const fx of xs){
      const x=Math.round(left+(right-left)*fx),y=Math.round(top+(bottom-top)*fy),hit=document.elementFromPoint(x,y)
      if(hit&&(el.contains(hit)||(el.matches('.canvas-hf-hit')&&hit.closest('.canvas-hf-page')===el.closest('.canvas-hf-page')&&hit.closest('.page-hf-'+el.dataset.hfKind))))return {x,y}
    }
    throw new Error('控件未命中可见区域: '+${JSON.stringify(selector)}+' '+el.textContent+' '+JSON.stringify({left:r.left,top:r.top,width:r.width,height:r.height,hit:document.elementFromPoint((left+right)/2,(top+bottom)/2)?.className}))
  })()`)
  for(let i=1;i<=count;i++) {
    wc.sendInputEvent({type:'mouseDown',button:'left',clickCount:i,...point})
    wc.sendInputEvent({type:'mouseUp',button:'left',clickCount:i,...point})
  }
  await pause(150)
}
async function button(text, container = '.header-footer-ribbon-body') {
  await run(`(() => {
    const el=[...document.querySelectorAll(${JSON.stringify(container+' button')})].find(el=>el.textContent.trim()===${JSON.stringify(text)} || el.lastElementChild?.textContent.trim()===${JSON.stringify(text)})
    if(!el)throw new Error('找不到按钮: '+${JSON.stringify(text)}+' '+document.querySelector(${JSON.stringify(container)})?.textContent)
    el.dataset.probeButton='target'
  })()`)
  await click('[data-probe-button="target"]')
  await run(`document.querySelector('[data-probe-button="target"]')?.removeAttribute('data-probe-button')`)
}
const area = (i, kind) => `.canvas-hf-page[data-hf-page-index="${i}"] .page-hf-${kind}`
const geometry = (i, kind) => run(`(() => {const el=document.querySelector(${JSON.stringify(area(i,kind))}),r=el.getBoundingClientRect(),pr=el.parentElement.getBoundingClientRect();return {bottom:pr.bottom-r.bottom,top:r.top-pr.top,position:getComputedStyle(el).position,border:getComputedStyle(el).${kind==='header'?'borderBottomStyle':'borderTopStyle'}}})()`)
async function activate(i,kind,fraction=.12) {
  const hit=`.canvas-hf-page[data-hf-page-index="${i}"] .canvas-hf-hit-${kind}`
  assert.ok(await run(`document.querySelector(${JSON.stringify(hit)}).getBoundingClientRect().height>=48`))
  await click(hit,2,fraction)
  await until(`Boolean(document.querySelector(${JSON.stringify(area(i,kind)+'.page-hf-editing .page-hf-edit-surface')}))`, `第${i+1}页${kind}`)
  await until('Boolean(document.querySelector(".ribbon-tab-contextual.active"))','对应选项卡')
}
async function exit() {
  await button('关闭页眉和页脚')
  await until('!document.querySelector(".canvas-hf-page .page-hf-editing")','关闭编辑')
}
async function replaceText(selector,text) {
  await click(selector)
  wc.sendInputEvent({type:'keyDown',keyCode:'A',modifiers:['control']})
  wc.sendInputEvent({type:'keyUp',keyCode:'A',modifiers:['control']})
  await pause(80)
  await wc.insertText(text)
  await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  await pause(150)
  if(selector.includes('page-hf-edit-surface'))assert.equal(await run(`document.querySelector(${JSON.stringify(selector)}).innerText`),text,'编辑区全选替换')
}
async function option(text) {
  const selector=await run(`(() => {const label=[...document.querySelectorAll('.hf-ribbon-options label')].find(el=>el.textContent.trim()===${JSON.stringify(text)});if(!label)throw new Error('选项不存在');label.querySelector('input').dataset.probeOption='target';return '[data-probe-option="target"]'})()`)
  await click(selector)
  await run(`document.querySelector('[data-probe-option="target"]')?.removeAttribute('data-probe-option')`)
}
async function main() {
  let ok=false
  const timer=setTimeout(()=>app.exit(1),300000)
  try {
    setDataDir(data);db.setDataDir(data);await db.initDb()
    const source=path.join(data,'四页-页眉页脚.docx')
    const AdmZip=createRequire(import.meta.url)('adm-zip')
    const fixture=new AdmZip(path.join(root,'vendor/happyoffice/fixtures/generated/kitchen-sink.docx'))
    const paras=Array.from({length:4},(_,i)=>`${i?'<w:p><w:r><w:br w:type="page"/></w:r></w:p>':''}<w:p><w:r><w:t>第 ${i+1} 页正文。页脚应固定在纸张底部。</w:t></w:r></w:p>`).join('')
    fixture.updateFile('word/document.xml',Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${paras}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr></w:body></w:document>`))
    fixture.writeZip(source)
    win=new BrowserWindow({show:true,title:'Friday 页眉页脚验收（独立数据）',width:1440,height:950,webPreferences:{backgroundThrottling:false}})
    assert.equal(await initOfficeHost(win),true)
    const [width,height]=win.getContentSize();setOfficeContentBounds({x:0,y:0,width,height})
    assert.equal((await openOfficeFile(source)).success,true)
    wc=getOfficeUiTarget().webContents
    win.focus();wc.focus()
    wc.setBackgroundThrottling(false)
    await until('Boolean(window.__aidocs?.editor?.state.doc.content.size>10)','正文就绪')
    await run('window.__aidocs.whenReady()')
    await until('document.querySelectorAll(".canvas-hf-page").length===4','四个纸张编辑层')
    console.log('四页已就绪')
    assert.equal(await run('Boolean(document.querySelector(".ribbon-tab-contextual"))'),false)
    const positions=[]
    for(let i=0;i<4;i++)for(const kind of ['header','footer']) {
      const before=await geometry(i,kind)
      assert.equal(before.border,'none')
      await activate(i,kind,i%2?.85:.12)
      const during=await geometry(i,kind)
      assert.equal(during.position,'absolute');assert.equal(during.border,'dashed')
      assert.ok(Math.abs((kind==='footer'?before.bottom:before.top)-(kind==='footer'?during.bottom:during.top))<2,JSON.stringify({i,kind,before,during}))
      await button('页眉')
      assert.equal(await run('Boolean(document.querySelector(".ribbon-tab-contextual.active"))'),true)
      assert.ok(await run('document.querySelectorAll(".hf-gallery-menu [data-hf-template]").length===8'))
      await button('页眉');await exit()
      positions.push({page:i+1,kind,...during})
    }
    console.log('四页宽区双击、固定定位、Ribbon 焦点通过')
    await activate(1,'header')
    await wc.insertText('Friday 页眉验收')
    await until(`document.querySelector(${JSON.stringify(area(1,'header')+' .page-hf-edit-surface')}).innerText==='Friday 页眉验收'`,'页眉输入')
    await button('页眉横线')
    await run(`(() => {const el=document.querySelector('.hf-design-menu input[type="color"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'#cc1122');el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await button('应用','.hf-design-menu')
    assert.ok(await run(`Boolean(document.querySelector(${JSON.stringify(area(1,'header')+' .page-hf-edit-surface')}).style.borderBottom)`))
    await button('页码');await click('[data-hf-number="footer-plain-center"]')
    await until(`document.querySelector(${JSON.stringify(area(1,'footer')+' .page-hf-edit-surface')})?.innerText.includes('{PAGE}')`,'页码插入并切到页脚编辑')
    await exit()
    await until(`document.querySelector(${JSON.stringify(area(1,'footer'))}).textContent.includes('2')`,'退出编辑后显示当前页码')
    await run('window.__aidocs.save()');await pause(1000)
    const zip=new AdmZip(source)
    const parts=kind=>zip.getEntries().filter(e=>new RegExp('^word/'+kind+'\\d+\\.xml$').test(e.entryName)).map(e=>e.getData().toString('utf8')).join('')
    assert.match(parts('header'),/Friday 页眉验收/);assert.match(parts('header'),/pBdr/)
    assert.match(parts('header'),/CC1122|cc1122/);assert.match(parts('footer'),/PAGE/)
    await activate(2,'footer');await button('页眉页脚切换')
    await until(`Boolean(document.querySelector(${JSON.stringify(area(2,'header')+'.page-hf-editing')}))`,'切换页眉')
    await exit()
    // 模板必须真正插入并保存，页眉、页脚均覆盖；不影响后续分节回归。
    fs.mkdirSync(reports,{recursive:true})
    const galleryResults=[]
    for(const kind of ['header','footer']) {
      await activate(2,kind)
      for(const template of ['blank','columns','title','rule','band','titleDate','page','pageTotal']) {
        await button(kind==='header'?'页眉':'页脚')
        if(template==='columns')fs.writeFileSync(path.join(reports,`docs-${kind}-gallery.png`),(await wc.capturePage()).toPNG())
        await click(`[data-hf-template="${template}"]`)
        assert.equal(await run('Boolean(document.querySelector(".ribbon-tab-contextual.active"))'),true)
        await exit();await run('window.__aidocs.save()');await pause(80)
        const content=new AdmZip(source).getEntries().filter(e=>new RegExp('^word/'+kind+'\\d+\\.xml$').test(e.entryName)).map(e=>e.getData().toString('utf8')).join('')
        assert.ok(content.length>0)
        if(template==='columns')assert.match(content,/<w:tabs>/)
        if(template==='band')assert.match(content,/E8EEF7/)
        if(template==='pageTotal')assert.match(content,/NUMPAGES/)
        galleryResults.push({kind,template,saved:true})
        await activate(2,kind)
      }
      await exit()
    }
    await activate(2,'footer')
    await replaceText(area(2,'footer')+' .page-hf-edit-surface','左侧右侧')
    wc.sendInputEvent({type:'keyDown',keyCode:'Home',modifiers:['control']})
    wc.sendInputEvent({type:'keyUp',keyCode:'Home',modifiers:['control']})
    for(let i=0;i<2;i++){
      wc.sendInputEvent({type:'keyDown',keyCode:'Right'})
      wc.sendInputEvent({type:'keyUp',keyCode:'Right'})
    }
    await until(`document.querySelector(${JSON.stringify(area(2,'footer')+' .page-hf-edit-surface')}).dataset.hfStart==='2'`,'保留页脚正文中的插入位置')
    await button('页码')
    await button('当前位置','.hf-number-positions')
    await click('[data-hf-number="current-plain-center"]')
    await until(`document.querySelector(${JSON.stringify(area(2,'footer')+' .page-hf-edit-surface')}).innerText==='左侧{PAGE}右侧'`,'当前位置插入保留两侧文字')
    await until('document.activeElement?.classList.contains("page-hf-edit-surface")','插入后返回页脚编辑')
    await wc.insertText('继续')
    await until(`document.querySelector(${JSON.stringify(area(2,'footer')+' .page-hf-edit-surface')}).innerText==='左侧{PAGE}继续右侧'`,'插入后的光标继续输入')
    await button('页码')
    await button('页面底端','.hf-number-positions')
    fs.writeFileSync(path.join(reports,'docs-page-number-gallery.png'),(await wc.capturePage()).toPNG())
    await click('[data-hf-number="footer-total-right"]')
    await exit()
    assert.ok(await run(`document.querySelector(${JSON.stringify(area(2,'footer'))}).textContent.includes('第 3 页，共 4 页')`))
    await activate(2,'footer');await button('日期 / 时间')
    assert.equal(await run('document.querySelectorAll(".hf-date-formats [role=option]").length'),8)
    fs.writeFileSync(path.join(reports,'docs-date-time-menu.png'),(await wc.capturePage()).toPNG())
    await click('.hf-date-formats [role=option]:nth-child(4)')
    await click('.hf-field-checkbox input')
    await button('插入','.hf-date-menu')
    await button('文档信息');await button('文件路径','.layout-menu')
    assert.equal(await run('document.querySelector("input[aria-label=域显示内容]").value'),source)
    await button('插入','.hf-design-menu')
    await button('文档部件')
    await replaceText('input[aria-label=模板名称]','验收页脚模板')
    await button('保存当前内容到模板库','.hf-design-menu')
    await button('页脚');await button('删除页脚','.hf-gallery-actions')
    await button('文档部件');await button('验收页脚模板','.hf-saved-templates')
    await exit();await run('window.__aidocs.save()');await pause(100)
    await run(`window.__aidocs.openPath(${JSON.stringify(source)})`);await run('window.__aidocs.whenReady()')
    await until(`document.querySelector(${JSON.stringify(area(2,'footer'))})?.textContent.includes(${JSON.stringify(source)})`,'模板和文档路径保存重开')
    console.log('16 个页眉页脚模板、页码样式、日期格式、文档信息与自定义模板通过')
    // 页脚单独验收：文字、小数距离、首页/奇偶变体、保存重开与各页位置。
    await activate(2,'footer')
    await replaceText(area(2,'footer')+' .page-hf-edit-surface','普通页脚 {PAGE}')
    await replaceText('.hf-distance-control input[aria-label="页脚距底(cm)"]','0.9')
    wc.sendInputEvent({type:'keyDown',keyCode:'Return'});wc.sendInputEvent({type:'keyUp',keyCode:'Return'})
    await until(`Math.abs(parseFloat(document.querySelector(${JSON.stringify(area(2,'footer'))}).style.bottom)-34)<1`,'页脚距底小数参数')
    await option('首页不同')
    await activate(0,'footer')
    await replaceText(area(0,'footer')+' .page-hf-edit-surface','首页页脚')
    await option('奇偶页不同')
    await activate(1,'footer')
    await replaceText(area(1,'footer')+' .page-hf-edit-surface','偶数页脚 {PAGE}')
    await exit();await run('window.__aidocs.save()');await pause(700)
    await run(`window.__aidocs.openPath(${JSON.stringify(source)})`)
    await run('window.__aidocs.whenReady()')
    await until(`document.querySelectorAll('.canvas-hf-page').length===4 && document.querySelector(${JSON.stringify(area(0,'footer'))})?.textContent.includes('首页页脚')`,'保存重开首页页脚')
    await until(`document.querySelector(${JSON.stringify(area(1,'footer'))})?.textContent.includes('偶数页脚 2')`,'保存重开偶数页脚')
    assert.ok(await run(`document.querySelector(${JSON.stringify(area(2,'footer'))}).textContent.includes('普通页脚 3')`))
    assert.ok(await run(`document.querySelector(${JSON.stringify(area(3,'footer'))}).textContent.includes('偶数页脚 4')`))
    assert.equal(await run('Boolean(document.querySelector(".ribbon-tab-contextual"))'),false)
    const footerPositions=[]
    for(let i=0;i<4;i++){
      await activate(i,'footer')
      const g=await geometry(i,'footer')
      assert.ok(Math.abs(g.bottom-34)<1,JSON.stringify({page:i+1,...g}))
      footerPositions.push({page:i+1,...g})
      if(i<3)await exit()
    }
    await exit()
    const zoomPositions=[]
    for(const scale of [.5,2,1]){
      await run(`(() => {const el=document.querySelector('.zoom-slider');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${scale*100});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})()`)
      await until(`Number(document.querySelector('.zoom-slider').value)===${scale*100}`,'缩放设置')
      for(let i=0;i<4;i++){
        await activate(i,'footer',i%2?.85:.12)
        const g=await geometry(i,'footer')
        assert.ok(Math.abs(g.bottom-34*scale)<1,JSON.stringify({page:i+1,scale,...g}))
        zoomPositions.push({page:i+1,scale,bottom:g.bottom})
        await exit()
      }
    }
    fs.mkdirSync(reports,{recursive:true})
    const pdfPath=path.join(reports,'docs-footer-four-pages.pdf')
    const originalSaveDialog=dialog.showSaveDialog,originalOpen=shell.openPath
    let pdfSaved=false
    try{
      dialog.showSaveDialog=async()=>({canceled:false,filePath:pdfPath})
      shell.openPath=async()=>''
      pdfSaved=await run('window.__aidocs.exportPdfTo()')
    }finally{dialog.showSaveDialog=originalSaveDialog;shell.openPath=originalOpen}
    assert.equal(pdfSaved,true,'页脚 PDF 导出: '+await run('window.__aidocs.getStatus()'))
    const {getDocument}=await import(pathToFileURL(createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.mjs')).href)
    const loading=getDocument({data:new Uint8Array(fs.readFileSync(pdfPath))})
    const pdf=await loading.promise
    const pdfFooters=[]
    try{
      assert.equal(pdf.numPages,4)
      for(let i=1;i<=4;i++){
        const page=await pdf.getPage(i),content=await page.getTextContent()
        const expected=i===1?'首页页脚':i%2===0?'偶数页脚':'普通页脚'
        const text=content.items.map(item=>item.str).join('')
        assert.ok(text.includes(expected),JSON.stringify({page:i,text}))
        const item=content.items.find(item=>item.str?.includes(expected))
        assert.ok(item.transform[5]>=0&&item.transform[5]<70,JSON.stringify({page:i,item}))
        pdfFooters.push({page:i,text:expected,yFromBottomPt:item.transform[5]})
      }
    }finally{await loading.destroy()}
    await button('关闭','.pv-toolbar')
    await until('!document.querySelector(".pagination-preview")','关闭导出分页预览')
    console.log('四页页脚缩放、PDF 实际输出通过')
    // 分节页脚必须独立保存；连续修改同一节的两个位置参数不能跳回正文光标所在节。
    const multiSource=path.join(data,'三节-页脚.docx')
    const multi=new AdmZip(path.join(root,'vendor/happyoffice/fixtures/generated/kitchen-sink.docx'))
    const sect=i=>`<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr>`
    const multiBody=[0,1,2].map(i=>`<w:p><w:r><w:t>第 ${i+1} 节正文</w:t></w:r></w:p>${i<2?`<w:p><w:pPr>${sect(i)}</w:pPr></w:p>`:sect(i)}`).join('')
    multi.updateFile('word/document.xml',Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${multiBody}</w:body></w:document>`))
    multi.writeZip(multiSource)
    await run(`window.__aidocs.openPath(${JSON.stringify(multiSource)})`)
    await run('window.__aidocs.whenReady()')
    await until('document.querySelectorAll(".canvas-hf-page").length===3','三节三页')
    for(let i=0;i<3;i++){
      await activate(i,'footer')
      await replaceText(area(i,'footer')+' .page-hf-edit-surface',`第${i+1}节页脚 {PAGE}`)
      await exit()
    }
    await activate(1,'footer')
    await replaceText('.hf-distance-control input[aria-label="页脚距底(cm)"]','0.8')
    await click('.hf-distance-control input[aria-label="页眉距顶(cm)"]')
    await until(`Math.abs(parseFloat(document.querySelector(${JSON.stringify(area(1,'footer'))}).style.bottom)-30.2667)<1`,'第二节页脚距底失焦提交')
    await replaceText('.hf-distance-control input[aria-label="页眉距顶(cm)"]','1.1')
    await button('页脚')
    await until(`Math.abs(parseFloat(document.querySelector(${JSON.stringify(area(1,'header'))}).style.top)-41.6)<1`,'第二节连续修改页眉距顶')
    await button('页脚');await exit()
    await run('window.__aidocs.save()');await pause(700)
    await run(`window.__aidocs.openPath(${JSON.stringify(multiSource)})`)
    await run('window.__aidocs.whenReady()')
    await until(`document.querySelectorAll('.canvas-hf-page').length===3 && document.querySelector(${JSON.stringify(area(1,'footer'))})?.textContent.includes('第2节页脚')`,'分节页脚保存重开')
    const sectionPositions=[]
    for(let i=0;i<3;i++){
      assert.ok(await run(`document.querySelector(${JSON.stringify(area(i,'footer'))}).textContent.includes(${JSON.stringify(`第${i+1}节页脚`)})`),`第${i+1}节内容独立`)
      const g=await geometry(i,'footer')
      assert.ok(Math.abs(g.bottom-(i===1?30.2667:48))<1,JSON.stringify({page:i+1,...g}))
      const h=await geometry(i,'header')
      assert.ok(Math.abs(h.top-(i===1?41.6:48))<1,JSON.stringify({page:i+1,...h}))
      sectionPositions.push({section:i+1,footerBottom:g.bottom,headerTop:h.top})
    }
    await activate(1,'footer')
    await button('上一页')
    await until(`Boolean(document.querySelector(${JSON.stringify(area(0,'footer')+'.page-hf-editing')}))`,'上一页页脚')
    await button('下一页')
    await until(`Boolean(document.querySelector(${JSON.stringify(area(1,'footer')+'.page-hf-editing')}))`,'下一页页脚')
    await button('页脚');await button('编辑页脚…','.hf-gallery-actions')
    await replaceText('.hf-design-menu textarea','菜单页脚 {PAGE} / {NUMPAGES}')
    await run(`(() => {const el=document.querySelector('.hf-design-menu select');el.value='right';el.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await button('应用','.hf-design-menu')
    await until(`document.querySelector(${JSON.stringify(area(1,'footer')+' .page-hf-edit-surface')})?.style.textAlign==='right'`,'页脚菜单对齐应用')
    for(const text of ['日期','时间']){await button('域');await button(text,'.layout-menu')}
    for(const text of ['总页数','文件名']){await button('域');await button(text,'.layout-menu')}
    await exit();await run('window.__aidocs.save()');await pause(500)
    const savedFooterParts=new AdmZip(multiSource).getEntries().filter(entry=>/^word\/footer\d+\.xml$/.test(entry.entryName)).map(entry=>entry.getData().toString('utf8')).join('')
    for(const instr of ['DATE','TIME','NUMPAGES','FILENAME'])assert.match(savedFooterParts,new RegExp(`>\\s*${instr}\\s*<`),`${instr} 字段写入 DOCX`)
    await activate(1,'footer')
    await button('页码');await button('设置页码格式…','.hf-gallery-actions')
    await until('Boolean(document.querySelector(".pgnum-row input"))','页码格式设置窗口')
    await replaceText('.pgnum-row input','7')
    await click('.pgnum-row .gs-dd-btn');await click('.gs-dd-item[data-value="upperRoman"]')
    await button('确定','.modal-actions')
    await until('!document.querySelector(".pgnum-row")','页码格式应用')
    await exit()
    await until(`document.querySelector(${JSON.stringify(area(1,'footer'))}).textContent.includes('VII')`,'第二节罗马数字起始页码')
    await activate(1,'footer');await button('页码');await button('移除页码','.hf-gallery-actions')
    assert.ok(await run(`!document.querySelector(${JSON.stringify(area(1,'footer')+' .page-hf-edit-surface')}).innerText.includes('{PAGE}')`),'移除页脚页码')
    await button('页脚');await button('删除页脚','.hf-gallery-actions')
    await until(`document.querySelector(${JSON.stringify(area(1,'footer')+' .page-hf-edit-surface')})?.innerText===''`,'移除页脚')
    await click('.doc-page p',2)
    await until('!document.querySelector(".ribbon-tab-contextual")','双击正文退出页眉页脚')
    assert.equal(await run('Boolean(document.querySelector(".canvas-hf-page .page-hf-editing"))'),false)
    await pause(400)
    const report={ok:true,galleryResults,pageNumberGallery:true,dateFormatPicker:true,documentInfoPath:true,savedTemplateRoundTrip:true,pages:4,allPageWideDoubleClick:true,footerPinned:true,ribbonRetainsEditing:true,realMenus:true,headerLineSaved:true,pageNumbersSaved:true,navigation:true,footerTextSaved:true,decimalFooterDistance:true,firstAndEvenFooterSavedAndReloaded:true,sectionFootersSavedAndReloaded:true,footerMenuAndAlignment:true,dateTimeAndFieldsSaved:true,pageNumberFormatAndRemoval:true,doubleClickBodyExit:true,footerPositions,zoomPositions,pdfFooters,sectionPositions,positions}
    fs.mkdirSync(reports,{recursive:true})
    fs.writeFileSync(path.join(reports,'docs-header-footer.json'),JSON.stringify(report,null,2))
    fs.writeFileSync(path.join(reports,'docs-header-footer.png'),(await wc.capturePage()).toPNG())
    console.log(JSON.stringify(report));ok=true
  }catch(error){
    console.error(error.stack)
    fs.mkdirSync(reports,{recursive:true})
    fs.writeFileSync(path.join(reports,'docs-header-footer-error.json'),JSON.stringify({ok:false,at:new Date().toISOString(),error:error.stack},null,2))
    if(wc&&!wc.isDestroyed()){
      fs.mkdirSync(reports,{recursive:true})
      console.error(JSON.stringify(await run('({pages:document.querySelectorAll(".canvas-hf-page").length,ribbon:document.querySelector(".header-footer-ribbon-body")?.textContent,zoom:document.querySelector(".zoom-value")?.textContent,zoomValue:document.querySelector(".zoom-slider")?.value,debug:window.__pageDebug})')))
      fs.writeFileSync(path.join(reports,'docs-header-footer-failure.png'),(await wc.capturePage()).toPNG())
    }
  }finally{
    clearTimeout(timer);shutdownOfficeHost();db.closeDb()
    if(win&&!win.isDestroyed())win.destroy()
    try{removePathNoFollowSync(data,{root:os.tmpdir()})}catch{}
    app.exit(ok?0:1)
  }
}
app.whenReady().then(main).catch(error=>{console.error(error.stack);app.exit(1)})
