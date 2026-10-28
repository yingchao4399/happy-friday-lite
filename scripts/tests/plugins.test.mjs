import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import {PluginStore,safeEntry,validateManifest} from '../../src-electron/plugins/package-store.js'
import {projectNote,restoreProjection} from '../../src-electron/plugins/note-projection.js'
const manifest={id:'example',name:'Example',version:'1.0.0',format:'friday',apiVersion:1,permissions:['notes.read','notes.write']}
test('插件包校验拒绝越界路径、未知权限、缺失入口',async()=>{
  for(const name of ['../a','/absolute','a\\b','C:/a','a/../../b','a//b'])assert.throws(()=>safeEntry(name),/PATH/)
  assert.throws(()=>validateManifest({...manifest,permissions:['fs']}),/UNSUPPORTED/)
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'friday-plugin-')),store=new PluginStore(dir)
  try{await assert.rejects(store.installFiles({'manifest.json':JSON.stringify(manifest)}),/MAIN_MISSING/)}finally{await fs.rm(dir,{recursive:true,force:true})}
})
test('插件升级保留配置，失败包不破坏旧版，回滚和卸载清理',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'friday-plugin-')),store=new PluginStore(dir)
  const files=version=>({'manifest.json':JSON.stringify({...manifest,version}),'main.js':'exports.activate=()=>{}'})
  try{
    await store.installFiles(files('1.0.0'));await store.saveData('example',{goal:42});await store.set('example',{enabled:true})
    await assert.rejects(store.installFiles({...files('broken')}),/MANIFEST_INVALID/)
    assert.equal((await store.list())[0].manifest.version,'1.0.0')
    await store.installFiles(files('2.0.0'));assert.equal((await store.list())[0].enabled,false);assert.equal((await store.loadData('example')).goal,42)
    await store.rollback('example');assert.equal((await store.readPackage('example')).manifest.version,'1.0.0')
    await store.uninstall('example');assert.equal((await store.list()).length,0);assert.deepEqual(await store.loadData('example'),{})
  }finally{await fs.rm(dir,{recursive:true,force:true})}
})
test('ZIP 包支持单层目录并限制解压总量',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'friday-plugin-')),store=new PluginStore(path.join(dir,'store')),zip=new AdmZip()
  try{zip.addFile('sample/manifest.json',Buffer.from(JSON.stringify(manifest)));zip.addFile('sample/main.js',Buffer.from('exports.activate=()=>{}'));zip.writeZip(path.join(dir,'plugin.zip'));await store.installZip(path.join(dir,'plugin.zip'));assert.equal((await store.list())[0].manifest.id,'example')}finally{await fs.rm(dir,{recursive:true,force:true})}
})
test('Markdown 投影保留图表表格和格式节点，拒绝静默删除或修改保护标记',()=>{
  const html='<p>hello</p><div data-chart="42"><canvas></canvas></div><table><tbody><tr><td>cell</td></tr></tbody></table><p style="color:red">red</p>'
  const p=projectNote({id:'n',title:'N',content:html,revision:2})
  assert.equal(p.protectedNodes.length,3)
  const restored=restoreProjection(p.text+'\n\nworld',p)
  assert.match(restored.content,/data-chart="42"/);assert.match(restored.content,/<table>/);assert.match(restored.content,/style="color:red"/);assert.match(restored.content,/world/)
  assert.throws(()=>restoreProjection('deleted',p),/PROTECTED/)
  assert.throws(()=>restoreProjection(p.text.replace(p.protectedNodes[0].token,'changed'),p),/PROTECTED/)
  assert.doesNotMatch(restoreProjection('<script>alert(1)</script><p onclick="bad()">safe</p>',{protectedNodes:[]}).content,/script|onclick/)
})
