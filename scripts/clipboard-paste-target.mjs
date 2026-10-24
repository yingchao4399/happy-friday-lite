import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-paste-target-'))
app.setPath('userData', directory)
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 700, height: 500, title: 'Friday Clipboard Acceptance Target', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  window.on('page-title-updated', event => event.preventDefault())
  const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>Friday Clipboard Acceptance Target</title><style>body{font:16px system-ui;padding:24px;background:#fafafa}textarea{font:16px/1.6 system-ui;width:100%;height:180px;box-sizing:border-box;padding:12px}button{padding:8px 16px;margin:8px}</style><h2>Friday 剪贴板外部粘贴验收窗口</h2><p>只用于合成验收文字，不保存或提交内容。</p><textarea aria-label="验收输入区" spellcheck="false"></textarea><p id="status" role="status">等待粘贴</p><button id="fixture">放入验收文字</button><button id="clear">清空输入区</button><script>const editor=document.querySelector('textarea'),status=document.querySelector('#status');document.querySelector('#fixture').onclick=()=>{editor.value='Friday clipboard external paste acceptance 2026';editor.focus();editor.select();status.textContent='验收文字已选中'};document.querySelector('#clear').onclick=()=>{editor.value='';editor.focus();status.textContent='等待粘贴'};editor.addEventListener('paste',()=>{setTimeout(()=>{status.textContent=editor.value.includes('Friday clipboard external paste acceptance 2026')?'粘贴内容核验通过':'已收到粘贴内容'},30)})</script></html>`
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
})
app.on('window-all-closed', () => app.quit())
