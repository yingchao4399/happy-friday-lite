// 隔离真实 Electron：字体挂起不得阻塞原版纸张、机身、正文和终端。
import {app, BrowserWindow, ipcMain} from 'electron'
import {build} from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import {registerTypewriterTerminalCommands} from '../src-electron/typewriter-terminal.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-typewriter-recovery-'))
const output = path.join(root, 'artifacts/typewriter/recovery')
fs.mkdirSync(output, {recursive:true})
app.setPath('userData', path.join(temp, 'profile'))
app.on('window-all-closed', () => {})
const entry = path.join(root, 'typewriter-recovery-probe.html')
let win
const errors = []
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const run = code => win.webContents.executeJavaScript(code, true)
async function until(code, timeout=10000) {
  const end = Date.now()+timeout
  while (Date.now()<end) { if(await run(code)) return; await pause(80) }
  throw new Error('验收超时：'+code)
}
app.whenReady().then(async()=>{
  let ok=false
  const timer=setTimeout(()=>app.exit(1),120000)
  try {
    ipcMain.handle('fonts-list', () => new Promise(() => {}))
    ipcMain.handle('get_notes', () => [])
    fs.writeFileSync(entry, `<!doctype html><meta charset="utf-8"><div id="app"></div><style>html,body,#app{height:100%;margin:0}#app{position:relative}</style><script type="module">
import {createApp,h,shallowRef,ref,KeepAlive} from 'vue';import{createPinia}from'pinia';import{i18n}from'/src/i18n/index.js';import Stage from'/src/views/typewriter/components/TypewriterStage.vue';import{defaultSettings}from'/src/features/typewriter/nocturne-core/app/nocturne/settings.ts';import{activeTerminalText}from'/src/features/typewriter/nocturne-core/lib/nocturne/terminal-bridge.ts';
window.source=shallowRef({id:'recovery-note',viewId:'recovery-note',content:'原版打字机恢复验收\\nTypewriter paper and machine.',flush:async()=>{}});window.saved='';window.visible=ref(true);window.readScreen=()=>activeTerminalText('screen');const settings=defaultSettings();settings.lighting.quality='low';createApp({render:()=>h(KeepAlive,null,()=>visible.value?h(Stage,{settings,source:source.value,onChange:text=>{saved=text;source.value.content=text}}):null)}).use(createPinia()).use(i18n).mount('#app');</script>`)
    await build({root,configFile:false,plugins:[vue()],resolve:{alias:{'@':path.join(root,'src')}},base:'./',logLevel:'error',build:{outDir:path.join(temp,'site'),minify:false,rollupOptions:{input:entry}}})
    win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload:path.join(root,'preload.cjs'),contextIsolation:true,backgroundThrottling:false}})
    win.webContents.on('console-message', event=>{if(event.level==='error') errors.push(event.message)})
    registerTypewriterTerminalCommands(win)
    await win.loadFile(path.join(temp,'site/typewriter-recovery-probe.html'))
    await until('Boolean(document.querySelector(".tn-note-input"))')
    await until('document.querySelector(".tn-stage")?.dataset.machine==="drawn"',60000)
    const geometry=await run(`Object.fromEntries(['.tn-stage','.tn-sheet','.tn-machine','.tn-note-input'].map(s=>[s,document.querySelector(s).getBoundingClientRect().toJSON()]))`)
    for(const selector of ['.tn-stage','.tn-sheet','.tn-machine','.tn-note-input']) assert.ok(geometry[selector].width>100&&geometry[selector].height>30, selector+' 不可见')
    await run('document.querySelector(".tn-note-input").focus()')
    await win.webContents.insertText('中文输入恢复 ')
    await until('saved.includes("中文输入恢复")')
    fs.writeFileSync(path.join(output,'note.png'),(await win.webContents.capturePage()).toPNG())
    await run('document.querySelector(".tn-tools .tn-tool:last-child").click()')
    await until('Boolean(document.querySelector(".tn-studio"))')
    assert.ok(await run('document.querySelectorAll(".tn-studio input[type=range]").length>=12'))
    await run('document.querySelector(".tn-studio .tn-close").click(); window.source.value=null')
    await until('Boolean(document.querySelector(".xterm-helper-textarea"))')
    await until('!document.querySelector(".tn-plugin-status")',20000)
    await run('document.querySelector(".xterm-helper-textarea").focus()')
    await win.webContents.insertText('echo FRIDAY_RECOVERY')
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'})
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'})
    await until('readScreen().includes("FRIDAY_RECOVERY")')
    fs.writeFileSync(path.join(output,'terminal.png'),(await win.webContents.capturePage()).toPNG())
    await run('window.visible.value=false'); await pause(100); await run('window.visible.value=true')
    await until('Boolean(document.querySelector(".xterm-helper-textarea"))')
    assert.deepEqual(errors,[])
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:true,geometry,checks:['字体挂起时舞台首屏可见','原版纸张/机身尺寸','中文输入','原版工作室控件','终端命令','终端离开后重开'],errors},null,2))
    ok=true
  } catch(error) {
    console.error(error.stack)
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:false,error:error.message,errors},null,2))
    if(win&&!win.isDestroyed())fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG())
  } finally {
    clearTimeout(timer)
    if(win&&!win.isDestroyed())win.destroy()
    if(fs.existsSync(entry))fs.unlinkSync(entry)
    app.exit(ok?0:1)
  }
})
