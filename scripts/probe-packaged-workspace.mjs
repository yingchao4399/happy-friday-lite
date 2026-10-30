import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
const root=process.cwd(),batch=process.argv[2]||'1',port=9440+Number(batch)
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
  await evaluate(`location.hash='#/typewriter'`)
  await until('Boolean(document.querySelector("[data-action=new-note]"))')
  await click('[data-action=new-note]')
  await until('Boolean(document.querySelector(".tn-note-input"))')
  await evaluate(`window.noteEventTrace=[];window.electronAPI.on('note-changed',v=>noteEventTrace.push({kind:'ipc',...v}));window.addEventListener('friday:note-document',e=>noteEventTrace.push({kind:'document',...e.detail}));window.addEventListener('error',e=>noteEventTrace.push({kind:'error',message:e.message}));window.currentDocument=()=>{const el=document.querySelector('.tn-note-input');for(let f=el?.[Object.keys(el).find(k=>k.startsWith('__reactFiber'))];f;f=f.return)if(f.memoizedProps?.document)return f.memoizedProps.document;return null}`)
  await rpc('Page.bringToFront')
  await until('Boolean(document.querySelector(".tn-stage")?.dataset.render)')
  await pause(2000)
  await evaluate(`window.packagedAudio=0;const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){if(this.context instanceof AudioContext)packagedAudio++;return start.apply(this,args)};document.querySelector('.tn-note-input').focus()`)
  await rpc('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65})
  await rpc('Input.insertText',{text:'a'})
  await rpc('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65})
  await rpc('Input.insertText',{text:'打包应用中文输入\nPackaged font and ink test.'})
  await until(`document.querySelector('[data-save-status]')?.textContent==='已保存'`)
  const notes=await evaluate(`window.electronAPI.invoke('get_notes')`)
  assert.equal(notes.length,1);assert.match(notes[0].contentText,/打包应用中文输入/)
  report.feedback=await evaluate(`({audio:packagedAudio,stage:{...document.querySelector('.tn-stage').dataset},visible:document.visibilityState,focus:document.hasFocus()})`)
  assert.ok(report.feedback.audio>0,JSON.stringify(report.feedback))
  report.checks.push('打包应用真实输入、中英笔记同 ID 保存、AudioContext 击键声')
  await click('.tn-tools .tn-tool:last-child')
  await until('Boolean(document.getElementById("tn-font"))')
  if(Number(batch)>=4){
    await evaluate(`window.matrixInput=document.querySelector('.tn-note-input');window.matrixText=matrixInput.value;window.uiMatrix=[]`)
    for(let theme=0;theme<3;theme++)for(let paper=0;paper<6;paper++)for(const brightness of [0.2,2]){
      await evaluate(`document.querySelectorAll('.tn-cards')[0].children[${theme}].click()`)
      await evaluate(`document.querySelectorAll('.tn-cards')[1].children[${paper}].click()`)
      await evaluate(`(()=>{const el=document.querySelectorAll('.tn-studio .tn-section')[4].querySelector('input[type=range]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${brightness});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`)
      await pause(65)
      assert.ok(await evaluate(`document.querySelector('.tn-note-input')===matrixInput&&matrixInput.value===matrixText`))
      await evaluate(`uiMatrix.push({theme:${theme},paper:${paper},brightness:${brightness},ink:getComputedStyle(matrixInput).color,paperColor:getComputedStyle(document.querySelector('.tn-stage')).getPropertyValue('--tn-paper'),machine:document.querySelector('.tn-stage').dataset.machine})`)
    }
    report.matrix=await evaluate('uiMatrix');assert.equal(report.matrix.length,36)
    await evaluate(`document.querySelectorAll('.tn-cards')[0].children[0].click()`)
    await evaluate(`document.querySelectorAll('.tn-cards')[1].children[0].click()`)
    report.checks.push('安装包三主题×六纸张×两档灯光 36 组合切换，纸面墨色生效，保持同一输入元素与正文')
  }
  for(const font of ['jetbrains-mono','fira-code','sarasa-mono-sc']){
    await evaluate(`document.getElementById('tn-font').value=${JSON.stringify(font)};document.getElementById('tn-font').dispatchEvent(new Event('change',{bubbles:true}))`)
    await until(`document.getElementById('tn-font').value===${JSON.stringify(font)}&&!document.getElementById('tn-font').disabled`,45000)
  }
  assert.ok(await evaluate(`document.fonts.check('15px "Sarasa Mono SC"','中文ABC')`))
  if(Number(batch)>=4){
    await evaluate(`Array.from(document.querySelectorAll('.tn-studio button')).find(el=>el.textContent.startsWith('Source Code Pro')).click()`)
    await until(`document.querySelector('.tn-note-input')?.style.fontFamily.includes('Source Code Pro')&&!document.getElementById('tn-font').disabled`,100000)
    const downloaded=await evaluate(`window.electronAPI.invoke('fonts-list')`)
    assert.ok(downloaded.find(font=>font.id==='source-code-pro')?.installed)
    assert.ok(await evaluate(`document.fonts.check('15px "Source Code Pro"','ABC')`))
    report.checks.push('安装包 Studio 扩展字体真实下载到本地、校验后加载并切换 Source Code Pro')
  }
  await evaluate(`document.getElementById('tn-ink-mode').value='preset';document.getElementById('tn-ink-mode').dispatchEvent(new Event('change',{bubbles:true}))`)
  await until('Boolean(document.querySelector(".tn-ink-swatches"))')
  await click('.tn-ink-swatches button:nth-child(5)')
  report.checks.push('安装包内三款字体加载切换、中文字体、预设墨色')
  await click('.tn-studio .tn-close')
  await click('[data-action=terminal]')
  await until('Boolean(document.querySelector(".xterm-helper-textarea"))')
  await until(`Boolean((()=>{let f=document.querySelector('.tn-terminal-plugin');f=f[Object.keys(f).find(k=>k.startsWith('__reactFiber'))];for(;f;f=f.return){for(let h=f.memoizedState;h&&typeof h==='object';h=h.next){const v=h.memoizedState?.current;if(v?.buffer?.active&&v?.write){window.packagedTerm=v;return true}}}return false})())`)
  await until(`Array.from({length:packagedTerm.buffer.active.length},(_,i)=>packagedTerm.buffer.active.getLine(i)?.translateToString(true)).join('\\n').includes('PS ')`,30000)
  await evaluate(`document.querySelector('.xterm-helper-textarea').focus()`)
  await rpc('Input.insertText',{text:"Write-Output ('PACKAGED_' + (6 * 7))"})
  await rpc('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  await rpc('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  await until(`Array.from({length:packagedTerm.buffer.active.length},(_,i)=>packagedTerm.buffer.active.getLine(i)?.translateToString(true)).some(line=>line.trim()==='PACKAGED_42')`,30000)
  assert.equal((await evaluate(`window.electronAPI.invoke('typewriter-terminal-list')`)).length,1)
  report.checks.push('安装包 node-pty 真实 PowerShell 键盘输入与 PACKAGED_42 计算回显')
  if(Number(batch)>=2){
    await click('.tab-bar-left button:first-child')
    await until('Boolean(document.querySelector(".command-palette"))')
    if(Number(batch)>=4){
      for(const query of ['Command palette','mingling']){
        await evaluate(`document.querySelector('.command-palette input').value=${JSON.stringify(query)};document.querySelector('.command-palette input').dispatchEvent(new Event('input',{bubbles:true}))`)
        await until(`document.querySelector('.command-results')?.textContent.includes('命令面板')`)
      }
      report.checks.push('中文界面可用英文 Command palette 和拼音 mingling 搜索同一命令')
    }
    await evaluate(`document.querySelector('.command-palette input').value='快捷键';document.querySelector('.command-palette input').dispatchEvent(new Event('input',{bubbles:true}))`)
    await until('document.querySelector(".command-results")?.textContent.includes("快捷键设置")')
    report.checks.push('全应用按钮打开命令浮窗并搜索设置命令')
    await evaluate(`document.querySelector('.command-palette header button').click()`)
    const existingOfficeTargets = new Set((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).map(page => page.id))
    await evaluate(`(async()=>{window.packagedOffice=await window.electronAPI.invoke('office-new',{type:'docs',name:'Command Focus Probe'});location.hash='#/office/'+packagedOffice.viewId.replace('-','/')})()`)
    let officeTarget
    for(let i=0;i<150;i++){const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();officeTarget=pages.find(t=>t.type==='page'&&!existingOfficeTargets.has(t.id)&&/^genoffice-app:\/\/docs\//.test(t.url));if(officeTarget)break;await pause(200)}
    assert.ok(officeTarget,'真实 Office renderer 应创建')
    const mainSocket=socket,officeSocket=new WebSocket(officeTarget.webSocketDebuggerUrl)
    await new Promise((resolve,reject)=>{officeSocket.onopen=resolve;officeSocket.onerror=reject})
    officeSocket.onmessage=mainSocket.onmessage;socket=officeSocket
    await until('Boolean(window.__aidocs?.editor)',60000)
    await pause(2500)
    await rpc('Page.bringToFront')
    await evaluate(`window.__aidocs.editor.commands.insertContent('OFFICE_FOCUS_42');window.__aidocs.editor.commands.focus()`)
    await until('document.hasFocus()')
    await evaluate(`document.title='Friday Packaged Office Probe'`)
    if(!process.argv.includes('--manual-keys')){socket=mainSocket;await click('.tab-bar-left button:first-child');socket=officeSocket}
    await rpc('Input.dispatchKeyEvent',{type:'keyUp',key:'P',code:'KeyP',modifiers:10,windowsVirtualKeyCode:80})
    socket=mainSocket
    await until('Boolean(document.querySelector(".command-palette"))',process.argv.includes('--manual-keys')?180000:45000)
    report.checks.push(process.argv.includes('--manual-keys')?'真实 Office 原生视图 Ctrl+Shift+P 打开应用命令浮窗':'真实 Office 原生视图中点击常驻按钮打开命令浮窗')
    const overlay=await rpc('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,`packaged-${batch}-office-palette.png`),Buffer.from(overlay.data,'base64'))
    await evaluate(`document.querySelector('.command-palette header button').click()`)
    socket=officeSocket
    await until('document.hasFocus()')
    assert.match(await evaluate('window.__aidocs.editor.getText()'),/OFFICE_FOCUS_42/)
    socket=mainSocket;officeSocket.close()
    report.checks.push('关闭命令浮窗后 Office 文档保持、焦点恢复，原生视图未重载')

  }
  if(Number(batch)>=3){
    await evaluate(`location.hash='#/settings/plugins'`)
    await until('Boolean(document.querySelector(".plugin-settings"))')
    await evaluate(`window.electronAPI.invoke('plugins-example')`)
    await until('Boolean(document.querySelector("[data-plugin-id=friday-writing-tools]"))')
    await evaluate(`window.electronAPI.invoke('plugins-enable',{id:'friday-writing-tools'})`)
    await until(`document.querySelector('[data-plugin-id=friday-writing-tools]')?.textContent.includes('停用')`)
    await evaluate(`location.hash='#/typewriter'`)
    await until('Boolean(document.querySelector("[data-action=choose-note]"))')
    await click('[data-action=choose-note]');await until('Boolean(document.querySelector(".note-choices button"))');await click('.note-choices button')
    await until('Boolean(document.querySelector(".tn-note-input"))')
    await evaluate(`document.querySelector('.tn-note-input').focus();document.querySelector('.tn-note-input').setSelectionRange(0,0)`)
    await click('.tab-bar-left button:first-child')
    await until('Boolean(document.querySelector(".command-palette"))')
    await evaluate(`document.querySelector('.command-palette input').value='插入时间戳';document.querySelector('.command-palette input').dispatchEvent(new Event('input',{bubbles:true}))`)
    await until(`document.querySelector('.command-results')?.textContent.includes('Insert timestamp')`)
    await click('.command-results>button')
    await until(`/^\\d{4}-\\d{2}-\\d{2}T/.test(document.querySelector('.tn-note-input')?.value)`)
    await until(`document.querySelector('[data-save-status]')?.textContent==='已保存'`)
    const updated=await evaluate(`window.electronAPI.invoke('get_notes')`);assert.match(updated[0].contentText,/\d{4}-\d{2}-\d{2}T/)
    report.checks.push('打包应用插件管理、独立宿主启用、命令面板执行插件、插字联动同 ID 笔记保存')
    await evaluate(`window.electronAPI.invoke('plugins-disable',{id:'friday-writing-tools'})`)
    await click('.tab-bar-left button:first-child');await until('Boolean(document.querySelector(".command-palette"))')
    await evaluate(`document.querySelector('.command-palette input').value='插入时间戳';document.querySelector('.command-palette input').dispatchEvent(new Event('input',{bubbles:true}))`)
    await until('!document.querySelector(".command-results>button")')
    await click('.command-palette header button')
    await evaluate(`window.electronAPI.invoke('plugins-uninstall',{id:'friday-writing-tools'})`)
    assert.equal((await evaluate(`window.electronAPI.invoke('plugins-list')`)).length,0)
    report.checks.push('打包应用停用释放插件命令，卸载清理插件和配置')
  }
  if(Number(batch)>=4){
    await evaluate(`window.electronAPI.invoke('plugins-sample')`)
    await evaluate(`window.electronAPI.invoke('plugins-enable',{id:'obsidian-sample-plugin'})`)
    await evaluate(`window.electronAPI.invoke('plugins-execute',{id:'obsidian-sample-plugin',command:'open-sample-modal',context:{noteId:${JSON.stringify(notes[0].id)}}})`)
    const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json(),pluginTarget=pages.find(t=>t.type==='page'&&t.url.includes('plugins/host.html')&&t.title==='Sample Plugin')
    assert.ok(pluginTarget,'打包应用官方示例应创建隔离窗口')
    const mainSocket=socket,pluginSocket=new WebSocket(pluginTarget.webSocketDebuggerUrl)
    await new Promise((resolve,reject)=>{pluginSocket.onopen=resolve;pluginSocket.onerror=reject});pluginSocket.onmessage=mainSocket.onmessage;socket=pluginSocket
    assert.equal(await evaluate(`document.querySelector('.modal-content')?.textContent`),'Woah!')
    assert.equal(await evaluate(`typeof window.electronAPI`),'undefined')
    await click('.modal-close-button');socket=mainSocket
    await evaluate(`window.electronAPI.invoke('plugins-settings',{id:'obsidian-sample-plugin'})`);socket=pluginSocket
    assert.match(await evaluate('document.body.textContent'),/Settings for my awesome plugin/)
    socket=mainSocket
    await evaluate(`window.electronAPI.invoke('plugins-markdown',{id:'obsidian-sample-plugin',noteId:${JSON.stringify(notes[0].id)}})`)
    socket=pluginSocket
    await evaluate(`window.__fridayCM.dispatch({changes:{from:0,insert:'PACKAGED_CM6_42\\n\\n'}});true`)
    await until(`document.getElementById('markdown-save-status')?.textContent==='已保存'`)
    socket=mainSocket
    await until(`document.querySelector('.tn-note-input')?.value.replaceAll(String.fromCharCode(92),'').includes('PACKAGED_CM6_42')`)
    assert.match((await evaluate(`window.electronAPI.invoke('get_note',{noteId:${JSON.stringify(notes[0].id)}})`)).content,/PACKAGED_CM6_42/)
    report.checks.push('安装包官方示例原包 Modal/设置实际运行，隔离宿主 CM6 保存后同 ID 打字机内容自动同步')
    await evaluate(`window.electronAPI.invoke('plugins-uninstall',{id:'obsidian-sample-plugin'})`);pluginSocket.close()
    const catalog=await evaluate(`window.electronAPI.invoke('plugins-catalog')`),item=catalog.entries.find(e=>e.id==='obsidian-sort-and-permute-lines');assert.ok(item)
    const community=await evaluate(`window.electronAPI.invoke('plugins-download',${JSON.stringify({id:item.id,repo:item.repo})})`)
    await evaluate(`window.electronAPI.invoke('plugins-enable',{id:${JSON.stringify(item.id)}})`)
    const sortNote=await evaluate(`window.electronAPI.invoke('create_note',{title:'Packaged community sort'})`)
    await evaluate(`window.electronAPI.invoke('update_note',{noteId:${JSON.stringify(sortNote.id)},title:'Packaged community sort',content:'<p>zebra</p><p>apple</p><p>banana</p>',contentText:'zebra\\napple\\nbanana',baseRevision:0})`)
    await evaluate(`window.electronAPI.invoke('plugins-markdown',{id:${JSON.stringify(item.id)},noteId:${JSON.stringify(sortNote.id)}})`)
    await evaluate(`window.electronAPI.invoke('plugins-execute',{id:${JSON.stringify(item.id)},command:'sort-alphabetically',context:{noteId:${JSON.stringify(sortNote.id)}}})`)
    await until(`(async()=>{const n=await window.electronAPI.invoke('get_note',{noteId:${JSON.stringify(sortNote.id)}});return n.revision>=2})()`)
    const sorted=await evaluate(`window.electronAPI.invoke('get_note',{noteId:${JSON.stringify(sortNote.id)}})`)
    assert.ok(sorted.content.indexOf('apple')<sorted.content.indexOf('banana'));assert.ok(sorted.content.indexOf('banana')<sorted.content.indexOf('zebra'))
    report.community={id:item.id,repo:item.repo,version:community.manifest.version,compatibility:'partial',verifiedCommand:'sort-alphabetically'}
    report.checks.push('安装包从官方目录下载真实社区插件原包，启用并执行 CM6 排序，结果保存同一笔记')
    await evaluate(`window.electronAPI.invoke('plugins-uninstall',{id:${JSON.stringify(item.id)}})`)
  }
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
