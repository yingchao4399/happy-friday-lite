// Generated fixtures only. This probe measures converter content/structure and worker behavior;
// it deliberately makes no pixel-perfect layout or installer acceptance claim.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { performance } from 'node:perf_hooks'
import { spawnSync } from 'node:child_process'
import AdmZip from 'adm-zip'
import { DOMParser } from '@xmldom/xmldom'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const vendorRequire = createRequire(path.join(projectRoot, 'vendor/happyoffice/package.json'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const hashFile = file => hash(fs.readFileSync(file))
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const normalized = text => String(text).normalize('NFKC').replace(/\s+/gu, '').toUpperCase()
const fault = (code, message = code) => Object.assign(new Error(message), { code })

export function parseQualityArguments(args) {
  const options = {}
  for (let index = 0; index < args.length; index++) {
    const match = /^(--packaged-app|--report)(?:=(.*))?$/.exec(args[index])
    if (!match) throw fault('OFFICE_QUALITY_ARGUMENT_INVALID', 'Usage: node scripts/probe-office-conversion-quality.mjs [--packaged-app <absolute app directory>] [--report <absolute JSON path>]')
    const key = match[1] === '--packaged-app' ? 'packagedApp' : 'reportFile'
    const value = match[2] === undefined ? args[++index] : match[2]
    if (options[key] || !value || !path.isAbsolute(value) || value.includes('\0')) throw fault('OFFICE_QUALITY_ARGUMENT_INVALID', 'Arguments must be unique absolute paths')
    options[key] = path.resolve(value)
  }
  return options
}

function runtimeFor(packagedApp) {
  const moduleRoot = packagedApp ? fs.realpathSync(packagedApp) : projectRoot
  const resourcesRoot = packagedApp ? path.dirname(moduleRoot) : path.join(projectRoot, 'resources')
  const officeRoot = path.join(resourcesRoot, 'office')
  const packageJson = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'package.json'), 'utf8'))
  const bundlePath = path.join(officeRoot, 'main/pdf-converter.cjs')
  const wasmPath = path.join(officeRoot, 'wasm/pdfium.wasm')
  const adapterPath = path.join(moduleRoot, 'src-electron/office/converter-adapter.js')
  const workerPath = path.join(moduleRoot, 'src-electron/office/conversion-worker.js')
  const validationPath = path.join(moduleRoot, 'src-electron/office/artifact-delivery.js')
  const manifestPath = path.join(officeRoot, 'integration-manifest.json')
  const files = [bundlePath, wasmPath, adapterPath, workerPath, validationPath, manifestPath]
  const identities = files.map(file => ({ path: file, sha256: hashFile(file) }))
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const helper = path.join(officeRoot, 'ocr', process.platform === 'win32' ? 'win-ocr.exe' : 'vision-ocr')
  return {
    moduleRoot, resourcesRoot, officeRoot, bundlePath, wasmPath, adapterPath, validationPath, helper,
    evidence: { mode: packagedApp ? 'packaged-converter-and-worker' : 'source-adapter-and-bundled-converter', moduleRoot, releaseVersion: packageJson.releaseVersion, applicationVersion: packageJson.version, nodeVersion: process.version, platform: process.platform, arch: process.arch, officeReleaseVersion: manifest.releaseVersion, sourceIdentityDigest: manifest.sources?.identityDigest, resourcesDigest: manifest.resourcesDigest, files: identities, nativeOcrHelper: fs.existsSync(helper) ? { path: helper, sha256: hashFile(helper) } : null },
    unchanged: () => identities.every(item => hashFile(item.path) === item.sha256),
  }
}

function scanImage(createCanvas, lines) {
  const canvas = createCanvas(1224, 1584)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, 1224, 1584)
  context.fillStyle = '#000000'
  context.font = 'bold 42px Arial'
  lines.forEach((line, index) => context.fillText(line, 120, 210 + index * 78))
  context.font = '30px Arial'
  context.fillText('This generated page contains pixels and no PDF text layer.', 120, 530)
  context.fillText('The output must disclose whether text recognition was used.', 120, 585)
  return canvas.toBuffer('image/png')
}

