import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

// 选区仅导出调用时的文字快照，不读取或覆盖源文档。
export async function exportSelectionText({ text, targetPath, sourcePath }) {
  if (typeof text !== 'string' || !text.trim() || text.length > 4 * 1024 * 1024) throw new Error('OFFICE_SELECTION_INVALID')
  if (typeof targetPath !== 'string' || !path.isAbsolute(targetPath) || targetPath.includes('\0') || !targetPath.toLowerCase().endsWith('.txt')) throw new Error('OFFICE_EXPORT_TARGET_INVALID')
  if (sourcePath) {
    const [source, target] = await Promise.all([fs.realpath(sourcePath).catch(() => path.resolve(sourcePath)), fs.realpath(targetPath).catch(() => path.resolve(targetPath))])
    if (source.toLowerCase() === target.toLowerCase()) throw new Error('OFFICE_EXPORT_SOURCE_OVERWRITE')
    const [a, b] = await Promise.all([fs.stat(sourcePath).catch(() => null), fs.stat(targetPath).catch(() => null)])
    if (a && b && a.dev === b.dev && a.ino === b.ino) throw new Error('OFFICE_EXPORT_SOURCE_OVERWRITE')
  }
  const temporary = path.join(path.dirname(targetPath), `.friday-selection-${crypto.randomUUID()}.tmp`)
  try {
    const bytes = Buffer.from('\ufeff' + text, 'utf8')
    await fs.writeFile(temporary, bytes, { flag: 'wx' })
    await fs.rename(temporary, targetPath)
    return { ok: true, data: { path: targetPath, bytes: bytes.length }, warnings: [], error: null, affectedResources: [targetPath], undo: null }
  } finally { await fs.unlink(temporary).catch(() => {}) }
}
