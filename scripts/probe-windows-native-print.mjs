// 用合成横向 PDF 验收 Windows 原生打印桥。仅手动完成真实系统打印/取消。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { pathToFileURL } from 'node:url'
const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(path.join(root, 'vendor/happyoffice/apps/pdf/package.json'))
async function verifyOutput(output) {
  const { PDFDocument } = require('pdf-lib')
  const bytes=fs.readFileSync(output)
  const pdf=await PDFDocument.load(bytes)
  assert.equal(pdf.getPageCount(),1)
  const size=pdf.getPage(0).getSize()
  assert.ok(size.width>size.height,'实际打印产物应是横向纸张')
  const {getDocument}=await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href)
  const loading=getDocument({data:new Uint8Array(bytes)})
  try {
    const page=await (await loading.promise).getPage(1)
    const {createCanvas}=require('@napi-rs/canvas')
    const viewport=page.getViewport({scale:1.6})
    const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height))
    await page.render({canvas,canvasContext:canvas.getContext('2d'),viewport}).promise
    const screenshot=path.join(root,'app-data/diagnostics/windows-native-print-output.png')
    fs.writeFileSync(screenshot,canvas.toBuffer('image/png'))
    const {recognizeImage}=await import('../src-electron/rag/imageOcr.js')
    const text=(await recognizeImage(screenshot)).text.replace(/[^A-Za-z0-9]/g,'').toUpperCase()
    assert.ok(text.includes('FRIDAYNATIVEPRINTPROBE'),'打印产物需保留水平正文')
    console.log(JSON.stringify({ok:true,mode:'system-output',...size,bytes:bytes.length}))
  } finally {await loading.destroy()}
}
const existingOutput=process.argv.find(arg=>arg.startsWith('--verify-output='))?.slice(16)
if (existingOutput) {
  await verifyOutput(existingOutput)
} else if (!process.versions.electron) {
  const localRequire = createRequire(import.meta.url)
  const { spawn } = await import('node:child_process')
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
  const child=spawn(localRequire('electron'),[import.meta.filename,...process.argv.slice(2)],{env,windowsHide:false,stdio:'inherit'})
  process.exitCode=await new Promise(resolve=>child.once('exit',code=>resolve(code??1)))
} else {
const {app,BrowserWindow}=await import('electron')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'friday-native-print-profile-')))
app.whenReady().then(async () => {
const owner=new BrowserWindow({show:false,width:900,height:700,title:'Friday Windows 打印验收（隔离夹具）',webPreferences:{sandbox:true}})
await owner.loadURL('data:text/html,<title>Friday Windows 打印验收</title><h2>Friday PRINT PROBE</h2>')
owner.show(); owner.focus()
console.log(JSON.stringify({stage:'owner-visible',visible:owner.isVisible(),bounds:owner.getBounds()}))
const { PDFDocument, StandardFonts } = require('pdf-lib')
const output = process.argv.find(arg=>arg.startsWith('--output='))?.slice(9)
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-native-print-probe-'))
const source = path.join(workDir, 'source.pdf')
try {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  document.addPage([720,405]).drawText('FRIDAY NATIVE PRINT PROBE', { x:55,y:300,size:24,font })
  fs.writeFileSync(source, await document.save())
  const digest = () => crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex')
  const hash = digest()
  const helper = path.join(root,'vendor/happyoffice/packages/electron-utils/native/system-print.exe')
  const result = await new Promise((resolve,reject)=>{
    const child = execFile(helper, [], {windowsHide:false,timeout:900000,encoding:'utf8'}, (error,stdout,stderr)=>{
      if(error){ reject(new Error('native helper: '+stderr.trim())); return }
      try {resolve(JSON.parse(stdout.trim()))} catch {reject(new Error('invalid helper result'))}
    })
    child.stdin.on('error',()=>{})
    child.stderr.pipe(process.stderr)
    child.stdin.end(JSON.stringify({pdfPath:source,title:'Friday 隔离打印验收',ownerHandle:owner.getNativeWindowHandle().readBigUInt64LE().toString(),landscape:true,copies:1,paperWidth:210000,paperHeight:297000}))
  })
  assert.equal(result.success, Boolean(output))
  assert.equal(digest(),hash)
  if(output){
    await verifyOutput(output)
    console.log(JSON.stringify({sourceUnchanged:true}))
  } else {assert.match(result.failureReason,/cancel/i);console.log(JSON.stringify({ok:true,mode:'cancel',sourceUnchanged:true}))}
} finally {
  fs.unlinkSync(source)
  fs.rmdirSync(workDir)
  owner.destroy()
  app.quit()
}
}).catch(error => {console.error(error); app.exit(1)})
}
