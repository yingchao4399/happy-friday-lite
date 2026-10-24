import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { clipboardFileType } from './clipboard-content.js'

const require = createRequire(import.meta.url)

// 独占只读打开：Windows 上只要录屏软件仍持有读写句柄，就等待下一轮。
export function createRecordingReleaseCheck() {
  if (process.platform !== 'win32') return async () => true
  const koffi = require('koffi'), kernel = koffi.load('kernel32.dll')
  const open = kernel.func('void * __stdcall CreateFileW(str16 path, uint32_t access, uint32_t share, void *security, uint32_t creation, uint32_t flags, void *templateFile)')
  const close = kernel.func('bool __stdcall CloseHandle(void *handle)')
  return async file => {
    const handle = open(file, 0x80000000, 0, null, 3, 0x80, null)
    if (!handle) return false
    const address = koffi.address(handle)
    if (address === 0xFFFFFFFFFFFFFFFFn || address === 0xFFFFFFFFn || address === -1n) return false
    try { return true } finally { close(handle) }
  }
}

// 只观察设置中的录屏目录。启动时建立基线，不导入历史视频；写入稳定且释放句柄后入库。
export function createRecordingCollector({ directories, optionalDirectories = [], onReady, isReleased, onError = () => {}, stableMs = 8000, now = Date.now }) {
  let timer, stopped = false, busy = false, seeded = false
  const files = new Map()
  const roots = [...new Set(directories.map(folder => path.resolve(folder)))]
  const optional = new Set(optionalDirectories.map(folder => path.resolve(folder)))
  async function scan() {
    if (stopped || busy) return
    busy = true
    const found = new Set()
    let visited = 0
    async function visit(folder, depth = 0) {
      let entries
      try { entries = await fs.readdir(folder, { withFileTypes: true }) }
      catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes(error.code)) { if (depth === 0 && !optional.has(folder)) onError('CLIPBOARD_RECORDING_DIRECTORY_MISSING') }
        else onError('CLIPBOARD_RECORDING_DIRECTORY_UNAVAILABLE')
        return
      }
      for (const entry of entries) {
        if (stopped || ++visited > 8000) return
        if (entry.isSymbolicLink()) continue
        const file = path.join(folder, entry.name)
        if (entry.isDirectory() && depth < 3) { await visit(file, depth + 1); continue }
        if (!entry.isFile() || clipboardFileType(file).kind !== 'video') continue
        try {
          const stat = await fs.stat(file), fingerprint = stat.size + ':' + stat.mtimeMs + ':' + stat.birthtimeMs
          found.add(file)
          let state = files.get(file)
          if (!state || state.fingerprint !== fingerprint) {
            state = { fingerprint, since: now(), published: !seeded }
            files.set(file, state)
          }
          if (state.published || !stat.size || now() - state.since < stableMs || !await isReleased(file)) continue
          // 检查锁之后再读一次属性，防止检查期间继续写入或被删除。
          const current = await fs.stat(file)
          if (current.size !== stat.size || current.mtimeMs !== stat.mtimeMs || stopped) continue
          await onReady({ file, size: stat.size, modifiedAt: stat.mtimeMs, fingerprint })
          state.published = true
        } catch (error) { if (error.code !== 'ENOENT') onError('CLIPBOARD_RECORDING_CAPTURE_FAILED') }
      }
    }
    try {
      for (const root of roots) await visit(root)
      // 扫描上限触发时不丢弃状态，避免下一次重复导入。
      if (visited <= 8000) for (const file of files.keys()) if (!found.has(file)) files.delete(file)
      if (visited > 8000) onError('CLIPBOARD_RECORDING_DIRECTORY_TOO_LARGE')
      seeded = true
    } finally { busy = false }
  }
  return {
    scan,
    async start() { await scan(); if (!stopped && !timer) { timer = setInterval(scan, 3000); timer.unref?.() } },
    stop() { stopped = true; clearInterval(timer); files.clear() }
  }
}
