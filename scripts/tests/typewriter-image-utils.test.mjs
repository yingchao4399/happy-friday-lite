import test from 'node:test'
import assert from 'node:assert/strict'
import { extractTypewriterImages, markdownImage, normalizeImageSource, parseTypewriterImageNodes, updateTypewriterImageMetadata } from '../../src/features/typewriter/image-utils.js'

test('Typewriter image Markdown inserts a parseable data URL', () => {
  const markdown = markdownImage('diagram', 'data:image/png;base64,AAECAw==')
  assert.deepEqual(extractTypewriterImages(markdown).map(({ alt, src }) => ({ alt, src })), [
    { alt: 'diagram', src: 'data:image/png;base64,AAECAw==' },
  ])
})

test('Typewriter image widget metadata updates in place and keeps body flow', () => {
  const markdown = `before\n${markdownImage('illustration', 'friday-asset://notes/illustration.png', { width: 160, height: 120 })}after`
  const [image] = parseTypewriterImageNodes(markdown)
  assert.equal(image.width, 160)
  assert.equal(image.height, 120)
  assert.equal(image.range.to, image.anchor.offset + markdown.slice(image.anchor.offset).match(/^!?\[[^\]]*\]\([^\n]*\)/)[0].length)
  const resized = updateTypewriterImageMetadata(markdown, image.anchor.offset, { width: 224, align: 'left', shadow: 0.35 })
  assert.match(resized, /width=224/)
  assert.match(resized, /align=left/)
  assert.match(resized, /shadow=0\.35/)
  assert.match(resized, /\)\nafter$/)
  assert.ok(!resized.includes('flowRows='))
})

test('Typewriter image parser consumes only legacy reserved flow rows', () => {
  const markdown = '![old](friday-asset://notes/old.png "width=160;flowRows=4")\n\n\n\nnext'
  const [image] = parseTypewriterImageNodes(markdown)
  assert.equal(image.flowRows, 4)
  assert.equal(markdown.slice(image.range.to), 'next')
})

test('Typewriter image scan restores safe HTML images and removes duplicates', () => {
  const images = extractTypewriterImages([
    '![photo](data:image/webp;base64,AQID)',
    '<img alt="photo" src="data:image/webp;base64,AQID">',
  ].join('\n'))
  assert.equal(images.length, 1)
  assert.equal(images[0].src, 'data:image/webp;base64,AQID')
})

test('Typewriter image scan rejects raw Windows paths and file URLs', () => {
  const src = normalizeImageSource('C:\\Users\\A User\\Pictures\\测试 图.png')
  assert.equal(src, 'file:///C:/Users/A%20User/Pictures/%E6%B5%8B%E8%AF%95%20%E5%9B%BE.png')
  assert.deepEqual(extractTypewriterImages(`![图](<${src}>)`), [])
})
