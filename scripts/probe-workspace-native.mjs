import {app,BrowserWindow} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {setDataDir} from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import {registerWorkspaceCommands} from '../src-electron/workspace-commands.js'
import {initOfficeSession,shutdownOfficeHost} from '../src-electron/office/office-session.js'
import {newOfficeDocument,getOfficeUiTarget} from '../src-electron/office/office-host.js'
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'friday-workspace-native-'));app.setPath('userData',path.join(dir,'profile'));app.on('window-all-closed',()=>{})
setTimeout(()=>app.exit(1),60000)
app.whenReady().then(async()=>{
 setDataDir(dir);db.setDataDir(dir);await db.initDb()
 const win=new BrowserWindow({show:true,webPreferences:{preload:path.resolve('preload.cjs'),sandbox:true,contextIsolation:true}})
 registerWorkspaceCommands(win)
 await win.loadURL('data:text/html,<html><body>Probe</body></html>')
 await win.webContents.executeJavaScript(`window.keys=[];window.electronAPI.on('workspace-shortcut',value=>keys.push(value));true`)
 await initOfficeSession(win);await newOfficeDocument('docs',undefined,'Keys');const {webContents:wc}=getOfficeUiTarget()
 wc.on('before-input-event',(_event,input)=>console.log('INPUT',JSON.stringify(input)))
 await new Promise(r=>setTimeout(r,3000));wc.focus()
 wc.sendInputEvent({type:'keyDown',keyCode:'P',modifiers:['control','shift']});wc.sendInputEvent({type:'keyUp',keyCode:'P',modifiers:['control','shift']})
 await new Promise(r=>setTimeout(r,1000));console.log('RESULT',await win.webContents.executeJavaScript('JSON.stringify(keys)'))
 shutdownOfficeHost();db.closeDb();win.destroy();app.exit(0)
})
