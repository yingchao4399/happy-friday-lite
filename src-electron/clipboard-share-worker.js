import { parentPort, workerData } from 'node:worker_threads'
import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'

// 有界独立线程压缩，主进程不读取整个文件夹，也不会静默遗漏文件。
const { folders, directory, maxBytes = 256 * 1024 * 1024, maxEntries = 20000 } = workerData
let bytes = 0, count = 0
function fail(code) { throw Object.assign(new Error(code), { code }) }
function collect(file, name, entries) {
  const stat = fs.lstatSync(file)
  if (stat.isSymbolicLink()) fail('CLIPBOARD_SHARE_LINK_UNSUPPORTED')
  if (++count > maxEntries) fail('CLIPBOARD_SHARE_FOLDER_TOO_LARGE')
  if (stat.isDirectory()) {
    entries.push({ file, name: name + '/', directory: true })
    for (const entry of fs.readdirSync(file)) collect(path.join(file, entry), name + '/' + entry, entries)
  } else if (stat.isFile()) {
    bytes += stat.size
    if (bytes > maxBytes) fail('CLIPBOARD_SHARE_FOLDER_TOO_LARGE')
    entries.push({ file, name, size: stat.size, modified: stat.mtimeMs })
  } else fail('CLIPBOARD_SHARE_FILE_UNAVAILABLE')
}
try {
  const results = []
  for (let index = 0; index < folders.length; index++) {
    parentPort.postMessage({ stage: 'collecting', current: index, total: folders.length })
    const folder = folders[index], entries = []
    collect(folder, path.basename(folder) || 'folder', entries)
    const zip = new AdmZip()
    for (const entry of entries) {
      const current = fs.lstatSync(entry.file)
      if (current.isSymbolicLink()) fail('CLIPBOARD_SHARE_LINK_UNSUPPORTED')
      if (entry.directory) {
        if (!current.isDirectory()) fail('CLIPBOARD_SHARE_SOURCE_CHANGED')
        zip.addFile(entry.name, Buffer.alloc(0))
      } else {
        if (!current.isFile() || current.size !== entry.size || current.mtimeMs !== entry.modified) fail('CLIPBOARD_SHARE_SOURCE_CHANGED')
        const content = fs.readFileSync(entry.file), after = fs.statSync(entry.file)
        if (content.length !== entry.size || after.size !== entry.size || after.mtimeMs !== entry.modified) fail('CLIPBOARD_SHARE_SOURCE_CHANGED')
        zip.addFile(entry.name, content)
      }
    }
    parentPort.postMessage({ stage: 'archiving', current: index, total: folders.length })
    const archive = path.join(directory, (index + 1) + '-' + (path.basename(folder) || 'folder') + '.zip')
    zip.writeZip(archive)
    results.push(archive)
  }
  parentPort.postMessage({ done: true, files: results })
} catch (error) {
  const code = error.code?.startsWith('CLIPBOARD_SHARE_') ? error.code : ['ENOENT', 'ENOTDIR'].includes(error.code) ? 'CLIPBOARD_SHARE_FILE_MISSING' : 'CLIPBOARD_SHARE_FILE_UNAVAILABLE'
  parentPort.postMessage({ done: true, error: code })
}
