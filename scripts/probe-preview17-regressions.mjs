// 隔离用户数据，验收用户报告的入口、外观、终端、笔记引用及真实 Office 命令。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
const root=process.cwd(),dev=process.argv.includes('--dev'),port=9467
const output=path.join(root,'artifacts/typewriter'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'friday-preview17-'))
const executable=path.join(root,dev?'node_modules/electron/dist/electron.exe':'release/win-unpacked/Happy Friday Lite.exe')
const log=fs.openSync(path.join(output,`preview17-app-${dev?'dev':'packaged'}.log`),'w'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE
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
try{
  let target
  for(const end=Date.now()+120000;Date.now()<end;){try{const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();target=targets.find(t=>t.type==='page'&&(t.url.includes('index.html')||t.url.includes('localhost:5173')));if(target)break}catch{}await pause(250)}
  assert.ok(target,'应用主窗口应启动');socket=await connect(target.webSocketDebuggerUrl)
  if(dev)await rpc('Page.navigate',{url:new URL('../dist/index.html',import.meta.url).href})
  await until('Boolean(document.querySelector(".tab-bar-container"))&&!document.querySelector(".startup-open-overlay")',120000)
  await rpc('Page.bringToFront')
  await evaluate(`window.probeErrors=[];window.addEventListener('unhandledrejection',e=>probeErrors.push(String(e.reason)));window.addEventListener('error',e=>probeErrors.push(e.message))`)
  await evaluate(`location.hash='#/settings'`);await until('Boolean(document.querySelector("[data-settings-workspace]"))')
  const general=await evaluate(`({font:getComputedStyle(document.querySelector('.settings-page')).fontFamily,title:getComputedStyle(document.querySelector('.settings-title')).fontSize,entries:[...document.querySelectorAll('[data-settings-workspace] a')].map(el=>({text:el.innerText,rect:el.getBoundingClientRect().toJSON()}))})`)
  assert.equal(general.entries.length,3);assert.ok(general.entries.every(e=>e.rect.width>100&&e.rect.height>=52&&e.rect.y>=0));assert.equal(general.title,'24px');report.general=general;await screenshot('settings')
  for(const route of ['plugins','plugin-market','shortcuts']){
    await evaluate(`location.hash='#/settings/${route}'`);const selector=route==='shortcuts'?'.workspace-settings':'.plugin-settings';await until(`Boolean(document.querySelector('${selector}'))`)
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('${selector}')).fontFamily`),general.font)
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('${selector} h1')).fontSize`),'24px')
    await screenshot(route)
  }
  assert.equal(await evaluate('document.querySelectorAll(".sidebar-bottom button").length'),0)
  await click('.tab-bar-left button:first-child');await until('Boolean(document.querySelector(".command-palette"))')
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.command-palette')).fontFamily`),general.font)
  assert.ok(await evaluate(`[...document.querySelectorAll('.command-categories button')].some(el=>el.textContent==='Office')`))
  await screenshot('palette');await click('.command-palette header button')
  step('设置三个正式入口可见；插件/市场/快捷键/命令面板同字体与标题规格；无侧栏重复按钮')

  // 真实原生 Office 视图，命令通过面板发往现有菜单通道。
  await palette('office.new.docs');await until(`location.hash.includes('/office/docs/')`)
  let officeTarget
  for(const end=Date.now()+60000;Date.now()<end;){officeTarget=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.url.startsWith('genoffice-app://docs'));if(officeTarget)break;await pause(200)}
  assert.ok(officeTarget);const mainSocket=socket,officeSocket=await connect(officeTarget.webSocketDebuggerUrl);socket=officeSocket
  await until('Boolean(window.__aidocs?.editor)',60000);await pause(1800)
  await evaluate(`window.__aidocs.editor.commands.insertContent('OFFICE_COMMAND_17');window.__aidocs.editor.commands.focus()`)
  socket=mainSocket;await palette('office.undo');socket=officeSocket;await until(`!window.__aidocs.editor.getText().includes('OFFICE_COMMAND_17')`)
  socket=mainSocket;await palette('office.redo');socket=officeSocket;await until(`window.__aidocs.editor.getText().includes('OFFICE_COMMAND_17')`)
  socket=mainSocket;await palette('office.print');socket=officeSocket;await pause(1000);await screenshot('office-print')
  report.officePrint=await evaluate(`({text:document.body.innerText.slice(-2000),dialogs:document.querySelectorAll('[role=dialog]').length})`)
  assert.match(report.officePrint.text,/打印设置|Print settings/)
  await rpc('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});socket=mainSocket
  const officeState=await evaluate(`window.electronAPI.invoke('office-get-state')`);report.office=officeState
  // 测试结束后不关闭未保存文档，避免触发真实另存为对话框。
  officeSocket.close();step('Office 新建、撤销、重做和打印通过真实原生编辑器菜单运行，文档及焦点保留')

  await evaluate(`location.hash='#/typewriter'`);await until('Boolean(document.querySelector("[data-action=terminal]"))');await click('[data-action=terminal]');await until('Boolean(document.querySelector(".xterm"))')
  await evaluate(`window.findTerminal=()=>{let fiber=document.querySelector('.tn-terminal-host')?.[Object.keys(document.querySelector('.tn-terminal-host')||{}).find(k=>k.startsWith('__reactFiber'))];for(;fiber;fiber=fiber.return)for(let hook=fiber.memoizedState;hook;hook=hook.next){const value=hook.memoizedState?.current;if(value?.buffer?.active&&value?.paste)return value}return null};window.term=findTerminal();window.readScreen=()=>Array.from({length:term.buffer.active.length},(_,i)=>term.buffer.active.getLine(i)?.translateToString(true)||'').join(String.fromCharCode(10))`)
  assert.ok(await evaluate('Boolean(term)'));await until(`readScreen().includes('>')`,60000)
  const sessions=await evaluate(`window.electronAPI.invoke('typewriter-terminal-list')`);assert.equal(sessions.length,1)
  await evaluate(`term.paste("echo 'FRIDAY_TERMINAL_17 中文'\\r")`);await until(`readScreen().split('FRIDAY_TERMINAL_17 中文').length>=3`)
  await click('.tn-tools .tn-tool:last-child');await until('Boolean(document.getElementById("tn-font"))')
  for(const font of ['jetbrains-mono','fira-code','sarasa-mono-sc','courier-prime']){
    await evaluate(`document.getElementById('tn-font').value=${JSON.stringify(font)};document.getElementById('tn-font').dispatchEvent(new Event('change',{bubbles:true}))`)
    await until(`document.getElementById('tn-font').value===${JSON.stringify(font)}&&!document.getElementById('tn-font').disabled`,30000)
    const options=await evaluate('({family:term.options.fontFamily,size:term.options.fontSize,cell:term._core._renderService.dimensions.css.cell})');report.fonts??=[];report.fonts.push({font,...options})
    assert.match(options.family,new RegExp({'jetbrains-mono':'JetBrains Mono','fira-code':'Fira Code','sarasa-mono-sc':'Sarasa Mono SC','courier-prime':'Courier Prime'}[font]))
    assert.equal(await evaluate('findTerminal()===term'),true)
  }
  await evaluate(`document.getElementById('tn-ink-mode').value='preset';document.getElementById('tn-ink-mode').dispatchEvent(new Event('change',{bubbles:true}))`);await until('document.querySelectorAll(".tn-ink-swatches button").length===6');await evaluate(`document.querySelectorAll('.tn-ink-swatches button')[4].click()`)
  await until(`term.options.theme.foreground==='#702738'`)
  const labels=await evaluate(`[...document.querySelectorAll('.tn-studio label')].map(el=>({text:el.textContent,id:el.htmlFor}))`)
  const locale=JSON.parse(fs.readFileSync(path.join(root,'src/i18n/locales/zh-CN/typewriter.json'),'utf8')),key=Array.from('Type size').map(c=>c.codePointAt(0).toString(36)).join('_'),sizeLabel=labels.find(el=>el.text===locale.original[key]);assert.ok(sizeLabel)
  await evaluate(`(()=>{const el=document.getElementById(${JSON.stringify(sizeLabel.id)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,20);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await until('term.options.fontSize===20');assert.equal(await evaluate('findTerminal()===term'),true)
  assert.ok(await evaluate('term._core._renderService.dimensions.css.cell.width>11'))
  assert.ok(await evaluate(`readScreen().includes('FRIDAY_TERMINAL_17 中文')`))
  assert.deepEqual((await evaluate(`window.electronAPI.invoke('typewriter-terminal-list')`)).map(s=>s.id),sessions.map(s=>s.id))
  report.terminal=await evaluate(`({theme:term.options.theme,contrast:term.options.minimumContrastRatio,dimensions:term._core._renderService.dimensions.css.cell,screen:readScreen().slice(-300),stage:{...document.querySelector('.tn-stage').dataset}})`)
  assert.match(report.terminal.theme.background,/rgba\(\d+, \d+, \d+, 0\)/);assert.notEqual(report.terminal.theme.brightYellow,'#fce94f')
  assert.equal(await evaluate('document.querySelectorAll(".tn-ink-picker input[type=checkbox]").length'),0)
  assert.ok(await evaluate('Boolean(document.querySelector(".tn-ink-picker .tn-switch"))'))
  await screenshot('terminal');await click('.tn-studio .tn-close')
  step('真实 PowerShell 输入/输出；四款本地字体及字号/墨色热切换；PTY、xterm 实例保持；原作开关/预览样式')

  const targetNote=await evaluate(`window.electronAPI.invoke('create_note',{title:'目标笔记 B'})`),sourceNote=await evaluate(`window.electronAPI.invoke('create_note',{title:'来源笔记 A'})`)
  const uri='friday://notes/'+encodeURIComponent(targetNote.id)
  const content=`<h1 data-note-title="true">来源笔记 A</h1><p><a class="text-link" href="${uri}#锚点">点击内链 B</a></p><div data-note-reference="true" data-kind="note" data-source-id="${targetNote.id}" data-source-uri="${uri}" data-title="引用卡片 B">引用卡片 B</div><p>[[目标笔记 B#锚点|Wiki 别名]]</p>`
  await evaluate(`window.electronAPI.invoke('update_note',${JSON.stringify({noteId:targetNote.id,title:'目标笔记 B',content:'<h1 data-note-title="true">目标笔记 B</h1><h2>锚点</h2><p>TARGET_BODY_17</p>',contentText:'目标笔记 B 锚点 TARGET_BODY_17',baseRevision:0})})`)
  await evaluate(`window.electronAPI.invoke('update_note',${JSON.stringify({noteId:sourceNote.id,title:'来源笔记 A',content,contentText:'来源笔记 A [[目标笔记 B#锚点|Wiki 别名]]',baseRevision:0})})`)
  await selectNote(sourceNote.id);await click('[data-action=open-note-page]');await until(`Boolean(document.querySelector('.note-page .prose-editor'))`,60000)
  await until(`Boolean(document.querySelector('.note-page [data-note-reference]'))`)
  await click('.note-page [data-note-reference]');await until(`document.querySelector('.note-page .prose-editor')?.textContent.includes('TARGET_BODY_17')`)
  const returnA=async()=>{await evaluate(`[...document.querySelectorAll('.note-page .note-item')].find(el=>el.querySelector('.note-title')?.textContent==='来源笔记 A').click()`);await until(`Boolean(document.querySelector('.note-page [data-note-reference]'))`)}
  await returnA();await click('.note-page a.text-link');await until(`document.querySelector('.note-page .prose-editor')?.textContent.includes('TARGET_BODY_17')`)
  await until(`window.getSelection()?.anchorNode?.parentElement?.closest('h2')?.textContent==='锚点'`)
  await returnA();await until('Boolean(document.querySelector(".friday-wiki-link"))');await click('.friday-wiki-link');await until(`document.querySelector('.note-page .prose-editor')?.textContent.includes('TARGET_BODY_17')`)
  await until(`window.getSelection()?.anchorNode?.parentElement?.closest('h2')?.textContent==='锚点'`)
  await returnA();await evaluate(`window.dispatchEvent(new CustomEvent('friday:show-links',{detail:'outgoing'}))`);await until('Boolean(document.querySelector(".note-page .note-links-panel article"))');assert.ok(await evaluate('Boolean(document.querySelector(".note-page .links-help[open]"))'));await click('.note-page .note-links-panel article button')
  await until(`document.querySelector('.note-page .prose-editor')?.textContent.includes('TARGET_BODY_17')`)
  await evaluate(`window.dispatchEvent(new CustomEvent('friday:show-links',{detail:'incoming'}))`);await until(`document.querySelector('.note-page .note-links-panel')?.textContent.includes('来源笔记 A')`)
  await screenshot('note-links')
  await evaluate(`location.hash='#/note/'+${JSON.stringify(sourceNote.id)}`);await until(`Boolean(document.querySelector('.note-edit a.text-link'))`)
  await click('.note-edit a.text-link');await until(`document.querySelector('.note-edit .prose-editor')?.textContent.includes('TARGET_BODY_17')`)
  assert.ok(await evaluate(`document.querySelector('.note-edit .prose-editor')?.textContent.includes('锚点')`))
  await evaluate(`location.hash='#/typewriter'`);await until('Boolean(document.querySelector("[data-action=choose-note]"))');await selectNote(sourceNote.id)
  await evaluate(`window.locationTrace=[];window.addEventListener('friday:note-locate',e=>locationTrace.push(e.detail));(()=>{const el=document.querySelector('.tn-note-input'),at=el.value.indexOf('friday://notes/');window.sourceMarkdown=el.value;el.focus();el.setSelectionRange(at+4,at+4);el.dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}))})()`)
  await until(`document.querySelector('.tn-note-input')?.value.replaceAll(String.fromCharCode(92),'').includes('TARGET_BODY_17')`)
  report.heading=await evaluate(`(()=>{const el=document.querySelector('.tn-note-input');return {requests:locationTrace,source:sourceMarkdown,text:el.value,position:el.selectionStart}})()`);console.log('heading',JSON.stringify(report.heading))
  await until(`(()=>{const el=document.querySelector('.tn-note-input');return el?.value.slice(el.selectionStart).startsWith('## 锚点')})()`)
  await selectNote(sourceNote.id)
  await evaluate(`(()=>{const el=document.querySelector('.tn-note-input'),at=el.value.indexOf('目标笔记 B#');if(at<0)throw new Error('WikiLink missing');el.focus();el.setSelectionRange(at+2,at+2);el.dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}))})()`)
  await until(`(()=>{const el=document.querySelector('.tn-note-input');return el?.value.replaceAll(String.fromCharCode(92),'').includes('TARGET_BODY_17')&&el.value.includes('## 锚点')&&window.locationTrace?.at(-1)?.heading==='锚点'})()`)
  report.links=await evaluate(`window.electronAPI.invoke('note-links-index',{noteId:${JSON.stringify(sourceNote.id)}})`)
  assert.ok(report.links.outgoing.some(link=>link.targetNoteId===targetNote.id));step('笔记首页引用卡片/内链/WikiLink 实际点击；出链/反链列表跳转；打字机 Ctrl 点击；内置使用说明')
  report.errors=await evaluate('probeErrors');assert.deepEqual(report.errors,[])
  report.ok=true
}catch(error){report.error=error.stack;console.error(error);if(socket?.readyState===1){await screenshot('failure').catch(()=>{});report.current=await evaluate(`({url:location.href,text:document.body.innerText.slice(-1600)})`).catch(()=>null)}process.exitCode=1}
finally{
  fs.writeFileSync(path.join(output,`preview17-${dev?'dev':'packaged'}-report.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
  if(socket?.readyState===1)socket.close()
  // 只结束本次隔离测试创建的进程；未保存的 Office 测试文档可能拦截正常关窗。
  if(child.exitCode===null){child.kill();await new Promise(resolve=>{const timer=setTimeout(resolve,3000);child.once('exit',()=>{clearTimeout(timer);resolve()})})}
  fs.closeSync(log)
}
