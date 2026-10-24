import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { clipboardFileEntries, clipboardFileItemKind } from '../../src-electron/clipboard-files.js'
import { clipboardFileType } from '../../src-electron/clipboard-content.js'
import { readClipboardSourceImage } from '../../src-electron/clipboard-media.js'
import { createRecordingCollector, createRecordingReleaseCheck } from '../../src-electron/clipboard-recordings.js'
import { clipboardDefaults, validateClipboardSettings } from '../../src-electron/clipboard-settings.js'

test('文件夹按实际类型识别，支持带扩展名的文件夹、混合条目及失效路径', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-folders-'))
  try {
    const folder = path.join(root, '项目.png'), file = path.join(root, '说明.txt')
    await fs.mkdir(folder); await fs.writeFile(file, 'text')
    const entries = clipboardFileEntries([folder, file])
    assert.equal(entries[0].kind, 'folder'); assert.equal(entries[0].available, true)
    assert.equal(entries[1].kind, 'file'); assert.equal(entries[1].index, 1)
    assert.equal(clipboardFileItemKind({ kind: 'file' }, entries.slice(0, 1)), 'folder')
    assert.equal(clipboardFileItemKind({ kind: 'mixed' }, entries), 'mixed')
    await fs.rmdir(folder)
    const missing = clipboardFileEntries([folder], entries)[0]
    assert.equal(missing.kind, 'folder'); assert.equal(missing.available, false)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('图片文件可读取预览且不覆盖源文件，敏感条目、错误索引与非图片文件受保护', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-source-image-'))
  try {
    const source = path.join(root, '照片.jpg'), storage = path.join(root, 'managed')
    await sharp({ create: { width: 640, height: 480, channels: 3, background: '#7050a0' } }).jpeg().toFile(source)
    const before = await fs.readFile(source), item = { filePaths: [source], sensitivity: 'normal' }
    assert.equal(clipboardFileType(source).kind, 'image')
    const preview = await readClipboardSourceImage(item, 0, storage, { thumbnail: false })
    assert.equal(preview.width, 640); assert.equal(preview.height, 480); assert.match(preview.contentHash, /^[a-f0-9]{64}$/)
    assert.deepEqual(await fs.readFile(source), before)
    await assert.rejects(readClipboardSourceImage({ ...item, sensitivity: 'secret' }, 0, storage), { code: 'CLIPBOARD_IMAGE_UNAVAILABLE' })
    await assert.rejects(readClipboardSourceImage(item, 99, storage), { code: 'CLIPBOARD_IMAGE_UNAVAILABLE' })
    await fs.unlink(source)
    await assert.rejects(readClipboardSourceImage(item, 0, storage), { code: 'CLIPBOARD_IMAGE_MISSING' })
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('录屏等待写入稳定和句柄释放，忽略旧视频、去重、处理重命名与停止采集', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-recordings-'))
  const collected = [], errors = []
  let now = 0, released = false
  const collector = createRecordingCollector({ directories: [root], onReady: item => collected.push(item), isReleased: async () => released, now: () => now, stableMs: 100, onError: code => errors.push(code) })
  try {
    await fs.writeFile(path.join(root, 'old.mp4'), 'old')
    await collector.scan()
    const file = path.join(root, 'new.mp4')
    await fs.writeFile(file, 'recording'); await collector.scan()
    now += 150; await collector.scan(); assert.equal(collected.length, 0, '句柄仍占用时不收录')
    released = true
    await fs.appendFile(file, '-still-recording'); await collector.scan()
    now += 50; await collector.scan(); assert.equal(collected.length, 0, '继续写入后重新计算等待时间')
    now += 100; await collector.scan(); assert.equal(collected.length, 1)
    assert.equal(collected[0].file, file)
    now += 500; await collector.scan(); assert.equal(collected.length, 1, '稳定视频不重复收录，旧视频不回填')
    await fs.writeFile(path.join(root, 'part.tmp'), 'final video'); await collector.scan()
    await fs.rename(path.join(root, 'part.tmp'), path.join(root, 'final.webm')); await collector.scan()
    now += 150; await collector.scan(); assert.equal(collected.length, 2)
    await fs.writeFile(path.join(root, 'stopped.mp4'), 'stopped'); await collector.scan()
    collector.stop(); now += 500; await collector.scan(); assert.equal(collected.length, 2)
    assert.deepEqual(errors, [])
  } finally { collector.stop(); await fs.rm(root, { recursive: true, force: true }) }
})

test('录屏设置校验目录，Windows 独占打开能区分关闭文件与仍在写入的文件', async () => {
  assert.throws(() => validateClipboardSettings({ ...clipboardDefaults, recordingFolders: ['relative'] }), { code: 'CLIPBOARD_SETTINGS_INVALID' })
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-recording-lock-'))
  try {
    const file = path.join(root, 'recording.mp4')
    await fs.writeFile(file, 'sample')
    const releaseCheck = createRecordingReleaseCheck()
    assert.equal(await releaseCheck(file), true)
    const handle = await fs.open(file, 'r+')
    try { if (process.platform === 'win32') assert.equal(await releaseCheck(file), false) }
    finally { await handle.close() }
    assert.equal(await releaseCheck(file), true)
    if (process.platform === 'win32') assert.equal(await releaseCheck(path.join(root, 'missing.mp4')), false)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('系统默认目录缺失可忽略，用户指定的录屏目录缺失必须报告', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-recording-errors-'))
  const optional = path.join(root, 'optional'), selected = path.join(root, 'selected'), errors = []
  const collector = createRecordingCollector({ directories: [optional, selected], optionalDirectories: [optional], onReady() {}, isReleased: async () => true, onError: code => errors.push(code) })
  try { await collector.scan(); assert.deepEqual(errors, ['CLIPBOARD_RECORDING_DIRECTORY_MISSING']) }
  finally { collector.stop(); await fs.rm(root, { recursive: true, force: true }) }
})
