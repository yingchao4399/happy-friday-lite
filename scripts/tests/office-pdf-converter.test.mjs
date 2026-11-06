import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const vendor = path.join(root, 'vendor/happyoffice')
const vendorRequire = createRequire(path.join(vendor, 'package.json'))
const require = createRequire(import.meta.url)

test('pure PDF converter bundles without Electron and converts with explicit resources from an unrelated cwd', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-pdf-worker-'))
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  const esbuild = vendorRequire('esbuild')
  const output = path.join(temporary, 'pdf-converter.cjs')
  const built = await esbuild.build({
    entryPoints: [path.join(root, 'scripts/office/entries/pdf-converter.ts')], outfile: output,
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', minify: true, keepNames: true,
    nodePaths: [path.join(vendor, 'node_modules')], metafile: true,
    banner: { js: "const __fridayBundleUrl = require('node:url').pathToFileURL(__filename).href;" },
    define: { 'import.meta.url': '__fridayBundleUrl' }, logLevel: 'silent',
  })
  assert.ok(!Object.keys(built.metafile.inputs).some(file => /apps[\\/]shell[\\/]/.test(file)))
  assert.ok(!Object.values(built.metafile.outputs).some(item => item.imports.some(dependency => dependency.path === 'electron')))
  const module = require(output)
  assert.equal(typeof module.convertSnapshot, 'function')
  await assert.rejects(module.convertSnapshot({ bytes: new Uint8Array(), wasmPath: 'relative' }), { code: 'PDF_SNAPSHOT_INVALID' })
  await assert.rejects(module.convertSnapshot({ bytes: new Uint8Array([1]), wasmPath: 'relative' }), { code: 'PDFIUM_RESOURCE_PATH_INVALID' })

  const { PDFDocument, StandardFonts } = vendorRequire('pdf-lib')
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const page = pdf.addPage([595, 842])
  page.drawText('Friday PDF conversion contract 2026', { x: 72, y: 750, font, size: 16 })
  const pdfPath = path.join(temporary, 'source.pdf')
  fs.writeFileSync(pdfPath, await pdf.save())
  const docxPath = path.join(temporary, 'result.docx')
  const scriptPath = path.join(temporary, 'run.cjs')
  fs.writeFileSync(scriptPath, `const fs = require('node:fs')
const { convertSnapshot } = require('./pdf-converter.cjs')
const progress = []
convertSnapshot({ bytes: new Uint8Array(fs.readFileSync(process.argv[2])), wasmPath: process.argv[3], ocrHelperDir: process.argv[4] }, (page, total) => progress.push([page, total]))
  .then(result => { fs.writeFileSync(process.argv[5], result.docx); console.log(JSON.stringify({ pages: result.pages, scannedDocument: result.scannedDocument, warnings: result.warnings, pageResults: result.pageResults, progress })) })
  .catch(error => { console.error(error.stack); process.exitCode = 1 })
`)
  const unrelated = path.join(temporary, '隔离的工作目录')
  fs.mkdirSync(unrelated)
  const result = spawnSync(process.execPath, [scriptPath, pdfPath, path.join(vendor, 'node_modules/@embedpdf/pdfium/dist/pdfium.wasm'), path.join(temporary, 'missing-optional-ocr'), docxPath], {
    cwd: unrelated, encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
  })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  const report = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1))
  assert.equal(report.pages, 1)
  assert.equal(report.scannedDocument, false)
  assert.equal(report.pageResults.length, 1)
  assert.deepEqual(report.progress, [[1, 1]])
  const AdmZip = require('adm-zip')
  const zip = new AdmZip(docxPath)
  assert.ok(zip.getEntry('[Content_Types].xml'))
  const xml = zip.readAsText('word/document.xml')
  const text = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(match => match[1]).join('')
  assert.match(text, /Friday PDF conversion contract 2026/)
})
