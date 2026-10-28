import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
const root=process.cwd(),batch='shortcuts',port=9450
const output=path.join(root,'artifacts/typewriter'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'friday-packaged-'+batch+'-'))
const executable=path.join(root,'release/win-unpacked/Happy Friday Lite.exe')
const log=fs.openSync(path.join(output,`packaged-${batch}.log`),'w'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE
const child=spawn(executable,[`--friday-data-dir=${profile}`,`--remote-debugging-port=${port}`],{env,stdio:['ignore',log,log],windowsHide:!process.argv.includes('--manual-keys')})
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),report={batch,checks:[],profile,ok:false},pending=new Map()
let socket,seq=0
async function rpc(method,params={}){const id=++seq;return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timeout'))},45000);pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value)},reject});socket.send(JSON.stringify({id,method,params}))})}
async function evaluate(expression){const value=await rpc('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(value.exceptionDetails)throw new Error(value.exceptionDetails.exception?.description||value.exceptionDetails.text);return value.result?.value}
async function until(expression,ms=45000){for(const end=Date.now()+ms;Date.now()<end;){if(await evaluate(expression))return;await pause(150)}throw new Error('timeout: '+expression)}
async function click(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await pause(200)}
try{
  let target
  for(const end=Date.now()+90000;Date.now()<end;){try{const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();target=targets.find(t=>t.type==='page'&&t.url.includes('index.html'));if(target)break}catch{}await pause(250)}
  assert.ok(target,'packaged main renderer must start')
  socket=new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject})
  socket.onmessage=event=>{const message=JSON.parse(event.data);const task=pending.get(message.id);if(task){pending.delete(message.id);message.error?task.reject(new Error(message.error.message)):task.resolve(message.result)}}
  await until('Boolean(document.querySelector(".tab-bar-container"))&&!document.querySelector(".startup-open-overlay")',90000)

  await evaluate(`location.hash='#/settings/shortcuts'`)
  await until('Boolean(document.querySelector(".shortcut-row"))')
  const row=`Array.from(document.querySelectorAll('.shortcut-row')).find(el=>el.querySelector('strong').textContent==='命令面板')`
  await evaluate(`${row}.querySelectorAll('button')[0].click()`)
  await rpc('Input.dispatchKeyEvent',{type:'keyDown',key:'J',code:'KeyJ',modifiers:10,windowsVirtualKeyCode:74})
  await until(`document.querySelector('.shortcut-recorder')?.textContent.includes('Mod+Shift+J')`)
  await click('.shortcut-recorder button')
  await until('!document.querySelector(".shortcut-recorder")')
  assert.deepEqual((await evaluate(`window.electronAPI.invoke('workspace-keymap-get')`)).bindings['app.commands'],['Mod+Shift+J'])
  await rpc('Input.dispatchKeyEvent',{type:'keyDown',key:'J',code:'KeyJ',modifiers:10,windowsVirtualKeyCode:74})
  await until('Boolean(document.querySelector(".command-palette"))');await click('.command-palette header button')
  report.checks.push('真实快捷键设置录制 Ctrl+Shift+J，主进程保存并通过按键打开命令面板')
  await evaluate(`${row}.querySelectorAll('button')[1].click()`)
  await until(`(async()=>!(await window.electronAPI.invoke('workspace-keymap-get')).bindings['app.commands'].length)()`)
  await rpc('Input.dispatchKeyEvent',{type:'keyDown',key:'J',code:'KeyJ',modifiers:10,windowsVirtualKeyCode:74});await pause(200)
  assert.ok(await evaluate('!document.querySelector(".command-palette")'))
  await evaluate(`${row}.querySelectorAll('button')[2].click()`)
  await until(`!JSON.parse(localStorage.getItem('friday-keymap-v1'))['app.commands']`)
  await rpc('Input.dispatchKeyEvent',{type:'keyDown',key:'P',code:'KeyP',modifiers:10,windowsVirtualKeyCode:80})
  await until('Boolean(document.querySelector(".command-palette"))');await click('.command-palette header button')
  report.checks.push('清除后旧键失效，恢复默认后 Ctrl+Shift+P 生效')
  await evaluate(`${row}.querySelectorAll('button')[0].click()`)
  await rpc('Input.dispatchKeyEvent',{type:'keyDown',key:'P',code:'KeyP',modifiers:2,windowsVirtualKeyCode:80})
  await until(`document.querySelector('.shortcut-recorder')?.textContent.includes('Mod+P')`)
  await click('.shortcut-recorder button')
  await until(`document.querySelector('.workspace-settings')?.textContent.includes('该组合键保留')`)
  await click('.shortcut-recorder button:last-child')
  await evaluate(`${row}.querySelectorAll('button')[0].click()`)
  await rpc('Input.dispatchKeyEvent',{type:'keyDown',key:',',code:'Comma',modifiers:2,windowsVirtualKeyCode:188})
  await until(`document.querySelector('.shortcut-recorder')?.textContent.includes('快捷键冲突')`)
  await click('.shortcut-recorder button:last-child')
  report.checks.push('实际录制 Office 打印保留键被拒绝；与设置默认键冲突时显示提示并可取消')
  await evaluate(`(()=>{const input=document.querySelector('input[type=file]'),transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify({schemaVersion:1,bindings:{'app.commands':['Mod+Shift+K']}})],'shortcuts.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  await until(`(async()=>(await window.electronAPI.invoke('workspace-keymap-get')).bindings['app.commands']?.[0]==='Mod+Shift+K')()`)
  await evaluate(`window.exportedKeys=null;const original=URL.createObjectURL;URL.createObjectURL=blob=>{window.exportedKeys=blob;return original(blob)};document.addEventListener('click',event=>{if(event.target.closest('a')?.download==='friday-shortcuts.json')event.preventDefault()},true);document.querySelector('.workspace-actions button').click()`)
  const exported=JSON.parse(await evaluate('exportedKeys.text()'));assert.equal(exported.schemaVersion,1);assert.deepEqual(exported.bindings['app.commands'],['Mod+Shift+K'])
  report.checks.push('真实文件输入导入快捷键 JSON，导出按钮生成相同版本/绑定内容')
  const image=await rpc('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,`packaged-${batch}.png`),Buffer.from(image.data,'base64'))
  report.ok=true
}catch(error){report.error=error.stack;report.sync=await evaluate(`({events:window.noteEventTrace,document:window.currentDocument?.(),input:document.querySelector('.tn-note-input')?.value,status:document.querySelector('[data-save-status]')?.textContent})`).catch(()=>null);process.exitCode=1}
finally{
  fs.writeFileSync(path.join(output,`packaged-${batch}-report.json`),JSON.stringify(report,null,2))
  console.log(JSON.stringify(report))
  if(socket?.readyState===1){await rpc('Browser.close').catch(()=>{});socket.close()}
  if(!child.killed)setTimeout(()=>child.kill(),5000).unref()
  fs.closeSync(log)
}