async function chinesePdf(wasmPath) {
  const candidates = process.platform === 'win32'
    ? ['simhei.ttf', 'simkai.ttf', 'simfang.ttf'].map(name => path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', name))
    : ['/System/Library/Fonts/Supplemental/Arial Unicode.ttf', '/usr/share/fonts/truetype/arphic/ukai.ttc']
  const fontFile = candidates.find(file => fs.existsSync(file) && !file.endsWith('.ttc'))
  if (!fontFile) return { skipped: 'No supported single-face system CJK font was found' }
  const { init } = vendorRequire('@embedpdf/pdfium')
  const raw = fs.readFileSync(wasmPath)
  const wrapped = await init({ wasmBinary: raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), thisProgram: 'friday-quality-fixture' })
  const m = wrapped.pdfium || wrapped
  m._PDFiumExt_Init()
  const fontBytes = fs.readFileSync(fontFile)
  const doc = m._FPDF_CreateNewDocument()
  let font = 0
  try {
    const page = m._FPDFPage_New(doc, 0, 612, 792)
    const fontPointer = m._malloc(fontBytes.length)
    m.HEAPU8.set(fontBytes, fontPointer)
    try { font = m._FPDFText_LoadFont(doc, fontPointer, fontBytes.length, 2, 1) } finally { m._free(fontPointer) }
    if (!font) throw fault('OFFICE_QUALITY_CJK_FONT_LOAD_FAILED')
    const markers = ['中文转换质量验证', '同源文件不可修改', 'FRIDAY CHINESE TEST 8246']
    for (let index = 0; index < markers.length; index++) {
      const text = Buffer.from(markers[index] + '\0', 'utf16le')
      const pointer = m._malloc(text.length)
      const object = m._FPDFPageObj_CreateTextObj(doc, font, 16)
      m.HEAPU8.set(text, pointer)
      try { if (!m._FPDFText_SetText(object, pointer)) throw fault('OFFICE_QUALITY_CJK_TEXT_FAILED') } finally { m._free(pointer) }
      m._FPDFPageObj_Transform(object, 1, 0, 0, 1, 72, 720 - index * 38)
      m._FPDFPage_InsertObject(page, object)
    }
    if (!m._FPDFPage_GenerateContent(page)) throw fault('OFFICE_QUALITY_CJK_PAGE_FAILED')
    m._FPDF_ClosePage(page)
    const writer = m._PDFiumExt_OpenFileWriter()
    try {
      if (!m._PDFiumExt_SaveAsCopy(doc, writer)) throw fault('OFFICE_QUALITY_CJK_SAVE_FAILED')
      const size = m._PDFiumExt_GetFileWriterSize(writer)
      const pointer = m._malloc(size)
      try {
        m._PDFiumExt_GetFileWriterData(writer, pointer, size)
        return { bytes: Buffer.from(m.HEAPU8.subarray(pointer, pointer + size)), markers, font: { path: fontFile, sha256: hash(fontBytes) } }
      } finally { m._free(pointer) }
    } finally { m._PDFiumExt_CloseFileWriter(writer) }
  } finally { if (font) m._FPDFFont_Close(font); m._FPDF_CloseDocument(doc) }
}

