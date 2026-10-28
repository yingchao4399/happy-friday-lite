// 隔离用户数据，验收用户报告的入口、外观、终端、笔记引用及真实 Office 命令。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
const root=process.cwd(),dev=process.argv.includes('--dev'),port=9469
const output=path.join(root,'artifacts/typewriter'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'friday-preview17-'))
const executable=path.join(root,dev?'node_modules/electron/dist/electron.exe':'release/win-unpacked/Happy Friday Lite.exe')
const log=fs.openSync(path.join(output,`preview17-note-diagnostic-${dev?'dev':'packaged'}.log`),'w'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE
const child=spawn(executable,[...(dev?['.']:[]),`--friday-data-dir=${profile}`,`--remote-debugging-port=${port}`],{env,stdio:['ignore',log,log],windowsHide:true})
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),report={mode:dev?'dev':'packaged',checks:[],ok:false},pending=new Map()
let socket,seq=0
async function rpc(method,params={}){const id=++seq;return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timeout'))},45000);pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value)},reject});socket.send(JSON.stringify({id,method,params}))})}
async function evaluate(expression){const value=await rpc('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(value.exceptionDetails)throw new Error(value.exceptionDetails.exception?.description||value.exceptionDetails.text);return value.result?.value}
async function until(expression,ms=45000){for(const end=Date.now()+ms;Date.now()<end;){if(await evaluate(expression))return;await pause(120)}throw new Error('timeout: '+expression)}
async function click(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await pause(150)}
async function connect(url){const ws=new WebSocket(url);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});ws.onmessage=event=>{const message=JSON.parse(event.data),task=pending.get(message.id);if(task){pending.delete(message.id);message.error?task.reject(new Error(message.error.message)):task.resolve(message.result)}};return ws}
async function screenshot(name){const image=await rpc('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,`preview17-${name}.png`),Buffer.from(image.data,'base64'))}
const step=name=>{report.checks.push(name);console.log(name)}
async function palette(id){await click('.tab-bar-left button:first-child');await until('Boolean(document.querySelector(".command-palette"))');await evaluate(`(()=>{const el=document.querySelector('.command-palette input');el.value=${JSON.stringify(id)};el.dispatchEvent(new Event('input',{bubbles:true}))})()`);await until(`Boolean(document.getElementById('command-'+${JSON.stringify(id)}))`);await click('#command-'+id.replaceAll('.','\\.'))}
async function selectNote(id){await click('[data-action=choose-note]');await until(`Boolean(document.querySelector('[data-note-id="${id}"]'))`);await click(`[data-note-id="${id}"]`);await until('Boolean(document.querySelector(".tn-note-input"))')}
try {
 let target
 for(const end=Date.now()+90000;Date.now()<end;){try{target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page'&&t.url.includes('index.html'));if(target)break}catch{}await pause(200)}
 socket=await connect(target.webSocketDebuggerUrl);if(dev)await rpc('Page.navigate',{url:new URL('../../dist/index.html',import.meta.url).href})
 await until('Boolean(document.querySelector(".tab-bar-container"))&&!document.querySelector(".startup-open-overlay")',90000)
 await evaluate("window.diagErrors=[];window.addEventListener('unhandledrejection',e=>diagErrors.push(String(e.reason)));window.addEventListener('error',e=>diagErrors.push(e.message))")
 const note=await evaluate("window.electronAPI.invoke('create_note',{title:'路由测试'})")
 await evaluate("window.electronAPI.invoke('update_note',"+JSON.stringify({noteId:note.id,title:'路由测试',content:'<h2>标题定位</h2><p>ROUTE_TEST</p>',contentText:'标题定位 ROUTE_TEST',baseRevision:0})+")")
 await evaluate("location.hash='#/note/"+note.id+"'")
 await until('Boolean(document.querySelector(".note-edit .prose-editor"))')
 await pause(1200)
 const result=await evaluate("(()=>{const el=document.querySelector('.note-edit'),state=el.__vueParentComponent?.setupState,store=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('note');return {errors:diagErrors,text:el.innerText,keys:Object.keys(state||{}),id:state?.noteId,title:state?.noteTitle,content:state?.noteContent,share:state?.isShareMode,store:{saving:store?.saving,pending:store?._pendingSave,promise:!!store?._savePromise}}})()")
 console.log(JSON.stringify(result,null,2));await screenshot('note-diagnostic')
} catch(e){console.error(e);process.exitCode=1}finally{socket?.close();child.kill();fs.closeSync(log)}
