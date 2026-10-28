import {ipcMain, dialog} from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import {getDataDir} from './config.js'

const catalog = [{id:'source-code-pro',family:'Source Code Pro',weight:400,
  url:'https://raw.githubusercontent.com/adobe-fonts/source-code-pro/release/TTF/SourceCodePro-Regular.ttf',
  license:'https://raw.githubusercontent.com/adobe-fonts/source-code-pro/release/LICENSE.md'}]
const inflight = new Map()
const root = () => path.join(getDataDir(), 'fonts')
const validId = id => typeof id === 'string' && /^[a-z0-9-]{1,100}$/.test(id)
async function records() {
  await fs.mkdir(root(), {recursive:true})
  const result = []
  for (const file of await fs.readdir(root())) {
    if (!file.endsWith('.json')) continue
    try {const entry=JSON.parse(await fs.readFile(path.join(root(),file),'utf8')); if(validId(entry.id)) result.push(entry)} catch {}
  }
  return result
}
export function registerFontCommands(win) {
  const handle = (name, run) => ipcMain.handle(name, (event,args) => {
    if (event.sender !== win.webContents) throw new Error('FONT_OWNER_REQUIRED')
    return run(args || {})
  })
  handle('fonts-list', async () => {
    const installed = await records()
    return [...catalog.map(font => ({...font,installed:installed.some(item=>item.id===font.id)})),
      ...installed.filter(font=>!catalog.some(item=>item.id===font.id)).map(font=>({...font,installed:true}))]
  })
  handle('fonts-read', async ({id}) => {
    if (!validId(id)) throw new Error('FONT_INVALID')
    const entry=(await records()).find(font=>font.id===id)
    if (!entry) throw new Error('FONT_NOT_FOUND')
    const bytes=await fs.readFile(path.join(root(),id+'.font'))
    if (crypto.createHash('sha256').update(bytes).digest('hex')!==entry.sha256) throw new Error('FONT_HASH_MISMATCH')
    return {base64:bytes.toString('base64')}
  })
  async function store(font, bytes, license='') {
    if (bytes.length>60*1024*1024 || bytes.length<100) throw new Error('FONT_INVALID')
    const header=bytes.subarray(0,4).toString('hex')
    if (!['00010000','4f54544f','774f4646','774f4632','74746366'].includes(header)) throw new Error('FONT_INVALID')
    await fs.mkdir(root(),{recursive:true})
    const entry={...font,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),installedAt:new Date().toISOString()}
    await fs.writeFile(path.join(root(),font.id+'.tmp'),bytes)
    await fs.rename(path.join(root(),font.id+'.tmp'),path.join(root(),font.id+'.font'))
    if(license)await fs.writeFile(path.join(root(),font.id+'.LICENSE'),license)
    await fs.writeFile(path.join(root(),font.id+'.json'),JSON.stringify(entry))
    return {...entry,installed:true}
  }
  handle('fonts-download', async ({id}) => {
    const font=catalog.find(font=>font.id===id)
    if (!font) throw new Error('FONT_INVALID')
    if(!inflight.has(id))inflight.set(id,(async()=>{
      const response=await fetch(font.url,{signal:AbortSignal.timeout(90000)})
      if(!response.ok)throw new Error('FONT_DOWNLOAD_FAILED')
      const license=await fetch(font.license,{signal:AbortSignal.timeout(30000)})
      if(!license.ok)throw new Error('FONT_LICENSE_FAILED')
      return store(font,Buffer.from(await response.arrayBuffer()),await license.text())
    })().finally(()=>inflight.delete(id)))
    return inflight.get(id)
  })
  handle('fonts-import', async ({family}) => {
    if(typeof family!=='string'||!family.trim()||family.length>100||/[^\p{L}\p{N} ._-]/u.test(family))throw new Error('FONT_INVALID')
    const result=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Font',extensions:['ttf','otf','woff','woff2']}]})
    if(result.canceled)return null
    const bytes=await fs.readFile(result.filePaths[0])
    return store({id:'import-'+crypto.createHash('sha256').update(bytes).digest('hex').slice(0,16),family:family.trim(),weight:400},bytes)
  })
}
