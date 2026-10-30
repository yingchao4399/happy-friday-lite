import {BrowserWindow,ipcMain,dialog,app} from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import crypto from 'node:crypto'
import {getDataDir} from '../config.js'
import * as db from '../db.js'
import {PluginStore,validId} from './package-store.js'
import {downloadRelease,communityCatalog} from './catalog.js'
import {projectNote,restoreProjection} from './note-projection.js'
import {getOfficeState,getOfficeDocumentSelection,newOfficeDocument,autoSaveOfficeFile} from '../office/office-host.js'
const base=path.dirname(fileURLToPath(import.meta.url))
export class PluginManager{
  constructor(owner,root=path.join(getDataDir(),'plugins')){this.owner=owner;this.store=new PluginStore(root);this.hosts=new Map();this.projections=new Map();this.transitions=new Map()}
  emit(channel,value){if(!this.owner.isDestroyed())this.owner.webContents.send(channel,value)}
  async snapshot(){return (await this.store.list()).map(record=>({...record,running:this.hosts.has(record.manifest.id),commands:this.hosts.get(record.manifest.id)?.commands||[]}))}
  async changed(){this.emit('plugins-changed',await this.snapshot())}
  transition(id,run){
    const previous=this.transitions.get(id)||Promise.resolve()
    const task=previous.catch(()=>{}).then(run)
    this.transitions.set(id,task)
    task.then(()=>{if(this.transitions.get(id)===task)this.transitions.delete(id)},()=>{if(this.transitions.get(id)===task)this.transitions.delete(id)})
    return task
  }
  async invokeHost(entry,method,value,timeout=15000){
    let timer
    try{return await Promise.race([entry.win.webContents.executeJavaScript(`window.${method}(${JSON.stringify(value??null)})`,true),new Promise((_,reject)=>timer=setTimeout(()=>{entry.win.destroy();reject(new Error('PLUGIN_RUNTIME_TIMEOUT'))},timeout))])}finally{clearTimeout(timer)}
  }
  enable(id){return this.transition(id,()=>this.start(id))}
  async start(id){
    if(this.hosts.has(id))return
    if(this.owner.isDestroyed())throw new Error('PLUGIN_OWNER_CLOSED')
    let entry
    try{
      const record=(await this.store.list()).find(r=>r.manifest.id===id);if(!record)throw new Error('PLUGIN_NOT_FOUND')
      const pkg=await this.store.readPackage(id)
      for(const [file,hash]of Object.entries(record.hashes)){const bytes=await fs.readFile(path.join(this.store.dir(id),file));if(crypto.createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error('PLUGIN_HASH_MISMATCH')}
      const win=new BrowserWindow({show:false,width:900,height:760,parent:this.owner,title:pkg.manifest.name,webPreferences:{preload:path.join(base,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,partition:'friday-plugin-'+crypto.randomUUID(),webSecurity:true}})
      entry={win,manifest:pkg.manifest,commands:[],tools:[],id};this.hosts.set(id,entry)
      win.setMenu(null);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault())
      win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false))
      win.on('close',event=>{if(this.hosts.get(id)===entry){event.preventDefault();win.hide()}})
      win.on('closed',()=>{if(this.hosts.get(id)===entry&&!entry.unloading)void this.fail(id,'PLUGIN_HOST_CLOSED',entry)})
      win.webContents.on('render-process-gone',(_event,details)=>{entry.crashed=true;if(this.hosts.get(id)===entry&&!entry.unloading)void this.fail(id,details.reason,entry)})
      win.webContents.on('unresponsive',()=>{if(this.hosts.get(id)===entry&&!entry.unloading){entry.crashed=true;win.destroy();void this.fail(id,'PLUGIN_UNRESPONSIVE',entry)}})
      await win.loadFile(path.join(base,'host.html'))
      const ready=await this.invokeHost(entry,'__fridayPluginBoot',pkg)
      entry.commands=ready.commands
      await this.store.set(id,{enabled:true,lastError:null,compatibility:pkg.manifest.id==='obsidian-sample-plugin'&&pkg.manifest.version==='1.0.0'&&record.hashes['main.js']==='fb38a50b1dbc3987ef34d7c5de77865e7a5c48719ffe3a11baecb6106124b1ae'?'verified':ready.compatibility||'unverified',runtime:{platform:process.platform,version:pkg.manifest.version,editor:'friday-isolated'}})
      await this.changed()
    }catch(error){
      if(entry){entry.unloading=true;for(const dispose of entry.tools)dispose();if(!entry.win.isDestroyed())entry.win.destroy()}
      this.hosts.delete(id)
      const patch={enabled:false,lastError:error.message}
      if(/(?:UNSUPPORTED|PLUGIN_MODULE_MISSING|OBSIDIAN_PLUGIN_CLASS_MISSING)/.test(error.message))patch.compatibility='unsupported'
      await this.store.set(id,patch).catch(()=>{})
      await this.changed()
      throw error
    }
  }
  fail(id,message,expected){return this.transition(id,async()=>{
    if(this.hosts.get(id)!==expected||expected.unloading)return
    await this.stop(id)
    await this.store.set(id,{enabled:false,lastError:String(message||'PLUGIN_HOST_FAILED')}).catch(()=>{})
    await this.changed()
  })}
  disable(id){return this.transition(id,()=>this.stop(id))}
  async stop(id){
    const entry=this.hosts.get(id);if(entry)entry.unloading=true
    if(entry){if(!entry.win.isDestroyed()){if(!entry.crashed)await this.invokeHost(entry,'__fridayPluginUnload',null,2000).catch(()=>{});if(!entry.win.isDestroyed())entry.win.destroy()}for(const dispose of entry.tools)dispose()}
    this.hosts.delete(id)
    for(const key of this.projections.keys())if(key.startsWith(id+':'))this.projections.delete(key)
    await this.store.set(id,{enabled:false}).catch(()=>{});await this.changed()
  }
  async installPackage(files,source){
    const id=JSON.parse(Buffer.from(files['manifest.json']).toString()).id
    const before=(await this.store.list()).find(record=>record.manifest.id===id),enabled=this.hosts.has(id)
    await this.disable(id)
    const savedData=before?await this.store.loadData(id):null
    try{
      const installed=await this.store.installFiles(files,source)
      const addedPermissions=before&&installed.manifest.permissions.some(p=>!before.manifest.permissions.includes(p))
      if(enabled&&!addedPermissions)try{await this.enable(id)}catch(error){await this.store.rollback(id);await this.store.saveData(id,savedData);await this.enable(id);await this.store.set(id,{lastError:'PLUGIN_UPDATE_ROLLED_BACK: '+error.message});throw error}
      await this.changed();return installed
    }catch(error){if(before&&enabled&&!this.hosts.has(id))await this.enable(id).catch(()=>{});await this.changed();throw error}
  }
  async execute(id,command,context={}){
    const entry=this.hosts.get(id);if(!entry||entry.unloading)throw new Error('PLUGIN_DISABLED')
    const descriptor=entry.commands.find(c=>c.id===command);if(!descriptor)throw new Error('PLUGIN_COMMAND_MISSING')
    const noteId=typeof context.noteId==='string'?context.noteId:null
    if(descriptor.editor&&(!entry.manifest.permissions.includes('notes.read')||!entry.manifest.permissions.includes('notes.write')))throw new Error('PLUGIN_PERMISSION_DENIED: editor')
    entry.context=entry.manifest.permissions.includes('notes.read')?{noteId,selection:context.selection,text:context.text}:{noteId:null}

    return this.invokeHost(entry,'__fridayPluginExecute',{id:command,context:entry.context})
  }
  async runtimeCall(entry,method,args={}){
    const require=p=>{if(!entry.manifest.permissions.includes(p))throw new Error('PLUGIN_PERMISSION_DENIED: '+p)}
    const read=id=>{require('notes.read');if(typeof id!=='string')throw new Error('EDITOR_REQUIRED');const note=db.getNote(id);if(!note)throw new Error('NOTE_NOT_FOUND');const key=entry.id+':'+id,cached=this.projections.get(key);if(cached&&cached.revision===(note.revision||0))return cached;const projection=projectNote(note,cached?.protectedNodes);this.projections.set(key,projection);return projection}
    switch(method){
      case 'settings.load':return this.store.loadData(entry.id)
      case 'settings.save':return this.store.saveData(entry.id,args.value)
      case 'window.show':entry.win.show();return true
      case 'window.hide':entry.win.hide();return true
      case 'notice':this.emit('plugins-notice',{id:entry.id,message:String(args.message).slice(0,500)});return true
      case 'notes.draft.save':case 'notes.draft.read':case 'notes.draft.clear':{
        require('notes.write');if(typeof args.id!=='string'||!db.getNote(args.id))throw new Error('NOTE_NOT_FOUND')
        const dir=path.join(this.store.root,'data',entry.id,'drafts'),file=path.join(dir,crypto.createHash('sha256').update(args.id).digest('hex')+'.json')
        if(method==='notes.draft.read')return JSON.parse(await fs.readFile(file,'utf8').catch(error=>{if(error.code==='ENOENT')return 'null';throw error}))
        if(method==='notes.draft.clear')return this.store.mutate(async()=>{await fs.rm(file,{force:true});return true})
        if(typeof args.text!=='string'||args.text.length>8*1024*1024)throw new Error('NOTE_TEXT_INVALID')
        return this.store.mutate(async()=>{await fs.mkdir(dir,{recursive:true});await fs.writeFile(file+'.tmp',JSON.stringify({noteId:args.id,text:args.text,revision:args.revision}));await fs.rename(file+'.tmp',file);return true})
      }
      case 'notes.list':require('notes.read');return db.getNotes().map(n=>({id:n.id,title:n.title,revision:n.revision||0,createdAt:n.createdAt,updatedAt:n.updatedAt}))
      case 'notes.read':{const result=read(args.id);return {...result,protectedNodes:undefined}}
      case 'notes.write':{
        require('notes.write');const projection=this.projections.get(entry.id+':'+args.id);if(!projection||args.revision!==projection.revision)throw new Error('NOTE_REVISION_CONFLICT')
        const latest=db.getNote(args.id);if(!latest)throw new Error('NOTE_NOT_FOUND');const body=restoreProjection(args.text,projection)
        const updated=db.updateNote(args.id,latest.title,body.content,body.contentText,undefined,undefined,args.revision);this.emit('note-changed',{noteId:args.id,revision:updated.revision});return {...read(args.id),protectedNodes:undefined}
      }
      case 'notes.create':{require('notes.write');if(typeof args.title!=='string'||!args.title.trim()||args.title.length>300)throw new Error('NOTE_TITLE_INVALID');const body=restoreProjection(args.text||'',{protectedNodes:[]}),note=db.createNote(null,null,args.title);const updated=db.updateNote(note.id,note.title,body.content,body.contentText,undefined,undefined,0);this.emit('note-changed',{noteId:note.id,revision:updated.revision});return {id:note.id,title:note.title,revision:updated.revision}}
      case 'office.list':require('office.read');return getOfficeState()
      case 'office.selection':require('office.read');return getOfficeDocumentSelection()
      case 'office.save':require('office.write');if(!getOfficeState().some(v=>v.viewId===args.viewId))throw new Error('OFFICE_VIEW_MISSING');return autoSaveOfficeFile(args.viewId)
      case 'office.create':require('office.write');if(!['docs','sheets','slides'].includes(args.type))throw new Error('OFFICE_TYPE_INVALID');return newOfficeDocument(args.type,undefined,String(args.name||'').slice(0,200))
      case 'agent.register':{
        require('agent.tools');const {z}=await import('zod'),{registerTool,unregisterOwnedTool}=await import('../agent/tools/registry.js')
        if(!validId(args.name)||typeof args.description!=='string'||!args.parameters||typeof args.parameters!=='object')throw new Error('PLUGIN_TOOL_INVALID')
        const shape={};for(const [name,schema]of Object.entries(args.parameters)){if(!validId(name)||!['string','number','boolean'].includes(schema.type))throw new Error('PLUGIN_TOOL_SCHEMA_UNSUPPORTED');shape[name]=z[schema.type]().describe(String(schema.description||name));if(schema.optional)shape[name]=shape[name].optional()}
        const callback=args.callback
        const name='plugin_'+entry.id.replaceAll('-','_')+'_'+args.name.replaceAll('-','_'),owner='plugin:'+entry.id
        registerTool({name,description:args.description,schema:z.object(shape),meta:{owner,requireApproval:true,capabilityType:'write'},handler:async args=>{if(!this.hosts.has(entry.id))throw new Error('PLUGIN_DISABLED');return JSON.stringify(await this.invokeHost(entry,'__fridayPluginExecute',{id:callback,context:null,args}))}})
        entry.tools.push(()=>unregisterOwnedTool(name,owner));return {name,requireApproval:true}
      }
      default:throw new Error('PLUGIN_API_UNSUPPORTED: '+method)
    }
  }
  async dispose(){for(const id of [...this.hosts.keys()])await this.disable(id)}
}
let manager
export function getPluginManager(){return manager}
export function registerPluginCommands(owner){
  manager=new PluginManager(owner)
  const handle=(name,run)=>ipcMain.handle(name,(event,args={})=>{if(event.sender!==owner.webContents)throw new Error('PLUGIN_OWNER_REQUIRED');return run(args)})
  ipcMain.handle('plugin-runtime-call',(event,{method,args}={})=>{const entry=[...manager.hosts.values()].find(e=>e.win.webContents===event.sender);if(!entry)throw new Error('PLUGIN_HOST_REQUIRED');return manager.runtimeCall(entry,method,args||{})})
  handle('plugins-context',({context}={})=>{if(context&&typeof context.text==='string'&&context.text.length>8*1024*1024)throw new Error('NOTE_TEXT_INVALID');for(const entry of manager.hosts.values())if(entry.manifest.permissions.includes('notes.read')&&!entry.win.isDestroyed())entry.win.webContents.send('plugin-context',context||null);return true})
  handle('plugins-markdown',async({id,noteId})=>{const entry=manager.hosts.get(id);if(!entry||entry.manifest.format!=='obsidian')throw new Error('PLUGIN_DISABLED');if(!db.getNote(noteId))throw new Error('NOTE_NOT_FOUND');await manager.invokeHost(entry,'__fridayMarkdownOpen',{noteId});return true})
  handle('plugins-sample',async()=>{const dir=app.isPackaged?path.join(process.resourcesPath,'plugins/sample-plugin'):path.resolve(base,'../../resources/plugins/sample-plugin'),files={};for(const file of await fs.readdir(dir))files[file]=await fs.readFile(path.join(dir,file));return manager.installPackage(files,{kind:'official-sample',repo:'obsidianmd/obsidian-sample-plugin',release:'1.0.0'})})
  handle('plugins-list',()=>manager.snapshot())
  handle('plugins-enable',({id})=>manager.enable(id))
  handle('plugins-disable',({id})=>manager.disable(id))
  handle('plugins-execute',({id,command,context})=>manager.execute(id,command,context))
  handle('plugins-settings',async({id})=>{const entry=manager.hosts.get(id);if(!entry)throw new Error('PLUGIN_DISABLED');await manager.invokeHost(entry,'__fridayPluginSettings');entry.win.show();return true})
  handle('plugins-import',async()=>{const result=await dialog.showOpenDialog(owner,{properties:['openFile'],filters:[{name:'Plugin ZIP',extensions:['zip']}]});if(result.canceled)return null;return manager.installPackage(await manager.store.readZip(result.filePaths[0]),{kind:'local'})})
  handle('plugins-example',async()=>{const dir=app.isPackaged?path.join(process.resourcesPath,'plugins/friday-writing-tools'):path.resolve(base,'../../resources/plugins/friday-writing-tools'),files={};for(const file of await fs.readdir(dir))files[file]=await fs.readFile(path.join(dir,file));await manager.disable('friday-writing-tools');const record=await manager.store.installFiles(files,{kind:'bundled'});await manager.changed();return record})
  handle('plugins-uninstall',async({id})=>{await manager.disable(id);await manager.store.uninstall(id);await manager.changed();return true})
  handle('plugins-rollback',async({id})=>{await manager.disable(id);const result=await manager.store.rollback(id);await manager.changed();return result})
  handle('plugins-catalog',async({refresh}={})=>communityCatalog(manager.store.root,refresh))
  handle('plugins-download',async({repo,id})=>{const value=await downloadRelease(repo,id);return manager.installPackage(value.files,value.source)})
  owner.on('closed',()=>{for(const entry of manager.hosts.values())if(!entry.win.isDestroyed())entry.win.destroy();manager.hosts.clear()})
  // 崩溃前已启用的包在独立进程中恢复；失败状态写回注册表。
  const restoreRecords=manager.store.list()
  setTimeout(async()=>{for(const record of await restoreRecords)if(record.enabled&&!(manager.hosts.has(record.manifest.id))&&(await manager.store.list()).some(current=>current.manifest.id===record.manifest.id&&current.enabled))try{await manager.enable(record.manifest.id)}catch{}},1500).unref()
  return manager
}
