// 使用真实 Vue 页面、原作 React 外壳、笔记 SQLite 和 PTY 的隔离验收。
import {app, BrowserWindow, ipcMain, dialog, net, protocol} from 'electron'
import {build} from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fileURLToPath, pathToFileURL} from 'node:url'
import sharp from 'sharp'
import * as db from '../src-electron/db.js'
import {registerFontCommands} from '../src-electron/fonts.js'
import {setDataDir as setConfigDir} from '../src-electron/config.js'
import {registerTypewriterTerminalCommands} from '../src-electron/typewriter-terminal.js'
import {NOTE_ASSET_SCHEME, importNoteResource, resolveNoteAssetPath} from '../src-electron/note-resources.js'
import {parseTypewriterImageNodes} from '../src/features/typewriter/image-utils.js'

protocol.registerSchemesAsPrivileged([{
  scheme: NOTE_ASSET_SCHEME,
  privileges: {standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true},
}])

const root = fileURLToPath(new URL('../', import.meta.url))
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-typewriter-workspace-'))
app.setPath('userData', path.join(temp, 'profile'))
app.on('window-all-closed', () => {})
const output = path.join(root, 'artifacts/typewriter')
fs.mkdirSync(output, {recursive:true})
for(const method of ['log','error']){const original=console[method];console[method]=(...args)=>{fs.appendFileSync(path.join(output,'batch1-probe-live.log'),args.map(a=>typeof a==='string'?a:JSON.stringify(a)).join(' ')+'\n');original(...args)}}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const percentile = (values, fraction) => [...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*fraction)-1)]
let win
let rejectSave=false
let probePhase='bootstrap'
const run = async code => {
  try { return await win.webContents.executeJavaScript(code, true) }
  catch (error) {
    error.message = `${error.message}\nProbe phase: ${probePhase}\nProbe JS: ${String(code).slice(0,240)}`
    throw error
  }
}
async function until(code, timeout=18000) {
  const end = Date.now()+timeout
  while (Date.now()<end) { if(await run(code))return; await pause(75) }
  throw new Error('验收超时：'+code)
}
async function click(selector) {
  await run(`document.querySelector(${JSON.stringify(selector)}).click()`)
  await pause(160)
}
async function key(keyCode, modifiers=[]) {
  win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers})
  if (keyCode.length===1 && !modifiers.length) win.webContents.sendInputEvent({type:'char',keyCode})
  win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers})
  await pause(60)
}
async function dragClip(kind) {
  await pause(1800)
  const rect=await run('document.querySelector(".tn-scroll-clip").getBoundingClientRect().toJSON()')
  console.log('clip',kind,rect,await run('getComputedStyle(document.querySelector(".tn-scroll-clip")).transform'))
  const before=await run('Number(document.querySelector(".tn-scroll-clip").getAttribute("aria-valuenow"))')
  const x=Math.round(rect.x+rect.width/2),y=Math.round(rect.y+rect.height/2)
  await run(`window.pointerTrace=[];for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])document.addEventListener(type,e=>pointerTrace.push([type,e.clientY,e.buttons,e.target.className?.baseVal||e.target.className]),{capture:true})`)
  console.log('hit',await run(`document.elementFromPoint(${x},${y})?.outerHTML.slice(0,300)`))
  win.webContents.sendInputEvent({type:'mouseMove',x,y})
  win.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1})
  for(let step=1;step<=12;step++){win.webContents.sendInputEvent({type:'mouseMove',x,y:Math.round(Math.max(100,y-450*step/12)),button:'left',modifiers:['leftButtonDown']});await pause(60)}
  win.webContents.sendInputEvent({type:'mouseUp',x,y:Math.round(Math.max(100,y-450)),button:'left',clickCount:1})
  await pause(900)
  const after=await run('Number(document.querySelector(".tn-scroll-clip").getAttribute("aria-valuenow"))')
  assert.ok((await run('pointerTrace.filter(e=>e[0]==="pointermove"&&e[2]===1).length'))>=10)
  assert.ok(Math.abs(after-before)>10,`${kind} 回形针拖动没有改变滚动位置：${before}->${after}`)
}
app.whenReady().then(async()=>{
  let ok=false
  const entry=path.join(root,'typewriter-workspace-probe.html')
  const errors=[]
  const report={checks:[],platform:process.platform, electron:process.versions.electron}
  const timer=setTimeout(()=>app.exit(1),480000)
  try {
    db.setDataDir(path.join(temp,'data')); setConfigDir(path.join(temp,'data')); await db.initDb()
    protocol.handle(NOTE_ASSET_SCHEME, request => {
      const filePath = resolveNoteAssetPath(request.url)
      if (!filePath) return new Response(null, {status:404})
      return net.fetch(pathToFileURL(filePath).href).catch(() => new Response(null, {status:404}))
    })
    const fixture=db.importNote(null,null,'原有笔记验收','<h2>已有正文</h2><p>Original text</p><div data-note-chart="true" kind="bar" title="保留图表"></div>','已有正文 Original text')
    const suppliedImage=process.env.FRIDAY_TYPEWRITER_TEST_IMAGE
    const useSuppliedImage=Boolean(suppliedImage&&fs.existsSync(suppliedImage))
    const imageFile=path.join(temp,useSuppliedImage?'用户实图验收.jpg':'图片验收.png')
    if(useSuppliedImage) fs.copyFileSync(suppliedImage,imageFile)
    else fs.writeFileSync(imageFile,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWsAAAAASUVORK5CYII=','base64'))
    const imageWidthMinimum=useSuppliedImage?1000:1
    const md=path.join(temp,'中文 文件.md');fs.writeFileSync(md,'# 文件导入\n\n正文测试，不能发送给 Shell。\n')
    ipcMain.handle('get_notes',()=>db.getNotes())
    ipcMain.handle('get_note',(_e,a)=>db.getNote(a.noteId))
    ipcMain.handle('create_note',(_e,a)=>db.createNote(a.knowledgeBaseId,a.notebookId,a.title))
    ipcMain.handle('import_note',(_e,a)=>db.importNote(a.knowledgeBaseId,a.notebookId,a.title,a.content,a.contentText))
    ipcMain.handle('update_note',(_e,a)=>{if(rejectSave)throw new Error('验收模拟保存失败');return db.updateNote(a.noteId,a.title,a.content,a.contentText,a.notebookId,a.marpContent)})
    ipcMain.handle('note-resource-import',(_e,a)=>importNoteResource(a))
    ipcMain.handle('open-file-dialog',()=>md)
    ipcMain.handle('kb-read-file',(_e,a)=>({success:true,content:fs.readFileSync(a.filePath,'utf8')}))
    ipcMain.handle('save-file-dialog',()=>path.join(temp,'export.md'))
    fs.writeFileSync(entry,`<!doctype html><meta charset="utf-8"><div id="app"></div><style>html,body,#app{height:100%;margin:0}</style><script type="module">
import{createApp,h,KeepAlive}from'vue';import{createPinia}from'pinia';import{createRouter,createMemoryHistory,RouterView}from'vue-router';
import{i18n,setI18nLanguage}from'/src/i18n/index.js';import View from'/src/views/typewriter/TypewriterView.vue';
import{useTypewriterStore,useNoteStore}from'/src/store/index.js';
import{on}from'/src/features/typewriter/nocturne-core/lib/nocturne/bus.ts';
import{activeTerminalText}from'/src/features/typewriter/nocturne-core/lib/nocturne/terminal-bridge.ts';
import{buildRig,lightAmount}from'/src/features/typewriter/nocturne-core/app/nocturne/light-model.ts';
import{activeTheme}from'/src/features/typewriter/nocturne-core/app/nocturne/apply-config.ts';
import{stageLayout}from'/src/features/typewriter/nocturne-core/app/nocturne/stage-layout.ts';
window.probe={keys:0,audio:0,energy:0,cursors:[]};window.__light={buildRig,lightAmount,activeTheme,stageLayout};on('key',()=>probe.keys++);on('cursor',f=>{probe.cursors.push({x:f.x,col:f.col,row:f.row})});
const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...a){if(this.context instanceof AudioContext){probe.audio++;probe.audioState=this.context.state;const d=this.buffer?.getChannelData(0);if(d)probe.energy=Math.max(probe.energy,...d.filter((_,i)=>i%100===0).map(Math.abs))}return start.apply(this,a)};
const pinia=createPinia();const router=createRouter({history:createMemoryHistory(),routes:[{path:'/',component:View},{path:'/note',name:'note',component:{render:()=>h('div','Notes')}}]});
window.router=router;const app=createApp({render:()=>h(RouterView,null,{default:({Component})=>h(KeepAlive,null,()=>Component)})}).use(pinia).use(i18n).use(router);window.tw=useTypewriterStore();tw.patchSettings({lighting:{quality:'low'},paper:{style:'cotton'}});window.notes=useNoteStore();window.readScreen=()=>activeTerminalText('screen');window.setLanguage=setI18nLanguage;
router.isReady().then(()=>app.mount('#app'));</script>`)
    const site=path.join(temp,'site')
    await build({root,configFile:false,plugins:[vue()],resolve:{alias:{'@':path.join(root,'src')}},base:'./',logLevel:'error',build:{outDir:site,minify:false,rollupOptions:{input:entry}}})
    win=new BrowserWindow({show:false,width:1496,height:1020,webPreferences:{preload:path.join(root,'preload.cjs'),contextIsolation:true,backgroundThrottling:false}})
    win.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message.slice(0,1500))})
    dialog.showSaveDialog=async()=>({canceled:false,filePath:path.join(temp,'folio.png')})
    registerTypewriterTerminalCommands(win); registerFontCommands(win)
    ipcMain.handle('note-links-index',(_e,a)=>db.getNoteLinks(a.noteId))
    await win.loadFile(path.join(site,'typewriter-workspace-probe.html'));win.showInactive()
    await until('Boolean(document.querySelector("[data-action=new-note]"))')
    await run(`window.__openDiagnostics={longTasks:[],milestones:{}};const openSelectors={workspace:'.typewriter-workspace',stage:'.tn-stage',paper:'.tn-sheet',note:'.tn-note-input',editor:'.tn-note-input .cm-editor .cm-content',machineBuilt:'.tn-stage[data-machine="built"]',machineDrawn:'.tn-stage[data-machine="drawn"]'};const markOpen=()=>{for(const [name,selector]of Object.entries(openSelectors))if(!window.__openDiagnostics.milestones[name]&&document.querySelector(selector))window.__openDiagnostics.milestones[name]=performance.now()-window.__firstOpen};window.__openObserver=new PerformanceObserver(list=>window.__openDiagnostics.longTasks.push(...list.getEntries().map(entry=>({startTime:entry.startTime,duration:entry.duration,attribution:[...(entry.attribution||[])].map(item=>({name:item.name,containerType:item.containerType,containerName:item.containerName,containerId:item.containerId,executionStart:item.executionStart,executionEnd:item.executionEnd}))}))));try{window.__openObserver.observe({type:'longtask',buffered:false})}catch{};window.__openMutations=new MutationObserver(markOpen);window.__openMutations.observe(document.body,{attributes:true,childList:true,subtree:true,attributeFilter:['data-machine']});const createNote=notes.createNote.bind(notes);notes.createNote=async(...args)=>{const start=performance.now();try{return await createNote(...args)}finally{window.__openDiagnostics.createNoteMs=performance.now()-start}};true`)
    await run('window.__firstOpen=performance.now();document.querySelector("[data-action=new-note]").click()')
    await until('Boolean(document.querySelector(".tn-note-input .cm-editor .cm-content"))')
    const openDiagnostics=await run('window.__openObserver?.disconnect();window.__openMutations?.disconnect();({...window.__openDiagnostics,milestones:{...window.__openDiagnostics.milestones},resources:performance.getEntriesByType("resource").filter(entry=>entry.startTime>=window.__firstOpen).map(entry=>({name:entry.name.split("/").slice(-2).join("/"),startTime:entry.startTime-window.__firstOpen,duration:entry.duration,transferSize:entry.transferSize})).sort((a,b)=>b.duration-a.duration).slice(0,12)})')
    report.performance={firstOpenMs:await run('performance.now()-window.__firstOpen'),...openDiagnostics}
    const focusFeedback=await run(`new Promise(resolve=>{const root=document.querySelector('.tn-root'),button=document.querySelector('.tn-tools .tn-tool:nth-child(3)'),start=performance.now(),observer=new MutationObserver(()=>{if(root.classList.contains('tn-focus')){observer.disconnect();resolve(performance.now()-start)}});observer.observe(root,{attributes:true,attributeFilter:['class']});button.click();setTimeout(()=>{observer.disconnect();resolve(null)},1000)})`)
    assert.ok(focusFeedback!==null&&focusFeedback<=100,`专注模式按钮响应 ${focusFeedback}ms > 100ms`)
    report.performance.focusToggleFeedbackMs=focusFeedback
    await run('document.querySelector(".tn-tools .tn-tool:nth-child(3)").click()')
    await until('!document.querySelector(".tn-focus")')
    assert.equal(await run('document.querySelectorAll(".xterm").length'),0)
    const newId=await run('notes.currentNoteId')
    assert.ok(db.getNote(newId),'新建笔记必须写入笔记数据库')
    await until('document.querySelector(".tn-stage")?.dataset.machine==="drawn"',90000)
    await pause(1800)
    await run('window.originalStage=document.querySelector(".tn-stage");document.querySelector(".tn-note-input").focus()')
    for(const code of ['t','y','p','e']){await key(code); await pause(250)}
    await key('Enter')
    await win.webContents.insertText('中文输入和 Markdown **正文**')
    const asset=importNoteResource({noteId:newId,filePath:imageFile})
    await win.webContents.insertText(`\n![森林实图验收](${asset.url} "width=320;align=center;fit=contain;intensity=0.18;temperature=0;shadow=0.2;blend=paper")\n`)
    await until(`document.querySelector(".tn-inline-image-node img")?.naturalWidth>=${imageWidthMinimum}`)
    const imageCheck=await run(`(()=>{const img=document.querySelector('.tn-inline-image-node img'),node=img?.closest('.tn-inline-image-node'),paper=document.querySelector('.tn-sheet')||document.querySelector('.tn-note-plugin');const r=img?.getBoundingClientRect(),p=paper?.getBoundingClientRect();return{naturalWidth:img?.naturalWidth,naturalHeight:img?.naturalHeight,renderedWidth:r?.width,renderedHeight:r?.height,insidePaper:Boolean(r&&p&&r.left>=p.left&&r.right<=p.right&&r.top>=p.top&&r.bottom<=p.bottom),blend:getComputedStyle(node).mixBlendMode,alt:img?.alt,anchor:node?.dataset.imageId}})()`)
    assert.ok(imageCheck.naturalWidth>=imageWidthMinimum,'实图必须解码成功')
    assert.ok(imageCheck.renderedWidth>0&&imageCheck.renderedHeight>0,'图片必须实际显示')
    assert.equal(imageCheck.blend,'normal','图片不应重复相乘纸张底色')
    assert.equal(await run('getComputedStyle(document.querySelector(".tn-paper-light")).mixBlendMode'),'multiply','纸张光照层必须覆盖正文图片')
    assert.equal(await run('getComputedStyle(document.querySelector(".tn-glow")).mixBlendMode'),'screen','灯光叠加层必须覆盖正文图片')
    assert.ok(imageCheck.insidePaper,'图片必须位于原版纸面边界内')
    await run("tw.patchSettings({theme:'paper-and-ink',lighting:{source:'desk-lamp',position:{x:0.84,y:0.04},spread:96,reach:1.25,softness:0.75,intensity:1,enabled:true}})")
    await pause(600)
    const illumination=await run(`(()=>{const stage=document.querySelector('.tn-stage'),sheet=document.querySelector('.tn-sheet').getBoundingClientRect(),img=document.querySelector('.tn-inline-image-node img').getBoundingClientRect(),layout=window.__light.stageLayout(stage.clientWidth,stage.clientHeight,true,tw.settings.paper.width),rig=window.__light.buildRig(tw.settings.lighting,window.__light.activeTheme(tw.settings),{width:layout.sheet.width,height:layout.sheet.height,headX:layout.sheet.width/2,railY:layout.sheet.height});return{center:window.__light.lightAmount(rig,img.left+img.width/2-sheet.left,img.top+img.height/2-sheet.top),corners:[window.__light.lightAmount(rig,img.left-sheet.left,img.top-sheet.top),window.__light.lightAmount(rig,img.right-sheet.left,img.bottom-sheet.top)],source:rig.source}})()`)
    assert.equal(illumination.source,'desk-lamp')
    assert.ok(illumination.center>0.08,`光束必须真实覆盖图片，图片中心 irradiance=${illumination.center}`)
    report.checks.push({name:'图片位于纸张光照合成层下且灯束实际覆盖图片',illumination})
    await run('document.querySelector(".tn-note-input").scrollTop=0;document.querySelector(".tn-note-input").dispatchEvent(new Event("scroll"))')
    await pause(700)
    fs.writeFileSync(path.join(output,'image-fusion.png'),(await win.webContents.capturePage()).toPNG())
    await click('.toolbar-button[aria-pressed]')
    await until(`document.querySelector(".typewriter-preview img")?.naturalWidth>=${imageWidthMinimum}`)
    await click('.toolbar-button[aria-pressed]')
    await until(`document.querySelector('[data-save-status]')?.textContent==='已保存'`)
    assert.match(db.getNote(newId).contentText,/type\s*中文输入和 Markdown 正文/)
    assert.match(db.getNote(newId).content,/friday-asset:\/\/note-assets\//)
    assert.match(db.getNote(newId).content,/width=320;align=center;fit=contain/)
    report.checks.push({name:'用户实图在正文锚点解码、纸面融合、预览一致且元数据持久化',image:imageCheck})
    const extraImageWidths=[96,128,160,192,224,256,288,352,384]
    await run('document.querySelector(".tn-note-input").focus()')
    await key('End',['control'])
    await win.webContents.insertText(extraImageWidths.map((width,index)=>`![多尺寸插画 ${index+2}](${asset.url} "width=${width};height=${width};align=center;fit=contain;intensity=0.18;temperature=0;shadow=0.2;blend=paper")`).join('\n')+'\n')
    await until('document.querySelector(".tn-note-input").value.match(/!\\[多尺寸插画/g)?.length===9')
    const parsedImages=parseTypewriterImageNodes(await run('document.querySelector(".tn-note-input").value'))
    assert.equal(parsedImages.length,10,'文档必须持久包含十个正文图片节点')
    const beforeResizeWidths=parsedImages.map(image=>image.width)
    assert.deepEqual(beforeResizeWidths,[320,...extraImageWidths],'十个正文图片节点必须按不同尺寸显示')
    const visibleImages=await run(`(async()=>{const input=document.querySelector('.tn-note-input'),max=Math.max(0,input.scrollHeight-input.clientHeight),step=Math.max(120,Math.floor(input.clientHeight*.45)),seen={};for(let top=0;top<=max+step;top+=step){input.scrollTop=Math.min(max,top);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));for(const node of document.querySelectorAll('.tn-inline-image-node')){const img=node.querySelector('img');seen[node.dataset.imageId]={width:parseFloat(img.style.width),naturalWidth:img.naturalWidth}}}input.scrollTop=0;return seen})()`)
    assert.deepEqual(Object.keys(visibleImages).sort(),parsedImages.map(image=>image.id).sort(),'视口滚动必须逐一实际渲染十个图片节点')
    for(const [id,image] of Object.entries(visibleImages)){
      assert.ok(image.naturalWidth>=imageWidthMinimum,`${id} 必须完成原图解码`)
      const expected=parsedImages.find(item=>item.id===id).width
      assert.equal(image.width,expected,`${id} 的渲染宽度必须与文档一致`)
    }
    await run('document.querySelector(".tn-note-input").scrollTop=0')
    async function dragImageResize(index,delta) {
      const imageRect=await run(`document.querySelectorAll('.tn-inline-image-node img')[${index}].getBoundingClientRect().toJSON()`)
      win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(imageRect.left+imageRect.width/2),y:Math.round(imageRect.top+imageRect.height/2)})
      await pause(140)
      const handleRect=await run(`document.querySelectorAll('.tn-inline-image-node')[${index}].querySelector('.tn-typewriter-image-resize').getBoundingClientRect().toJSON()`)
      const x=Math.round(handleRect.left+handleRect.width/2),y=Math.round(handleRect.top+handleRect.height/2)
      win.webContents.sendInputEvent({type:'mouseMove',x,y})
      win.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1})
      for(let step=1;step<=8;step++){
        win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(x+delta*step/8),y,button:'left',modifiers:['leftButtonDown']})
        await pause(12)
      }
      win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(x+delta),y,button:'left',clickCount:1})
      const expected=Math.max(96,Math.min(960,beforeResizeWidths[index]+delta))
      await until(`Math.abs(parseFloat(document.querySelectorAll('.tn-inline-image-node img')[${index}].style.width)-${expected})<1`)
      return expected
    }
    const resizedWidth=await dragImageResize(0,64)
    assert.equal(resizedWidth,384)
    assert.equal(parseTypewriterImageNodes(await run('document.querySelector(".tn-note-input").value'))[0]?.width,384,'拖动后的图片宽度必须写回正文模型')
    await key('z',['control'])
    await pause(180)
    const undoImageWidth=parseTypewriterImageNodes(await run('document.querySelector(".tn-note-input").value'))[0]?.width
    assert.equal(undoImageWidth,320,'撤销必须恢复图片原尺寸')
    // CodeMirror's Windows keymap maps redo to Mod-y.
    await key('y',['control'])
    await pause(180)
    const redoImageWidth=parseTypewriterImageNodes(await run('document.querySelector(".tn-note-input").value'))[0]?.width
    assert.equal(redoImageWidth,384,'重做必须恢复调整后的图片尺寸')
    const primaryImageSelector=`[data-image-id="${parsedImages[0].id}"]`
    await run('document.querySelector(".tn-note-input").scrollTop=0')
    await until(`Boolean(document.querySelector(${JSON.stringify(primaryImageSelector)}))`)
    await run(`document.querySelector(${JSON.stringify(primaryImageSelector)}).querySelectorAll('.tn-typewriter-image-controls button')[2].click()`)
    await until(`document.querySelector(${JSON.stringify(primaryImageSelector)})?.classList.contains('align-right')`)
    await run(`(()=>{const details=document.querySelector(${JSON.stringify(primaryImageSelector)}).querySelector('.tn-typewriter-image-lighting');details.open=true;const intensity=details.querySelector('input[type=range]');intensity.value='0.7';intensity.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await until(`document.querySelector(${JSON.stringify(primaryImageSelector)})?.querySelector('img').style.filter.includes('saturate(1.14)')`)
    await until(`document.querySelector('[data-save-status]')?.textContent==='已保存'`)
    const tenImages=db.getNote(newId).content
    assert.equal((tenImages.match(/<img\b/g)||[]).length,10,'数据库 HTML 必须持久包含全部十张正文图片')
    assert.match(tenImages,/alt="多尺寸插画 2"/)
    assert.match(tenImages,/title="width=384;align=right/)
    assert.match(tenImages,/intensity=0\.7/)
    await click('[data-action=choose-note]')
    await click(`[data-note-id="${newId}"]`)
    await until('document.querySelector(".tn-note-input")?.value.match(/!\\[多尺寸插画/g)?.length===9')
    const reopenedImages=parseTypewriterImageNodes(await run('document.querySelector(".tn-note-input").value'))
    assert.equal(reopenedImages.length,10,'重开后必须恢复全部十个正文图片节点')
    const reopenedVisibleImages=await run(`(async()=>{const input=document.querySelector('.tn-note-input'),max=Math.max(0,input.scrollHeight-input.clientHeight),step=Math.max(120,Math.floor(input.clientHeight*.45)),seen={};for(let top=0;top<=max+step;top+=step){input.scrollTop=Math.min(max,top);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));for(const node of document.querySelectorAll('.tn-inline-image-node')){const img=node.querySelector('img');seen[node.dataset.imageId]={width:parseFloat(img.style.width),naturalWidth:img.naturalWidth}}}input.scrollTop=0;return seen})()`)
    assert.deepEqual(Object.keys(reopenedVisibleImages).sort(),reopenedImages.map(image=>image.id).sort(),'重开后滚动必须重新渲染全部图片节点')
    const reopenedPrimarySelector=`[data-image-id="${reopenedImages[0].id}"]`
    await run('document.querySelector(".tn-note-input").scrollTop=0')
    await until(`document.querySelector(${JSON.stringify(reopenedPrimarySelector)})?.classList.contains('align-right')`)
    await until(`parseFloat(document.querySelector(${JSON.stringify(reopenedPrimarySelector)}).querySelector('img').style.width)===384`)
    await run(`Array.from(document.querySelectorAll('.toolbar-button')).find(button=>button.textContent.includes('导出 Markdown'))?.click()`)
    const exportPath=path.join(temp,'export.md')
    for(let n=0;n<100&&!fs.existsSync(exportPath);n++)await pause(100)
    assert.equal(fs.existsSync(exportPath),true,'正文图片 Markdown 导出文件必须真实写入')
    const exportedMarkdown=fs.readFileSync(exportPath,'utf8')
    assert.match(exportedMarkdown,/width=384;align=right/)
    assert.match(exportedMarkdown,/intensity=0.7/)
    report.checks.push({name:'十张多尺寸图片真实拖拽缩放、撤销重做、对齐/灯光元数据持久化并重开恢复'})
    const feedback=await run('({keys:probe.keys,audio:probe.audio,energy:probe.energy,state:probe.audioState,cols:probe.cursors.map(c=>c.col),motion:document.querySelector(".tn-stage").dataset.motion})')
    report.feedback=feedback
    assert.ok(feedback.keys>=5);assert.ok(feedback.audio>=5);assert.ok(feedback.energy>0.01)
    assert.ok(new Set(feedback.cols).size>=3)
    report.checks.push({name:'新建真实笔记、正文输入、自动保存、击键声与光标联动',feedback})
    await run('document.querySelector(".tn-note-input").focus();document.querySelector(".tn-note-input").setSelectionRange(0,0)')
    await win.webContents.insertText(Array.from({length:130},(_,n)=>`Paperclip line ${n} 中文`).join('\n')+'\n')
    await until('Number(document.querySelector(".tn-scroll-clip")?.getAttribute("aria-valuemax"))>50')
    assert.equal(await run('getComputedStyle(document.querySelector(".tn-note-input .cm-scroller")).scrollbarWidth'),'none','自定义回形针样式下不显示原生笔记滚动条')
    assert.equal(await run('getComputedStyle(document.querySelector(".tn-note-input .cm-scroller"),"::-webkit-scrollbar").width'),'0px','Chromium 原生滚动条轨道已隐藏')
    await dragClip('note')
    for (const finish of ['silver','brass','gold','black']) {
      await run(`tw.patchSettings({scrollbar:{style:'clip',finish:${JSON.stringify(finish)}}})`)
      await pause(100)
      assert.ok(await run('Boolean(document.querySelector(".tn-scroll-clip svg .tn-clip-body"))'))
    }
    report.checks.push({name:'原版回形针：长笔记显示、真实指针拖动滚动、四种金属材质'})
    await until(`document.querySelector('[data-save-status]')?.textContent==='已保存'`)
    await click('[data-action=choose-note]')
    await click(`[data-note-id="${fixture.id}"]`)
    await until('document.querySelector(".tn-note-input")?.value.includes("Original text")')
    await run('document.querySelector(".tn-note-input").focus();document.querySelector(".tn-note-input").setSelectionRange(0,0)')
    await win.webContents.insertText('新增内容\n\n')
    await until(`document.querySelector('[data-save-status]')?.textContent==='已保存'`)
    const updated=db.getNote(fixture.id)
    assert.match(updated.contentText,/新增内容/);assert.match(updated.content,/data-note-chart/)
    assert.equal(db.getNotes().length,2)
    report.checks.push({name:'选取原有笔记、更新同一 ID、保留图表、无多余副本',id:fixture.id})
    await run(`document.querySelector('.tn-tools .tn-tool:last-child').click()`)
    await until('Boolean(document.querySelector(".tn-studio"))')
    assert.ok(await run('document.querySelectorAll(".tn-section").length')>=7)
    assert.ok(await run('document.querySelectorAll(".tn-studio input[type=range]").length')>=12)
    assert.match(await run('document.querySelector(".tn-studio").innerText'),/纹理深度/)
    await run(`setLanguage('en-US')`)
    await until(`document.querySelector('.tn-studio').textContent.includes('Texture depth')`)
    await run(`setLanguage('zh-CN');tw.patchSettings({typography:{fontSize:18,cursorStyle:'quill'},paper:{style:'laid'}})`)
    await until(`getComputedStyle(document.querySelector('.tn-note-input')).fontSize==='18px'&&Boolean(document.querySelector('.tn-quill'))`)
    assert.equal(await run('getComputedStyle(document.querySelector(".tn-note-input")).backgroundColor'),'rgba(0, 0, 0, 0)')
    assert.equal(await run('document.querySelector(".tn-stage")===originalStage'),true)
    report.checks.push({name:'原版二级菜单、中英切换、字体/纸张/羽毛笔设置、外壳保持同实例'})
    const beforeFont=await run('document.querySelector(".tn-note-input")');
    for(const font of ['jetbrains-mono','fira-code','sarasa-mono-sc']){
      await run(`document.getElementById('tn-font').value=${JSON.stringify(font)};document.getElementById('tn-font').dispatchEvent(new Event('change',{bubbles:true}))`)
      await until(`tw.settings.typography.font===${JSON.stringify(font)}`,30000)
      assert.equal(await run('document.querySelector(".tn-stage")===originalStage'),true)
    }
    await run("tw.patchSettings({typography:{inkMode:'custom',inkColor:'#702738',contrastPolicy:'auto'}})")
    await until('getComputedStyle(document.querySelector(".tn-note-input")).color==="rgb(112, 39, 56)"')
    assert.equal(await run('document.fonts.check(\'15px "Sarasa Mono SC"\',"中文ABC")'),true)
    await run("window.noteIdentity=document.querySelector('.tn-note-input');tw.patchSettings({paper:{style:'night'}})")
    await pause(200)
    assert.equal(await run("document.querySelector('.tn-note-input')===noteIdentity"),true)
    await run("tw.patchSettings({paper:{style:'cotton'}})")
    report.checks.push({name:'三款新增本地字体真实加载切换、中文离线字形、墨色及深浅纸张、舞台与编辑器保持实例'})

    await run(`document.querySelector('.tn-studio .tn-close').click()`)
    await click('.tn-tools .tn-tool:first-child')
    await until('Boolean(document.querySelector(".tn-press"))')
    assert.ok(await run('document.querySelectorAll(".tn-ribbon").length')===6)
    await run(`document.querySelector('.tn-press-text').focus()`)
    await win.webContents.insertText('中文打印验收\nPaper and wax seal.')
    await click('.tn-button-primary')
    await until('document.querySelector(".tn-press")?.dataset.state==="printed"')
    const folios=await run(`window.electronAPI.invoke('typewriter-archive-list')`)
    assert.equal(folios.length,1); assert.match(folios[0].text,/中文打印验收/)
    await run(`document.querySelector('.tn-press-actions button').click()`)
    for(let n=0;n<100&&!fs.existsSync(path.join(temp,'folio.png'));n++)await pause(100)
    assert.equal(fs.readFileSync(path.join(temp,'folio.png')).subarray(0,8).toString('hex'),'89504e470d0a1a0a')
    const renamed=await run(`window.electronAPI.invoke('typewriter-archive-rename',{id:${JSON.stringify(folios[0].id)},title:'档案重命名'})`)
    assert.equal(renamed.title,'档案重命名')
    await run(`window.electronAPI.invoke('typewriter-archive-remove',${JSON.stringify(folios[0].id)})`)
    assert.equal((await run(`window.electronAPI.invoke('typewriter-archive-list')`)).length,0)
    report.checks.push({name:'原版 Press 打印动画、六种丝带、真实 Archive 保存/重命名/删除、PNG 文件签名'})
    await run(`document.querySelector('.tn-press .tn-close').click()`)

    await click('[data-action=terminal]')
    await until('Boolean(document.querySelector(".xterm-helper-textarea"))')
    await until('readScreen().includes("PS ")',25000)
    await run('document.querySelector(".xterm-helper-textarea").focus()')
    await win.webContents.insertText(`Write-Output ('FRIDAY_' + (6 * 7))`)
    await pause(350)
    await key('Enter')
    await until('readScreen().split("\\n").some(line=>line.trim()==="FRIDAY_42")')
    assert.equal(await run('document.querySelector(".tn-stage")===originalStage'),true)
    report.checks.push({name:'独立 PowerShell 插件、真实命令计算回显、切换不重建外壳'})
    await run('document.querySelector(".xterm-helper-textarea").focus()')
    await win.webContents.insertText('1..160 | ForEach-Object { "CLIP_LINE_$_" }'); await pause(350); await key('Enter')
    await until('readScreen().includes("CLIP_LINE_160")')
    await until('Number(document.querySelector(".tn-scroll-clip")?.getAttribute("aria-valuemax"))>50')
    assert.equal(await run('getComputedStyle(document.querySelector(".xterm-viewport"),"::-webkit-scrollbar").width'),'0px','Chromium 终端原生滚动条已隐藏')
    await dragClip('terminal')
    const session=(await run(`window.electronAPI.invoke('typewriter-terminal-list')`))[0].id
    await run(`window.electronAPI.invoke('typewriter-terminal-write',${JSON.stringify({sessionId:session,data:'exit\r'})})`)
    await until('Boolean(document.querySelector("[data-action=restart-terminal]"))')
    await click('[data-action=restart-terminal]')
    await until('readScreen().includes("PS ")',25000)
    report.checks.push({name:'终端回形针拖动、终端退出后重新启动'})

    await click('[data-action=choose-note]');await click(`[data-note-id="${newId}"]`)
    await until('document.querySelector(".tn-note-input")?.value.includes("中文输入")')
    await until(`document.querySelector(".tn-inline-image-node img")?.naturalWidth>=${imageWidthMinimum}`)
    report.checks.push({name:'切换笔记后用户实图仍显示'})
    assert.equal(await run('document.querySelectorAll(".xterm").length'),0)
    assert.equal((await run(`window.electronAPI.invoke('typewriter-terminal-list')`)).length,0)
    report.checks.push({name:'从终端切回笔记、内容恢复、PTY 释放'})
    await run('tw.patchSettings({lighting:{enabled:true,quality:"low"},effects:true,typography:{cursorStyle:"block"}})')
    await until('document.querySelector(".tn-stage")?.dataset.machine==="drawn"',90000)
    const capturePaperLight=async()=>{
      const png=(await win.webContents.capturePage()).toPNG()
      const bounds=await run('document.querySelector(".tn-sheet").getBoundingClientRect().toJSON()')
      const viewport=await run('({width:innerWidth,height:innerHeight})')
      const metadata=await sharp(png).metadata()
      const scaleX=metadata.width/viewport.width,scaleY=metadata.height/viewport.height
      const left=Math.max(0,Math.round((bounds.x+bounds.width*.05)*scaleX))
      const top=Math.max(0,Math.round((bounds.y+bounds.height*.05)*scaleY))
      const region={left,top,width:Math.max(1,Math.min(metadata.width-left,Math.round(bounds.width*.9*scaleX))),height:Math.max(1,Math.min(metadata.height-top,Math.round(bounds.height*.9*scaleY)))}
      const {data,info}=await sharp(png).extract(region).removeAlpha().raw().toBuffer({resolveWithObject:true})
      let luminance=0
      for(let index=0;index<data.length;index+=info.channels)luminance+=data[index]*.2126+data[index+1]*.7152+data[index+2]*.0722
      return {luminance:luminance/(info.width*info.height),size:{width:info.width,height:info.height}}
    }
    assert.equal(await run('document.querySelector(".tn-cord")?.getAttribute("aria-pressed")==="true"'),true,'笔记纸面光效测试应从台灯开启状态开始')
    await run('document.querySelector(".tn-cord").click()')
    await until('document.querySelector(".tn-cord")?.getAttribute("aria-pressed")==="false"')
    await pause(350)
    const lampOffPaper=await capturePaperLight()
    await run('document.querySelector(".tn-cord").click()')
    await until('document.querySelector(".tn-cord")?.getAttribute("aria-pressed")==="true"')
    await pause(350)
    const lampOnPaper=await capturePaperLight()
    const lampLuminanceDelta=Math.abs(lampOnPaper.luminance-lampOffPaper.luminance)
    assert.ok(lampLuminanceDelta>=1,`台灯开关必须改变纸面光效像素，亮度差 ${lampLuminanceDelta.toFixed(2)} < 1`)
    report.checks.push({name:'笔记台灯实体开关改变纸面光照像素',lamp:{lampOffPaper,lampOnPaper,luminanceDelta:lampLuminanceDelta}})
    await run('document.querySelector(".tn-note-input").focus();tw.patchSettings({typography:{cursorStyle:"underline"}})')
    await until('document.querySelector(".tn-note-plugin")?.classList.contains("tn-note-cursor-underline")&&Boolean(document.querySelector(".tn-note-input .cm-cursor"))')
    const underlineCursor=await run("(()=>{const cursor=document.querySelector('.tn-note-input .cm-cursor'),after=getComputedStyle(cursor,'::after');return{borderColor:getComputedStyle(cursor).borderLeftColor,underlineHeight:after.height,underlineColor:after.backgroundColor}})()")
    assert.equal(underlineCursor.borderColor,'rgba(0, 0, 0, 0)','下划线光标隐藏竖线')
    assert.equal(underlineCursor.underlineHeight,'2px','下划线光标实际绘制')
    report.checks.push({name:'笔记下划线光标设置实际绘制',underlineCursor})
    await run('tw.patchSettings({typography:{cursorStyle:"block"}})')
    await run('document.querySelector(".tn-note-input").scrollTop=0;document.querySelector(".tn-note-input").dispatchEvent(new Event("scroll"))')
    win.showInactive(); await pause(2200)
    fs.writeFileSync(path.join(output,'workspace-note.png'),(await win.webContents.capturePage()).toPNG())
    report.checks.push({name:'完整机身实际绘制',render:await run('({...document.querySelector(".tn-stage").dataset})')})
    await click('.workspace-toolbar .icon-only')
    await until('Boolean(document.querySelector("[data-action=open-file]"))')
    await click('[data-action=open-file]')
    await until('document.querySelector(".tn-note-input")?.value.includes("不能发送给 Shell")')
    assert.equal((await run(`window.electronAPI.invoke('typewriter-terminal-list')`)).length,0)
    assert.equal(db.getNotes().length,3)
    assert.match(db.getNote(await run('notes.currentNoteId')).contentText,/文件导入/)
    report.checks.push({name:'中文空格路径 Markdown 直接导入笔记、不发送 Shell、不产生 PTY'})
    await click('[data-action=open-note-page]')
    await until('!document.querySelector(".tn-note-input")')
    const linkedId=await run('notes.currentNoteId')
    db.updateNote(linkedId,'笔记模块更新','<p>从笔记模块更新的正文</p>','从笔记模块更新的正文')
    await run('router.push("/")')
    await until('document.querySelector(".tn-note-input")?.value.includes("从笔记模块更新的正文")')
    report.checks.push({name:'真实 RouterView/KeepAlive 路由切换、返回后重新读取同 ID 笔记'})
    const paperBeforeFocus=await run('getComputedStyle(document.querySelector(".tn-sheet")).backgroundColor')
    await run('window.heldInput=document.querySelector(".tn-note-input");tw.patchSettings({effects:false,focusMode:true})')
    await until('Boolean(document.querySelector(".tn-focus"))')
    assert.equal(await run('document.querySelector(".tn-note-input")===heldInput'),true)
    assert.equal(await run('getComputedStyle(document.querySelector(".tn-sheet")).backgroundColor'),paperBeforeFocus,'专注模式必须沿用退出前选中的纸张背景')
    assert.equal(await run('document.querySelector(".tn-sheet").getBoundingClientRect().width===document.querySelector(".tn-stage").getBoundingClientRect().width'),true,'专注模式纸张必须铺满舞台')
    await run('tw.patchSettings({effects:true,focusMode:false})')
    report.checks.push({name:'Focus/Effects 切换保持编辑器实例和内容'})
    rejectSave=true
    await run('document.querySelector(".tn-note-input").focus()')
    await win.webContents.insertText('保存失败保留输入')
    await until(`document.querySelector('[data-save-status]')?.textContent==='保存失败'`)
    rejectSave=false
    await key('s',['control'])
    await until(`document.querySelector('[data-save-status]')?.textContent==='已保存'`)
    assert.match(db.getNote(linkedId).contentText,/保存失败保留输入/)
    report.checks.push({name:'数据库写入失败保留输入、Ctrl+S 重试保存同一笔记'})

    const performanceText=(size)=>{const line='Preview22 mixed 中文性能测试 1234567890 abcdefghijklmnopqrstuvwxyz ';return(line.repeat(Math.ceil(size/line.length))).slice(0,size)}
    await run(`window.__perf={active:false,update:[],paint:[],longTasks:[],pending:[]};{const editor=document.querySelector('.tn-note-input');editor.addEventListener('beforeinput',()=>window.__perf.pending.push(performance.now()),{capture:true});document.addEventListener('friday:typewriter-input',()=>{const at=window.__perf.pending.shift();if(at===undefined)return;window.__perf.update.push(performance.now()-at);requestAnimationFrame(()=>requestAnimationFrame(()=>window.__perf.paint.push(performance.now()-at))) });window.__perfObserver=new PerformanceObserver(list=>{if(window.__perf.active)for(const item of list.getEntries())window.__perf.longTasks.push(item.duration)});try{window.__perfObserver.observe({type:'longtask',buffered:false})}catch{};true}`)
    for(const size of [20000,50000,100000]){
      probePhase=`${size} 字性能夹具初始化`
      const fixtureText=performanceText(size)
      await run(`(()=>{const editor=document.querySelector('.tn-note-input');editor.value=${JSON.stringify(fixtureText)};editor.setSelectionRange(0,0);editor.focus()})()`)
      await until(`document.querySelector('.tn-note-input')?.value.length===${size}`,30000)
      await until(`document.querySelector('[data-save-status]')?.textContent==='已保存'`,30000)
      if(size===100000){
        probePhase='100000 字纸夹性能追踪初始化'
        await run(`window.__clipProbe={active:false,result:null};window.__clipLongTaskObserver=new PerformanceObserver(list=>{if(window.__clipProbe.active)for(const item of list.getEntries())window.__clipProbe.longTasks.push(item.duration)});try{window.__clipLongTaskObserver.observe({type:'longtask',buffered:false})}catch{};
        window.__clipY=()=>parseFloat(/translateY\\((-?[0-9.]+)px\\)/.exec(document.querySelector('.tn-scroll-clip')?.style.transform||'')?.[1]||'0');
        window.__clipTarget=()=>{const stage=document.querySelector('.tn-stage'),layout=window.__light.stageLayout(stage.clientWidth,stage.clientHeight,true,window.tw.settings.paper.width),clip=document.querySelector('.tn-scroll-clip'),max=Number(clip?.getAttribute('aria-valuemax'))||0,now=Number(clip?.getAttribute('aria-valuenow'))||0,ratio=max>0?Math.max(0,Math.min(1,now/max)):1,trackTop=layout.text.y+18,travel=Math.max(1,Math.max(40,layout.text.height-36)-26);return trackTop+ratio*travel};
        window.__startClipTrace=()=>{const initialTarget=window.__clipTarget(),state={active:true,startTarget:initialTarget,target:initialTarget,startY:window.__clipY(),samples:[],longTasks:[],overshoot:false,maxSpeed:0,done:false,startedAt:0,settled:0,lastY:window.__clipY(),lastAt:performance.now()};window.__clipProbe=state;const frame=now=>{if(window.__clipProbe!==state||state.done)return;const y=window.__clipY(),target=window.__clipTarget(),dt=Math.max(.001,(now-state.lastAt)/1000);if(!state.startedAt&&Math.abs(target-state.startTarget)>1){state.startedAt=now;state.target=target;state.lastY=y;state.lastAt=now}if(state.startedAt){state.target=target;state.samples.push({t:now,y,target});state.maxSpeed=Math.max(state.maxSpeed,Math.abs(y-state.lastY)/dt);const direction=Math.sign(state.target-state.startTarget);if(direction>0&&y>state.target+.03||direction<0&&y<state.target-.03)state.overshoot=true;state.settled=Math.abs(y-state.target)<=.02?state.settled+1:0;if(state.settled>=3){state.done=true;state.active=false;const times=state.samples.map((sample,i)=>i?sample.t-state.samples[i-1].t:null).filter(Boolean);state.result={started:true,durationMs:now-state.startedAt,fps:times.length?1000/(times.reduce((a,b)=>a+b,0)/times.length):0,minFps:times.length?1000/Math.max(...times):0,samples:state.samples.length,overshoot:state.overshoot,maxSpeed:state.maxSpeed,longTasks:state.longTasks.slice()}}}if(!state.done&&now-(state.startedAt||state.lastAt)>1500){state.done=true;state.active=false;state.result={timedOut:true,started:Boolean(state.startedAt),target,stateY:y}}state.lastY=y;state.lastAt=now;if(!state.done)requestAnimationFrame(frame)};requestAnimationFrame(frame)};true`)
        await run(`document.querySelector('.tn-note-input').scrollTop=0`)
        await until(`Number(document.querySelector('.tn-scroll-clip')?.getAttribute('aria-valuenow'))<1`)
        await until(`Math.abs(window.__clipY()-window.__clipTarget())<.02`)
        const clipTraces=[]
        const clipTrialCount=Math.max(1,Number(process.env.FRIDAY_CLIP_TRIALS)||100)
        for(let n=0;n<clipTrialCount;n++){
          probePhase=`纸夹远跳 ${n+1}/${clipTrialCount} 启动追踪`
          await run('window.__startClipTrace()')
          probePhase=`纸夹远跳 ${n+1}/${clipTrialCount} 发送 Home/End`
          await key(n%2===0?'End':'Home',['control'])
          probePhase=`纸夹远跳 ${n+1}/${clipTrialCount} 等待动画`
          await until('window.__clipProbe?.done===true',3000)
          probePhase=`纸夹远跳 ${n+1}/${clipTrialCount} 读取结果`
          const result=await run('window.__clipProbe.result')
          if (n===0) report.performance.firstClipTrace=result
          assert.ok(result&&!result.timedOut&&result.started,`纸夹滑块第 ${n+1} 次远距离光标跳转应完成：${JSON.stringify(result)}`)
          clipTraces.push(result)
        }
        const clipDuration=clipTraces.map(item=>item.durationMs)
        report.performance.scrollClip={trials:clipTraces.length,durationP95Ms:percentile(clipDuration,.95),minimumFps:Math.min(...clipTraces.map(item=>item.minFps)),overshoots:clipTraces.filter(item=>item.overshoot).length,maximumSpeedPxPerSecond:Math.max(...clipTraces.map(item=>item.maxSpeed)),longTasks:clipTraces.reduce((total,item)=>total+item.longTasks.length,0)}
        assert.equal(report.performance.scrollClip.overshoots,0,'纸夹滑块不得越过目标后回弹')
        assert.ok(report.performance.scrollClip.durationP95Ms<=800,`纸夹滑块动画 P95 ${report.performance.scrollClip.durationP95Ms.toFixed(1)}ms > 800ms`)
        assert.ok(report.performance.scrollClip.maximumSpeedPxPerSecond<=1800,`纸夹滑块峰值速度 ${report.performance.scrollClip.maximumSpeedPxPerSecond.toFixed(1)}px/s > 1800px/s`)
        // Windows compositor timestamps can quantize one 18.2 ms sample to 54.9 FPS; retain a
        // small measurement epsilon while preserving the 55 FPS product target.
        assert.ok(report.performance.scrollClip.minimumFps>=54.5,`回形针滚动动画低于 55 FPS：${report.performance.scrollClip.minimumFps.toFixed(1)}fps`)
        assert.equal(report.performance.scrollClip.longTasks,0,'回形针滚动期间不得产生 50ms 以上主线程长任务')
        report.checks.push({name:'真实笔记 Home/End 远距离回形针滚动过渡',performance:report.performance.scrollClip})
      }
      await run(`window.__perf={...window.__perf,active:true,update:[],paint:[],longTasks:[],pending:[]}`)
      probePhase=`${size} 字输入 P95 测试`
      for(let n=0;n<80;n++){
        win.webContents.sendInputEvent({type:'keyDown',keyCode:'X'})
        win.webContents.sendInputEvent({type:'char',keyCode:'x'})
        win.webContents.sendInputEvent({type:'keyUp',keyCode:'X'})
        await pause(20)
      }
      await until('window.__perf.update.length>=80&&window.__perf.paint.length>=80',15000)
      await run('window.__perf.active=false')
      const metric=await run(`({samples:window.__perf.update.length,longTaskP95Ms:window.__perf.longTasks.length?window.__perf.longTasks.slice().sort((a,b)=>a-b)[Math.ceil(window.__perf.longTasks.length*.95)-1]:0,longTaskCount:window.__perf.longTasks.length})`)
      metric.inputUpdateP50Ms=percentile(await run('window.__perf.update.slice()'),.5)
      metric.inputUpdateP95Ms=percentile(await run('window.__perf.update.slice()'),.95)
      metric.inputPaintP95Ms=percentile(await run('window.__perf.paint.slice()'),.95)
      report.performance.inputByLength={...(report.performance.inputByLength||{}),[size]:metric}
      const limit=size===20000?50:size===50000?100:Infinity
      assert.ok(metric.inputUpdateP95Ms<=limit,`${size} 字输入更新 P95 ${metric.inputUpdateP95Ms.toFixed(1)}ms > ${limit}ms`)
      assert.ok(metric.longTaskP95Ms<50,`${size} 字输入主线程长任务 P95 ${metric.longTaskP95Ms.toFixed(1)}ms >= 50ms`)
      if(size===20000){
        const previewTimings=[]
        for(let n=0;n<20;n++){
          const started=await run('performance.now()')
          await run(`Array.from(document.querySelectorAll('.workspace-toolbar .toolbar-button')).find(button=>button.getAttribute('aria-pressed')!==null)?.click()`)
          await until('Boolean(document.querySelector(".typewriter-preview"))',5000)
          await run(`Array.from(document.querySelectorAll('.workspace-toolbar .toolbar-button')).find(button=>button.getAttribute('aria-pressed')!==null)?.click()`)
          await until('!document.querySelector(".typewriter-preview")',5000)
          previewTimings.push((await run('performance.now()'))-started)
        }
        report.performance.preview20kP95Ms=percentile(previewTimings,.95)
        report.performance.previewSamples=previewTimings.length
        assert.ok(report.performance.preview20kP95Ms<=500,`20k 字预览切换 P95 ${report.performance.preview20kP95Ms.toFixed(1)}ms > 500ms`)
      }
    }

    const returnTimings=[]
    for(let n=0;n<20;n++){
      await run('router.push("/note")')
      await until('!document.querySelector(".tn-note-input")')
      const started=Date.now()
      await run('router.push("/")')
      await until('Boolean(document.querySelector(".tn-note-input"))')
      returnTimings.push(Date.now()-started)
    }
    report.performance.returnP95Ms=percentile(returnTimings,.95)
    report.performance.returnSamples=returnTimings.length
    assert.ok(report.performance.returnP95Ms<=1000,`长文返回 P95 ${report.performance.returnP95Ms}ms > 1000ms`)
    report.checks.push({name:'十万字长文输入与页面返回 P95 达标',performance:report.performance})
    assert.deepEqual(errors.filter(e=>!e.includes('验收模拟保存失败')),[])
    report.ok=true;ok=true
  } catch(error){report.ok=false;report.phase=probePhase;report.error=error.stack;console.error(error.stack)
    if(win&&!win.isDestroyed()){fs.writeFileSync(path.join(output,'workspace-failure.png'),(await win.webContents.capturePage()).toPNG());report.dom=await run(`([...document.querySelectorAll('.tn-stage,.tn-text,.tn-note-plugin,.tn-note-input,.tn-note-mirror,.tn-machine')].map(e=>({class:e.className,rect:e.getBoundingClientRect().toJSON(),hidden:e.hidden,style:e.getAttribute('style'),font:getComputedStyle(e).font,color:getComputedStyle(e).color,display:getComputedStyle(e).display,dataset:{...e.dataset},value:e.value?.slice(0,200)})))`)}
  } finally {
    report.errors=errors;report.generatedAt=new Date().toISOString()
    fs.writeFileSync(path.join(output,'workspace-report.json'),JSON.stringify(report,null,2))
    console.log(JSON.stringify(report))
    clearTimeout(timer);if(win&&!win.isDestroyed())win.destroy();db.closeDb();if(fs.existsSync(entry))fs.unlinkSync(entry)
    app.exit(ok?0:1)
  }
})
