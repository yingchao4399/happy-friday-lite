import { app, BrowserWindow, Menu, clipboard } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as db from '../src-electron/db.js'
import { setDataDir } from '../src-electron/config.js'
import { installEditContextMenu } from '../src-electron/edit-context-menu.js'
import { registerClipboardCommands, startClipboardCapture, stopClipboardCapture, captureInternalClipboard } from '../src-electron/clipboard.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-edit-clipboard-'))
app.setPath('userData', path.join(data, 'profile'))
let win, ok = false, openedMenu
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const deadline = setTimeout(() => app.exit(1), 30000)

async function main() {
  const previous = { text: clipboard.readText(), html: clipboard.readHTML(), image: clipboard.readImage() }
  const popup = Menu.prototype.popup
  try {
    setDataDir(data); db.setDataDir(data); await db.initDb()
    win = new BrowserWindow({ show: false, width: 700, height: 500, webPreferences: { preload: path.join(root, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
    registerClipboardCommands(win); startClipboardCapture(win)
    installEditContextMenu(win.webContents, { captureClipboard: captureInternalClipboard })
    Menu.prototype.popup = function () { openedMenu = this }
    const wc = win.webContents
    await win.loadURL('data:text/html,<html><body><div id="editor" contenteditable="true" style="padding:40px">Friday copy acceptance</div><script>document.querySelector("%23editor")</script></body></html>')
    const select = text => wc.executeJavaScript(`(() => { const e=document.querySelector('#editor'); e.textContent=${JSON.stringify(text)}; e.focus(); const r=document.createRange(); r.selectNodeContents(e); const s=getSelection(); s.removeAllRanges(); s.addRange(r) })()`)
    async function captured(text) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = db.queryAllRaw('SELECT payload FROM clipboard_items')
        if (rows.some(row => JSON.parse(row.payload).plainText === text)) return
        await sleep(30)
      }
      throw new Error('应用内复制未进入剪贴板历史')
    }
    await select('Friday copy acceptance')
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'C', modifiers: ['control'] })
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'C', modifiers: ['control'] })
    await captured('Friday copy acceptance')
    await select('Friday cut acceptance')
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'X', modifiers: ['control'] })
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'X', modifiers: ['control'] })
    await captured('Friday cut acceptance')
    assert.equal(await wc.executeJavaScript('document.querySelector("#editor").textContent'), '')
    await select('Friday menu acceptance')
    wc.sendInputEvent({ type: 'mouseDown', x: 100, y: 58, button: 'right', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x: 100, y: 58, button: 'right', clickCount: 1 })
    for (let attempt = 0; attempt < 100 && !openedMenu; attempt++) await sleep(20)
    assert.ok(openedMenu, '正文原生右键菜单必须出现')
    const copy = openedMenu.items.find(item => item.label === Menu.buildFromTemplate([{ role: 'copy' }]).items[0].label)
    assert.ok(copy?.enabled)
    copy.click()
    await captured('Friday menu acceptance')
    await sleep(100)
    const stored = db.queryAllRaw('SELECT payload FROM clipboard_items').map(row => JSON.parse(row.payload))
    assert.ok(stored.every(item => ['Friday copy acceptance', 'Friday cut acceptance', 'Friday menu acceptance'].includes(item.plainText)), '不得抢先收录此前外部剪贴板内容')
    assert.equal(stored.length, 3, '同一次复制的多入口通知必须去重')
    ok = true
    console.log(JSON.stringify({ ok: true, checks: ['keyboard-copy', 'keyboard-cut', 'body-context-menu', 'menu-copy-history'], clipboardItems: db.queryAllRaw('SELECT count(*) AS n FROM clipboard_items')[0].n }))
  } catch (error) { console.error(error.stack) }
  finally {
    clearTimeout(deadline); Menu.prototype.popup = popup
    clipboard.write(previous)
    stopClipboardCapture(); if (win && !win.isDestroyed()) win.destroy(); db.closeDb()
    app.exit(ok ? 0 : 1)
  }
}
app.whenReady().then(main)
