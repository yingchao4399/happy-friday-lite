import test from 'node:test'
import assert from 'node:assert/strict'
import { fileUrlForNote, notePathFromUrl } from '../../src/views/note/media-path.js'

test('笔记媒体路径对 Windows、UNC、空格和 URL 保持可往返', () => {
  for (const source of ['C:\\Users\\张三\\视频 #1.mp4', 'C:\\媒体\\音频?.m4a', '\\\\server\\share\\课程 1.mp3']) {
    const url = fileUrlForNote(source)
    assert.match(url, /^file:/i)
    assert.equal(notePathFromUrl(url), source)
  }
  assert.equal(fileUrlForNote('https://example.com/a b.mp4'), 'https://example.com/a b.mp4')
  assert.equal(notePathFromUrl('https://example.com/a.mp4'), 'https://example.com/a.mp4')
})

test('笔记媒体路径不会把敏感 URL 当成本地文件', () => {
  for (const source of ['data:video/mp4;base64,abc', 'blob:https://example.com/id', '']) {
    assert.equal(fileUrlForNote(source), source)
    assert.equal(notePathFromUrl(source), source)
  }
})
