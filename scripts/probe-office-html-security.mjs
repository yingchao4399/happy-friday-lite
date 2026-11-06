import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { transform } from 'esbuild'
import { transformHtmlPreviewSource } from './office/html-renderer-adapter.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const file = fileURLToPath(import.meta.url)
const hash = value => createHash('sha256').update(value).digest('hex')
if (!process.versions.electron) {
  const { spawn } = await import('node:child_process')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(createRequire(import.meta.url)('electron'), [file], { cwd: root, windowsHide: true, env, stdio: 'inherit' })
  const timer = setTimeout(() => child.kill(), 180000)
  process.exitCode = await new Promise(resolve => { child.once('error', error => { console.error(error); resolve(1) }); child.once('exit', (code, signal) => { console.log(JSON.stringify({ phase: 'electron-exit', code, signal })); resolve(code ?? 1) }) })
  clearTimeout(timer)
} else {
  const { app, BrowserWindow } = await import('electron')
  app.disableHardwareAcceleration()
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'friday-html-security-')))
  const report = { ok: false, checkedAt: new Date().toISOString(), electron: process.versions.electron, steps: [], limitations: ['真实 Chromium 派生预览与 inspector 边界；最终 HTML App 的模式切换、协议与安装版另行验收。'] }
  const persist = stage => {
    report.stage = stage
    fs.writeFileSync(path.join(root, 'artifacts/office-html-security-report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ stage }))
  }
  persist('electron-main-loaded')
  // 不在 Electron ESM 入口顶层 await ready；先结束入口求值再启动验证。
  void (async () => {
  let win
  try {
    await Promise.race([app.whenReady(), new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Electron ready timeout')), 45000))])
    persist('app-ready')
    const instrumentFile = path.join(root, 'vendor/genoffice-html/apps/html/src/renderer/preview/instrument.ts')
    const source = fs.readFileSync(instrumentFile, 'utf8')
    const adapted = transformHtmlPreviewSource(source, instrumentFile)
    const compiled = await transform(adapted, { loader: 'ts', format: 'iife', globalName: 'FridayInstrument' })
    const inspector = fs.readFileSync(path.join(root, 'vendor/genoffice-html/apps/html/src/renderer/preview/inspector.js'), 'utf8')
    const html = '<!doctype html><html><head><meta http-equiv="refresh" content="0;url=https://invalid.example/"></head><body data-gx-inspector="forged"><h1>Normal editable heading</h1><script nonce="author">document.body.dataset.attacked="yes";parent.postMessage({type:"gx:htmlEditCommit",version:1,sid:1,html:"ATTACK"},"*")</script><img src="bad:" onerror="document.body.dataset.attacked=\'yes\'"><svg onload="document.body.dataset.attacked=\'yes\'"><foreignObject><iframe srcdoc="&lt;script&gt;parent.postMessage(1,\'*\')&lt;/script&gt;"></iframe></foreignObject></svg><a href="javascript:alert(1)">link</a></body></html>'
    const at = html.indexOf('<h1>')
    const map = { version: 1, elements: [{ startTag: [at, at + 4], sid: 1 }] }
    win = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><body></body></html>'))
    persist('parent-loaded')
    const wc = win.webContents
    wc.on('console-message', event => { if (event.message && !event.message.includes('Electron Security Warning')) console.log('preview-console:', event.message) })
    await wc.executeJavaScript(compiled.code + ';window.fridayBuild = FridayInstrument.instrumentForPreview; window.received=[]; window.accepted=[]; window.editing=true; window.addEventListener("message",e=>{if(e.source!==window.testFrame?.contentWindow)return;window.received.push(e.data);if(window.editing)window.accepted.push(e.data)})')
    const build = present => `window.fridayBuild(${JSON.stringify(html)},${JSON.stringify(map)},${JSON.stringify(inspector)},${present})`
    await wc.executeJavaScript(`window.testFrame=document.createElement('iframe');window.testFrame.sandbox='allow-scripts allow-forms allow-popups allow-modals';document.body.append(window.testFrame);window.testFrame.srcdoc=${build(false)}`)
    for (let attempt = 0; ; attempt++) {
      if (await wc.executeJavaScript('window.received.some(m=>m.type==="gx:ready")')) break
      assert.ok(attempt < 100, '可信 inspector 未启动')
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    const frame = wc.mainFrame.frames[0]
    const inspected = await frame.executeJavaScript('({attack:document.body.dataset.attacked,scriptCount:document.scripts.length,handlerCount:[...document.querySelectorAll("*")].flatMap(e=>[...e.attributes].filter(a=>a.name.startsWith("on"))).length,frames:document.querySelectorAll("iframe,object,embed").length,require:typeof require,api:typeof htmlApi})')
    assert.equal(inspected.attack, undefined)
    assert.equal(inspected.scriptCount, 1)
    assert.equal(inspected.handlerCount, 0)
    assert.equal(inspected.frames, 0)
    assert.equal(inspected.require, 'undefined')
    assert.equal(inspected.api, 'undefined')
    assert.equal(await wc.executeJavaScript('window.accepted.some(m=>m.type==="gx:htmlEditCommit")'), false)
    report.steps.push({ name: '作者脚本、事件处理、嵌套主动内容和刷新被隔离；可信 inspector 正常启动', inspected })
    persist('edit-isolation-passed')
    await wc.executeJavaScript('window.testFrame.contentWindow.postMessage({type:"gx:select",sid:1},"*")')
    for (let attempt = 0; ; attempt++) {
      if (await wc.executeJavaScript('window.received.some(m=>m.type==="gx:rect"&&m.sid===1)')) break
      assert.ok(attempt < 100, '正常可视选择未返回可信几何数据')
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    report.steps.push({ name: '受控 inspector 选择仍返回 sid 和几何信息' })
    // 演示原文保持脚本；父控制面不接纳该模式发来的任何编辑消息。
    const presentHtml = html.replace(/<meta http-equiv="refresh"[^>]+>/, '')
    await wc.executeJavaScript(`window.editing=false;window.received=[];window.accepted=[];window.testFrame.remove();window.testFrame=document.createElement('iframe');window.testFrame.sandbox='allow-scripts allow-forms';document.body.append(window.testFrame);window.testFrame.srcdoc=window.fridayBuild(${JSON.stringify(presentHtml)},${JSON.stringify(map)},${JSON.stringify(inspector)},true)`)
    for (let attempt = 0; ; attempt++) {
      if (await wc.executeJavaScript('window.received.some(m=>m.type==="gx:htmlEditCommit")')) break
      assert.ok(attempt < 100, '演示作者脚本未正常运行')
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.equal(await wc.executeJavaScript('window.accepted.length'), 0)
    report.steps.push({ name: '演示保留作者脚本，伪造编辑消息全部不被接纳', sourceSha256: hash(html), adaptedModuleSha256: hash(adapted) })
    report.ok = true
  } catch (error) { report.error = error.stack || String(error); console.error(report.error) }
  finally {
    fs.writeFileSync(path.join(root, 'artifacts/office-html-security-report.json'), JSON.stringify(report, null, 2))
    if (win && !win.isDestroyed()) win.destroy()
    app.exit(report.ok ? 0 : 1)
  }
  })()
}
