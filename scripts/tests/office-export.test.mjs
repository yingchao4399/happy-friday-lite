import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import sharp from 'sharp'
import PptxGenJS from 'pptxgenjs'
import mammoth from 'mammoth'
import XLSX from 'xlsx'
import { exportDocument, validateDocumentExport } from '../../src-electron/office/export-document.js'
import { removePathNoFollow } from '../../src-electron/fs-safe.js'

const fixture = new URL('../../vendor/happyoffice/fixtures/generated/kitchen-sink.docx', import.meta.url)
test('Word 导出当前快照 DOCX、TXT、Markdown，原文档不变，成功只在写入后报告', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-office-export-test-'))
  const bytes = await fs.readFile(fixture)
  try {
    for (const format of ['docx', 'txt', 'md']) {
      const targetPath = path.join(root, '中文导出.' + format)
      const stages = []
      const result = await exportDocument({ kind: 'docs', format, bytes, html: '<h1>更新的标题</h1><p>尚未保存的<strong>正文</strong></p><ul><li>保留列表</li></ul><table><tr><th>项目</th><th>值</th></tr><tr><td>A|B</td><td>42</td></tr></table>', plainText: '更新的标题\n尚未保存的正文\n保留列表', targetPath }, { onProgress: item => stages.push(item.stage) })
      assert.equal(result.ok, true)
      assert.deepEqual(result.affectedResources, [targetPath])
      assert.equal(stages.at(-1), 'complete')
      const output = await fs.readFile(targetPath)
      if (format === 'docx') assert.deepEqual(output, bytes)
      else if (format === 'md') {
        assert.match(output.toString('utf8'), /# 更新的标题[\s\S]*\*\*正文\*\*[\s\S]*保留列表/)
        assert.ok(output.toString('utf8').includes('| A\\|B | 42 |'))
      }
      else assert.match(output.toString('utf8'), /尚未保存的正文/)
    }
    assert.deepEqual(await fs.readFile(fixture), bytes)
  } finally { await removePathNoFollow(root, { root: os.tmpdir() }) }
})

test('表格文本导出覆盖所有工作表、中文和 Markdown 转义', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-sheets-export-test-'))
  try {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['项目', '内容'], ['A|B', '第一行\n第二行']]), '数据')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['第二张表']]), '汇总')
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    for (const format of ['txt', 'md', 'xlsx']) {
      const targetPath = path.join(root, '表格.' + format)
      await exportDocument({ kind: 'sheets', format, bytes, targetPath })
      const output = await fs.readFile(targetPath)
      if (format === 'xlsx') assert.equal(XLSX.read(output).SheetNames.length, 2)
      else {
        assert.match(output.toString(), /数据[\s\S]*汇总/)
        if (format === 'md') assert.ok(output.toString().includes('A\\|B'))
      }
    }
  } finally { await removePathNoFollow(root, { root: os.tmpdir() }) }
})

test('无效快照、源文件覆盖、扩展名冲突及取消保留原有目标', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-export-failure-'))
  try {
    const targetPath = path.join(root, '保留.docx')
    await fs.writeFile(targetPath, '原有文件')
    const bytes = await fs.readFile(fixture)
    assert.throws(() => validateDocumentExport({ kind: 'docs', format: 'docx', bytes, targetPath, sourcePath: targetPath }), /SOURCE_OVERWRITE/)
    assert.throws(() => validateDocumentExport({ kind: 'docs', format: 'md', bytes, targetPath }), /EXTENSION_MISMATCH/)
    const invalid = new AdmZip()
    invalid.addFile('[Content_Types].xml', Buffer.from('<Types/>'))
    await assert.rejects(exportDocument({ kind: 'docs', format: 'docx', bytes: invalid.toBuffer(), targetPath }), /SNAPSHOT_INVALID/)
    await assert.rejects(exportDocument({ kind: 'docs', format: 'docx', bytes, targetPath }, { signal: AbortSignal.abort() }))
    assert.equal(await fs.readFile(targetPath, 'utf8'), '原有文件')
    assert.deepEqual(await fs.readdir(root), ['保留.docx'])
  } finally { await removePathNoFollow(root, { root: os.tmpdir() }) }
})

test('Slides 讲义保留全部页面位图和含特殊字符的备注，并能作为 DOCX 解析', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-handout-test-'))
  try {
    const presentation = new PptxGenJS()
    presentation.addSlide().addText('页面 1', { x: 1, y: 1, w: 4, h: 2 })
    const bytes = await presentation.write({ outputType: 'nodebuffer' })
    const png = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#ffffff' } }).png().toBuffer()
    const targetPath = path.join(root, '讲义.handout.docx')
    await exportDocument({ kind: 'slides', format: 'handout.docx', bytes, targetPath, pages: [
      { pngBase64: png.toString('base64'), notes: '第一张备注 <保留> & 原文\n第二行' },
      { pngBase64: png.toString('base64'), notes: '第二张备注' },
    ] })
    const output = await fs.readFile(targetPath)
    const archive = new AdmZip(output)
    assert.equal(archive.getEntries().filter(entry => entry.entryName.startsWith('word/media/')).length, 2)
    const parsed = await mammoth.extractRawText({ buffer: output })
    assert.ok(parsed.value.includes('第一张备注 <保留> & 原文'))
    assert.ok(parsed.value.includes('第二张备注'))
    assert.equal(archive.readAsText('word/document.xml').match(/<w:br w:type="page"/g)?.length, 1)
  } finally { await removePathNoFollow(root, { root: os.tmpdir() }) }
})
