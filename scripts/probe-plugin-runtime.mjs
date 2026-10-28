import {app,BrowserWindow} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import {setDataDir} from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import {registerPluginCommands} from '../src-electron/plugins/manager.js'
import {initOfficeSession,shutdownOfficeHost} from '../src-electron/office/office-session.js'
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'friday-plugins-')),report={ok:false,checks:[],profile:temp}
app.setPath('userData',path.join(temp,'profile'));app.on('window-all-closed',()=>{})
const pause=ms=>new Promise(r=>setTimeout(r,ms));let manager,win
const deadline=setTimeout(()=>app.exit(1),120000)
app.whenReady().then(async()=>{
 try{
  setDataDir(temp);db.setDataDir(temp);await db.initDb()
  win=new BrowserWindow({show:false,webPreferences:{preload:path.resolve('preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}})
  manager=registerPluginCommands(win)
  await win.loadURL('data:text/html,<html><body>Plugin Test</body></html>')
  const invoke=(name,args)=>win.webContents.executeJavaScript(`window.electronAPI.invoke(${JSON.stringify(name)},${JSON.stringify(args||{})})`,true)
  const record=await invoke('plugins-example');assert.equal(record.manifest.version,'1.0.0')
  await invoke('plugins-enable',{id:'friday-writing-tools'})
  const entry=manager.hosts.get('friday-writing-tools');assert.ok(entry)
  assert.deepEqual(await entry.win.webContents.executeJavaScript('({node:typeof require,electron:typeof window.electronAPI})'),{node:'undefined',electron:'undefined'})
  assert.equal(entry.win.webContents.getLastWebPreferences().sandbox,true)
  const note=db.createNote(null,null,'Plugin Test');db.updateNote(note.id,note.title,'<p>hello 世界</p>','hello 世界',undefined,undefined,0)
  const result=await invoke('plugins-execute',{id:entry.id,command:'insert-time',context:{noteId:note.id,selection:{from:0,to:0}}})
  assert.match(result.operations[0].text,/^\d{4}-\d{2}-\d{2}T/)
  await invoke('plugins-execute',{id:entry.id,command:'word-count',context:{noteId:note.id}})
  report.checks.push('原生示例插件在 sandbox 进程运行，无 Node/主应用 API，笔记统计与插字命令返回真实结果')
  await invoke('plugins-settings',{id:entry.id})
  for(let i=0;i<100;i++){if(await entry.win.webContents.executeJavaScript('Boolean(document.querySelector("input"))'))break;await pause(50)}
  await entry.win.webContents.executeJavaScript(`document.querySelector('input').value='42';document.querySelector('input').dispatchEvent(new Event('change',{bubbles:true}))`)
  await pause(200);assert.equal((await manager.store.loadData(entry.id)).goal,42)
  await invoke('plugins-disable',{id:entry.id});assert.ok(entry.win.isDestroyed());assert.equal(manager.hosts.size,0)
  await invoke('plugins-enable',{id:entry.id});assert.equal((await manager.store.loadData(entry.id)).goal,42)
  await invoke('plugins-uninstall',{id:entry.id});assert.equal((await manager.snapshot()).length,0);assert.deepEqual(await manager.store.loadData(entry.id),{})
  report.checks.push('真实设置表单保存与重启保留，停用销毁宿主，卸载清理命令与设置')
  const manifest={id:'office-example',name:'Office example',format:'friday',apiVersion:1,version:'1.0.0',category:'office',permissions:['office.read','office.write']}
  await initOfficeSession(win)
  await manager.store.installFiles({'manifest.json':JSON.stringify(manifest),'main.js':`exports.activate=api=>{api.commands.register({id:'create',name:'Create',run:async()=>{const result=await api.office.create('docs','Plugin Office');api.notice(JSON.stringify(result));if(!(await api.office.list()).length)throw new Error('Office missing')}})}`})
  await manager.enable(manifest.id);await manager.execute(manifest.id,'create');await manager.disable(manifest.id)
  report.checks.push('Office 插件通过真实宿主接口新建 Docs 并读取原生视图状态')
  await manager.store.installFiles({'manifest.json':JSON.stringify({...manifest,id:'unsupported-example',permissions:[]}),'main.js':`require('node:fs')`})
  await assert.rejects(manager.enable('unsupported-example'),/REQUIRE_UNSUPPORTED/)
  assert.equal((await manager.store.list()).find(p=>p.manifest.id==='unsupported-example').compatibility,'unsupported')
  assert.equal(manager.hosts.size,0)
  report.checks.push('未支持的 Node 接口明确报错且销毁失败进程，不留下已启用状态')
  const agentManifest={...manifest,id:'agent-example',category:'agent',permissions:['agent.tools']}
  await manager.installPackage({'manifest.json':JSON.stringify(agentManifest),'main.js':`exports.activate=async api=>{await api.agent.registerTool({name:'count',description:'统计测试文本长度',parameters:{text:{type:'string'}},run:async args=>args.text.length})}`})
  await manager.enable(agentManifest.id)
  const {listRegisteredTools,buildInterruptConfig,executeCapability}=await import('../src-electron/agent/tools/registry.js')
  const tool=listRegisteredTools().find(t=>t.name==='plugin_agent_example_count');assert.ok(tool);assert.equal(tool.meta.requireApproval,true);assert.equal(typeof tool.schema.extend,'function');assert.ok(buildInterruptConfig()[tool.name])
  const toolResult=JSON.parse(await executeCapability(tool.name,{text:'hello'},{},{approvalGranted:true}));assert.equal(toolResult.result,5)
  await manager.disable(agentManifest.id);assert.ok(!listRegisteredTools().some(t=>t.name===tool.name))
  report.checks.push('智能体插件进入真实工具注册表和审批 interruptOn，纯 z.object 校验后执行返回结果；停用释放工具')
  const stable={...manifest,id:'rollback-example',permissions:[]},files={'manifest.json':JSON.stringify(stable),'main.js':`exports.activate=api=>api.commands.register({id:'alive',name:'Alive',run:()=>42})`}
  await manager.installPackage(files);await manager.enable(stable.id)
  await assert.rejects(manager.installPackage({...files,'manifest.json':JSON.stringify({...stable,version:'1.0.1'}),'main.js':`exports.activate=()=>{throw new Error('BROKEN_UPDATE')}`}),/BROKEN_UPDATE/)
  assert.equal((await manager.snapshot()).find(r=>r.manifest.id===stable.id).manifest.version,'1.0.0');assert.equal((await manager.execute(stable.id,'alive')).result,42)
  const runtime=manager.hosts.get(stable.id);runtime.win.webContents.forcefullyCrashRenderer();for(let i=0;i<100&&manager.hosts.has(stable.id);i++)await pause(50);assert.ok(!manager.hosts.has(stable.id))
  report.checks.push('启用插件升级启动失败自动回滚旧版本并恢复命令；宿主进程真实崩溃后停用清理')
  await manager.enable(stable.id);const hanging=manager.hosts.get(stable.id)
  await hanging.win.webContents.executeJavaScript('window.__fridayNever=()=>new Promise(()=>{});true')
  await assert.rejects(manager.invokeHost(hanging,'__fridayNever',null,100),/TIMEOUT/)
  for(let i=0;i<100&&(manager.hosts.has(stable.id)||(await manager.snapshot()).find(r=>r.manifest.id===stable.id).enabled);i++)await pause(50)
  assert.ok(!manager.hosts.has(stable.id));assert.equal((await manager.snapshot()).find(r=>r.manifest.id===stable.id).enabled,false)
  report.checks.push('宿主调用无响应时超时终止进程并清理已启用状态和命令')
  report.ok=true
 }catch(error){report.error=error.stack;process.exitCode=1}
 finally{
  fs.writeFileSync('artifacts/typewriter/plugins-runtime-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))
  clearTimeout(deadline);await manager?.dispose();shutdownOfficeHost();db.closeDb();if(win&&!win.isDestroyed())win.destroy();app.exit(process.exitCode||0)
 }
})
