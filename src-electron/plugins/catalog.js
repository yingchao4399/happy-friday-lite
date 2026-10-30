import fs from 'node:fs'
import path from 'node:path'
import {net} from 'electron'
export async function fetchBytes(url,max=20*1024*1024){
  const parsed=new URL(url)
  if(parsed.protocol!=='https:'||!['github.com','api.github.com','raw.githubusercontent.com','objects.githubusercontent.com','release-assets.githubusercontent.com'].includes(parsed.hostname))throw new Error('PLUGIN_SOURCE_DENIED')
  // GitHub rejects anonymous requests without a user agent in some regions
  // and rate-limits the API much sooner than the release asset host.  Keep
  // the request explicit and use a caller-provided token only for api.github.com
  // (never forward it to release assets or arbitrary plugin content).
  const headers={'Accept':'application/vnd.github+json','User-Agent':'Happy-Friday-Lite/'+(process.env.npm_package_version||'3.0.6')}
  const token=process.env.GITHUB_TOKEN||process.env.GH_TOKEN
  if(token&&parsed.hostname==='api.github.com')headers.Authorization=`Bearer ${token}`
  const response=await net.fetch(url,{headers,signal:AbortSignal.timeout(90000)})
  if(!response.ok)throw new Error('PLUGIN_DOWNLOAD_FAILED: '+response.status)
  if(Number(response.headers.get('content-length'))>max)throw new Error('PLUGIN_PACKAGE_TOO_LARGE')
  const reader=response.body.getReader();const chunks=[];let size=0
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max)throw new Error('PLUGIN_PACKAGE_TOO_LARGE');chunks.push(Buffer.from(value))}}finally{await reader.cancel().catch(()=>{})}
  return Buffer.concat(chunks)
}
export function validRepo(repo){if(typeof repo!=='string'||!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)||repo.includes('..'))throw new Error('PLUGIN_REPO_INVALID');return repo}
function latestReleaseUrl(url){
  return new Promise((resolve,reject)=>{
    const request=net.request({url,redirect:'manual',credentials:'omit'})
    const timer=setTimeout(()=>{request.abort();reject(new Error('PLUGIN_DOWNLOAD_TIMEOUT'))},45000)
    request.on('redirect',(_status,_method,location)=>{clearTimeout(timer);resolve(location);request.abort()})
    request.on('error',error=>{clearTimeout(timer);reject(error)})
    request.on('response',response=>{clearTimeout(timer);response.on('data',()=>{});response.on('end',()=>reject(new Error('PLUGIN_RELEASE_REDIRECT_MISSING')))})
    request.end()
  })
}
export async function communityCatalog(root,refresh=false){
  const file=path.join(root,'community-cache.json')
  if(!refresh&&fs.existsSync(file))return JSON.parse(fs.readFileSync(file,'utf8'))
  const entries=JSON.parse((await fetchBytes('https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json',8*1024*1024)).toString())
  if(!Array.isArray(entries))throw new Error('PLUGIN_CATALOG_INVALID')
  const result={fetchedAt:new Date().toISOString(),entries:entries.filter(e=>typeof e.id==='string'&&typeof e.name==='string'&&typeof e.repo==='string').map(e=>({...e,category:'obsidian',format:'obsidian',compatibility:'unverified'}))}
  fs.mkdirSync(root,{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(result));fs.renameSync(file+'.tmp',file);return result
}
export async function downloadRelease(repo,expectedId){
  validRepo(repo)
  let release
  try{release=JSON.parse((await fetchBytes('https://api.github.com/repos/'+repo+'/releases/latest',2*1024*1024)).toString())}
  catch(apiError){
    // 公共 API 不可用时，从同仓库官方发行页取得最新版本。
    const latest='https://github.com/'+repo+'/releases/latest'
    const location=await latestReleaseUrl(latest)
    if(!location)throw apiError
    const resolved=new URL(location,latest),prefix='/'+repo+'/releases/tag/'
    if(resolved.protocol!=='https:'||resolved.hostname!=='github.com'||!resolved.pathname.startsWith(prefix))throw apiError
    const tag=decodeURIComponent(resolved.pathname.slice(prefix.length))
    release={tag_name:tag,html_url:resolved.href,assets:['manifest.json','main.js','styles.css'].map(name=>({name,browser_download_url:'https://github.com/'+repo+'/releases/download/'+encodeURIComponent(tag)+'/'+name}))}
  }
  const files={}
  for(const name of ['manifest.json','main.js','styles.css']){
    const asset=release.assets?.find(a=>a.name===name)
    if(asset)try{files[name]=await fetchBytes(asset.browser_download_url)}catch(error){if(name!=='styles.css')throw error}
    else if(name!=='styles.css')throw new Error('PLUGIN_RELEASE_INCOMPLETE')
  }
  if(JSON.parse(files['manifest.json'].toString()).id!==expectedId)throw new Error('PLUGIN_ID_MISMATCH')
  // 保留上游许可证；无许可证的插件包不推断授权。
  try{files['LICENSE']=await fetchBytes('https://raw.githubusercontent.com/'+repo+'/'+encodeURIComponent(release.tag_name)+'/LICENSE',200000)}catch{}
  return {files,source:{kind:'github',repo,release:release.tag_name,url:release.html_url}}
}
