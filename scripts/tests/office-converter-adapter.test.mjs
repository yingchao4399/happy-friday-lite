import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { convertOfficePdfSnapshot } from '../../src-electron/office/converter-adapter.js'
import { validateDocx } from '../../src-electron/office/artifact-delivery.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const fixtureBundle = fileURLToPath(new URL('./fixtures/office-worker-converter.cjs', import.meta.url))
const require = createRequire(import.meta.url)
const vendorRequire = createRequire(path.join(root, 'vendor/happyoffice/package.json'))
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

function trackedWorker() {
  const workers = []
  class TrackedWorker extends Worker {
    constructor(url, options) {
      super(url, options)
      workers.push(this)
    }
  }
  return { workers, WorkerClass: TrackedWorker }
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-converter-adapter-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  return directory
}

test('real worker converts a PDF with fresh packaged resources and reports page progress', async () => {
  const { PDFDocument, StandardFonts } = vendorRequire('pdf-lib')
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const marker = 'Friday actual Worker adapter PDF delivery 7139'
  pdf.addPage([595, 842]).drawText(marker, { x: 72, y: 750, font, size: 16 })
  const progress = []
  const tracked = trackedWorker()
  const result = await convertOfficePdfSnapshot({ bytes: await pdf.save(), wasmPath: path.join(root, 'resources/office/wasm/pdfium.wasm'), ocrHelperDir: null }, {
    bundlePath: path.join(root, 'resources/office/main/pdf-converter.cjs'),
    onProgress: value => progress.push(value), WorkerClass: tracked.WorkerClass, timeoutMs: 60000,
  })
  assert.equal(result.pages, 1)
  assert.equal(result.scannedDocument, false)
  assert.equal(result.pageResults[0].status, 'ok')
  assert.deepEqual(progress, [{ page: 1, total: 1 }])
  assert.equal(validateDocx(result.docx).valid, true)
  const AdmZip = require('adm-zip')
  const xml = new AdmZip(Buffer.from(result.docx)).readAsText('word/document.xml')
  const text = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(match => match[1]).join('')
  assert.match(text, new RegExp(marker))
  assert.equal(tracked.workers.length, 1)
  assert.equal(tracked.workers[0].threadId, -1, '返回成功前独立 Worker 必须已经退出')
})

test('worker result and progress are delivered from an isolated thread and its lifetime ends', async () => {
  const progress = []
  const tracked = trackedWorker()
  const result = await convertOfficePdfSnapshot({ mode: 'success' }, { bundlePath: fixtureBundle, onProgress: value => progress.push(value), WorkerClass: tracked.WorkerClass })
  assert.ok(result.fixtureThreadId > 0)
  assert.deepEqual(progress, [{ page: 1, total: 2 }, { page: 2, total: 2 }])
  assert.deepEqual([...result.docx], [80, 75, 3, 4])
  assert.equal(tracked.workers[0].threadId, -1)
})

test('abort terminates a CPU-busy real worker without a late completion or a blocked host timer', async t => {
  const directory = await fixture(t)
  const completionFile = path.join(directory, 'late-completion.txt')
  const controller = new AbortController()
  const tracked = trackedWorker()
  let progressCount = 0
  const converting = convertOfficePdfSnapshot({ mode: 'busy', busyMs: 800, completionFile }, {
    bundlePath: fixtureBundle, signal: controller.signal, WorkerClass: tracked.WorkerClass,
    onProgress: () => { progressCount++; setTimeout(() => controller.abort(), 20) }, timeoutMs: 5000,
  })
  let resolved = false
  converting.then(() => { resolved = true }, () => {})
  await assert.rejects(converting, { code: 'OFFICE_OPERATION_CANCELLED' })
  assert.equal(progressCount, 1)
  assert.equal(tracked.workers[0].threadId, -1, '取消返回前必须 terminate 已完成')
  await pause(850)
  assert.equal(resolved, false)
  await assert.rejects(fs.stat(completionFile), { code: 'ENOENT' })
})

test('timeout terminates a long worker and keeps the timeout error code', async t => {
  const directory = await fixture(t)
  const completionFile = path.join(directory, 'timeout-late.txt')
  const tracked = trackedWorker()
  await assert.rejects(convertOfficePdfSnapshot({ mode: 'busy', busyMs: 5000, completionFile }, {
    bundlePath: fixtureBundle, WorkerClass: tracked.WorkerClass, timeoutMs: 1000,
  }), { code: 'OFFICE_CONVERSION_TIMEOUT' })
  assert.equal(tracked.workers[0].threadId, -1)
  await assert.rejects(fs.stat(completionFile), { code: 'ENOENT' })
})

test('converter errors, native Worker errors and early exits reject with their correct identities', async t => {
  for (const [mode, code] of [['throw', 'FIXTURE_CONVERSION_FAILED'], ['worker-error', 'OFFICE_CONVERSION_WORKER_FAILED'], ['exit', 'OFFICE_CONVERSION_WORKER_EXIT']]) {
    await t.test(mode, async () => {
      const tracked = trackedWorker()
      await assert.rejects(convertOfficePdfSnapshot({ mode }, { bundlePath: fixtureBundle, WorkerClass: tracked.WorkerClass, timeoutMs: 5000 }), { code })
      assert.equal(tracked.workers[0].threadId, -1)
    })
  }
})

test('an already-aborted request creates no worker', async () => {
  const controller = new AbortController()
  controller.abort()
  const tracked = trackedWorker()
  await assert.rejects(convertOfficePdfSnapshot({ mode: 'success' }, { bundlePath: fixtureBundle, signal: controller.signal, WorkerClass: tracked.WorkerClass }), { code: 'OFFICE_OPERATION_CANCELLED' })
  assert.equal(tracked.workers.length, 0)
})

test('queued progress cannot update the host after cancellation has settled the operation', async () => {
  const controller = new AbortController()
  const tracked = trackedWorker()
  const progress = []
  await assert.rejects(convertOfficePdfSnapshot({ mode: 'progress-burst' }, {
    bundlePath: fixtureBundle, signal: controller.signal, WorkerClass: tracked.WorkerClass,
    onProgress: value => { progress.push(value); controller.abort() }, timeoutMs: 5000,
  }), { code: 'OFFICE_OPERATION_CANCELLED' })
  assert.equal(tracked.workers[0].threadId, -1)
  assert.deepEqual(progress, [{ page: 1, total: 50 }])
})

test('a failed progress observer cannot crash the host or invalidate a successful conversion', async () => {
  const tracked = trackedWorker()
  let notifications = 0
  const result = await convertOfficePdfSnapshot({ mode: 'success' }, {
    bundlePath: fixtureBundle, WorkerClass: tracked.WorkerClass,
    onProgress: () => { notifications++; throw new Error('测试 UI 观察者故障') }, timeoutMs: 5000,
  })
  assert.equal(notifications, 2)
  assert.equal(result.pages, 2)
  assert.equal(tracked.workers[0].threadId, -1)
})
