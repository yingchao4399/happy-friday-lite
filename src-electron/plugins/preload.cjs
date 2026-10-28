const {contextBridge,ipcRenderer}=require('electron')
contextBridge.exposeInMainWorld('pluginBridge',{
  call:(method,args)=>ipcRenderer.invoke('plugin-runtime-call',{method,args}),
  onContext:listener=>{const callback=(_event,value)=>listener(value);ipcRenderer.on('plugin-context',callback);return()=>ipcRenderer.removeListener('plugin-context',callback)}
})
