// 使用真正 NoteEditor、Electron 指针与 ECharts 验收编辑、取消、保存重开和缩放。
import { app, BrowserWindow, ipcMain } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'
import { chartKinds } from '../src/views/note/chart-model.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-chart-'))
app.setPath('userData', path.join(temp, 'profile'))
app.on('window-all-closed', () => {})
let win, harnessDir, server
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const run = code => win.webContents.executeJavaScript(code, true)
async function until(code) { for (let i = 0; i < 300; i++) { if (await run(code)) return; await pause(50) } throw new Error('图表验收超时: ' + code) }
async function click(selector, count = 1) {
  const point = await run(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e)throw new Error('找不到控件'); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)} })()`)
  for (let i = 1; i <= count; i++) { win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: i, ...point }); win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: i, ...point }) }
  await pause(180)
}
async function replace(selector, value) {
  await click(selector)
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] })
  await pause(80); win.webContents.insertText(value); await pause(180)
}
const chartAttributes = () => run(`(() => { const d=document.createElement('div'); d.innerHTML=window.emittedNote; const c=d.querySelector('[data-note-chart]');return Object.fromEntries([...c.attributes].map(a=>[a.name,a.value])); })()`)

async function main() {
  let ok = false
  const timer = setTimeout(() => app.exit(1), 240000)
  try {
    harnessDir = fs.mkdtempSync(path.join(root, 'note-chart-probe-'))
    fs.writeFileSync(path.join(harnessDir, 'note.json'), JSON.stringify({ content: '<h1 data-note-title="true">图表验收</h1><p>双击图表编辑；在正文内拖动调整大小。</p><div data-note-chart="true" kind="bar" title="图表验收" width="620" height="320"></div><p>正文保留</p>' }))
    fs.writeFileSync(path.join(harnessDir, 'index.html'), `<!doctype html><html lang="zh"><meta charset="utf-8"><body><div id="app"></div><script type="module">
