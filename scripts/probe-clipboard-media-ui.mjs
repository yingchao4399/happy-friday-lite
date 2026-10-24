import { app, BrowserWindow, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { setDataDir, saveConfig } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import { registerClipboardCommands, stopClipboardCapture, listClipboardItems, getClipboardImage, createClipboardShareForItem } from '../src-electron/clipboard.js'
import { storeClipboardPng } from '../src-electron/clipboard-media.js'
import { startShareServer, stopShareServer } from '../src-electron/shareServer.js'

// 独立临时数据与隐藏窗口，验证真实 Canvas / Chromium 解码器 / preload / IPC。
const root = fileURLToPath(new URL('../', import.meta.url))
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-media-ui-'))
app.setPath('userData', path.join(data, 'profile'))
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.on('window-all-closed', () => {})
let win, harnessDir
const previousExternal = shell.openExternal, opened = []
const deadline = setTimeout(() => { console.error('图片与媒体验收超时'); app.exit(1) }, 100_000)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const run = code => win.webContents.executeJavaScript(code)
async function until(code) {
  for (let i = 0; i < 120; i++) { if (await run(code)) return; await wait(40) }
  throw new Error('未达到状态: ' + code)
}
async function click(text, scope = 'last-dialog') {
  await run(`(() => { const root=${scope === 'document' ? 'document' : '[...document.querySelectorAll("[role=dialog]")].at(-1)'}; const b=[...root.querySelectorAll('button')].find(n=>n.textContent.trim()===${JSON.stringify(text)}); if(!b||b.disabled)throw new Error('按钮不可用:'+${JSON.stringify(text)});b.click() })()`)
}
async function openItem(id) {
  await run(`document.querySelectorAll('[role=dialog] header button').forEach(b=>b.click())`)
  await until('!document.querySelector("[role=dialog]")')
  const entry = listClipboardItems().find(item => item.id === id)
  const text = entry.sourceApp === 'friday-merge' ? 'friday-merge' : entry.plainText || '媒体验收-' + id
  await run(`(() => { const input=document.querySelector('input[type=search]');input.value=${JSON.stringify(text)};input.dispatchEvent(new Event('input',{bubbles:true})) })()`)
  await until('[...document.querySelectorAll(".clipboard-row")].some(row=>row.dataset.clipboardId===' + JSON.stringify(id) + ')')
  await run('[...document.querySelectorAll(".clipboard-row")].find(row=>row.dataset.clipboardId===' + JSON.stringify(id) + ').click()')
  await until('document.querySelector("[role=dialog]")')
}
async function stroke(from, to) {
  const rect = await run('(() => {const r=document.querySelector(".editing-stage canvas").getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()')
  const p = xy => ({ x: Math.round(rect.x + xy[0] * rect.w), y: Math.round(rect.y + xy[1] * rect.h) })
  win.webContents.sendInputEvent({ type: 'mouseDown', ...p(from), button: 'left', clickCount: 1 })
  win.webContents.sendInputEvent({ type: 'mouseMove', ...p(to), movementX: 1, movementY: 1 })
  win.webContents.sendInputEvent({ type: 'mouseUp', ...p(to), button: 'left', clickCount: 1 })
  await wait(90)
}
const canvasPng = () => run('document.querySelector(".editing-stage canvas").toDataURL()')
function insert(id, props) {
  const item = { id, kind: 'text', plainText: '媒体验收-' + id, html: '', filePaths: [], imagePaths: [], capturedAt: new Date().toISOString(), sourceApp: '验收样本', hash: id, tags: [], sensitivity: 'normal', ...props }
  db.queryAllRaw('INSERT INTO clipboard_items VALUES (?,?,?,?)', [id, JSON.stringify(item), item.capturedAt, null])
}
async function main() {
try {
  setDataDir(data); db.setDataDir(data); await db.initDb()
  saveConfig({ language: 'zh-CN', clipboard: { captureEnabled: false, captureRecordings: false, shortcutEnabled: false } })
  const png = await sharp({ create: { width: 800, height: 450, channels: 3, background: '#d7e2ee' } }).composite([{ input: Buffer.from('<svg width="800" height="450"><defs><linearGradient id="g"><stop stop-color="#ff8040"/><stop offset="1" stop-color="#235dad"/></linearGradient></defs><rect width="800" height="450" fill="url(#g)"/><circle cx="400" cy="220" r="140" fill="#fedcba"/></svg>') }]).png().toBuffer()
  const image = await storeClipboardPng(png, path.join(data, 'clipboard-media'))
  insert('image', { kind: 'image', imagePath: image.imagePath, imagePaths: [image.imagePath] })
  insert('rich', { kind: 'html', html: '<h2>富文本图片验收</h2><p>前文<img src="data:image/png;base64,' + png.toString('base64') + '">后文</p>' })
  insert('link', { kind: 'link', plainText: 'https://example.com/friday-media-probe' })
  const code = path.join(data, '验收.py'); fs.writeFileSync(code, 'def original():\n    return 1\n')
  insert('code', { kind: 'code', language: 'python', filePaths: [code] })
  const wav = Buffer.alloc(44 + 44100 * 2 * 3)
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
  for (let i = 0; i < (wav.length - 44) / 2; i++) wav.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 440 / 44100) * 1800), 44 + i * 2)
  const audio = path.join(data, '音频.wav'); fs.writeFileSync(audio, wav)
  insert('audio', { kind: 'audio', filePaths: [audio] })
  harnessDir = fs.mkdtempSync(path.join(root, '.clipboard-media-probe-'))
  fs.writeFileSync(path.join(harnessDir, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app"></div><script type="module">
import {createApp} from 'vue';import {createRouter,createMemoryHistory} from 'vue-router';import {i18n} from '/src/i18n/index.js';import ClipboardView from '/src/views/clipboard/ClipboardView.vue';import '/src/assets/styles/main.css';
createApp(ClipboardView).use(createRouter({history:createMemoryHistory(),routes:[{path:'/',component:ClipboardView}]})).use(i18n).mount('#app');window.ready=true;
</script><style>html,body,#app{height:100%;width:100%;margin:0}</style></body></html>`)
  win = new BrowserWindow({ show: false, width: 1280, height: 1000, webPreferences: { offscreen: true, backgroundThrottling: false, preload: path.join(root, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } })
  win.webContents.on('console-message', event => { if (event.level === 'error') console.error('[界面验收]', event.message) })
  registerClipboardCommands(win)
  shell.openExternal = async url => { opened.push(url) }
  await win.loadURL('http://localhost:5173/' + path.basename(harnessDir) + '/index.html')
  await until('window.ready && document.querySelector(".clipboard-row")')
  const videoBytes = await run(`new Promise((resolve,reject)=>{const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d'),stream=c.captureStream(15),r=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),parts=[];r.ondataavailable=e=>parts.push(e.data);r.onerror=reject;r.onstop=async()=>{const data=await new Blob(parts).arrayBuffer();let s='';for(const v of new Uint8Array(data))s+=String.fromCharCode(v);stream.getTracks().forEach(t=>t.stop());resolve(btoa(s))};let n=0;const timer=setInterval(()=>{x.fillStyle=n++%2?'#456a91':'#c6d9ee';x.fillRect(0,0,320,180)},65);r.start();setTimeout(()=>{clearInterval(timer);r.stop()},2000)})`)
  const video = path.join(data,'视频.webm'); fs.writeFileSync(video,Buffer.from(videoBytes,'base64'))
  insert('video',{kind:'video',filePaths:[video]})
  await openItem('image')
  await until('document.querySelector(".detail-images .thumbnail img")?.naturalWidth>0')
  await run('document.querySelector(".detail-images .thumbnail").click()')
  await until('document.querySelector(".preview-canvas img")?.naturalWidth>0')
  for (const width of [640,420]) {
    win.setContentSize(width,800)
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    assert.equal(await run('(()=>{const d=[...document.querySelectorAll("[role=dialog]")].at(-1);return [...d.querySelectorAll("footer button")].every(b=>{const r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})})()'),true,'图片预览按钮在窄窗口完整可见')
  }
  win.setContentSize(1280,1000)
  await run(`(() => {const c=document.querySelector('.preview-canvas'),r=c.getBoundingClientRect();for(let i=0;i<8;i++)c.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,clientX:r.x+r.width/2,clientY:r.y+r.height/2,bubbles:true,cancelable:true}))})()`)
  assert.ok((await run('document.querySelector(".dimensions").textContent')).includes('260%'))
  const previewBounds = await run('(() => {const r=document.querySelector(".preview-canvas").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()')
  win.webContents.sendInputEvent({ type:'mouseDown', x:Math.round(previewBounds.x), y:Math.round(previewBounds.y), button:'left', clickCount:1 })
  win.webContents.sendInputEvent({ type:'mouseMove', x:1200, y:950, movementX:500, movementY:500 })
  win.webContents.sendInputEvent({ type:'mouseUp', x:1200, y:950, button:'left', clickCount:1 })
  assert.equal(await run('(() => {const c=document.querySelector(".preview-canvas").getBoundingClientRect(),i=document.querySelector(".preview-canvas img").getBoundingClientRect();return i.left<=c.right&&i.right>=c.left&&i.top<=c.bottom&&i.bottom>=c.top})()'), true)
  await click('适应窗口')
  await click('编辑图片')
  await until('document.querySelector(".editing-stage canvas")?.width===800')
  win.setContentSize(420,800)
  await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  assert.equal(await run('(()=>{const d=[...document.querySelectorAll("[role=dialog]")].at(-1);return [...d.querySelectorAll("footer button")].every(b=>{const r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})})()'),true,'图片保存按钮在窄窗口完整可见')
  await until('!document.querySelector(".modal-fade-enter-active,.modal-fade-leave-active")')
  await wait(100)
  fs.mkdirSync(path.join(root,'app-data','diagnostics'),{recursive:true})
  fs.writeFileSync(path.join(root,'app-data','diagnostics','clipboard-image-editor-420.png'),(await win.webContents.capturePage()).toPNG())
  win.setContentSize(1280,1000)
  const initial = await canvasPng()
  await stroke([.1,.15], [.7,.6]); const pen = await canvasPng(); assert.notEqual(pen, initial)
  await click('撤销'); assert.equal(await canvasPng(), initial)
  await click('重做'); assert.equal(await canvasPng(), pen)
  await click('文本框'); await stroke([.3,.3], [.3,.3])
  await until('document.querySelector(".text-overlay")')
  await run(`(()=>{const n=document.querySelector('.text-overlay');n.value='Friday 图片编辑验收';n.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await click('添加文字'); const text = await canvasPng(); assert.notEqual(text, pen)
  await click('马赛克'); await stroke([.3,.3], [.7,.7]); assert.notEqual(await canvasPng(), text)
  await click('裁切'); await stroke([.1,.1], [.9,.8]); await click('应用裁切')
  const cropped = await run('(()=>{const c=document.querySelector(".editing-stage canvas");return [c.width,c.height]})()')
  assert.ok(cropped[0] > 600 && cropped[0] < 680 && cropped[1] > 290 && cropped[1] < 340)
  await click('旋转 90°')
  assert.deepEqual(await run('(()=>{const c=document.querySelector(".editing-stage canvas");return [c.width,c.height]})()'), [cropped[1], cropped[0]])
  const final = await canvasPng()
  await click('保存到剪贴板')
  await until('!document.querySelector(".editing-stage")')
  const saved = await getClipboardImage({ id:'image', thumbnail:false })
  assert.deepEqual(await sharp(Buffer.from(final.split(',')[1],'base64')).raw().toBuffer(), await sharp(Buffer.from(saved.dataUrl.split(',')[1],'base64')).raw().toBuffer())
  assert.deepEqual(fs.readFileSync(image.imagePath), png, '编辑保留原始 PNG')

  await openItem('rich')
  await until('document.querySelector(".rich-image-node .thumbnail img")?.naturalWidth>0')
  await run('document.querySelector(".rich-image-node .thumbnail").click()')
  await until('document.querySelector(".preview-canvas img")?.naturalWidth>0')
  await click('编辑图片'); await until('document.querySelector(".editing-stage canvas")?.width===800')
  await click('旋转 90°'); await click('保存到剪贴板')
  await until('!document.querySelector(".editing-stage")')
  assert.equal((await getClipboardImage({id:'rich',htmlIndex:0,thumbnail:false})).width,450)
  assert.ok(listClipboardItems().find(item=>item.id==='rich').html.includes('后文'))
  await startShareServer()
  const share = await createClipboardShareForItem('rich')
  const localUrl = share.url.replace(/^http:\/\/[^/]+/, 'http://127.0.0.1:' + new URL(share.url).port)
  assert.match(await (await fetch(localUrl)).text(), /\/image\/0/)
  assert.equal((await sharp(Buffer.from(await (await fetch(localUrl+'/image/0')).arrayBuffer())).metadata()).width,450)
  const merged = await run(`window.electronAPI.invoke('clipboard-batch',{ids:['rich','code'],action:'merge'})`)
  assert.equal((await getClipboardImage({id:merged.id,htmlIndex:0,thumbnail:false})).width,450)
  await openItem(merged.id)
  await until('document.querySelector(".rich-image-node .thumbnail img")?.naturalWidth>0')
  await run('document.querySelector(".rich-image-node .thumbnail").click()')
  await until('document.querySelector(".preview-canvas img")?.naturalWidth>0')
  await click('编辑图片');await until('document.querySelector(".editing-stage canvas")?.width===450')
  await click('旋转 90°');await click('保存到剪贴板')
  await until('!document.querySelector(".editing-stage")')
  assert.equal((await getClipboardImage({id:merged.id,htmlIndex:0,thumbnail:false})).width,800)
  assert.equal((await getClipboardImage({id:'rich',htmlIndex:0,thumbnail:false})).width,450,'编辑合并副本中的图片不影响原条目')

  await openItem('rich')
  await run('document.querySelector(".rich-content").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))')
  await until('document.querySelector(".tiptap[contenteditable=true]")')
  await run('(()=>{const n=document.querySelector(".tiptap");n.focus();const range=document.createRange();range.selectNodeContents(n);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range)})()')
  await win.webContents.insertText('这段草稿应该在取消后消失')
  await until('document.querySelector(".tiptap").textContent.includes("这段草稿")')
  await click('取消')
  await until('document.querySelector(".tiptap").textContent.includes("后文") && !document.querySelector(".tiptap").textContent.includes("这段草稿")')
  await click('生成二维码')
  await until('document.querySelector(".qr-url") && document.querySelector(".qr-image")?.naturalWidth>0')
  assert.ok((await run('document.querySelector(".qr-url").textContent')).includes('/clipboard-share/'),'富文本含图片时必须使用可取图片的分享链接')
  await click('关闭')

  await openItem('code')
  await until('document.querySelector(".detail-text").textContent.includes("def original")')
  await run('document.querySelector(".detail-text").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))')
  await until('document.querySelector(".detail-editor")')
  await run(`(()=>{const n=document.querySelector('.detail-editor');n.value=${JSON.stringify('  # 保留缩进\nvalue = 42\n')};n.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await click('保存'); await until('!document.querySelector(".detail-editor")')
  assert.equal(listClipboardItems().find(item=>item.id==='code').plainText,'  # 保留缩进\nvalue = 42\n')
  assert.equal(fs.readFileSync(code,'utf8'),'def original():\n    return 1\n')

  await openItem('link')
  await run('document.querySelector(".detail-link").click()'); await wait(450)
  assert.deepEqual(opened,['https://example.com/friday-media-probe'])
  await run('document.querySelector(".detail-link").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))')
  await until('document.querySelector(".detail-editor")')
  await run(`(()=>{const n=document.querySelector('.detail-editor');n.value='https://example.org/updated';n.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await click('保存'); await until('document.querySelector(".detail-link")?.textContent.includes("example.org")')
  assert.equal(opened.length,1,'双击编辑不额外打开浏览器')

  await openItem('audio')
  await until('document.querySelector("audio")?.readyState>=2')
  assert.equal(Math.round(await run('document.querySelector("audio").duration')),3)
  await run('document.querySelector("audio").play()')
  await until('document.querySelector("audio").currentTime>0.1')
  await run('(()=>{const a=document.querySelector("audio");a.pause();a.currentTime=1.5})()')
  await until('Math.abs(document.querySelector("audio").currentTime-1.5)<0.1 && !document.querySelector("audio").seeking')
  await openItem('video')
  await until('document.querySelector("video")?.readyState>=2')
  await run('document.querySelector("video").play()')
  await until('document.querySelector("video").currentTime>0.2')
  await run('(()=>{const v=document.querySelector("video");v.pause();v.currentTime=0.8})()')
  await until('Math.abs(document.querySelector("video").currentTime-0.8)<0.1 && !document.querySelector("video").seeking')
  fs.mkdirSync(path.join(root,'app-data','diagnostics'),{recursive:true})
  fs.writeFileSync(path.join(root,'app-data','diagnostics','clipboard-media-ui.png'),(await win.webContents.capturePage()).toPNG())
  console.log(JSON.stringify({ok:true,preloadAndIPC:true,zoomPanBounds:true,penUndoRedo:true,textBox:true,mosaic:true,cropRotate:true,exactSavedPixels:true,originalPreserved:true,inlineImagePreviewEditShare:true,richCancelRestoresImages:true,codeEdit:true,linkOpenAndEdit:true,audioPlaybackSeek:true,videoPlaybackSeek:true}))
} catch(error) { console.error(error); if(win&&!win.isDestroyed())console.error(await run('document.body.innerText'));process.exitCode=1 }
finally {
  clearTimeout(deadline);shell.openExternal=previousExternal;stopShareServer();stopClipboardCapture();db.closeDb()
  if(win&&!win.isDestroyed())win.destroy()
  if(harnessDir&&path.dirname(harnessDir)===path.resolve(root))removePathNoFollowSync(harnessDir,{root})
  app.exit(process.exitCode||0)
}
}
app.whenReady().then(main)
