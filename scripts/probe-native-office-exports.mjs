// 只生成本脚本创建的测试文档，不打开用户 Office 文档。
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import XLSX from 'xlsx'
import PptxGenJS from 'pptxgenjs'
import AdmZip from 'adm-zip'
import sharp from 'sharp'
import { exportDocument } from '../src-electron/office/export-document.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = path.join(root, 'app-data', 'diagnostics', 'office-native-exports')
await fs.mkdir(directory, { recursive: true })
const doc = new AdmZip()
doc.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'))
doc.addFile('_rels/.rels', Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'))
doc.addFile('word/document.xml', Buffer.from('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>FRIDAY 中文导出验收</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>'))
const docs = doc.toBuffer()
const workbook = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['验收项目', '值'], ['导出', 42]]), '中文工作表')
const sheets = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
const presentation = new PptxGenJS()
for (const text of ['FRIDAY EXPORT 1', 'FRIDAY EXPORT 2']) {
  const slide = presentation.addSlide()
  slide.addText(text, { x: 1, y: 1, w: 7, h: 2, fontSize: 32 })
  slide.addNotes('Speaker notes ' + text)
}
const slides = await presentation.write({ outputType: 'nodebuffer' })
const results = []
for (const [kind, bytes, formats] of [['docs', docs, ['doc', 'xps']], ['sheets', sheets, ['pdf', 'xps']], ['slides', slides, process.argv.includes('--types-only') ? ['ppt', 'potx', 'pot', 'ppsx', 'pps', 'odp'] : ['pdf', 'xps', 'gif', 'mp4']]]) {
  if (process.argv.includes('--docs-only') && kind !== 'docs') continue
  if (process.argv.includes('--types-only') && kind !== 'slides') continue
  for (const format of formats) {
    const targetPath = path.join(directory, `${kind}-验收.${format}`)
    try {
      const result = await exportDocument({ kind, bytes, format, targetPath })
      const output = await fs.readFile(targetPath)
      if (['doc', 'ppt', 'pot', 'pps'].includes(format)) assert.equal(output.subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1')
      if (['potx', 'ppsx'].includes(format)) {
        const zip = new AdmZip(output)
        const type = format === 'potx' ? 'template' : 'slideshow'
        assert.ok(zip.readAsText('[Content_Types].xml').includes(`presentationml.${type}.main+xml`))
        assert.equal(zip.getEntries().filter(entry => /^ppt\/slides\/slide\d+\.xml$/.test(entry.entryName)).length, 2)
        assert.ok(zip.readAsText('ppt/notesSlides/notesSlide1.xml').includes('Speaker notes'))
      }
      if (format === 'odp') {
        const zip = new AdmZip(output)
        assert.equal(zip.readAsText('mimetype'), 'application/vnd.oasis.opendocument.presentation')
        assert.ok(zip.readAsText('content.xml').includes('FRIDAY EXPORT 1'))
      }
      if (format === 'pdf') assert.equal(output.subarray(0, 4).toString(), '%PDF')
      if (format === 'xps') assert.ok(new AdmZip(output).getEntries().some(entry => /\.fpage$/i.test(entry.entryName)))
      if (format === 'mp4') assert.equal(output.subarray(4, 8).toString(), 'ftyp')
      if (format === 'gif') { const metadata = await sharp(output, { animated: true }).metadata(); assert.ok(metadata.pages > 1, 'GIF 必须含多帧') }
      results.push({ kind, format, ok: result.ok, bytes: output.length })
    } catch (error) { results.push({ kind, format, ok: false, code: error.message, detail: error.detail }); process.exitCode = 1 }
    console.log(JSON.stringify(results.at(-1)))
  }
}
const report = process.argv.includes('--types-only') ? 'file-types-results.json' : process.argv.includes('--docs-only') ? 'word-results.json' : 'results.json'
await fs.writeFile(path.join(directory, report), JSON.stringify(results, null, 2))
