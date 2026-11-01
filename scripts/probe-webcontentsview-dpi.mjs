if (!process.versions.electron) {
  const {spawn}=await import('node:child_process'),{createRequire}=await import('node:module'),{fileURLToPath}=await import('node:url'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE
  const child=spawn(createRequire(import.meta.url)('electron'),[fileURLToPath(import.meta.url),...process.argv.slice(2)],{env,stdio:'inherit',windowsHide:true})
  process.exitCode=await new Promise(resolve=>child.on('exit',code=>resolve(code??1)))
} else {
const {app,BrowserWindow,WebContentsView}=await import('electron')
app.commandLine.appendSwitch('force-device-scale-factor',process.argv[2]||'1.5')
app.on('window-all-closed',()=>{})
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:true,width:1200,height:900})
  const view=new WebContentsView({webPreferences:{sandbox:true,backgroundThrottling:false}})
  win.contentView.addChildView(view)
  view.setVisible(true);view.setBounds({x:100,y:100,width:72,height:72})
  await view.webContents.loadURL('data:text/html,<style>html,body{margin:0}</style><button id=b>test</button>')
  await new Promise(resolve=>setTimeout(resolve,300))
  console.log(JSON.stringify({bounds:view.getBounds(),state:await view.webContents.executeJavaScript('({innerWidth,innerHeight,dpr:devicePixelRatio,rect:document.querySelector("#b").getBoundingClientRect().toJSON()})')}))
  view.setBounds({x:100,y:100,width:360,height:580});await new Promise(resolve=>setTimeout(resolve,300))
  console.log(JSON.stringify({bounds:view.getBounds(),state:await view.webContents.executeJavaScript('({innerWidth,innerHeight,dpr:devicePixelRatio,rect:document.querySelector("#b").getBoundingClientRect().toJSON()})')}))
  app.exit(0)
})
}
