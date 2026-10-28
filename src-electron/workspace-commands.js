import {app,ipcMain} from 'electron'
import {loadConfig,saveConfig} from './config.js'
import {bindingFromEvent,normalizeBinding} from '../src/features/shortcuts/keymap.js'
import {suspendOfficeForOverlay,resumeOfficeAfterOverlay} from './office/office-host.js'

const defaults={'app.commands':['Mod+Shift+P'],'app.settings':['Mod+,']}
export function registerWorkspaceCommands(win){
  let depth=0, commandMap=[]
  const allowed=event=>{if(event.sender!==win.webContents)throw new Error('WORKSPACE_OWNER_REQUIRED')}
  const nativeKeys=(wc)=>{
    if(wc===win.webContents)return
    wc.on('before-input-event',(event,input)=>{
      if(input.type!=='keyDown'||input.isAutoRepeat||depth)return
      const binding=bindingFromEvent({key:input.key,code:input.code,ctrlKey:input.control,metaKey:input.meta,altKey:input.alt,shiftKey:input.shift},{mac:process.platform==='darwin'})
      const bindings={...defaults,...loadConfig().workspaceShortcuts}
      const id=commandMap.find(c=>(c.contexts.includes('all')||c.contexts.includes('office'))&&c.bindings.includes(binding))?.id || Object.keys(defaults).find(id=>bindings[id]?.includes(binding))
      if(id){event.preventDefault();win.webContents.send('workspace-shortcut',{id})}
    })
  }
  app.on('web-contents-created',(_event,wc)=>nativeKeys(wc))
  ipcMain.handle('workspace-overlay',(event,{open}={})=>{
    allowed(event)
    if(open){if(depth++===0)suspendOfficeForOverlay()}
    else if(depth>0&&--depth===0){resumeOfficeAfterOverlay()}
    return {open:depth>0}
  })
  ipcMain.handle('workspace-keymap-sync',(event,{commands}={})=>{allowed(event);if(!Array.isArray(commands)||commands.length>10000)throw new Error('KEYMAP_INVALID');commandMap=commands.filter(c=>typeof c.id==='string'&&c.id.length<240&&Array.isArray(c.bindings)&&c.bindings.length<=3&&c.bindings.every(normalizeBinding)&&Array.isArray(c.contexts));return {saved:true}})
  ipcMain.handle('workspace-keymap-get',event=>{allowed(event);return {bindings:loadConfig().workspaceShortcuts||{}}})
  ipcMain.handle('workspace-keymap-save',(event,{bindings}={})=>{
    allowed(event)
    if(!bindings||typeof bindings!=='object'||Array.isArray(bindings)||Object.keys(bindings).length>10000)throw new Error('KEYMAP_INVALID')
    for(const [id,values]of Object.entries(bindings))if(id.length>240||!Array.isArray(values)||values.length>3||values.some(value=>!normalizeBinding(value)))throw new Error('KEYMAP_INVALID')
    const config=loadConfig();config.workspaceShortcuts=bindings;config.workspaceShortcutsVersion=1;saveConfig(config);return {saved:true}
  })
  win.webContents.on('render-process-gone',()=>{depth=0;resumeOfficeAfterOverlay()})
}
