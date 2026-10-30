import test from 'node:test'
import assert from 'node:assert/strict'
import { extractTypewriterImages, markdownImage, normalizeImageSource } from '../../src/features/typewriter/image-utils.js'

test('Typewriter image Markdown inserts a parseable data URL', () => {
  const markdown = markdownImage('diagram', 'data:image/png;base64,AAECAw==')
  assert.deepEqual(extractTypewriterImages(markdown).map(({ alt, src }) => ({ alt, src })), [
    { alt: 'diagram', src: 'data:image/png;base64,AAECAw==' },
  ])
})

test('Typewriter image scan restores safe HTML images and removes duplicates', () => {
  const images = extractTypewriterImages([
    '![photo](data:image/webp;base64,AQID)',
    '<img alt="photo" src="data:image/webp;base64,AQID">',
  ].join('\n'))
  assert.equal(images.length, 1)
  assert.equal(images[0].src, 'data:image/webp;base64,AQID')
})

test('Typewriter image scan encodes Windows asset paths with spaces', () => {
  const src = normalizeImageSource('C:\\Users\\A User\\Pictures\\测试 图.png')
  assert.equal(src, 'file:///C:/Users/A%20User/Pictures/%E6%B5%8B%E8%AF%95%20%E5%9B%BE.png')
  assert.equal(extractTypewriterImages(`![图](<${src}>)`)[0].src, src)
})