/** Every source PDF is generated here. Fixed PDF timestamps make ordinary fixtures reproducible. */
export async function generateQualityFixtures({ directory, wasmPath, includeChinese = true }) {
  fs.mkdirSync(directory, { recursive: true })
  const { PDFDocument, StandardFonts, rgb } = vendorRequire('pdf-lib')
  const { createCanvas } = vendorRequire('@napi-rs/canvas')
  const fixtures = []
  const make = async () => {
    const doc = await PDFDocument.create()
    doc.setCreationDate(new Date('2026-01-01T00:00:00.000Z'))
    doc.setModificationDate(new Date('2026-01-01T00:00:00.000Z'))
    doc.setProducer('Friday synthetic conversion quality fixture v1')
    const font = await doc.embedFont(StandardFonts.Helvetica)
    return { doc, font }
  }
  const add = async (id, doc, specification) => {
    const bytes = Buffer.isBuffer(doc) ? doc : Buffer.from(await doc.save())
    const sourcePath = path.join(directory, `${id}.pdf`)
    fs.writeFileSync(sourcePath, bytes)
    fixtures.push({ id, sourcePath, ...specification })
  }
  let f = await make()
  const multiMarkers = []
  for (let index = 1; index <= 3; index++) {
    const marker = `FRIDAY MULTIPAGE PAGE ${index} MARKER ${1428 + index}`
    multiMarkers.push(marker)
    const page = f.doc.addPage([612, 792])
    page.drawText(marker, { x: 64, y: 722, size: 16, font: f.font })
    for (let line = 0; line < 10; line++) page.drawText(`Page ${index} body line ${line + 1} preserves editable English content.`, { x: 64, y: 680 - line * 24, size: 12, font: f.font })
  }
  await add('english-multipage', f.doc, { expectedPages: 3, markers: multiMarkers, ocr: false })

  f = await make()
  let page = f.doc.addPage([612, 792])
  const columnMarkers = ['FRIDAY TWO COLUMN TITLE', 'LEFT COLUMN ALPHA', 'LEFT COLUMN BETA', 'RIGHT COLUMN GAMMA', 'RIGHT COLUMN DELTA']
  page.drawText(columnMarkers[0], { x: 64, y: 730, size: 18, font: f.font })
  for (let index = 0; index < 10; index++) {
    page.drawText(index === 0 ? columnMarkers[1] : index === 7 ? columnMarkers[2] : `Left paragraph line ${index} content`, { x: 64, y: 680 - index * 26, size: 11, font: f.font })
    page.drawText(index === 0 ? columnMarkers[3] : index === 7 ? columnMarkers[4] : `Right paragraph line ${index} content`, { x: 330, y: 680 - index * 26, size: 11, font: f.font })
  }
  await add('two-column', f.doc, { expectedPages: 1, markers: columnMarkers, expectedReadingOrder: [columnMarkers[1], columnMarkers[2], columnMarkers[3], columnMarkers[4]], ocr: false, inspectColumns: true })

  f = await make()
  page = f.doc.addPage([612, 792])
  page.drawText('FRIDAY GRID TABLE 3640', { x: 64, y: 730, size: 16, font: f.font })
  const rows = [['ITEM', 'PRICE', 'COUNT'], ['ALPHA', '100', '2'], ['BETA', '200', '3'], ['TOTAL', '300', '5']]
  for (let row = 0; row <= 4; row++) page.drawLine({ start: { x: 64, y: 670 - row * 40 }, end: { x: 514, y: 670 - row * 40 }, thickness: 1, color: rgb(0, 0, 0) })
  for (let column = 0; column <= 3; column++) page.drawLine({ start: { x: 64 + column * 150, y: 670 }, end: { x: 64 + column * 150, y: 510 }, thickness: 1, color: rgb(0, 0, 0) })
  rows.forEach((row, i) => row.forEach((text, j) => page.drawText(text, { x: 76 + j * 150, y: 644 - i * 40, size: 12, font: f.font })))
  await add('grid-table', f.doc, { expectedPages: 1, markers: ['FRIDAY GRID TABLE 3640', 'ALPHA', 'BETA', 'TOTAL', '100', '200', '300'], minTables: 1, ocr: false })

  const art = createCanvas(480, 240)
  const artContext = art.getContext('2d')
  artContext.fillStyle = '#f4f7fb'; artContext.fillRect(0, 0, 480, 240)
  for (let index = 0; index < 5; index++) { artContext.fillStyle = ['#2878c4', '#28a888', '#e9a63a', '#7c56ba', '#dc6858'][index]; artContext.fillRect(34 + index * 88, 210 - index * 29, 54, 25 + index * 29) }
  const artPng = art.toBuffer('image/png')
  fs.writeFileSync(path.join(directory, 'generated-chart.png'), artPng)
  f = await make(); page = f.doc.addPage([612, 792])
  const artImage = await f.doc.embedPng(artPng)
  page.drawText('FRIDAY IMAGE BEFORE 4751', { x: 64, y: 730, size: 16, font: f.font })
  page.drawImage(artImage, { x: 64, y: 410, width: 480, height: 240 })
  page.drawText('FRIDAY IMAGE AFTER 4752', { x: 64, y: 360, size: 16, font: f.font })
  await add('text-and-image', f.doc, { expectedPages: 1, markers: ['FRIDAY IMAGE BEFORE 4751', 'FRIDAY IMAGE AFTER 4752'], minImages: 1, ocr: false })

  const scanMarkers = ['FRIDAY SCAN ALPHA', 'PDF WORD QUALITY MATRIX', 'LOCAL OCR RECOGNITION TEST']
  const scanPng = scanImage(createCanvas, scanMarkers)
  const scanPngPath = path.join(directory, 'generated-scan.png')
  fs.writeFileSync(scanPngPath, scanPng)
  f = await make(); page = f.doc.addPage([612, 792])
  page.drawImage(await f.doc.embedPng(scanPng), { x: 0, y: 0, width: 612, height: 792 })
  const scanPdf = Buffer.from(await f.doc.save())
  await add('scan-without-ocr', scanPdf, { expectedPages: 1, markers: [], absentMarkers: scanMarkers, expectedStatuses: ['scanned'], minImages: 1, requireWarning: true, ocr: false })
  await add('scan-with-real-ocr', scanPdf, { expectedPages: 1, markers: scanMarkers, expectedStatuses: ['ocr'], ocr: true, requireRealOcr: true })

  f = await make()
  f.doc.addPage([612, 792]).drawText('FRIDAY MIXED DIGITAL ONE 5862', { x: 64, y: 720, size: 16, font: f.font })
  f.doc.addPage([612, 792]).drawImage(await f.doc.embedPng(scanPng), { x: 0, y: 0, width: 612, height: 792 })
  f.doc.addPage([612, 792]).drawText('FRIDAY MIXED DIGITAL THREE 5863', { x: 64, y: 720, size: 16, font: f.font })
  await add('mixed-digital-and-scan', f.doc, { expectedPages: 3, markers: ['FRIDAY MIXED DIGITAL ONE 5862', ...scanMarkers, 'FRIDAY MIXED DIGITAL THREE 5863'], expectedStatuses: ['ok', 'ocr', 'ok'], ocr: true, requireRealOcr: true })
  await add('damaged-pdf', Buffer.from('%PDF-1.7\nFriday deliberately malformed synthetic PDF; no catalog or cross-reference.'), { expectedError: true, ocr: false })

  f = await make()
  for (let index = 0; index < 80; index++) {
    const longPage = f.doc.addPage([612, 792])
    for (let line = 0; line < 24; line++) longPage.drawText(`Friday cancellation page ${index + 1} line ${line + 1} busy conversion marker.`, { x: 50, y: 740 - line * 25, size: 11, font: f.font })
  }
  await add('cancel-in-flight', f.doc, { expectedErrorCode: 'OFFICE_OPERATION_CANCELLED', cancelOnFirstProgress: true, ocr: false })
  let chinese = { skipped: 'Disabled by test fixture options' }
  if (includeChinese) {
    chinese = await chinesePdf(wasmPath)
    if (chinese.bytes) await add('chinese-text-layer', chinese.bytes, { expectedPages: 1, markers: chinese.markers, ocr: false, font: chinese.font })
  }
  return { fixtures, scanPngPath, chinese: chinese.bytes ? { included: true, font: chinese.font } : { included: false, reason: chinese.skipped } }
}

