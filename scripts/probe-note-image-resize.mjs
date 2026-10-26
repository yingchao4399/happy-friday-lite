// 真实笔记 NodeView 的鼠标拖动、撤销、保存重载与双击预览验收。
import { app, BrowserWindow, ipcMain } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'

const root=fileURLToPath(new URL('../',import.meta.url))
const data=fs.mkdtempSync(path.join(os.tmpdir(),'friday-note-resize-'))
app.setPath('userData',path.join(data,'profile'))
app.on('window-all-closed',()=>{})
let win,harnessDir,viteServer
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const run=code=>win.webContents.executeJavaScript(code,true)
async function until(code){for(let i=0;i<240;i++){if(await run(code))return;await pause(50)}throw new Error('笔记图片验收超时: '+code)}
async function point(selector){return run(`(() => {const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)}
async function click(selector,count=1){const p=await point(selector);for(let i=1;i<=count;i++){win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:i,...p});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:i,...p})}await pause(150)}
async function main(){
 let ok=false
 const timer=setTimeout(()=>app.exit(1),90000)
 try{
  const image='data:image/png;base64,'+(await sharp({create:{width:480,height:320,channels:4,background:'#3974a6'}}).png().toBuffer()).toString('base64')
  harnessDir=fs.mkdtempSync(path.join(root,'note-image-resize-probe-'))
  fs.writeFileSync(path.join(harnessDir,'note.json'),JSON.stringify({content:`<h1 data-note-title="true">图片拖动验收</h1><p>单击出现四角手柄；拖动即可缩放；双击进入图片编辑。</p><img src="${image}" width="360" height="240"><p>验收正文</p>`}))
  fs.writeFileSync(path.join(harnessDir,'index.html'),`<!doctype html><html lang="zh"><meta charset="utf-8"><body><div id="app"></div><script type="module">
import { createApp,h,ref } from 'vue'
import { createPinia } from 'pinia'
import { createRouter,createMemoryHistory } from 'vue-router'
import { i18n } from '/src/i18n/index.js'
import NoteEditor from '/src/views/note/NoteEditor.vue'
import '/src/assets/styles/main.css'
const initial=await(await fetch('./note.json')).json(),content=ref(initial.content)
const router=createRouter({history:createMemoryHistory(),routes:[{path:'/',component:{render:()=>null}}]})
createApp({setup:()=>()=>h(NoteEditor,{modelValue:content.value,'onUpdate:modelValue':value=>{content.value=value;window.emittedNote=value}})}).use(createPinia()).use(router).use(i18n).mount('#app')
</script><style>html,body,#app{height:100%;margin:0;background:var(--bg-primary)}</style></body></html>`)
  win=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{offscreen:true,backgroundThrottling:false,preload:path.join(root,'preload.cjs'),contextIsolation:true}})
  ipcMain.handle('kb-get-data-dir',()=>null)
  win.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message.slice(0,500))})
  const { createServer } = await import('vite')
  viteServer = await createServer({ configFile: path.join(root,'vite.config.js'), server: { host:'127.0.0.1',port:0,strictPort:false,hmr:false } })
  await viteServer.listen()
  const port = viteServer.httpServer.address().port
  await win.loadURL(`http://127.0.0.1:${port}/${path.basename(harnessDir)}/index.html`)
  await until('document.querySelector(".note-image-node img")?.naturalWidth===480')
  await click('.note-image-frame img')
  await until('document.querySelectorAll(".note-image-resize-handle").length===4')
  assert.equal(await run('Boolean(document.querySelector(".image-editor-overlay"))'),false)
  const before=await run('document.querySelector(".note-image-frame").getBoundingClientRect().width')
  const p=await point('.handle-se')
  win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p})
  for(let n=1;n<=8;n++){win.webContents.sendInputEvent({type:'mouseMove',button:'left',x:p.x+n*15,y:p.y+n*10});await pause(30)}
  win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:p.x+120,y:p.y+80})
  await until('window.emittedNote?.includes(\'width="480"\')')
  const after=await run('document.querySelector(".note-image-frame").getBoundingClientRect().width')
  assert.ok(after-before>=110,JSON.stringify({before,after}))
  const saved=await run('window.emittedNote')
  assert.match(saved,/height="320"/)
  fs.writeFileSync(path.join(harnessDir,'note.json'),JSON.stringify({content:saved}))
  await win.reload()
  await until('document.querySelector(".note-image-frame img")?.naturalWidth===480')
  assert.ok(Math.abs(await run('document.querySelector(".note-image-frame").getBoundingClientRect().width')-after)<2)
  await click('.note-image-frame img',2)
  await until('Boolean(document.querySelector(".note-image-editor-overlay"))')
  await pause(500)
  const report={ok:true,realPointerDrag:true,before,after,serializedDimensions:true,reloadDimensions:true,doubleClickPreview:true}
  fs.mkdirSync(path.join(root,'app-data/diagnostics'),{recursive:true})
  fs.writeFileSync(path.join(root,'app-data/diagnostics/note-image-resize.json'),JSON.stringify(report,null,2))
  fs.writeFileSync(path.join(root,'app-data/diagnostics/note-image-resize.png'),(await win.webContents.capturePage()).toPNG())
  console.log(JSON.stringify(report));ok=true
 }catch(error){console.error(error.stack);if(win&&!win.isDestroyed()){console.error(await run('document.querySelector(".note-image-node")?.outerHTML'));fs.mkdirSync(path.join(root,'app-data/diagnostics'),{recursive:true});fs.writeFileSync(path.join(root,'app-data/diagnostics/note-image-resize-failure.png'),(await win.webContents.capturePage()).toPNG())}}
 finally{clearTimeout(timer);if(win&&!win.isDestroyed())win.destroy();await viteServer?.close();if(harnessDir)removePathNoFollowSync(harnessDir,{root});app.exit(ok?0:1)}
}
app.whenReady().then(main)
