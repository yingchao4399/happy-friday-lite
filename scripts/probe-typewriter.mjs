// 独立 Electron 验收，使用临时用户目录，不启动或改动用户正在使用的实例。
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { registerTypewriterTerminalCommands } from '../src-electron/typewriter-terminal.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-typewriter-'))
app.setPath('userData', profile)
app.on('window-all-closed', () => {})
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
let win, server
const run = code => win.webContents.executeJavaScript(code, true)
async function until(code, timeout = 12000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (await run(code)) return; await pause(80) }
  throw new Error('验收超时: ' + code)
}
app.whenReady().then(async () => {
  const timer = setTimeout(() => app.exit(1), 60000)
  let ok = false
  const entry = path.join(root, 'typewriter-probe.html')
  const errors = []
  try {
    fs.writeFileSync(entry, `<!doctype html><meta charset="utf-8"><div id="app"></div>
<style>html,body,#app{height:100%;margin:0}#app{position:relative}</style>
<script type="module">
import{createApp,h}from'vue';import{createPinia}from'pinia';import{ i18n }from'/src/i18n/index.js';
import Stage from'/src/views/typewriter/components/TypewriterStage.vue';
import{defaultSettings}from'/src/features/typewriter/nocturne-core/app/nocturne/settings.ts';
import{on}from'/src/features/typewriter/nocturne-core/lib/nocturne/bus.ts';
window.probe={keys:0,nativeKeys:0,cursors:[],audio:0};window.addEventListener('keydown',()=>probe.nativeKeys++);
import{activeTerminalText}from'/src/features/typewriter/nocturne-core/lib/nocturne/terminal-bridge.ts';window.readScreen=()=>activeTerminalText('screen');
on('key',()=>probe.keys++);on('cursor',f=>{probe.cursors.push(f.col)});
const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){if(this.context instanceof AudioContext)probe.audio++;return start.apply(this,args)};
createApp({render:()=>h(Stage,{settings:defaultSettings(),onSession:id=>probe.session=id})}).use(createPinia()).use(i18n).mount('#app');
</script>`)
    const site = path.join(profile, 'site')
    await build({ root, configFile: false, plugins: [vue()], resolve: { alias: { '@': path.join(root, 'src') } }, base: './', logLevel: 'error', build: { outDir: site, rollupOptions: { input: entry }, minify: false } })
    win = new BrowserWindow({ show: false, width: 1400, height: 1000, webPreferences: { backgroundThrottling: false, preload: path.join(root, 'preload.cjs'), contextIsolation: true } })
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message.slice(0, 1200)) })
    registerTypewriterTerminalCommands(win)
    await win.loadFile(path.join(site, 'typewriter-probe.html'))
    await until('Boolean(document.querySelector(".xterm-helper-textarea"))')
    await pause(2500)
    await run('document.querySelector(".xterm-helper-textarea").focus()')
    for (const keyCode of ['e','c','h','o',' ','F','R','I','D','A','Y']) {
      win.webContents.sendInputEvent({type:'keyDown',keyCode});
      win.webContents.sendInputEvent({type:'char',keyCode});
      win.webContents.sendInputEvent({type:'keyUp',keyCode});
      await pause(35)
    }
    await pause(1000)
    const evidence = await run('({keys:probe.keys,nativeKeys:probe.nativeKeys,audio:probe.audio,cursors:probe.cursors.slice(-20),text:readScreen()})')
    console.log(JSON.stringify({evidence,errors}))
    assert.ok(evidence.keys > 0, '真实键盘输入没有触发原作击键事件')
    assert.ok(evidence.audio > 0, '真实键盘输入没有播放声音')
    assert.ok(new Set(evidence.cursors).size > 2, '真实键盘输入没有移动机头光标')
    ok = true
  } catch (error) { console.error(error.stack); console.error(JSON.stringify(errors)) }
  finally {
    clearTimeout(timer)
    if (win && !win.isDestroyed()) win.destroy()
    if (server) await server.close()
    if (fs.existsSync(entry)) fs.unlinkSync(entry)
    app.exit(ok ? 0 : 1)
  }
})
