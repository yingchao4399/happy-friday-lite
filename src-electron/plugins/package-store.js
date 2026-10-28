import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import AdmZip from 'adm-zip'

export const categories=['agent','notes','office','obsidian','other']
export const validId=id=>typeof id==='string'&&/^[a-z0-9][a-z0-9_-]{0,119}$/.test(id)
export const permissions=['notes.read','notes.write','office.read','office.write','agent.tools']
export function validateManifest(value){
  if(!value||!validId(value.id)||typeof value.name!=='string'||!value.name.trim()||value.name.length>200||!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(value.version))throw new Error('PLUGIN_MANIFEST_INVALID')
  const format=value.format==='friday'?'friday':'obsidian'
  if(format==='friday'&&(value.apiVersion!==1||!Array.isArray(value.permissions)||value.permissions.some(p=>!permissions.includes(p))))throw new Error('PLUGIN_API_UNSUPPORTED')
  return {...value,format,main:'main.js',category:format==='obsidian'?'obsidian':categories.includes(value.category)?value.category:'other',permissions:format==='obsidian'?['notes.read','notes.write']:value.permissions}
}
export function safeEntry(name){
  if(typeof name!=='string'||name.length>300||name.includes('\\')||name.startsWith('/')||name.includes(':')||name.includes('\0')||name.split('/').some(s=>s==='..'||s==='.'||!s))throw new Error('PLUGIN_PATH_INVALID')
  return name
}
export class PluginStore{
  constructor(root){this.root=path.resolve(root);this.queue=Promise.resolve()}
  dir(id){if(!validId(id))throw new Error('PLUGIN_ID_INVALID');return path.join(this.root,'packages',id)}
  async state(){try{return JSON.parse(await fs.readFile(path.join(this.root,'registry.json'),'utf8'))}catch(error){if(error.code!=='ENOENT')throw error;return {schemaVersion:1,plugins:{}}}}
  async save(state){await fs.mkdir(this.root,{recursive:true});const target=path.join(this.root,'registry.json');await fs.writeFile(target+'.tmp',JSON.stringify(state,null,2));await fs.rename(target+'.tmp',target)}
  async mutate(run){const task=this.queue.catch(()=>{}).then(run);this.queue=task;return task}
  async list(){return Object.values((await this.state()).plugins)}
  async set(id,patch){return this.mutate(async()=>{const state=await this.state();if(!state.plugins[id])throw new Error('PLUGIN_NOT_FOUND');state.plugins[id]={...state.plugins[id],...patch};await this.save(state);return state.plugins[id]})}
  async readPackage(id){
    const base=this.dir(id),files={}
    const walk=async(dir,prefix='')=>{for(const entry of await fs.readdir(dir,{withFileTypes:true})){const name=prefix+entry.name;safeEntry(name);if(entry.isSymbolicLink())throw new Error('PLUGIN_SYMLINK_DENIED');if(entry.isDirectory())await walk(path.join(dir,entry.name),name+'/');else if(/\.(?:js|json|css)$/.test(name))files[name]=await fs.readFile(path.join(dir,entry.name),'utf8')}}
    await walk(base);return {manifest:validateManifest(JSON.parse(files['manifest.json'])),files}
  }
  async installFiles(input,source={}){
    return this.mutate(async()=>{
      const files=Object.fromEntries(Object.entries(input).map(([name,bytes])=>[safeEntry(name),Buffer.from(bytes)]))
      if(Object.keys(files).length>1500||Object.values(files).reduce((n,b)=>n+b.length,0)>32*1024*1024)throw new Error('PLUGIN_PACKAGE_TOO_LARGE')
      const manifest=validateManifest(JSON.parse(files['manifest.json']?.toString()||'null'));if(!files['main.js']||files['main.js'].length>16*1024*1024)throw new Error('PLUGIN_MAIN_MISSING')
      const state=await this.state(),old=state.plugins[manifest.id],dest=this.dir(manifest.id),staging=dest+'-staging-'+crypto.randomUUID(),rollback=dest+'-rollback'
      await fs.mkdir(staging,{recursive:true})
      try{
        for(const [name,bytes]of Object.entries(files)){const target=path.join(staging,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes)}
        if(old){await fs.rm(rollback,{recursive:true,force:true});await fs.rename(dest,rollback)}
        await fs.rename(staging,dest)
        const hashes=Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,crypto.createHash('sha256').update(bytes).digest('hex')]))
        state.plugins[manifest.id]={manifest,enabled:false,source,hashes,installedAt:new Date().toISOString(),compatibility:'unverified',previous:old?{...old,previous:undefined}:null}
        await this.save(state);return state.plugins[manifest.id]
      }catch(error){await fs.rm(staging,{recursive:true,force:true});if(old&&await fs.stat(rollback).catch(()=>false)){await fs.rm(dest,{recursive:true,force:true});await fs.rename(rollback,dest)}throw error}
    })
  }
  async readZip(file){
    const stat=await fs.stat(file);if(stat.size>32*1024*1024)throw new Error('PLUGIN_PACKAGE_TOO_LARGE')
    const archive=new AdmZip(file),entries=archive.getEntries().filter(e=>!e.isDirectory)
    if(entries.length>1500||entries.reduce((n,e)=>n+e.header.size,0)>32*1024*1024)throw new Error('PLUGIN_PACKAGE_TOO_LARGE')
    const manifests=entries.filter(e=>/(^|\/)manifest\.json$/.test(e.entryName));if(manifests.length!==1)throw new Error('PLUGIN_MANIFEST_INVALID')
    const prefix=manifests[0].entryName.slice(0,-13),files={}
    for(const entry of entries){if((entry.attr>>>16&0xf000)===0xa000)throw new Error('PLUGIN_SYMLINK_DENIED');if(!entry.entryName.startsWith(prefix))throw new Error('PLUGIN_PATH_INVALID');const name=safeEntry(entry.entryName.slice(prefix.length));if(files[name])throw new Error('PLUGIN_PATH_INVALID');files[name]=entry.getData()}
    return files
  }
  async installZip(file){return this.installFiles(await this.readZip(file),{kind:'local'})}
  async rollback(id){return this.mutate(async()=>{const state=await this.state(),record=state.plugins[id];if(!record?.previous)throw new Error('PLUGIN_ROLLBACK_UNAVAILABLE');const dest=this.dir(id),temp=dest+'-failed';await fs.rename(dest,temp);try{await fs.rename(dest+'-rollback',dest);state.plugins[id]={...record.previous,enabled:false,previous:null};await this.save(state);await fs.rm(temp,{recursive:true,force:true});return state.plugins[id]}catch(error){await fs.rename(temp,dest);throw error}})}
  async uninstall(id){return this.mutate(async()=>{const state=await this.state();delete state.plugins[id];await this.save(state);await fs.rm(this.dir(id),{recursive:true,force:true});await fs.rm(this.dir(id)+'-rollback',{recursive:true,force:true});await fs.rm(path.join(this.root,'data',id),{recursive:true,force:true})})}
  async loadData(id){this.dir(id);try{return JSON.parse(await fs.readFile(path.join(this.root,'data',id,'data.json'),'utf8'))}catch(error){if(error.code!=='ENOENT')throw error;return {}}}
  async saveData(id,value){return this.mutate(async()=>{this.dir(id);const serialized=JSON.stringify(value);if(serialized.length>1024*1024)throw new Error('PLUGIN_DATA_TOO_LARGE');const dir=path.join(this.root,'data',id);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'data.tmp'),serialized);await fs.rename(path.join(dir,'data.tmp'),path.join(dir,'data.json'));return value})}
}
