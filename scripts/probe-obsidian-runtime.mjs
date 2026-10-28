import {app,BrowserWindow} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import {setDataDir} from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import {registerPluginCommands} from '../src-electron/plugins/manager.js'
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'friday-obsidian-')),report={ok:false,checks:[],profile:dir}
app.setPath('userData',path.join(dir,'profile'));app.on('window-all-closed',()=>{})
const pause=ms=>new Promise(r=>setTimeout(r,ms));let manager,win
const deadline=setTimeout(()=>app.exit(1),150000)
app.whenReady().then(async()=>{
 try{
  setDataDir(dir);db.setDataDir(dir);await db.initDb()
  win=new BrowserWindow({show:false,webPreferences:{preload:path.resolve('preload.cjs'),sandbox:true,contextIsolation:true}});manager=registerPluginCommands(win);await win.loadURL('data:text/html,<html><body>Obsidian Test</body></html>')
  const invoke=(name,args)=>win.webContents.executeJavaScript(`window.electronAPI.invoke(${JSON.stringify(name)},${JSON.stringify(args||{})})`,true)
  const note=db.createNote(null,null,'Obsidian Note');db.updateNote(note.id,note.title,'<h1>Heading</h1><p>original</p><table><tr><td>protected</td></tr></table>','original',undefined,undefined,0)
  await invoke('plugins-sample');await manager.enable('obsidian-sample-plugin')
  const entry=manager.hosts.get('obsidian-sample-plugin');assert.ok(entry.commands.some(c=>c.id==='open-sample-modal'))
  assert.equal((await manager.snapshot()).find(r=>r.manifest.id===entry.id).compatibility,'verified')
  await manager.execute(entry.id,'open-sample-modal',{noteId:note.id,text:'original',selection:{from:0,to:0}})
  assert.equal(await entry.win.webContents.executeJavaScript(`document.querySelector('.modal-content')?.textContent`),'Woah!')
  assert.equal(await entry.win.webContents.executeJavaScript(`document.querySelector('.status-bar')?.textContent`),'Status Bar Text')
  await entry.win.webContents.executeJavaScript(`document.querySelector('.modal-close-button').click();true`)
  await invoke('plugins-settings',{id:entry.id})
  assert.match(await entry.win.webContents.executeJavaScript('document.body.textContent'),/Settings for my awesome plugin/)
  assert.ok(await entry.win.webContents.executeJavaScript('Boolean(document.querySelector("input"))'))
  report.checks.push('官方 1.0.0 原始 main.js / manifest / styles 未修改，ES5 插件启动、命令、Modal、Setting、状态栏通过')
  await invoke('plugins-markdown',{id:entry.id,noteId:note.id})
  await entry.win.webContents.executeJavaScript(`window.__fridayCM.dispatch({changes:{from:0,insert:'# Written in CM6\\n\\n'}});true`)
  for(let i=0;i<120&&db.getNote(note.id).revision<2;i++)await pause(50)
  assert.match(db.getNote(note.id).content,/Written in CM6/);assert.match(db.getNote(note.id).content,/<table>/)
  await entry.win.webContents.executeJavaScript(`window.__fridayCM.dispatch({changes:{from:0,insert:'second save\\n\\n'}});true`)
  for(let i=0;i<120&&db.getNote(note.id).revision<3;i++)await pause(50)
  assert.match(db.getNote(note.id).content,/second save/);assert.match(db.getNote(note.id).content,/<table>/)
  const before=db.getNote(note.id).revision
  await entry.win.webContents.executeJavaScript(`window.__fridayCM.dispatch({changes:{from:0,to:window.__fridayCM.state.doc.length,insert:'deleted protected node'}});true`)
  await pause(1200);assert.equal(db.getNote(note.id).revision,before)
  assert.equal((await manager.runtimeCall(entry,'notes.draft.read',{id:note.id})).text,'deleted protected node')
  report.checks.push('真实 CM6 Markdown 编辑连续保存同 noteId，保留富文本表格；删除保护标记时拒绝落盘并保留恢复草稿')
  await manager.disable(entry.id);assert.equal(manager.hosts.size,0)
  const modern={id:'compat-fixture',name:'Compatibility test',version:'1.0.0',minAppVersion:'1.0.0'}
  await manager.store.installFiles({'manifest.json':JSON.stringify(modern),'main.js':`const {Plugin,MarkdownView}=require('obsidian');const {EditorView}=require('@codemirror/view');module.exports=class extends Plugin{async onload(){await this.saveData({count:(await this.loadData()).count+1||1});this.registerEditorExtension(EditorView.theme({'&':{backgroundColor:'rgb(245, 250, 255)'}}));this.addCommand({id:'replace',name:'Replace',editorCallback:editor=>editor.replaceSelection('COMPAT_REPLACED')});this.addCommand({id:'vault',name:'Vault',callback:async()=>{const file=this.app.workspace.getActiveFile();const text=await this.app.vault.read(file);await this.app.vault.modify(file,text+'\\n\\nVault API saved');if(!this.app.metadataCache.getFileCache(file).headings.length)throw new Error('No metadata')}})}}`})
  await manager.enable(modern.id);const current=manager.hosts.get(modern.id)
  const result=await manager.execute(modern.id,'replace',{noteId:note.id,text:'original',selection:{from:0,to:8}});assert.equal(result.operations[0].text,'COMPAT_REPLACED')
  await manager.execute(modern.id,'vault',{noteId:note.id,text:'original',selection:{from:0,to:8}});assert.match(db.getNote(note.id).content,/Vault API saved/)
  await invoke('plugins-markdown',{id:modern.id,noteId:note.id});assert.equal(await current.win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.cm-editor')).backgroundColor`),'rgb(245, 250, 255)')
  assert.equal((await manager.store.loadData(modern.id)).count,1)
  await manager.disable(modern.id);await manager.enable(modern.id);assert.equal((await manager.store.loadData(modern.id)).count,2)
  report.checks.push('现代 Obsidian 类生命周期、配置持久化、Editor 回调、Vault 受控投影、MetadataCache 标题、同一 CM6 模块扩展实际运行')
  await manager.disable(modern.id)
  const market=JSON.parse(fs.readFileSync('artifacts/typewriter/plugin-market-report.json','utf8'));assert.equal(market.ok,true)
  const packageDir=path.join(market.profile,'plugins/packages',market.plugin.id),files={};for(const name of fs.readdirSync(packageDir))files[name]=fs.readFileSync(path.join(packageDir,name))
  await manager.installPackage(files,{kind:'github',repo:market.plugin.repo,release:market.plugin.version});await manager.enable(market.plugin.id)
  const sortNote=db.createNote(null,null,'Community sorting');db.updateNote(sortNote.id,sortNote.title,'<p>zebra</p><p>apple</p><p>banana</p>','zebra\napple\nbanana',undefined,undefined,0)
  await invoke('plugins-markdown',{id:market.plugin.id,noteId:sortNote.id})
  await manager.execute(market.plugin.id,'sort-alphabetically',{noteId:sortNote.id,text:'zebra\napple\nbanana',selection:{from:0,to:0}})
  for(let i=0;i<120&&db.getNote(sortNote.id).revision<2;i++)await pause(50)
  assert.ok(db.getNote(sortNote.id).content.indexOf('apple')<db.getNote(sortNote.id).content.indexOf('banana'));assert.ok(db.getNote(sortNote.id).content.indexOf('banana')<db.getNote(sortNote.id).content.indexOf('zebra'))
  report.community={...market.plugin,compatibility:'partial',verifiedCommands:['sort-alphabetically'],mode:'CM6 Markdown'}
  report.checks.push('真实社区插件 Sort and Permute Lines 0.9.0 原包在 CM6 中排序并保存同一笔记；其余命令未宣称通过')
  report.ok=true
 }catch(error){report.error=error.stack;process.exitCode=1}
 finally{fs.writeFileSync('artifacts/typewriter/obsidian-runtime-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));clearTimeout(deadline);await manager?.dispose();db.closeDb();if(win&&!win.isDestroyed())win.destroy();app.exit(process.exitCode||0)}
})
