import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const background = app.commandLine.hasSwitch('test-background')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-lifecycle-'))
app.commandLine.appendSwitch('friday-data-dir', directory)
fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify({ language: 'zh-CN', clipboard: { trayEnabled: background, closeToTray: background, shortcutEnabled: false, captureEnabled: false, captureRecordings: false } }))
// 完整应用启动、真实 preload/IPC 和退出事件；所有测试窗口强制隐藏，不改变用户前台。
app.on('browser-window-created', (_event, window) => { window.show = () => {}; window.focus = () => {} })
let checked = false
const deadline = setTimeout(() => { process.stderr.write('完整应用退出验收超时\n'); app.exit(1) }, 60_000)
app.on('will-quit', () => {
  clearTimeout(deadline)
  if (!checked) { process.stderr.write('尚未完成验收即退出\n'); process.exitCode = 1 }
  else process.stdout.write(JSON.stringify({ ok: true, fullApplication: true, isolatedProfile: true, background, hiddenQuickDoesNotPreventExit: !background, closeToTrayAndExplicitQuit: background }) + '\n')
})

await import('../main.js')
async function verify() {
  try {
    let main
    for (let i = 0; i < 150; i++) {
      main = BrowserWindow.getAllWindows()[0]
      if (main && !main.webContents.isLoading() && await main.webContents.executeJavaScript('Boolean(window.electronAPI && document.querySelector(".app-container"))').catch(() => false)) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.ok(main)
    const result = await main.webContents.executeJavaScript("window.electronAPI.invoke('clipboard-quick-open')")
    assert.notEqual(result?.ok, false)
    const quick = BrowserWindow.getAllWindows().find(window => window !== main)
    assert.ok(quick, '实际创建浮窗')
    quick.hide()
    assert.equal(quick.isVisible(), false)
    if (!background) main.once('closed', () => { checked = true })
    main.close()
    if (background) {
      await new Promise(resolve => setTimeout(resolve, 100))
      assert.equal(main.isDestroyed(), false)
      assert.equal(main.isVisible(), false)
      const state = await main.webContents.executeJavaScript("window.electronAPI.invoke('clipboard-desktop-state')")
      assert.equal(state.trayAvailable, true)
      checked = true; app.quit()
    } else {
      for (let i = 0; i < 100 && !main.isDestroyed(); i++) await new Promise(resolve => setTimeout(resolve, 20))
      assert.equal(main.isDestroyed(), true)
    }
  } catch (error) { process.stderr.write(error.stack + '\n'); clearTimeout(deadline); app.exit(1) }
}
app.whenReady().then(verify)
