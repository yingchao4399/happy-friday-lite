import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'

const adapterPath = new URL('../../src/features/typewriter/adapters/note-adapter.js', import.meta.url)
const adapterSource = (await readFile(adapterPath, 'utf8')).replace(
  "import {readNote,saveNote} from '@/features/notes/documents'",
  'const readNote = (...args) => globalThis.__fridayReadNote(...args); const saveNote = (...args) => globalThis.__fridaySaveNote(...args);'
)
const bundled = await build({
  stdin: { contents: adapterSource, resolveDir: process.cwd() },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
})
const { createNoteDocument } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'))

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

test('Typewriter draft journal is debounced and flushed immediately before save', async () => {
  const writes = []
  const removes = []
  const storage = new Map()
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { writes.push({ key, value }); storage.set(key, value) },
    removeItem: key => { removes.push(key); storage.delete(key) },
  }
  let saveCalls = 0
  globalThis.__fridayReadNote = async () => ({ id: 'note-1', title: 'Test', content: '<p>base</p>', revision: 1 })
  globalThis.__fridaySaveNote = async ({ noteId, title, baseRevision, content, contentText }) => {
    saveCalls += 1
    assert.equal(noteId, 'note-1')
    assert.equal(title, 'Test')
    assert.equal(baseRevision, 1)
    assert.equal(content, '<p>hello world</p>\n')
    assert.equal(contentText, 'hello world\n')
    return { id: 'note-1', title: 'Test', content, contentText, revision: 2 }
  }
  globalThis.DOMParser = class {
    parseFromString(html) {
      return {
        body: { innerHTML: html, textContent: html.replace(/<[^>]+>/g, '') },
        querySelectorAll: () => [],
      }
    }
  }

  const document = createNoteDocument({ notes: [] }, {
    id: 'note-1', title: 'Test', content: '<p>base</p>', revision: 1,
  }, () => {}, 'hello')

  document.change('hello world')
  assert.equal(writes.length, 0, 'typing must not synchronously serialize the whole draft')
  await wait(100)
  assert.equal(writes.length, 0, 'journal remains deferred while typing continues')
  await wait(300)
  assert.equal(writes.length, 0)
  await wait(120)
  assert.equal(writes.length, 1)
  assert.deepEqual(JSON.parse(writes[0].value), { base: '<p>base</p>', text: 'hello world' })

  document.change('hello world')
  await document.flush()
  assert.equal(saveCalls, 1)
  assert.ok(removes.length >= 1, 'successful save clears the recovery journal immediately')
})
