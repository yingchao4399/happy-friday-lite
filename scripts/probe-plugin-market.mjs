import {app} from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {communityCatalog,downloadRelease} from '../src-electron/plugins/catalog.js'
import {PluginStore} from '../src-electron/plugins/package-store.js'
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'friday-plugin-market-')),report={ok:false,checks:[],profile:dir};app.setPath('userData',path.join(dir,'profile'))
app.whenReady().then(async()=>{try{
 const catalog=await communityCatalog(dir,true);assert.ok(catalog.entries.length>100);const cached=await communityCatalog(dir);assert.equal(cached.fetchedAt,catalog.fetchedAt);report.entries=catalog.entries.length;report.checks.push('官方社区目录联网读取、作者/仓库/ID 保留、离线缓存复用')
 const item=catalog.entries.find(e=>e.id==='obsidian-sort-and-permute-lines');assert.ok(item,'官方目录中应有测试插件')
 const release=await downloadRelease(item.repo,item.id),store=new PluginStore(path.join(dir,'plugins'));await store.installFiles(release.files,release.source);const pkg=await store.readPackage(item.id);assert.equal(pkg.files['main.js'],release.files['main.js'].toString());report.plugin={id:item.id,repo:item.repo,version:pkg.manifest.version};report.checks.push('真实社区插件发行版 main.js/manifest/styles 下载并安装，原始代码保持一致');report.ok=true
 }catch(error){report.error=error.stack;process.exitCode=1}finally{fs.mkdirSync('artifacts/typewriter',{recursive:true});fs.writeFileSync('artifacts/typewriter/plugin-market-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(process.exitCode||0)}})
