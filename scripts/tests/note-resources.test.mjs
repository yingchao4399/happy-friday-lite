import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setDataDir } from '../../src-electron/config.js'
import { importNoteResource, noteAssetUrl, resolveNoteAssetPath } from '../../src-electron/note-resources.js'

function createFixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-note-assets-'))
  const noteId = 'note_test-1'
  const noteDir = path.join(dataDir, 'note-assets', noteId)
  fs.mkdirSync(noteDir, { recursive: true })
  setDataDir(dataDir)
  return { dataDir, noteId, noteDir }
}

test('笔记资源返回稳定的 friday-asset URL，并可解析到受管文件', () => {
  const fixture = createFixture()
  try {
    const source = path.join(fixture.dataDir, 'image with spaces.png')
    fs.writeFileSync(source, Buffer.from([137, 80, 78, 71]))

    const asset = importNoteResource({ noteId: fixture.noteId, filePath: source })
    assert.equal(asset.mime, 'image/png')
    assert.match(asset.url, /^friday-asset:\/\/note-assets\/note_test-1\//)
    assert.equal(asset.url, noteAssetUrl(fixture.noteId, asset.path))
    assert.equal(resolveNoteAssetPath(asset.url), asset.path)
    assert.deepEqual(fs.readFileSync(resolveNoteAssetPath(asset.url)), Buffer.from([137, 80, 78, 71]))
    assert.throws(() => importNoteResource({ noteId: '../escape', filePath: source }), /NOTE_ID_INVALID/)
  } finally {
    setDataDir(null)
    fs.rmSync(fixture.dataDir, { recursive: true, force: true })
  }
})

test('资源协议拒绝错误源、查询参数、目录穿越和非法笔记 ID', () => {
  const fixture = createFixture()
  try {
    const file = path.join(fixture.noteDir, 'image.png')
    fs.writeFileSync(file, 'image')

    const invalidUrls = [
      'file://note-assets/note_test-1/image.png',
      'friday-asset://other-host/note_test-1/image.png',
      'friday-asset://note-assets/note_test-1/image.png?download=1',
      'friday-asset://note-assets/note_test-1/image.png#preview',
      'friday-asset://note-assets/note_test-1/%2E%2E%2Foutside.png',
      'friday-asset://note-assets/%2E%2E/image.png',
      'friday-asset://note-assets/note.test/image.png',
      'friday-asset://note-assets/note_test-1/missing.png',
      'friday-asset://note-assets/note_test-1/nested/image.png',
    ]
    for (const url of invalidUrls) assert.equal(resolveNoteAssetPath(url), null, url)
  } finally {
    setDataDir(null)
    fs.rmSync(fixture.dataDir, { recursive: true, force: true })
  }
})

test('资源协议拒绝指向 note-assets 目录外的符号链接', t => {
  const fixture = createFixture()
  try {
    const outside = path.join(fixture.dataDir, 'outside.png')
    const link = path.join(fixture.noteDir, 'linked.png')
    fs.writeFileSync(outside, 'outside')
    try {
      fs.symlinkSync(outside, link, 'file')
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
        t.skip(`symlinks unavailable: ${error.code}`)
        return
      }
      throw error
    }
    assert.equal(resolveNoteAssetPath(noteAssetUrl(fixture.noteId, link)), null)
  } finally {
    setDataDir(null)
    fs.rmSync(fixture.dataDir, { recursive: true, force: true })
  }
})
