const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pdfPassword', {
  submit: password => ipcRenderer.send('office-pdf-password-submit', password),
  cancel: () => ipcRenderer.send('office-pdf-password-cancel'),
})
