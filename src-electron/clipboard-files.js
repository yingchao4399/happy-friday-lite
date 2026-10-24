import fs from 'node:fs'
import path from 'node:path'
import { clipboardFileType } from './clipboard-content.js'

// 文件路径始终来自主进程保存的条目，渲染层仅使用条目 ID 和索引。
export function clipboardFileEntries(files = [], previous = []) {
  return files.map((file, index) => {
    let kind = previous.find(entry => entry.path === file)?.kind || clipboardFileType(file).kind
    let available = false
    try {
      const stat = fs.statSync(file)
      available = stat.isDirectory() || stat.isFile()
      kind = stat.isDirectory() ? 'folder' : clipboardFileType(file).kind
    } catch {}
    return { index, path: file, name: path.basename(file) || file, kind, available }
  })
}

export function clipboardFileItemKind(item, entries) {
  if (entries.length !== 1 || item.sensitivity === 'secret' || item.parts?.length || item.imagePath || item.html || item.kind === 'mixed') return item.kind
  return entries[0].kind
}
