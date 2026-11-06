import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { assessQualityCase, generateQualityFixtures, inspectQualityDocx, parseQualityArguments } from '../probe-office-conversion-quality.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const vendorRequire = createRequire(path.join(projectRoot, 'vendor/happyoffice/package.json'))
const { PDFDocument } = vendorRequire('pdf-lib')

test('quality CLI accepts unique absolute packaged/report paths in either syntax and rejects invalid arguments', () => {
  const app = path.resolve('安装目录/resources/app'), report = path.resolve('验收结果.json')
  assert.deepEqual(parseQualityArguments(['--packaged-app', app, `--report=${report}`]), { packagedApp: app, reportFile: report })
  assert.deepEqual(parseQualityArguments([`--packaged-app=${app}`, '--report', report]), { packagedApp: app, reportFile: report })
  for (const args of [['--report'], ['--report', 'relative.json'], ['--unknown'], ['--report', report, '--report', report]]) assert.throws(() => parseQualityArguments(args), { code: 'OFFICE_QUALITY_ARGUMENT_INVALID' })
})

test('DOCX inspection joins XML runs, decodes text and reports media/table/column structure', () => {
  const zip = new AdmZip()
  zip.addFile('word/document.xml', Buffer.from(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>FRIDAY &amp; </w:t></w:r><w:r><w:t>中文 MARKER</w:t></w:r><w:drawing/></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>CELL</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr><w:cols w:num="2"/></w:sectPr></w:body></w:document>`))
  zip.addFile('word/media/image1.png', Buffer.from('synthetic image bytes'))
  zip.addFile('word/header1.xml', Buffer.from('<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>HEADER TITLE 1429</w:t></w:r><w:r><w:instrText> PAGE </w:instrText></w:r></w:p></w:hdr>'))
  const result = inspectQualityDocx(zip.toBuffer(), ['FRIDAY & 中文 MARKER', 'MISSING'])
  assert.equal(result.markers[0].found, true)
  assert.equal(result.markers[1].found, false)
  assert.equal(result.tables, 1)
  assert.equal(result.tableCells, 1)
  assert.equal(result.drawings, 1)
  assert.equal(result.imageParts.length, 1)
  assert.equal(result.columns[0].count, '2')
  const headers = inspectQualityDocx(zip.toBuffer(), ['HEADER TITLE 1429', 'HEADER TITLE 1430'])
  assert.deepEqual(headers.markers[0].locations, ['word/header1.xml'])
  assert.equal(headers.markers[1].found, false)
  assert.deepEqual(headers.textParts.find(part => part.path === 'word/header1.xml').fieldInstructions, [' PAGE '])
})

test('valid OOXML cannot conceal missing markers, wrong page count or unverified actual OCR', () => {
  const specification = { expectedPages: 2, markers: ['EXPECTED'], requireRealOcr: true }
  const observed = { sourceUnchanged: true, workerTerminated: true, noLateProgressAfterReturn: true, conversion: { pages: 1 }, output: { validation: { valid: true }, persistedHashMatches: true, readback: { markers: [{ marker: 'EXPECTED', found: false }] } } }
  const result = assessQualityCase(specification, observed, false)
  assert.equal(result.pass, false)
  assert.ok(result.checks.some(item => item.name === 'all editable text markers recovered' && !item.pass))
  assert.ok(result.checks.some(item => item.name === 'expected source-page count' && !item.pass))
  assert.ok(result.checks.some(item => item.name === 'real installed OCR helper independently recognized generated pixels' && !item.pass))
  assert.equal(result.visualFidelity, 'not-rendered-or-human-reviewed')
})

test('cancellation must reach a real page, terminate its worker and produce no artifact', () => {
  const specification = { expectedErrorCode: 'OFFICE_OPERATION_CANCELLED' }
  const observed = { sourceUnchanged: true, workerTerminated: true, noLateProgressAfterReturn: true, aborted: true, progress: [{ page: 1, total: 80 }], error: { code: 'OFFICE_OPERATION_CANCELLED' } }
  assert.equal(assessQualityCase(specification, observed).pass, true)
  assert.equal(assessQualityCase(specification, { ...observed, progress: [] }).pass, false)
  assert.equal(assessQualityCase(specification, { ...observed, workerTerminated: false }).pass, false)
  assert.equal(assessQualityCase(specification, { ...observed, output: {} }).pass, false)
})

test('generated fixtures cover every required matrix category and contain no user source input', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-quality-fixtures-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const generated = await generateQualityFixtures({ directory, includeChinese: false })
  assert.deepEqual(generated.fixtures.map(item => item.id), ['english-multipage', 'two-column', 'grid-table', 'text-and-image', 'scan-without-ocr', 'scan-with-real-ocr', 'mixed-digital-and-scan', 'damaged-pdf', 'cancel-in-flight'])
  for (const fixture of generated.fixtures) {
    assert.equal(path.dirname(fixture.sourcePath), directory)
    assert.ok(fs.statSync(fixture.sourcePath).size > 0)
    if (fixture.expectedPages) assert.equal((await PDFDocument.load(fs.readFileSync(fixture.sourcePath))).getPageCount(), fixture.expectedPages)
  }
  assert.equal((await PDFDocument.load(fs.readFileSync(generated.fixtures.at(-1).sourcePath))).getPageCount(), 80)
  assert.equal(generated.fixtures.find(item => item.id === 'scan-without-ocr').ocr, false)
  assert.equal(generated.fixtures.find(item => item.id === 'scan-with-real-ocr').requireRealOcr, true)
})