export function inspectQualityDocx(bytes, markers = []) {
  const zip = new AdmZip(Buffer.from(bytes))
  const xml = zip.readAsText('word/document.xml')
  let malformed = false
  const doc = new DOMParser({ onError: () => { malformed = true } }).parseFromString(xml, 'application/xml')
  if (malformed || !doc?.documentElement) throw fault('OFFICE_QUALITY_DOCX_XML_INVALID')
  const nodes = name => Array.from(doc.getElementsByTagNameNS(WORD_NS, name))
  const textParts = zip.getEntries().filter(entry => /^word\/(?:document|header[0-9]+|footer[0-9]+|footnotes|endnotes)\.xml$/.test(entry.entryName)).map(entry => {
    let invalid = false
    const part = new DOMParser({ onError: () => { invalid = true } }).parseFromString(entry.getData().toString('utf8'), 'application/xml')
    if (invalid || !part?.documentElement) throw fault('OFFICE_QUALITY_DOCX_XML_INVALID')
    return { path: entry.entryName, text: Array.from(part.getElementsByTagNameNS(WORD_NS, 't')).map(node => node.textContent).join('\n'), fieldInstructions: Array.from(part.getElementsByTagNameNS(WORD_NS, 'instrText')).map(node => node.textContent) }
  })
  const mainBodyText = nodes('t').map(node => node.textContent).join('\n')
  const text = textParts.map(part => part.text).join('\n')
  const flat = normalized(text)
  const media = zip.getEntries().filter(entry => /^word\/media\/[^/]+$/.test(entry.entryName) && !entry.isDirectory).map(entry => ({ path: entry.entryName, bytes: entry.header.size, sha256: hash(entry.getData()) }))
  return {
    text, textCharacters: text.length, mainBodyText, textParts,
    markers: markers.map(marker => ({ marker, found: flat.includes(normalized(marker)), index: flat.indexOf(normalized(marker)), exactTextPresent: text.includes(marker), locations: textParts.filter(part => normalized(part.text).includes(normalized(marker))).map(part => part.path) })),
    imageParts: media, drawings: nodes('drawing').length + nodes('pict').length,
    tables: nodes('tbl').length, tableRows: nodes('tr').length, tableCells: nodes('tc').length,
    columns: nodes('cols').map(node => ({ count: node.getAttributeNS(WORD_NS, 'num') || '1', spacing: node.getAttributeNS(WORD_NS, 'space') || null })),
    explicitPageBreaks: nodes('br').filter(node => node.getAttributeNS(WORD_NS, 'type') === 'page').length,
    sections: nodes('sectPr').length,
    note: 'DOCX flow pagination and visual geometry are not established by XML counters; pages is the converter source-page count.',
  }
}

