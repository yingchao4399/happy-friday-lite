// 独立数据库与生成文档；真实鼠标打开正文菜单，验证系统复制和编辑历史。
import { app, BrowserWindow, clipboard } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { setDataDir } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import { initOfficeHost, openOfficeFile, getOfficeUiTarget, setOfficeContentBounds, shutdownOfficeHost } from '../src-electron/office/office-host.js'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-docs-context-'))
app.setPath('userData', path.join(data, 'profile'))
app.on('window-all-closed', () => {})
let win, wc
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const run = code => wc.executeJavaScript(code, true)
async function until(check, label) {
  for (let i = 0; i < 300; i++) { if (await check()) return; await pause(100) }
  throw new Error('正文菜单验收超时: ' + label)
}
async function openMenu(preserveSelection = false) {
  await run('window.__aidocs.editor.commands.focus();' + (preserveSelection ? '' : 'window.__aidocs.editor.commands.setTextSelection(2)'))
  const point = await run('(() => { const r=window.__aidocs.editor.view.coordsAtPos(2);return {x:Math.round(r.left+2),y:Math.round((r.top+r.bottom)/2)} })()')
  wc.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...point })
  wc.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...point })
  await until(() => run('Boolean(document.querySelector(".ctx-menu"))'), '真实右键')
}
async function command(labels) {
  await run('(() => { const labels=' + JSON.stringify(labels) + ';const button=[...document.querySelectorAll(".ctx-menu .ctx-item")].find(b=>labels.includes(b.querySelector(".ctx-label")?.textContent));if(!button||button.disabled)throw new Error("命令不可用: "+labels);button.click() })()')
  await until(() => run('!document.querySelector(".ctx-menu")'), '命令关闭菜单')
}
async function main() {
  let ok = false
  const timer = setTimeout(() => app.exit(1), 150000)
  try {
    setDataDir(data); db.setDataDir(data); await db.initDb()
    const source = path.join(data, '正文菜单.docx')
    fs.copyFileSync(path.join(root, 'vendor/happyoffice/fixtures/generated/kitchen-sink.docx'), source)
    const digest = () => crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex')
    const originalHash = digest()
    win = new BrowserWindow({ show: true, width: 1280, height: 900, title: 'Friday Word 正文菜单验收（隔离数据）', webPreferences: { sandbox: true } })
    assert.equal(await initOfficeHost(win), true)
    const layout = () => { const [width, height] = win.getContentSize(); setOfficeContentBounds({ x: 0, y: 0, width, height }) }
    win.on('resize', layout); layout()
    assert.equal((await openOfficeFile(source)).success, true)
    wc = getOfficeUiTarget().webContents
    await until(() => run('Boolean(window.__aidocs?.editor?.state.doc.content.size > 10)'), '正文就绪')
    await run('window.__aidocs.whenReady()')
    const originalText = await run('window.__aidocs.editor.getText()')
    const originalPlain = await run('window.__aidocs.editor.state.doc.textBetween(0,window.__aidocs.editor.state.doc.content.size,"\\n\\n")')
    const checkGallery = async () => {
      await pause(200)
      const gallery = await run('(() => { const el=document.querySelector(".style-gallery"),r=el.getBoundingClientRect(),cards=[...el.children],visible=cards.filter(c=>{const a=c.getBoundingClientRect();return a.top>=r.top-.5 && a.bottom<=r.bottom+.5});return {visible:visible.length,total:cards.length,whole:visible.every(c=>{const a=c.getBoundingClientRect();return a.left>=r.left-.5&&a.right<=r.right+.5}),more:Boolean(document.querySelector(".style-gallery-more"))} })()')
      assert.ok(gallery.visible > 0 && gallery.whole, JSON.stringify(gallery))
      assert.equal(gallery.more, gallery.visible < gallery.total, JSON.stringify(gallery))
    }
    await checkGallery()
    await openMenu()
    await command(['全选', 'Select All'])
    const selected = await run('(() => {const e=window.__aidocs.editor;return e.state.doc.textBetween(e.state.selection.from,e.state.selection.to,"\\n\\n")})()')
    assert.equal(selected, originalPlain, '全选应覆盖完整正文')
    // 全选后不重开菜单，直接真实键盘复制，校验系统剪贴板。
    wc.focus()
    await run('window.__aidocs.editor.view.focus()')
    await pause(100)
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'C', modifiers: ['control'] })
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'C', modifiers: ['control'] })
    await until(() => clipboard.readText().replace(/\s/g, '').includes(originalPlain.replace(/\s/g, '').slice(0, 40)), '系统复制全文')
    clipboard.writeText('FRIDAY_COPY_MENU_SENTINEL')
    await openMenu(true)
    await command(['复制', 'Copy'])
    await until(() => clipboard.readText().replace(/\s/g, '').includes(originalPlain.replace(/\s/g, '').slice(0, 40)), '右键复制全文')
    await run('window.__aidocs.editor.commands.setTextSelection(1);window.__aidocs.editor.view.focus()')
    await wc.insertText('FRIDAY_CONTEXT_HISTORY ')
    assert.equal(await run('window.__aidocs.editor.getText().includes("FRIDAY_CONTEXT_HISTORY")'), true)
    await openMenu(); await command(['撤销', 'Undo'])
    assert.equal(await run('window.__aidocs.editor.getText()'), originalText)
    await openMenu(); await command(['恢复', '重做', 'Redo'])
    assert.equal(await run('window.__aidocs.editor.getText().includes("FRIDAY_CONTEXT_HISTORY")'), true)
    await openMenu(); await command(['查找', 'Find'])
    await until(() => run('Boolean(document.querySelector(".find-panel"))'), '查找面板')
    win.setSize(760, 700); await pause(200)
    await checkGallery()
    await run('document.documentElement.setAttribute("data-theme","dark")')
    await run('window.__aidocs.editor.setEditable(false)')
    await openMenu()
    const readonly = await run('(() => {const labels=["剪切","粘贴","仅粘贴文本","撤销","恢复","重做","字体…","段落…","超链接…","新建批注","Cut","Paste","Paste as Plain Text","Undo","Redo","Font…","Paragraph…","Hyperlink…","New Comment"];return [...document.querySelectorAll(".ctx-menu .ctx-item")].filter(b=>labels.includes(b.querySelector(".ctx-label")?.textContent)).map(b=>({label:b.querySelector(".ctx-label").textContent,disabled:b.disabled,reason:b.title}))})()')
    assert.ok(readonly.length >= 7)
    assert.ok(readonly.every(item => item.disabled && item.reason), JSON.stringify(readonly))
    const bounds = await run('(() => {const r=document.querySelector(".ctx-menu").getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:innerWidth,height:innerHeight}})()')
    assert.ok(bounds.top >= 0 && bounds.left >= 0 && bounds.bottom <= bounds.height && bounds.right <= bounds.width, JSON.stringify(bounds))
    fs.writeFileSync(path.join(root, 'app-data/diagnostics/docs-context-menu-readonly.png'), (await wc.capturePage()).toPNG())
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'ESC' })
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'ESC' })
    await until(() => run('!document.querySelector(".ctx-menu")'), 'Esc 关闭')
    assert.equal(digest(), originalHash)
    console.log(JSON.stringify({ ok: true, realRightClick: true, selectAllCopy: true, history: true, find: true, readOnly: true, narrowDark: true, wholeStyleCards: true, sourceUnchanged: true }))
    ok = true
  } catch (error) { console.error(error.stack) }
  finally {
    clearTimeout(timer); shutdownOfficeHost(); db.closeDb()
    if (win && !win.isDestroyed()) win.destroy()
    try { removePathNoFollowSync(data, { root: os.tmpdir() }) } catch {}
    app.exit(ok ? 0 : 1)
  }
}
app.whenReady().then(main).catch(error => { console.error(error.stack); app.exit(1) })
