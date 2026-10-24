import fs from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Worker } from 'node:worker_threads'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { removePathNoFollow } from '../fs-safe.js'
const run = promisify(execFile)

export const documentExportFormats = Object.freeze({
  docs: ['docx', 'txt', 'md', 'doc', 'xps'],
  sheets: ['xlsx', 'txt', 'md', 'pdf', 'xps'],
  slides: ['pptx', 'ppt', 'potx', 'pot', 'ppsx', 'pps', 'odp', 'pdf', 'xps', 'mp4', 'gif', 'handout.docx']
})

export function validateDocumentExport(request) {
  if (!request || !documentExportFormats[request.kind]?.includes(request.format)) throw new Error('OFFICE_EXPORT_FORMAT_UNSUPPORTED')
  if (!request.bytes || !ArrayBuffer.isView(request.bytes) || request.bytes.byteLength === 0 || request.bytes.byteLength > 256 * 1024 * 1024) throw new Error('OFFICE_EXPORT_SNAPSHOT_INVALID')
  if (typeof request.targetPath !== 'string' || !path.isAbsolute(request.targetPath) || request.targetPath.includes('\0')) throw new Error('OFFICE_EXPORT_TARGET_INVALID')
  if (!request.targetPath.toLowerCase().endsWith('.' + request.format)) throw new Error('OFFICE_EXPORT_EXTENSION_MISMATCH')
  if (request.sourcePath && path.resolve(request.sourcePath).toLocaleLowerCase() === path.resolve(request.targetPath).toLocaleLowerCase()) throw new Error('OFFICE_EXPORT_SOURCE_OVERWRITE')
}

// 在同盘临时文件上生成并校验，再原子替换；取消/失败不破坏已有导出文件。
export async function exportDocument(request, { onProgress = () => {}, signal } = {}) {
  validateDocumentExport(request)
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-office-export-'))
  let worker
  const output = path.join(directory, 'result.' + request.format)
  let temporary
  let cancellation
  let cancellationCleanup
  const cleanupNative = async (cancel = false) => {
    if (process.platform !== 'win32') return
    const ownership = path.join(directory, 'owned-processes.json')
    if (!await fs.stat(ownership).then(() => true, () => false)) return
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./native-export-cleanup.ps1', import.meta.url)), '-OwnershipPath', ownership, ...(cancel ? ['-Cancel'] : [])], { windowsHide: true, timeout: 15000, maxBuffer: 4096 })
  }
  try {
    signal?.throwIfAborted()
    onProgress({ stage: 'converting' })
    await new Promise((resolve, reject) => {
      worker = new Worker(new URL('./export-worker.js', import.meta.url), { workerData: { ...request, targetPath: output, directory } })
      let settled = false
      // 取消先通知转换器，再等待其退出。直接 terminate 会在 COM 启动与
      // HWND 所有权登记之间切断控制链，造成无法安全归属的 Office 残留。
      const cancel = error => {
        if (settled || cancellation) return
        cancellation = error
        writeFileSync(path.join(directory, 'cancel.requested'), '')
        onProgress({ stage: 'cancelling' })
        cancellationCleanup = cleanupNative(true).catch(() => {})
      }
      const timeout = setTimeout(() => cancel(new Error('OFFICE_EXPORT_TIMEOUT')), 600000)
      const aborted = () => cancel(new Error('OFFICE_EXPORT_CANCELLED'))
      function finish(error) {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        signal?.removeEventListener('abort', aborted)
        worker.terminate().then(() => cancellation || error ? reject(cancellation || error) : resolve(), reject)
      }
      signal?.addEventListener('abort', aborted, { once: true })
      if (signal?.aborted) aborted()
      worker.on('message', result => {
        if (result.stage) { if (!cancellation) onProgress({ stage: result.stage }) }
        else finish(result.ok ? null : Object.assign(new Error(result.code || 'OFFICE_EXPORT_FAILED'), { detail: result.detail }))
      })
      worker.once('error', finish)
      worker.once('exit', code => { if (!settled) finish(new Error(`OFFICE_EXPORT_WORKER_EXIT_${code}`)) })
    })
    signal?.throwIfAborted()
    const stat = await fs.stat(output)
    if (!stat.isFile() || !stat.size) throw new Error('OFFICE_EXPORT_EMPTY')
    onProgress({ stage: 'writing' })
    temporary = path.join(path.dirname(request.targetPath), `.friday-export-${path.basename(directory)}.tmp`)
    await fs.copyFile(output, temporary, 1)
    signal?.throwIfAborted()
    await fs.rename(temporary, request.targetPath)
    onProgress({ stage: 'complete' })
    return { ok: true, data: { path: request.targetPath, bytes: stat.size }, warnings: [], error: null, affectedResources: [request.targetPath], undo: null }
  } finally {
    // 中止 worker 不会自动停止其系统转换子进程。只清理该次任务登记、
    // 且启动时间仍吻合的独立进程，避免超时后残留 Office 后台实例。
    await cancellationCleanup
    await cleanupNative().catch(() => {})
    if (temporary) await fs.unlink(temporary).catch(() => {})
    await removePathNoFollow(directory, { root: os.tmpdir() }).catch(() => {})
  }
}
