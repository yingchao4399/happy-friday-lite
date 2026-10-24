import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import sharp from 'sharp'
import { pathToFileURL } from 'node:url'
import { clipboardHtmlImages, clipboardItemHtml, replaceClipboardItemImage, replaceClipboardHtmlImage, readClipboardHtmlImage } from '../../src-electron/clipboard-html-images.js'
import { clipboardRichContent } from '../../src/utils/clipboardRichContent.js'

test('富文本内嵌图片按原索引读取和替换，坏索引、敏感和过期条目拒绝访问', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-html-image-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const png = await sharp({ create: { width: 240, height: 160, channels: 3, background: '#c6d9ee' } }).png().toBuffer()
  const src = 'data:image/png;base64,' + png.toString('base64')
  const html = '<p>前文<img src="' + src + '" alt="测试">后文</p><img src="https://example.com/x?a=1&amp;b=2">'
  const item = { html, sensitivity: 'normal' }
  assert.deepEqual(clipboardHtmlImages(html), [src, 'https://example.com/x?a=1&b=2'])
  const image = await readClipboardHtmlImage(item, 0, dir, { thumbnail: false })
  assert.equal(image.width, 240); assert.equal(image.height, 160)
  assert.deepEqual(Buffer.from(image.dataUrl.split(',')[1], 'base64'), png)
  const changed = replaceClipboardHtmlImage(html, 0, 'data:image/png;base64,AAAA')
  assert.equal(clipboardHtmlImages(changed)[0], 'data:image/png;base64,AAAA')
  assert.ok(changed.includes('前文') && changed.includes('后文'))
  for (const value of [{ ...item, deletedAt: 'now' }, { ...item, sensitivity: 'secret' }, { ...item, expiresAt: '2000-01-01' }]) await assert.rejects(readClipboardHtmlImage(value, 0, dir), /UNAVAILABLE/)
  await assert.rejects(readClipboardHtmlImage(item, -1, dir), /UNAVAILABLE/)
  assert.throws(() => replaceClipboardHtmlImage(html, 2, src), /UNAVAILABLE/)
  await assert.rejects(readClipboardHtmlImage({ html: '<img src="data:image/png;base64,not-valid!!!">' }, 0, dir), /INVALID/)
})

test('网页和本地图片点击后读取；自动预览不请求网络；无效、超限与不支持协议返回明确结果', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-html-remote-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const png = await sharp({ create: { width: 80, height: 50, channels: 3, background: '#eee' } }).png().toBuffer()
  let requests = 0
  const server = http.createServer((req, res) => {
    requests++
    if (req.url === '/missing') { res.writeHead(404); res.end(); return }
    if (req.url === '/large') { res.writeHead(200, { 'content-length': 70 * 1024 * 1024 }); res.end(); return }
    assert.equal(req.headers.cookie, undefined); assert.equal(req.headers.authorization, undefined)
    res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(png)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const url = 'http://127.0.0.1:' + server.address().port
  const item = { html: '<img src="' + url + '/image">' }
  await assert.rejects(readClipboardHtmlImage(item, 0, dir), /EXTERNAL_REQUIRED/)
  assert.equal(requests, 0)
  const image = await readClipboardHtmlImage(item, 0, dir, { loadExternal: true })
  assert.equal(image.width, 80)
  await readClipboardHtmlImage(item, 0, dir)
  assert.equal(requests, 1, '已经载入的图片复用受管缓存')
  const reloaded = await import('../../src-electron/clipboard-html-images.js?fresh-cache=' + Date.now())
  assert.equal((await reloaded.readClipboardHtmlImage({ ...item, htmlImageCache: { [image.sourceHash]: image.imagePath } }, 0, dir)).width,80)
  assert.equal(requests,1,'进程重建后可从条目持久化的受管缓存读取，不再次访问外部网站')
  await assert.rejects(readClipboardHtmlImage({ html: '<img src="' + url + '/missing">' }, 0, dir, { loadExternal: true }), /MISSING/)
  await assert.rejects(readClipboardHtmlImage({ html: '<img src="' + url + '/large">' }, 0, dir, { loadExternal: true }), /TOO_LARGE/)
  await assert.rejects(readClipboardHtmlImage({ html: '<img src="javascript:alert(1)">' }, 0, dir, { loadExternal: true }), /UNAVAILABLE/)
  const file = path.join(dir, '本地 图片.png'); await fs.writeFile(file, png)
  const local = { html: '<img src="' + pathToFileURL(file).href + '">' }
  await assert.rejects(readClipboardHtmlImage(local, 0, dir), /EXTERNAL_REQUIRED/)
  assert.equal((await readClipboardHtmlImage(local, 0, dir, { loadExternal: true })).height, 50)
})

test('合并条目中的多个富文本片段保持图片顺序和来源，替换只影响选中图片，前后端索引一致', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'friday-mixed-html-'))
  t.after(()=>fs.rm(dir,{recursive:true,force:true}))
  const png = await sharp({create:{width:100,height:70,channels:3,background:'#abc'}}).png().toBuffer()
  const src = 'data:image/png;base64,'+png.toString('base64')
  const item = {parts:[{text:'<script>文本不能变成 HTML</script>',sourceApp:'first'},{html:'<p>段落一<img src="'+src+'"></p>',sourceApp:'second'},{text:'<img src="fake">'},{html:'<p>段落二<img src="'+src+'"></p>',sourceApp:'third'}]}
  assert.equal(clipboardRichContent(item),clipboardItemHtml(item))
  assert.equal(clipboardHtmlImages(clipboardItemHtml(item)).length,2)
  assert.equal((await readClipboardHtmlImage(item,1,dir)).width,100)
  replaceClipboardItemImage(item,1,src.replace('base64,','base64,\n'))
  assert.equal(clipboardHtmlImages(item.parts[1].html)[0],src)
  assert.notEqual(clipboardHtmlImages(item.parts[3].html)[0],src)
  assert.equal(item.parts[3].sourceApp,'third')
  assert.throws(()=>replaceClipboardItemImage(item,2,src),/UNAVAILABLE/)
})
