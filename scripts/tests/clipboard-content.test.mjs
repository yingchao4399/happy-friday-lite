import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { clipboardFileType, clipboardCodeLanguage } from '../../src-electron/clipboard-content.js'
import { clipboardMatches, clipboardInDateRange } from '../../src-electron/clipboard-policy.js'
import { createClipboardAssetServer } from '../../src-electron/clipboard-assets.js'
import { createClipboardShare, revokeClipboardShare, startShareServer, stopShareServer } from '../../src-electron/shareServer.js'

test('音视频和代码类型识别，普通句子不会误判为代码', () => {
  assert.equal(clipboardFileType('录音.MP3').kind, 'audio')
  assert.equal(clipboardFileType('新视频.webm').kind, 'video')
  assert.deepEqual(clipboardFileType('示例.py'), { kind: 'code', language: 'python' })
  assert.equal(clipboardCodeLanguage('const answer = 42\n  console.log(answer)'), 'javascript')
  assert.equal(clipboardCodeLanguage('def main():\n  print("hello")'), 'python')
  assert.equal(clipboardCodeLanguage('今天记得回顾错题'), '')
})

test('搜索完整详情、来源、备注、分类标签与日期，隐私正文和备注不参与全文搜索', () => {
  const item = { plainText: '开头\n完整详情末尾', capturedAt: new Date(2026, 9, 23, 12).toISOString(), sourceApp: 'WINWORD', category: '学习', tags: ['公式'], note: '下周检查', parts: [{ text: '追加子项', sourceApp: 'chrome' }], filePaths: ['C:/验收/音频.wav'] }
  for (const query of ['完整详情末尾', 'winword', '学习', '公式', '下周检查', '2026-10-23', '追加子项', 'chrome', '音频.wav']) assert.equal(clipboardMatches(item, query), true, query)
  assert.equal(clipboardMatches({ ...item, sensitivity: 'secret' }, '完整详情末尾'), false)
  assert.equal(clipboardMatches({ ...item, sensitivity: 'secret' }, '下周检查'), false)
  assert.equal(clipboardMatches({ ...item, sensitivity: 'secret' }, 'winword'), true)
  assert.equal(clipboardInDateRange(item, '2026-10-23', '2026-10-23'), true)
  assert.equal(clipboardInDateRange(item, '2026-10-24'), false)
  assert.equal(clipboardInDateRange(item, '', '2026-10-22'), false)
})

test('音视频本机流支持 Range、拖动进度所需分段，删除或隐私化立即拒绝；代码读取保留缩进', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-assets-'))
  const file = path.join(directory, '中文 录音.wav'), code = path.join(directory, '示例.py')
  await fs.writeFile(file, Buffer.from('0123456789'))
  await fs.writeFile(code, 'def main():\n    print("ok")\n')
  const item = { id: 'one', filePaths: [file, code] }
  const assets = createClipboardAssetServer(id => id === 'one' ? item : null)
  try {
    const audio = await assets.get('one', 0)
    assert.equal(audio.kind, 'audio')
    const range = await fetch(audio.url, { headers: { Range: 'bytes=2-5' } })
    assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), 'bytes 2-5/10'); assert.equal(await range.text(), '2345')
    const suffix = await fetch(audio.url, { headers: { Range: 'bytes=-3' } })
    assert.equal(await suffix.text(), '789')
    assert.equal((await fetch(audio.url, { headers: { Range: 'bytes=100-' } })).status, 416)
    assert.equal((await assets.get('one', 1)).text, 'def main():\n    print("ok")\n')
    item.deletedAt = new Date().toISOString()
    assert.equal((await fetch(audio.url)).status, 404)
    await assert.rejects(assets.get('one', 0), /UNAVAILABLE/)
    item.deletedAt = null; item.sensitivity = 'secret'
    assert.equal((await fetch(audio.url)).status, 404)
    await assert.rejects(assets.get('one', 1), /UNAVAILABLE/)
    await assert.rejects(assets.get('one', -1), /UNAVAILABLE/)
  } finally { assets.close(); await fs.rm(directory, { recursive: true, force: true }) }
})

test('二维码实际分享页面提供图片、中文文件与音视频 Range 播放，HTML 转义与撤销生效', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-share-'))
  const image = path.join(directory, '图片.png'), audio = path.join(directory, '背诵 音频.wav'), video = path.join(directory, '视频.webm')
  await fs.writeFile(image, 'png-fixture'); await fs.writeFile(audio, '0123456789'); await fs.writeFile(video, 'video-fixture')
  try {
    await startShareServer()
    const share = await createClipboardShare({ text: '<script>alert(1)</script>', imagePaths: [image], filePaths: [audio, video] })
    const url = new URL(share.url); url.hostname = '127.0.0.1'
    const page = await (await fetch(url)).text()
    assert.ok(page.includes('&lt;script&gt;')); assert.ok(!page.includes('<script>'))
    assert.ok(page.includes('<audio controls')); assert.ok(page.includes('<video controls'))
    assert.ok(!page.includes('\\\"'), 'HTML 属性不能带多余反斜杠')
    assert.equal(await (await fetch(url.href + '/image/0')).text(), 'png-fixture')
    const download = await fetch(url.href + '/file/0?download=1')
    assert.ok(download.headers.get('content-disposition').includes(encodeURIComponent('背诵 音频.wav')))
    assert.equal(await download.text(), '0123456789')
    const range = await fetch(url.href + '/file/0', { headers: { Range: 'bytes=4-6' } })
    assert.equal(range.status, 206); assert.equal(range.headers.get('content-type'), 'audio/wav'); assert.equal(await range.text(), '456')
    assert.equal((await fetch(url.href + '/file/999')).status, 404)
    assert.equal(revokeClipboardShare(share.token), true)
    assert.equal((await fetch(url)).status, 404)
  } finally { stopShareServer(); await fs.rm(directory, { recursive: true, force: true }) }
})
