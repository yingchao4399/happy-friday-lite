// 普通编辑不加载附件解析器；三类编辑器通过真实 preload/IPC 首次读取附件。
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { setDataDir } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import * as host from '../src-electron/office/office-host.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-lazy-attachments-'))
app.setPath('userData', path.join(data, 'profile'))
const require = createRequire(import.meta.url)
const parser = path.join(root, 'resources/office/main/attachment-parser.cjs')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const timeout = setTimeout(() => { console.error('附件按需加载验收超时'); app.exit(1) }, 90000)
let win, ok = false

async function main() {
  try {
    setDataDir(data); db.setDataDir(data); await db.initDb()
    win = new BrowserWindow({ show: false, width: 1200, height: 900 })
    await host.initOfficeHost(win)
    host.setOfficeContentBounds({ x: 0, y: 0, width: 1200, height: 900 })
    const store = require('../resources/office/main/office-utils.cjs')
    const listed = path.join(data, 'recent.docx')
    fs.writeFileSync(listed, 'isolated recent fixture')
    store.recordRecentFile(listed)
    assert.equal((await host.getOfficeRecents())[0].path, listed)
    assert.equal((await host.toggleOfficeStarred(listed)).success, true)
    const renamed = await host.renameOfficeFile(listed, 'renamed')
    assert.equal(renamed.success, true)
    assert.equal((await host.getOfficeRecents())[0].starred, true)
    assert.equal((await host.deleteOfficeFile(renamed.filePath)).success, true)
    assert.deepEqual(await host.getOfficeRecents(), [])
    assert.deepEqual(host.getOfficeLoadedEditors(), [], '首页最近文件、收藏、重命名和删除不应加载编辑器')
    const txt = path.join(data, '附件.txt'), text = '延迟附件解析验收\nsecond line'
    fs.writeFileSync(txt, text)
    const docx = path.join(data, '附件.docx')
    fs.copyFileSync(path.join(root, 'vendor/happyoffice/fixtures/generated/kitchen-sink.docx'), docx)
    const { PDFDocument } = require('../vendor/happyoffice/node_modules/pdf-lib')
    const pdfFile = await PDFDocument.create()
    pdfFile.addPage().drawText('Friday attachment parsing')
    const pdf = path.join(data, '附件.pdf'); fs.writeFileSync(pdf, await pdfFile.save())
    const cases = []
    let parserModule
    for (const kind of ['docs', 'sheets', 'slides']) {
      const opened = await host.newOfficeDocument(kind)
      assert.equal(opened.success, true)
      const wc = host.getOfficeUiTarget().webContents
      const bridge = kind === 'sheets' ? 'window.desktopApi' : 'window.desktop'
      for (let attempt = 0; attempt < 300; attempt++) {
        if (await wc.executeJavaScript(`typeof ${bridge}?.readAttachment === "function"`)) break
        await sleep(30)
      }
      if (kind === 'docs') assert.equal(require.cache[parser], undefined, '普通 Word 首开不得加载附件解析器')
      const read = file => wc.executeJavaScript(`${bridge}.readAttachment(${JSON.stringify(file)},0,8192)`)
      const plain = await read(txt)
      assert.equal(plain.ok, true, JSON.stringify(plain)); assert.equal(plain.text, text)
      assert.ok(require.cache[parser], '实际读附件必须加载独立的解析模块')
      if (parserModule) assert.equal(require.cache[parser], parserModule, '三类编辑器复用同一个解析器实例')
      parserModule = require.cache[parser]
      const document = await read(docx)
      assert.equal(document.ok, true, JSON.stringify(document)); assert.ok(document.text.length > 10)
      const portable = await read(pdf)
      assert.equal(portable.ok, true, JSON.stringify(portable)); assert.match(portable.text, /Friday attachment parsing/)
      const missing = await read(path.join(data, '不存在.docx'))
      assert.equal(missing.ok, false); assert.ok(missing.error)
      cases.push({ kind, text: true, docx: true, pdf: true, failureReported: true })
      // 新文档没有编辑，不应出现保存确认。
      assert.equal(await host.closeOfficeFile(opened.viewId), true)
    }
    console.log(JSON.stringify({ ok: true, lightweightRecents: true, unloadedAtEditorStartup: true, sharedParser: true, cases }))
    ok = true
  } catch (error) { console.error(error.stack) }
  finally {
    clearTimeout(timeout); host.shutdownOfficeHost(); db.closeDb()
    if (win && !win.isDestroyed()) win.destroy()
    app.exit(ok ? 0 : 1)
  }
}
app.whenReady().then(main).catch(error => { console.error(error.stack); app.exit(1) })
