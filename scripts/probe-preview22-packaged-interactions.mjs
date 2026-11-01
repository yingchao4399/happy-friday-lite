import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {spawn} from 'node:child_process'
import {connectPage,waitPage,pause} from './lib/acceptance-cdp.mjs'

const root=process.cwd(),profile=fs.mkdtempSync(path.join(os.tmpdir(),'friday-preview22-interactions-')),port=9512
const report={ok:false,checkedAt:new Date().toISOString(),checks:[],transport:'本地可控 SSE，验证业务 UI/IPC/存储/路由；不计为真模型证据'}
const requests=[],held=[]
const server=http.createServer(async(request,response)=>{
  let raw='';for await(const part of request)raw+=part
  const body=JSON.parse(raw),last=body.messages?.filter(m=>m.role==='user').at(-1)?.content||''
  requests.push({last,system:body.messages?.find(m=>m.role==='system')?.content,stream:body.stream})
  if(!body.stream){response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({choices:[{message:{role:'assistant',content:'验收会话'},finish_reason:'stop'}]}));return}
  response.writeHead(200,{'Content-Type':'text/event-stream'})
  const chunk=text=>response.write('data: '+JSON.stringify({id:'acceptance',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]})+'\n\n')
  chunk('REPLY:')
  const finish=()=>{if(response.destroyed)return;chunk(String(last));response.end('data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n')}
  if(String(last).includes('HOLD'))held.push(finish)
  else setTimeout(finish,40)
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const model={id:'acceptance-model',provider:'deepseek',providerLabel:'Acceptance',modelName:'acceptance-model',apiKey:'local-fixture',baseUrl:`http://127.0.0.1:${server.address().port}/v1`}
fs.writeFileSync(path.join(profile,'config.json'),JSON.stringify({customModels:[model],selectedModelId:model.id,globalAgentDock:{visible:true,appearance:'default',mode:'auto',agentId:'friday'}}))
const executable=process.env.FRIDAY_PACKAGED_EXECUTABLE||path.join(root,'release/win-unpacked/Happy Friday Lite.exe')
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
let child,ui
const start=async()=>{
  const log=fs.openSync(path.join(root,'artifacts/preview22-packaged-interactions.log'),'a')
  child=spawn(executable,[`--friday-data-dir=${profile}`,`--remote-debugging-port=${port}`],{env,stdio:['ignore',log,log],windowsHide:false})
  ui=await connectPage(await waitPage(port,p=>p.type==='page'&&p.url.includes('index.html')&&!p.url.includes('__officeDock')))
  await ui.until('Boolean(document.querySelector(".tab-bar-container"))&&!document.querySelector(".startup-open-overlay")')
  await ui.rpc('Page.bringToFront')
}
const stop=async()=>{await ui.rpc('Browser.close').catch(()=>{});ui.close();await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,7000)});if(child.exitCode===null)child.kill();await pause(300)}
const invoke=(channel,args={})=>ui.evaluate(`window.electronAPI.invoke(${JSON.stringify(channel)},${JSON.stringify(args)})`)
const sessionList=()=>invoke('get_sessions',{scope:'dock',scopeKey:'global'})
const openDock=async()=>{if(!await ui.evaluate('Boolean(document.querySelector(".agent-dock-panel"))'))await ui.click('.agent-dock-trigger');await ui.until('Boolean(document.querySelector(".agent-dock-panel"))')}
const send=async(text)=>{await ui.click('.agent-dock-panel textarea');await ui.rpc('Input.insertText',{text});await ui.click('.agent-dock-panel form button[type=submit]')}
const selectHistory=async(index=0)=>{await ui.click('.agent-dock-panel .scoped-history-toggle');await ui.until('Boolean(document.querySelector(".scoped-history-session"))');await ui.click(`.scoped-history-item:nth-child(${index+1}) .scoped-history-session`);await ui.until('!document.querySelector(".scoped-history-panel")')}
try{
  await start()
  await ui.evaluate(`localStorage.setItem('happy-friday-custom-models',${JSON.stringify(JSON.stringify([model]))});localStorage.setItem('happy-friday-selected-model',${JSON.stringify(model.id)});location.hash='#/settings'`)
  await ui.until('Boolean(document.querySelector(".global-agent-select"))')
  // 从实际设置项目定位控件，通过真实鼠标输入触发保存队列。
  await ui.evaluate(`window.markSetting=(text,name)=>{const item=[...document.querySelectorAll('.setting-item')].find(el=>el.querySelector('.item-label')?.textContent.includes(text));if(!item)throw Error(text);item.dataset.acceptance=name};markSetting('全局助手','visible');document.querySelector('.global-agent-select').closest('.setting-item').dataset.acceptance='agent';[...document.querySelectorAll('.setting-item')].filter(el=>el.querySelector('.font-size-options')&&el.textContent.includes('形象')).forEach(el=>el.dataset.acceptance='appearance');[...document.querySelectorAll('.setting-item')].filter(el=>el.querySelector('.font-size-options')&&el.textContent.includes('模式')).forEach(el=>el.dataset.acceptance='mode')`)
  await ui.click('[data-acceptance=visible] .toggle-slider')
  await ui.until('getComputedStyle(document.querySelector(".agent-dock")).display==="none"')
  assert.equal((await invoke('get-config')).globalAgentDock.visible,false)
  await ui.click('[data-acceptance=visible] .toggle-slider')
  await ui.until('getComputedStyle(document.querySelector(".agent-dock")).display!=="none"')
  for(const appearance of ['compact','default']){
    await ui.click(`[data-acceptance=appearance] .font-size-option:nth-child(${appearance==='compact'?2:1})`)
    await ui.until(`document.querySelector('.agent-dock').classList.contains('agent-dock--compact')===${appearance==='compact'}`)
    assert.equal((await invoke('get-config')).globalAgentDock.appearance,appearance)
  }
  report.checks.push('设置隐藏/显示、默认/简洁形象真实点击、配置落盘与 Dock 同步')
  for(const [mode,index] of [['friday',1],['researcher',2],['auto',3]]){
    await ui.click(`[data-acceptance=mode] .font-size-option:nth-child(${index})`)
    await ui.until(`document.querySelector('[data-acceptance=mode] .font-size-option:nth-child(${index})').classList.contains('active')`)
    await ui.click('.global-agent-select')
    await ui.key('Home','Home',36)
    if(mode!=='friday')await ui.key('ArrowDown','ArrowDown',40)
    await ui.key('Enter','Enter',13)
    await ui.until(`document.querySelector('.global-agent-select').value===${JSON.stringify(mode==='friday'?'friday':'researcher')}`)
    await openDock();await ui.click('.agent-dock-small-button');await pause(100)
    const before=requests.length,text='ROUTE_'+mode
    await send(text);await ui.until(`document.querySelector('.agent-dock-chat-messages').textContent.includes('REPLY:${text}')&&!document.querySelector('.agent-dock-panel textarea').disabled`)
    const request=requests.slice(before).find(r=>r.last===text&&r.stream)
    assert.ok(request);assert.match(request.system,new RegExp('Agent profile: '+(mode==='friday'?'friday':'researcher')))
    report.checks.push(mode+' 模式实际主进程请求使用预期 Agent profile')
    await ui.click('.agent-dock-icon-button')
  }
  await openDock()
  const chatSessions=[]
  for(let index=0;index<30;index++){
    await ui.click('.agent-dock-small-button')
    await pause(60)
    const session=(await sessionList())[0];assert.ok(session?.id);chatSessions.push(session.id)
    const text=index%2?`SEND_EN_${index}`:`发送中文_${index}`
    await send(text)
    await ui.until(`document.querySelector('.agent-dock-chat-messages').textContent.includes(${JSON.stringify('REPLY:'+text)})&&!document.querySelector('.agent-dock-panel textarea').disabled`)
    const messages=await invoke('get_session_messages',{sessionId:session.id,scope:'dock',scopeKey:'global'})
    assert.deepEqual(messages.map(m=>m.content),[text,'REPLY:'+text])
  }
  assert.equal(new Set(chatSessions).size,30)
  report.checks.push('30 组独立新建/真实点击发送/中英文 SSE/数据库消息逐条核对，无串会话')
  await send('HOLD_OLD_CANCEL');await ui.until('document.querySelector(".agent-dock-panel textarea").disabled')
  await ui.click('.agent-dock-composer-actions button');await ui.until('!document.querySelector(".agent-dock-panel textarea").disabled')
  await ui.click('.agent-dock-small-button');await pause(80)
  await send('HOLD_OLD_SWITCH');await ui.until('document.querySelector(".agent-dock-panel textarea").disabled')
  await selectHistory(1)
  const restored=await ui.evaluate('document.querySelector(".agent-dock-chat-messages").textContent')
  for(const finish of held)finish()
  await pause(200)
  assert.equal(await ui.evaluate('document.querySelector(".agent-dock-chat-messages").textContent'),restored)
  await send('AFTER_SWITCH');await ui.until('document.querySelector(".agent-dock-chat-messages").textContent.includes("REPLY:AFTER_SWITCH")')
  report.checks.push('发送中取消/新建/历史切换后旧流不覆盖恢复会话，恢复后可续聊')
  const settings=(await invoke('get-config')).globalAgentDock
  await stop();await start()
  assert.deepEqual((await invoke('get-config')).globalAgentDock,settings)
  await openDock();await selectHistory()
  await ui.until('document.querySelector(".agent-dock-chat-messages").textContent.includes("AFTER_SWITCH")')
  assert.equal((await sessionList()).length>=33,true)
  report.checks.push('完整重启后设置一致、历史与续聊消息恢复')
  report.settings=settings
  report.ok=true
}catch(error){report.error=error.stack||String(error);console.error(report.error)}
finally{
  fs.writeFileSync(path.join(root,'artifacts/preview22-packaged-interactions-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
  if(ui)await stop().catch(()=>{});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));process.exitCode=report.ok?0:1
}