import { createApp,h,ref } from 'vue'
import { createPinia } from 'pinia'
import { createRouter,createMemoryHistory } from 'vue-router'
import { i18n } from '/src/i18n/index.js'
import NoteEditor from '/src/views/note/NoteEditor.vue'
import '/src/assets/styles/main.css'
async function mount(){
const initial=await window.electronAPI.invoke('get_note',{noteId:'probe'}),content=ref(initial.content)
window.emittedNote=initial.content
const router=createRouter({history:createMemoryHistory(),routes:[{path:'/',component:{render:()=>null}}]})
createApp({setup:()=>()=>h(NoteEditor,{modelValue:content.value,'onUpdate:modelValue':value=>{content.value=value;window.emittedNote=value}})}).use(createPinia()).use(router).use(i18n).mount('#app')
}
mount()
</script><style>html,body,#app{height:100%;margin:0;background:var(--bg-primary)}</style></body></html>`)
    ipcMain.handle('kb-get-data-dir', () => null)
    ipcMain.handle('get_note', () => JSON.parse(fs.readFileSync(path.join(harnessDir, 'note.json'), 'utf8')))
    win = new BrowserWindow({ show: false, width: 1280, height: 1000, webPreferences: { offscreen: true, backgroundThrottling: false, preload: path.join(root, 'preload.cjs'), contextIsolation: true } })
    win.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message.slice(0, 500)) })
    const { build } = await import('vite')
    const site = path.join(harnessDir, 'site')
    await build({ configFile: path.join(root, 'vite.config.js'), build: { outDir: site, emptyOutDir: true, rollupOptions: { input: path.join(harnessDir, 'index.html') } } })
    const entry = fs.readdirSync(site, { recursive: true }).find(file => file.endsWith('index.html'))
    console.log('验收页面已构建', entry)
    win.webContents.on('dom-ready', () => console.log('验收页面 DOM 已就绪'))
    await win.loadFile(path.join(site, entry))
    console.log('验收页面已加载')
    await until('Boolean(document.querySelector(".note-chart-node .chart-plot svg"))')
    await click('.note-chart-title', 2)
    await until('Boolean(document.querySelector(".chart-editor-layout"))')
    const rendered = []
    for (const kind of chartKinds) {
      await run(`(() => {const s=document.querySelector('[data-chart-input="kind"]');s.value=${JSON.stringify(kind)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`)
      await until(`document.querySelector('.chart-live-preview .note-chart-canvas')?.dataset.chartKind===${JSON.stringify(kind)}&&document.querySelector('.chart-live-preview .note-chart-canvas')?.dataset.chartReady==='true'`)
      assert.equal(await run('Boolean(document.querySelector(".chart-live-preview .error"))'), false)
      if (['table','stemLeaf'].includes(kind)) assert.ok(await run('document.querySelectorAll(".chart-live-preview tbody tr").length') >= 1)
      else assert.ok(await run('document.querySelector(".chart-live-preview svg").innerHTML.length') > 300)
      rendered.push(kind)
      console.log('图表已绘制', kind)
    }
    await run(`(() => {const s=document.querySelector('[data-chart-input="kind"]');s.value='scatter';s.dispatchEvent(new Event('change',{bubbles:true}));})()`)
    await replace('[data-chart-input="title"]', '真实 X 与系列')
    await click('.chart-data-heading button')
    const data = [{ label: '观测A', x: -20, value: -4, series: '实验组', error: 2, source: '来源A' }, { label: '观测B', x: 200, value: 9, series: '对照组', samples: [3, 5, 9] }]
    await replace('.chart-json', JSON.stringify(data))
    await click('[data-chart-apply]')
    await until('!document.querySelector(".chart-editor-layout")&&window.emittedNote?.includes("真实 X")')
    let attrs = await chartAttributes()
    const savedData = JSON.parse(attrs.data)
    assert.equal(savedData[0].x, -20); assert.equal(savedData[1].series, '对照组'); assert.deepEqual(savedData[1].samples, [3, 5, 9])
    await click('.note-chart-title', 2)
    await replace('[data-chart-input="title"]', '这个标题应被取消')
    await click('.dialog footer button')
    assert.equal((await chartAttributes()).title, '真实 X 与系列')
    await click('.note-chart-node')
    await until('Boolean(document.querySelector(".chart-resize-handle"))')
    const before = await run('document.querySelector(".note-chart-node").getBoundingClientRect().width')
    const p = await run(`(() => {const r=document.querySelector('.chart-resize-handle').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', ...p })
    for (let i = 1; i <= 8; i++) { win.webContents.sendInputEvent({ type: 'mouseMove', button: 'left', x: p.x - i * 15, y: p.y - i * 8 }); await pause(25) }
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', x: p.x - 120, y: p.y - 64 }); await pause(250)
    const after = await run('document.querySelector(".note-chart-node").getBoundingClientRect().width')
    assert.ok(before - after >= 100, JSON.stringify({ before, after }))
    attrs = await chartAttributes(); assert.equal(attrs.responsive, 'false')
    fs.writeFileSync(path.join(harnessDir, 'note.json'), JSON.stringify({ content: await run('window.emittedNote') }))
    await win.reload(); await until('Boolean(document.querySelector(".note-chart-node .chart-plot svg"))')
    assert.ok(Math.abs(after - await run('document.querySelector(".note-chart-node").getBoundingClientRect().width')) < 2)
    await click('.note-chart-node', 2)
    assert.equal(await run('document.querySelector(".chart-settings .check input").checked'), false)
    assert.equal(await run('document.querySelector("[data-chart-input=title]").value'), '真实 X 与系列')
    const report = { ok: true, actualNodeEditor: true, rendered, preservedXYAndSeriesAndSamples: true, cancelPreservesData: true, pointerResize: { before, after }, savedAndReloaded: true, generatedAt: new Date().toISOString() }
    fs.mkdirSync(path.join(root, 'app-data/diagnostics'), { recursive: true })
    fs.writeFileSync(path.join(root, 'app-data/diagnostics/note-chart.json'), JSON.stringify(report, null, 2))
    fs.writeFileSync(path.join(root, 'app-data/diagnostics/note-chart-editor.png'), (await win.webContents.capturePage()).toPNG())
    console.log(JSON.stringify(report)); ok = true
  } catch (error) {
    console.error(error.stack)
    if (win && !win.isDestroyed()) { fs.writeFileSync(path.join(root, 'app-data/diagnostics/note-chart-failure.png'), (await win.webContents.capturePage()).toPNG()); console.error(await run('document.body?.innerText.slice(-1800)')) }
  } finally {
    clearTimeout(timer); if (win && !win.isDestroyed()) win.destroy(); if(server) await new Promise(resolve => server.close(resolve)); if (harnessDir) removePathNoFollowSync(harnessDir, { root }); app.exit(ok ? 0 : 1)
  }
}
app.whenReady().then(main)
