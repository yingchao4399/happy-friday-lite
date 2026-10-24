import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { removePathNoFollow } from './fs-safe.js'

export async function prepareClipboardShareFiles(filePaths, { onProgress = () => {}, maxBytes, maxEntries } = {}) {
  const files = [], folders = []
  if (filePaths.length > 100) throw new Error('CLIPBOARD_SHARE_TOO_MANY_FILES')
  for (const file of filePaths) {
    let stat
    try { stat = await fs.lstat(file) } catch { throw new Error('CLIPBOARD_SHARE_FILE_MISSING') }
    if (stat.isSymbolicLink()) throw new Error('CLIPBOARD_SHARE_LINK_UNSUPPORTED')
    if (stat.isDirectory()) folders.push(file)
    else if (stat.isFile()) files.push(file)
    else throw new Error('CLIPBOARD_SHARE_FILE_UNAVAILABLE')
  }
  if (!folders.length) return { files, directory: null, folderCount: 0 }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-clipboard-share-'))
  try {
    const archives = await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./clipboard-share-worker.js', import.meta.url), { workerData: { folders, directory, maxBytes, maxEntries } })
      let settled = false
      const timeout = setTimeout(() => finish(new Error('CLIPBOARD_SHARE_FOLDER_TIMEOUT')), 120000)
      function finish(error, result) {
        if (settled) return
        settled = true; clearTimeout(timeout)
        // 等线程退出再清理目录，避免 Windows 上仍持有压缩文件句柄。
        worker.terminate().then(() => error ? reject(error) : resolve(result), reject)
      }
      worker.on('message', message => {
        if (message.done) finish(message.error ? new Error(message.error) : null, message.files)
        else onProgress(message)
      })
      worker.on('error', error => finish(error))
      worker.on('exit', () => { if (!settled) finish(new Error('CLIPBOARD_SHARE_FOLDER_FAILED')) })
    })
    return { files: [...files, ...archives], directory, folderCount: folders.length }
  } catch (error) { await removePathNoFollow(directory, { root: os.tmpdir() }); throw error }
}

export async function removeClipboardShareDirectory(directory) {
  if (!directory || path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('friday-clipboard-share-')) return
  for (let attempt = 0; attempt <= 10; attempt++) {
    try { await removePathNoFollow(directory, { root: os.tmpdir() }); return } catch (error) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code) || attempt === 10) return
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
}
