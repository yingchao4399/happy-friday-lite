// 独立进程真实键盘复制/剪切 → 生产剪贴板页面 → 真实粘贴，使用隔离数据。
import { app, BrowserWindow, clipboard, Menu } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const filename = fileURLToPath(import.meta.url)
const root = process.argv.find(arg => arg.startsWith('--app-root='))?.slice(11) || fileURLToPath(new URL('../', import.meta.url))
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-clipboard-roundtrip-'))
app.setPath('userData', data)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const peerMode = process.argv.includes('--peer')

async function until(check, message) {
  for (let i = 0; i < 150; i++) {
    const result = await check()
    if (result) return result
    await wait(60)
  }
  throw new Error(message)
}

async function mainProbe() {
if (peerMode) {
  await app.whenReady()
  const peer = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  await peer.loadURL('data:text/html,<textarea spellcheck="false"></textarea>')
  process.on('message', async request => {
    try {
      const wc = peer.webContents
      if (request.action === 'paste') {
        await wc.executeJavaScript('document.querySelector("textarea").value="";document.querySelector("textarea").focus()')
        wc.paste()
        await until(() => wc.executeJavaScript('document.querySelector("textarea").value.length > 0'), '外部粘贴无内容')
      } else {
        await wc.executeJavaScript(`(() => { const e=document.querySelector('textarea'); e.value=${JSON.stringify(request.text)};e.focus();e.select() })()`)
        wc.sendInputEvent({ type: 'keyDown', keyCode: request.action === 'cut' ? 'X' : 'C', modifiers: ['control'] })
        wc.sendInputEvent({ type: 'keyUp', keyCode: request.action === 'cut' ? 'X' : 'C', modifiers: ['control'] })
        await until(() => clipboard.readText() === request.text, '外部键盘操作未更新系统剪贴板')
      }
      process.send({ id: request.id, value: await wc.executeJavaScript('document.querySelector("textarea").value') })
    } catch (error) { process.send({ id: request.id, error: error.message }) }
  })
  process.send({ ready: true })
  process.on('disconnect', () => app.exit())
} else {
  Object.defineProperty(app, 'isPackaged', { configurable: true, value: true })
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: fs.existsSync(path.join(root, 'resources/office')) ? path.join(root, 'resources') : path.dirname(root) })
  // 只隐藏本次隔离运行创建的窗口。
  BrowserWindow.prototype.show = function () {}
  BrowserWindow.prototype.focus = function () {}
  const timeout = setTimeout(() => { console.error('跨进程剪贴板验收超时'); app.exit(1) }, 90000)
  let child, native, main, ok = false, previous, previousFiles = []
  try {
    await import(pathToFileURL(path.join(root, 'main.js')).href)
    await app.whenReady()
    main = await until(() => BrowserWindow.getAllWindows()[0], '主窗口未创建')
    const run = async code => {
      const result = await main.webContents.executeJavaScript(`Promise.resolve().then(() => (${code})).catch(error => ({__probeError:error.stack || error.message}))`)
      if (result?.__probeError) throw new Error(result.__probeError)
      return result
    }
    await until(() => run('!!window.electronAPI && !!document.querySelector(".sidebar")').catch(() => false), '生产界面未就绪')
    const { createWindowsClipboardAdapter } = await import(pathToFileURL(path.join(root, 'src-electron/windows-clipboard.js')).href)
    // 独立 HWND 保存/恢复文件格式，避免覆盖主窗口监听钩子。
    const holder = new BrowserWindow({ show: false })
    native = createWindowsClipboardAdapter(holder)
    previous = { text: clipboard.readText(), html: clipboard.readHTML(), image: clipboard.readImage() }
    previousFiles = native.readFilePaths({ strict: true })
    const settings = await run('window.electronAPI.invoke("clipboard-settings-get")')
    assert.equal(settings.captureMode, 'native')
    assert.equal(settings.captureIssue, null)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    child = spawn(process.execPath, [filename, '--peer'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    let ready = false, nextId = 0
    const pending = new Map()
    child.on('message', reply => {
      if (reply.ready) ready = true
      const task = pending.get(reply.id)
      if (task) { pending.delete(reply.id); reply.error ? task.reject(new Error(reply.error)) : task.resolve(reply.value) }
    })
    child.on('error', error => { for (const task of pending.values()) task.reject(error) })
    child.on('exit', () => { for (const task of pending.values()) task.reject(new Error('外部验收进程已退出')) })
    await until(() => ready, '外部验收进程未就绪')
    const send = (action, text) => new Promise((resolve, reject) => {
      const id = ++nextId; pending.set(id, { resolve, reject }); child.send({ id, action, text })
    })
    await run('location.hash = "#/clipboard"')
    await until(() => run('!!document.querySelector(".clipboard-page")'), '剪贴板页面未显示')
    for (const action of ['copy', 'cut']) {
      const text = `Friday external ${action} roundtrip ${Date.now()}`
      const after = await send(action, text)
      assert.equal(after, action === 'cut' ? '' : text, '剪切必须删除原文；复制保留原文')
      await until(() => run(`Array.from(document.querySelectorAll('.clipboard-row')).some(row=>row.textContent.includes(${JSON.stringify(text)}))`), '外部内容未自动显示，无需手动刷新')
      await run(`(() => { const row=Array.from(document.querySelectorAll('.clipboard-row')).find(row=>row.textContent.includes(${JSON.stringify(text)}));const copy=Array.from(row.querySelectorAll('.clipboard-actions button')).find(b=>b.textContent.trim()==='复制');if(!copy)throw Error('缺少复制按钮');copy.click() })()`)
      await until(() => run('!!document.querySelector(".copied-feedback")'), '复制动作未成功')
      assert.equal(await send('paste'), text, '从 Friday 复制后，外部实际粘贴必须逐字一致')
    }
    const rows = await run('window.electronAPI.invoke("clipboard-list")')
    assert.equal(rows.length, 2, '自身复制不得产生循环条目')
    assert.ok(rows.every(row => row.sourceApp && row.sourceApp !== 'system-clipboard'))
    // 页面重载后，数据库历史和原生监听必须仍可用。
    main.webContents.reload()
    await until(() => run('document.querySelectorAll(".clipboard-row").length === 2').catch(() => false), '重载后历史丢失')
    // 原版笔记编辑器实际正文的右键事件，不能用普通 textarea 替代。
    const noteText = 'Friday real note context menu acceptance'
    const note = await run('window.electronAPI.invoke("create_note", {title:"右键验收"})')
    await run(`window.electronAPI.invoke('update_note', ${JSON.stringify({ noteId: note.id, title: '右键验收', content: '<h1 data-note-title="true">右键验收</h1><p>' + noteText + '</p>', contentText: noteText })})`)
    await run(`location.hash = ${JSON.stringify('#/note/' + note.id)}`)
    await until(() => run(`document.querySelector('.tiptap')?.textContent.includes(${JSON.stringify(noteText)})`), '原版笔记编辑器未加载')
    const point = await run(`(() => { const p=Array.from(document.querySelectorAll('.tiptap p')).find(n=>n.textContent===${JSON.stringify(noteText)});if(!p)throw Error('未找到正文段落: '+document.querySelector('.tiptap').innerHTML);p.scrollIntoView();p.closest('[contenteditable]').focus();const r=document.createRange();r.selectNodeContents(p);const s=getSelection();s.removeAllRanges();s.addRange(r);const rect=p.getBoundingClientRect();return {x:Math.round(rect.x+12),y:Math.round(rect.y+8)} })()`)
    const oldPopup = Menu.prototype.popup
    let opened
    try {
      Menu.prototype.popup = function () { opened = this }
      main.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'right', clickCount: 1 })
      main.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'right', clickCount: 1 })
      await until(() => opened, '笔记正文没有右键菜单')
      const label = Menu.buildFromTemplate([{ role: 'copy' }]).items[0].label
      const copy = opened.items.find(item => item.label === label)
      assert.ok(copy?.enabled, '笔记正文复制菜单不可用')
      copy.click()
      await until(() => clipboard.readText() === noteText, '笔记菜单复制失败')
    } finally { Menu.prototype.popup = oldPopup }
    assert.equal(await send('paste'), noteText, '笔记菜单复制结果必须能在外部粘贴')
    await run('location.hash = "#/clipboard"')
    await until(() => run('document.querySelectorAll(".clipboard-row").length === 3'), '笔记菜单复制未进入历史或重复收录')
    console.log(JSON.stringify({ ok: true, productionUI: true, separateProcess: true, nativeListener: true, externalKeyboardCopy: true, externalKeyboardCut: true, automaticListRefresh: true, actualPasteMatches: true, noSelfCaptureLoop: true, persistedAfterReload: true, realNoteContextMenu: true, noteMenuCopyAndPaste: true }))
    ok = true
  } catch (error) { console.error(error.stack) }
  finally {
    clearTimeout(timeout)
    if (child?.connected) child.disconnect()
    const { stopClipboardCapture } = await import(pathToFileURL(path.join(root, 'src-electron/clipboard.js')).href)
    stopClipboardCapture()
    if (previous) {
      clipboard.write(previous)
      if (previousFiles.length) native?.writeFilePaths(previousFiles, { preserve: true })
    }
    native?.stop()
    app.exit(ok ? 0 : 1)
  }
}
}
mainProbe().catch(error => { console.error(error.stack); app.exit(1) })