export function assessQualityCase(specification, observed, realOcrVerified = false) {
  const checks = []
  const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), ...(detail === undefined ? {} : { detail }) })
  check('source bytes unchanged', observed.sourceUnchanged)
  check('worker terminated before returning', observed.workerTerminated)
  check('no late progress after worker return', observed.noLateProgressAfterReturn)
  if (specification.expectedErrorCode) {
    check('expected cancellation identity', observed.error?.code === specification.expectedErrorCode, observed.error)
    check('conversion reached a real source page before abort', observed.progress?.length > 0 && observed.aborted)
    check('cancelled result not written', !observed.output)
  } else if (specification.expectedError) {
    check('damaged source rejected with an error', Boolean(observed.error) && !observed.output, observed.error)
    check('damaged source is not a timeout or worker crash', observed.error && !['OFFICE_CONVERSION_TIMEOUT', 'OFFICE_CONVERSION_WORKER_FAILED', 'OFFICE_CONVERSION_WORKER_EXIT'].includes(observed.error.code))
  } else {
    check('conversion returned successfully', !observed.error, observed.error)
    check('OOXML package validated', observed.output?.validation?.valid)
    check('persisted bytes match worker output', observed.output?.persistedHashMatches)
    check('expected source-page count', observed.conversion?.pages === specification.expectedPages, { expected: specification.expectedPages, actual: observed.conversion?.pages })
    const readback = observed.output?.readback
    check('all editable text markers recovered', Boolean(readback) && (specification.markers || []).every(marker => readback.markers.find(item => item.marker === marker)?.found))
    if (specification.absentMarkers) check('scan without OCR does not pretend editable recognized text', specification.absentMarkers.every(marker => !normalized(readback?.text || '').includes(normalized(marker))))
    if (specification.expectedStatuses) check('expected per-page conversion modes disclosed', JSON.stringify(observed.conversion?.pageResults?.map(page => page.status)) === JSON.stringify(specification.expectedStatuses), observed.conversion?.pageResults)
    if (specification.minImages) check('image content preserved in output', readback?.imageParts?.length >= specification.minImages && readback?.drawings >= specification.minImages)
    if (specification.minTables) check('table remains an editable table', readback?.tables >= specification.minTables, { tables: readback?.tables, rows: readback?.tableRows, cells: readback?.tableCells })
    if (specification.requireWarning) check('bitmap fallback warning returned', observed.conversion?.warnings?.length > 0, observed.conversion?.warnings)
    if (specification.expectedReadingOrder) {
      const positions = specification.expectedReadingOrder.map(marker => readback?.markers.find(item => item.marker === marker)?.index ?? -1)
      check('column text follows left-column then right-column order', positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])), positions)
    }
    if (specification.requireRealOcr) check('real installed OCR helper independently recognized generated pixels', realOcrVerified)
  }
  return { pass: checks.every(item => item.pass), checks, visualFidelity: 'not-rendered-or-human-reviewed', limitation: 'Passing measured checks establishes the named markers/structures, page outcomes and worker behavior; it does not establish perfect layout or arbitrary-document quality.' }
}

