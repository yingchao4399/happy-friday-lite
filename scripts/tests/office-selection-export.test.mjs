import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { exportSelectionText } from '../../src-electron/office/export-selection.js'
import { removePathNoFollow } from '../../src-electron/fs-safe.js'

test('选区 TXT 精确保留中文、换行和字符边界，拒绝源文件硬链接及无效目标', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-selection-export-'))
  try {
    const sourcePath = path.join(root, 'source.pdf'), targetPath = path.join(root, '选区.txt')
    await fs.writeFile(sourcePath, '%PDF 原文')
    await fs.writeFile(targetPath, '旧目标')
    const text = '精确选区\n第二行 <>& 无额外相邻文字'
    const result = await exportSelectionText({ text, targetPath, sourcePath })
    assert.equal(result.ok, true)
    assert.equal(await fs.readFile(targetPath, 'utf8'), '\ufeff' + text)
    assert.equal(await fs.readFile(sourcePath, 'utf8'), '%PDF 原文')
    const linked = path.join(root, 'linked.txt')
    await fs.link(sourcePath, linked)
    await assert.rejects(exportSelectionText({ text, targetPath: linked, sourcePath }), /SOURCE_OVERWRITE/)
    await assert.rejects(exportSelectionText({ text: '', targetPath, sourcePath }), /SELECTION_INVALID/)
    await assert.rejects(exportSelectionText({ text, targetPath: sourcePath, sourcePath }), /TARGET_INVALID/)
    assert.equal((await fs.readdir(root)).some(name => name.endsWith('.tmp')), false)
  } finally { await removePathNoFollow(root, { root: os.tmpdir() }) }
})
