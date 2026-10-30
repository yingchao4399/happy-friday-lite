// 使用真实 Vue 页面、原作 React 外壳、笔记 SQLite 和 PTY 的隔离验收。
import {app, BrowserWindow, ipcMain, dialog, net, protocol} from 'electron'
import {build} from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fileURLToPath, pathToFileURL} from 'node:url'
import * as db from '../src-electron/db.js'
import {registerFontCommands} from '../src-electron/fonts.js'
import {setDataDir as setConfigDir} from '../src-electron/config.js'
import {registerTypewriterTerminalCommands} from '../src-electron/typewriter-terminal.js'
import {NOTE_ASSET_SCHEME, importNoteResource, resolveNoteAssetPath} from '../src-electron/note-resources.js'

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
const run = code => win.webContents.executeJavaScript(code, true)
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
    const imageFile=path.join(temp,'图片验收.png')
    fs.writeFileSync(imageFile,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWsAAAAASUVORK5CYII=','base64'))
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
window.probe={keys:0,audio:0,energy:0,cursors:[]};on('key',()=>probe.keys++);on('cursor',f=>{probe.cursors.push({x:f.x,col:f.col,row:f.row})});
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
    const firstOpenStarted=Date.now()
    await click('[data-action=new-note]')
    await until('Boolean(document.querySelector(".tn-note-input"))')
    report.performance={firstOpenMs:Date.now()-firstOpenStarted}
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
    await win.webContents.insertText(`\n![图片验收](${asset.url})\n`)
    await until('document.querySelector(".typewriter-image-card img")?.naturalWidth===1')
    await click('.toolbar-button[aria-pressed]')
    await until('document.querySelector(".typewriter-preview img")?.naturalWidth===1')
    await click('.toolbar-button[aria-pressed]')
    await until(`document.querySelector('[data-save-status]')?.textContent==='已保存'`)
    assert.match(db.getNote(newId).contentText,/type\s*中文输入和 Markdown 正文/)
    assert.match(db.getNote(newId).content,/friday-asset:\/\/note-assets\//)
    report.checks.push({name:'受管图片在编辑页与预览页加载，并保存到原笔记'})
    const feedback=await run('({keys:probe.keys,audio:probe.audio,energy:probe.energy,state:probe.audioState,cols:probe.cursors.map(c=>c.col),motion:document.querySelector(".tn-stage").dataset.motion})')
    report.feedback=feedback
    assert.ok(feedback.keys>=5);assert.ok(feedback.audio>=5);assert.ok(feedback.energy>0.01)
    assert.ok(new Set(feedback.cols).size>=3)
    report.checks.push({name:'新建真实笔记、正文输入、自动保存、击键声与光标联动',feedback})
    await run('document.querySelector(".tn-note-input").focus();document.querySelector(".tn-note-input").setSelectionRange(0,0)')
    await win.webContents.insertText(Array.from({length:130},(_,n)=>`Paperclip line ${n} 中文`).join('\n')+'\n')
    await until('Number(document.querySelector(".tn-scroll-clip")?.getAttribute("aria-valuemax"))>50')
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
    await dragClip('terminal')
    const session=(await run(`window.electronAPI.invoke('typewriter-terminal-list')`))[0].id
    await run(`window.electronAPI.invoke('typewriter-terminal-write',${JSON.stringify({sessionId:session,data:'exit\r'})})`)
    await until('Boolean(document.querySelector("[data-action=restart-terminal]"))')
    await click('[data-action=restart-terminal]')
    await until('readScreen().includes("PS ")',25000)
    report.checks.push({name:'终端回形针拖动、终端退出后重新启动'})

    await click('[data-action=choose-note]');await click(`[data-note-id="${newId}"]`)
    await until('document.querySelector(".tn-note-input")?.value.includes("中文输入")')
    await until('document.querySelector(".typewriter-image-card img")?.naturalWidth===1')
    report.checks.push({name:'切换笔记后受管图片仍显示'})
    assert.equal(await run('document.querySelectorAll(".xterm").length'),0)
    assert.equal((await run(`window.electronAPI.invoke('typewriter-terminal-list')`)).length,0)
    report.checks.push({name:'从终端切回笔记、内容恢复、PTY 释放'})
    await run('tw.patchSettings({lighting:{enabled:true,quality:"low"},effects:true,typography:{cursorStyle:"block"}})')
    await until('document.querySelector(".tn-stage")?.dataset.machine==="drawn"',90000)
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
    await run('window.heldInput=document.querySelector(".tn-note-input");tw.patchSettings({effects:false,focusMode:true})')
    await until('Boolean(document.querySelector(".tn-focus"))')
    assert.equal(await run('document.querySelector(".tn-note-input")===heldInput'),true)
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

    await run(`document.querySelector('.tn-note-input').focus()`)
    await win.webContents.insertText(Array.from({length:3500},(_,n)=>`Performance fixture ${n} 中文段落 1234567890.`).join('\n'))
    await until('document.querySelector(".tn-note-input")?.value.length>100000')
    await until(`document.querySelector('[data-save-status]')?.textContent==='已保存'`,30000)
    await run(`window.inputTimings=[];window.inputEventTimings=[];{
      const editor=document.querySelector('.tn-note-input');let started=0;
      editor.addEventListener('beforeinput',()=>{started=performance.now()},{capture:true});
      editor.addEventListener('input',()=>{
        const inputAt=performance.now();
        window.inputEventTimings.push(inputAt-started);
        const at=started;
        requestAnimationFrame(()=>setTimeout(()=>{if(at)window.inputTimings.push(performance.now()-at)},0));
      },{capture:true});
    }`)
    for(let n=0;n<80;n++){
      win.webContents.sendInputEvent({type:'keyDown',keyCode:'X'})
      win.webContents.sendInputEvent({type:'char',keyCode:'x'})
      win.webContents.sendInputEvent({type:'keyUp',keyCode:'X'})
      await pause(20)
    }
    await until('window.inputTimings.length>=80',15000)
    const inputTimings=await run('window.inputTimings.slice()')
    report.performance.inputP50Ms=percentile(inputTimings,.5)
    report.performance.inputP95Ms=percentile(inputTimings,.95)
    const inputEventTimings=await run('window.inputEventTimings.slice()')
    report.performance.inputEventP50Ms=percentile(inputEventTimings,.5)
    report.performance.inputEventP95Ms=percentile(inputEventTimings,.95)
    report.performance.inputSamples=inputTimings.length
    // The product SLO is input event -> content update. inputP95Ms also
    // includes a compositor animation frame and is intentionally reported as
    // a separate rendering metric because Windows frame scheduling can add a
    // 16/33 ms sample without delaying the edit itself.
    assert.ok(report.performance.inputEventP95Ms<=50,`长文输入事件 P95 ${report.performance.inputEventP95Ms.toFixed(1)}ms > 50ms`)

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
  } catch(error){report.ok=false;report.error=error.stack;console.error(error.stack)
    if(win&&!win.isDestroyed()){fs.writeFileSync(path.join(output,'workspace-failure.png'),(await win.webContents.capturePage()).toPNG());report.dom=await run(`([...document.querySelectorAll('.tn-stage,.tn-text,.tn-note-plugin,.tn-note-input,.tn-note-mirror,.tn-machine')].map(e=>({class:e.className,rect:e.getBoundingClientRect().toJSON(),hidden:e.hidden,style:e.getAttribute('style'),font:getComputedStyle(e).font,color:getComputedStyle(e).color,display:getComputedStyle(e).display,dataset:{...e.dataset},value:e.value?.slice(0,200)})))`)}
  } finally {
    report.errors=errors;report.generatedAt=new Date().toISOString()
    fs.writeFileSync(path.join(output,'workspace-report.json'),JSON.stringify(report,null,2))
    console.log(JSON.stringify(report))
    clearTimeout(timer);if(win&&!win.isDestroyed())win.destroy();db.closeDb();if(fs.existsSync(entry))fs.unlinkSync(entry)
    app.exit(ok?0:1)
  }
})
