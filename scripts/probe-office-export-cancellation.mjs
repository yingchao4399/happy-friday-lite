// 只转换本探针生成的幻灯片；不关闭、不读取用户现有的系统 Office 文档。
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import PptxGenJS from 'pptxgenjs'
import { exportDocument } from '../src-electron/office/export-document.js'
import { removePathNoFollow } from '../src-electron/fs-safe.js'

const run = promisify(execFile)
async function officeProcesses() {
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "@(Get-Process -Name WINWORD,EXCEL,POWERPNT -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) | ConvertTo-Json -Compress"], { windowsHide: true })
  return new Set(stdout.trim() ? [JSON.parse(stdout)].flat() : [])
}
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-export-cancel-probe-'))
try {
  const before = await officeProcesses()
  // 转换器在已有 Office 实例时应拒绝操作，不能让验收关闭用户进程。
  assert.equal(before.size, 0, '请在系统 Office 空闲时运行；探针不会关闭现有 Office')
  const deck = new PptxGenJS()
  for (let index = 0; index < 30; index++) deck.addSlide().addText('FRIDAY CANCEL ' + index, { x: 1, y: 1, w: 8, h: 2 })
  const bytes = await deck.write({ outputType: 'nodebuffer' })
  for (const cancelAt of ['native-starting', 'native-ready', 'native-converting']) {
    const targetPath = path.join(root, cancelAt + '.mp4')
    await fs.writeFile(targetPath, 'ORIGINAL_TARGET')
    const controller = new AbortController()
    const stages = []
    await assert.rejects(exportDocument({ kind: 'slides', format: 'mp4', bytes, targetPath }, {
      signal: controller.signal,
      onProgress: progress => { stages.push(progress.stage); if (progress.stage === cancelAt) controller.abort() },
    }), /OFFICE_EXPORT_CANCELLED/)
    assert.ok(stages.includes(cancelAt), '必须到达实际取消阶段')
    assert.equal(await fs.readFile(targetPath, 'utf8'), 'ORIGINAL_TARGET')
    const after = await officeProcesses()
    assert.deepEqual(after, before, '取消后不能残留本次 Office 进程')
    console.log(JSON.stringify({ ok: true, cancelAt, stages, targetPreserved: true, noOfficeResidue: true }))
  }
} finally { await removePathNoFollow(root, { root: os.tmpdir() }) }