async function runCase(specification, runtime, convert, validate, realOcrVerified, samplesDirectory) {
  const sourceBefore = hashFile(specification.sourcePath)
  const bytes = new Uint8Array(fs.readFileSync(specification.sourcePath))
  const controller = new AbortController()
  const workers = []
  class ObservedWorker extends Worker { constructor(url, options) { super(url, options); workers.push(this) } }
  const start = performance.now()
  const progress = []
  let lastTick = start, maxGap = 0, ticks = 0
  const heartbeat = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - lastTick); lastTick = now; ticks++ }, 10)
  const observed = { source: { path: specification.sourcePath, bytes: bytes.byteLength, sha256: sourceBefore }, ocrRequested: specification.ocr, progress }
  try {
    const result = await convert({ bytes, wasmPath: runtime.wasmPath, ocrHelperDir: specification.ocr ? path.dirname(runtime.helper) : null }, {
      bundlePath: runtime.bundlePath, signal: controller.signal, WorkerClass: ObservedWorker, timeoutMs: 180000,
      onProgress: value => {
        progress.push({ ...value, elapsedMs: Math.round(performance.now() - start) })
        if (specification.cancelOnFirstProgress && !controller.signal.aborted) controller.abort()
      },
    })
    observed.conversion = { pages: result.pages, scannedDocument: result.scannedDocument, warnings: result.warnings, pageResults: result.pageResults }
    const outputPath = path.join(samplesDirectory, `${specification.id}.docx`)
    const outputBytes = Buffer.from(result.docx)
    const validation = validate(outputBytes)
    fs.writeFileSync(outputPath, outputBytes, { flag: 'wx' })
    const saved = fs.readFileSync(outputPath)
    observed.output = { path: outputPath, bytes: saved.length, sha256: hash(saved), persistedHashMatches: hash(saved) === hash(outputBytes), validation, readback: inspectQualityDocx(saved, specification.markers) }
    fs.writeFileSync(path.join(samplesDirectory, `${specification.id}-readback.txt`), observed.output.readback.text)
  } catch (error) { observed.error = { code: error.code || error.name || 'OFFICE_QUALITY_CONVERSION_ERROR', message: error.message } }
  finally {
    clearInterval(heartbeat)
    observed.elapsedMs = Math.round(performance.now() - start)
    observed.hostEventLoop = { timerIntervalMs: 10, ticks, maxObservedGapMs: Math.round(Math.max(maxGap, performance.now() - lastTick)), note: 'Host timer observation only; no UI render-rate or packaged-main-process performance claim.' }
    observed.aborted = controller.signal.aborted
    observed.workerCount = workers.length
    observed.workerTerminated = workers.length === 1 && workers.every(worker => worker.threadId === -1)
    observed.source.sha256After = hashFile(specification.sourcePath)
    observed.sourceUnchanged = observed.source.sha256After === sourceBefore
    // Termination is awaited by the production adapter. A short extra turn detects queued late callbacks.
    const before = progress.length
    await new Promise(resolve => setTimeout(resolve, 20))
    observed.noLateProgressAfterReturn = progress.length === before
  }
  return { id: specification.id, specification, ...observed, assessment: assessQualityCase(specification, observed, realOcrVerified) }
}

