import { app, BrowserWindow, dialog } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { setDataDir } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import { initOfficeSession } from '../src-electron/office/office-session.js'
import { registerOfficeIpc } from '../src-electron/office/office-ipc.js'
import { getOfficeUiTarget, shutdownOfficeHost, openOfficeFile, queryOfficeDirty, setOfficeContentBounds } from '../src-electron/office/office-host.js'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-office-menu-'))
const source = path.join(dataDir, '当前文档.docx')
fs.copyFileSync(path.join(root, 'vendor', 'happyoffice', 'fixtures', 'generated', 'kitchen-sink.docx'), source)
const hash = filename => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex')
const sourceHash = hash(source)
app.setPath('userData', path.join(dataDir, 'profile'))
app.on('window-all-closed', () => {})
let win, wc, nextDialog, nextMessage
const originalSave = dialog.showSaveDialog
const originalMessage = dialog.showMessageBox
dialog.showSaveDialog = async (...args) => {
  assert.ok(nextDialog, '不允许验收过程中出现未计划的保存对话框')
  const response = nextDialog; nextDialog = null
  return response
}
dialog.showMessageBox = async (...args) => {
  assert.ok(nextMessage, '不允许验收过程中出现未计划的消息对话框')
  const response = nextMessage; nextMessage = null
  return response
}
const run = code => wc.executeJavaScript(code, true)
async function until(check, label) {
  for (let i = 0; i < 300; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error('Office 菜单状态超时: ' + label)
}
async function menu(command) {
  await run(`(() => { const button=document.querySelector('.ribbon-tab-file'); button.focus(); button.click(); })()`)
  await until(() => run(`Boolean(document.querySelector('[data-office-file-action=${JSON.stringify(command)}]'))`), command)
  await run(`document.querySelector('[data-office-file-action=${JSON.stringify(command)}]').click()`)
}
async function exportViaMenu(format, response) {
  nextDialog = response
  await menu('export')
  await run(`document.querySelector('[data-office-file-action="export:${format}"]').click()`)
  await until(() => !nextDialog, '保存对话框')
}

async function main() {
  const interactive = process.argv.includes('--interactive')
  const deadline = setTimeout(() => app.exit(1), interactive ? 1200000 : 120000)
  let ok = false
  try {
    setDataDir(dataDir); db.setDataDir(dataDir); await db.initDb()
    win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { sandbox: true } })
    assert.equal(await initOfficeSession(win), true)
    registerOfficeIpc()
    const layout = () => { const [width, height] = win.getContentSize(); setOfficeContentBounds({ x: 0, y: 0, width, height }) }
    win.on('resize', layout); layout()
    const opened = await openOfficeFile(source)
    assert.equal(opened.success, true)
    wc = getOfficeUiTarget().webContents
    await until(() => run('Boolean(window.__aidocs?.editor)'), 'editor')
    await until(() => run('window.__aidocs.editor.state.doc.content.size > 10'), '正文')
    await run('window.__aidocs.whenReady()')
    await run(`window.__aidocs.editor.commands.insertContentAt(1, '<h1>FRIDAY_UNSAVED_EXPORT</h1><p>未保存正文，必须进入导出副本。</p>')`)
    assert.equal(await run('window.__aidocs.editor.getText().includes("FRIDAY_UNSAVED_EXPORT")'), true, '先确认修改实际进入编辑器')
    assert.equal(await queryOfficeDirty(opened.viewId), true)
    for (const format of ['txt', 'md', 'docx']) {
      const target = path.join(dataDir, '导出.' + format)
      await exportViaMenu(format, { canceled: false, filePath: target })
      await until(() => fs.existsSync(target), format + '文件写入')
      await until(() => run('!document.querySelector(".file-menu") && !document.body.innerText.includes("正在导出…")'), '完成状态')
      if (format !== 'docx') assert.ok(fs.readFileSync(target, 'utf8').includes(format === 'md' ? 'FRIDAY\\_UNSAVED\\_EXPORT' : 'FRIDAY_UNSAVED_EXPORT'), format + '必须包含未保存正文')
      else {
        const { default: AdmZip } = await import('adm-zip')
        assert.ok(new AdmZip(target).readAsText('word/document.xml').includes('FRIDAY_UNSAVED_EXPORT'))
      }
    }
    assert.equal(hash(source), sourceHash, '导出不能保存或覆盖源文件')
    assert.equal(await queryOfficeDirty(opened.viewId), true, '导出不能清除未保存标记')
    await exportViaMenu('txt', { canceled: true })
    await until(() => run('document.body.innerText.includes("已取消导出")'), '取消状态')
    await exportViaMenu('docx', { canceled: false, filePath: source })
    await until(() => run('document.body.innerText.includes("不能覆盖当前源文件")'), '拒绝源文件覆盖')
    assert.equal(hash(source), sourceHash)
    await menu('options')
    await until(() => run('Boolean(document.querySelector(".office-options"))'), '选项弹窗')
    await until(() => run('!document.querySelector(".office-options .primary").disabled'), '选项加载')
    await run(`(() => { const dialog=document.querySelector('.office-options'); dialog.querySelectorAll('input')[2].click(); const select=dialog.querySelector('select'); select.value='dark'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`)
    await run(`document.querySelector('.office-options .primary').click()`)
    await until(() => run('!document.querySelector(".office-options")'), '选项持久化')
    const prefs = JSON.parse(fs.readFileSync(path.join(dataDir, 'profile', 'app-settings.json'), 'utf8'))
    assert.equal(prefs.autoSaveDefault, true)
    assert.equal(prefs.theme, 'dark')
    await menu('export')
    win.showInactive()
    await new Promise(resolve => setTimeout(resolve, 250))
    fs.mkdirSync(path.join(root, 'app-data', 'diagnostics'), { recursive: true })
    fs.writeFileSync(path.join(root, 'app-data', 'diagnostics', 'office-file-menu-word.png'), (await wc.capturePage()).toPNG())
    wc.focus()
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'End' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'End' })
    await until(() => run('document.activeElement?.getAttribute("data-office-file-action")==="close"'), 'End 导航到末项')
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Home' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Home' })
    await until(() => run('document.activeElement?.getAttribute("data-office-file-action")==="new"'), 'Home 导航到首项')
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await until(() => run('!document.querySelector("[role=menu]")'), 'Escape 关闭菜单')
    assert.equal(await run('document.activeElement?.matches(".ribbon-tab-file")'), true, '关闭后焦点回到文件按钮')
    win.setSize(760, 820); layout()
    await until(() => run('window.innerWidth < 800'), '嵌入编辑器随窗口缩放')
    await menu('options')
    await until(() => run('Boolean(document.querySelector(".office-options"))'), '窄窗口选项')
    const placement = await run(`(() => { const dialog=document.querySelector('.office-options'), box=dialog.getBoundingClientRect(); const label=dialog.querySelector('label'), input=label.querySelector('input'); return { inside:box.left>=0 && box.right<=innerWidth && box.top>=0 && box.bottom<=innerHeight, labelDisplay:getComputedStyle(label).display, inputHeight:input.getBoundingClientRect().height } })()`)
    assert.equal(placement.inside, true, '弹窗必须位于实际编辑器视口内')
    assert.equal(placement.labelDisplay, 'flex', '复选框和文字同排，不能被原版通用 modal 样式覆盖')
    assert.ok(placement.inputHeight < 20)
    await new Promise(resolve => setTimeout(resolve, 200))
    fs.writeFileSync(path.join(root, 'app-data', 'diagnostics', 'office-options-word-narrow-dark.png'), (await wc.capturePage()).toPNG())
    await run(`document.querySelector('.office-options .modal-actions button').click()`)
    await run(`window.fridayOffice.preferences({theme:'light'})`)
    await menu('options')
    await until(() => run('document.querySelector(".office-options select")?.value==="light"'), '浅色选项已加载')
    await new Promise(resolve => setTimeout(resolve, 200))
    fs.writeFileSync(path.join(root, 'app-data', 'diagnostics', 'office-options-word-narrow-light.png'), (await wc.capturePage()).toPNG())
    await run(`document.querySelector('.office-options .modal-actions button').click()`)
    await run(`window.fridayOffice.preferences({theme:'dark'})`)
    ok = true
    console.log(JSON.stringify({ ok, realPreloadIPC: true, unsavedDocxTxtMd: true, sourceUnchanged: true, dirtyPreserved: true, cancel: true, rejectSourceOverwrite: true, optionsPersisted: true, menuEscape: true }))
    if (interactive) {
      win.on('page-title-updated', event => event.preventDefault())
      win.setTitle('Friday Office UI 验收（隔离数据）')
      win.show()
      console.log('INTERACTIVE_READY')
      await new Promise(resolve => win.once('closed', resolve))
    }
  } catch (error) { console.error(error.stack); process.exitCode = 1 }
  finally {
    clearTimeout(deadline)
    dialog.showSaveDialog = originalSave; dialog.showMessageBox = originalMessage
    shutdownOfficeHost(); db.closeDb()
    if (win && !win.isDestroyed()) win.destroy()
    try { removePathNoFollowSync(dataDir, { root: os.tmpdir() }) } catch {}
    app.exit(ok ? 0 : 1)
  }
}
app.whenReady().then(main).catch(() => app.exit(1))