export async function runOfficeConversionQuality({ packagedApp, reportFile } = {}) {
  const runtime = runtimeFor(packagedApp)
  const target = reportFile || path.join(projectRoot, 'artifacts', `office-conversion-quality-${runtime.evidence.releaseVersion}.json`)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const samplesDirectory = fs.mkdtempSync(path.join(path.dirname(target), `${path.basename(target, path.extname(target))}-samples-`))
  const report = { schemaVersion: 1, ok: false, checkedAt: new Date().toISOString(), runtime: runtime.evidence, fixturePolicy: 'Only generated PDF/PNG samples; no user document is read.', samplesDirectory, cases: [], limitations: [
    'Structural validity is necessary but does not establish layout fidelity.',
    'Source-page count is not a rendered Word pagination measurement.',
    'No DOCX visual rendering or human comparison is performed by this script.',
    'Editable marker inspection includes main body, headers, footers and notes. Dynamic PAGE fields are reported as XML instructions; rendered page-field values are not evaluated.',
    'A synthetic matrix does not establish quality for arbitrary real PDF documents, an installed application, or live-model tool selection.',
  ] }
  const started = performance.now()
  try {
    const { convertOfficePdfSnapshot } = await import(pathToFileURL(runtime.adapterPath).href)
    const { validateDocx } = await import(pathToFileURL(runtime.validationPath).href)
    const generated = await generateQualityFixtures({ directory: samplesDirectory, wasmPath: runtime.wasmPath })
    report.chineseFixture = generated.chinese
    if (fs.existsSync(runtime.helper)) {
      const recognition = spawnSync(runtime.helper, [], { input: fs.readFileSync(generated.scanPngPath), maxBuffer: 8 * 1024 * 1024, timeout: 35000, windowsHide: true })
      let parsed
      try { parsed = JSON.parse(recognition.stdout?.toString('utf8').replace(/^\uFEFF/, '') || '') } catch { /* unavailable or malformed helper output remains explicit */ }
      const recognizedText = Array.isArray(parsed?.lines) ? parsed.lines.map(line => line.t).join('\n') : ''
      report.realOcr = { helper: runtime.evidence.nativeOcrHelper, processStatus: recognition.status, signal: recognition.signal, error: recognition.error?.message, stderr: recognition.stderr?.toString('utf8').slice(0, 4000), recognizedText, lines: parsed?.lines, paperShare: parsed?.paper, verified: recognition.status === 0 && normalized(recognizedText).includes(normalized('FRIDAY SCAN ALPHA')) }
    } else report.realOcr = { verified: false, reason: 'Installed OCR helper unavailable; OCR cases must not be reported as passed' }
    for (const specification of generated.fixtures) {
      const result = await runCase(specification, runtime, convertOfficePdfSnapshot, validateDocx, report.realOcr.verified, samplesDirectory)
      report.cases.push(result)
      process.stdout.write(JSON.stringify({ case: result.id, pass: result.assessment.pass, elapsedMs: result.elapsedMs, pageResults: result.conversion?.pageResults, error: result.error }) + '\n')
      // Preserve completed cases even when a later native worker fails or the caller interrupts.
      fs.writeFileSync(target, JSON.stringify(report, null, 2))
    }
    report.runtimeFilesUnchanged = runtime.unchanged()
    report.ok = report.runtimeFilesUnchanged && report.cases.every(item => item.assessment.pass)
    report.summary = { total: report.cases.length, passed: report.cases.filter(item => item.assessment.pass).length, failed: report.cases.filter(item => !item.assessment.pass).map(item => ({ id: item.id, checks: item.assessment.checks.filter(check => !check.pass) })), visualFidelity: 'not assessed' }
    const multipage = report.cases.find(item => item.id === 'english-multipage')
    if (multipage?.output) report.multipageHeaderObservation = {
      generatedTitles: multipage.specification.markers,
      recoveredMarkerLocations: multipage.output.readback.markers,
      headerParts: multipage.output.readback.textParts.filter(part => /\/header[0-9]+\.xml$/.test(part.path)),
      distinction: 'The first title may move from the source-page top into a Word header; that alone is not data loss. Missing later literal MARKER values are a separate measured content difference. Dynamic PAGE instructions do not supply those distinct MARKER values.',
      visualRenderingRequired: true,
    }
  } catch (error) { report.error = { code: error.code || error.name, message: error.message, stack: error.stack }; process.stderr.write(JSON.stringify(report.error) + '\n') }
  finally {
    report.elapsedMs = Math.round(performance.now() - started)
    report.finishedAt = new Date().toISOString()
    fs.writeFileSync(target, JSON.stringify(report, null, 2))
  }
  return { ...report, reportFile: target }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await runOfficeConversionQuality(parseQualityArguments(process.argv.slice(2)))
    process.stdout.write(JSON.stringify({ ok: result.ok, runtime: result.runtime.releaseVersion, summary: result.summary, reportFile: result.reportFile, error: result.error }, null, 2) + '\n')
    process.exitCode = result.ok ? 0 : 1
  } catch (error) { process.stderr.write(JSON.stringify({ ok: false, code: error.code || error.name, message: error.message }, null, 2) + '\n'); process.exitCode = 1 }
}
