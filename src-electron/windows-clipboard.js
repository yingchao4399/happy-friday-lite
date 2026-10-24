import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function readFiles(koffi, getClipboardData) {
  const memory = getClipboardData(15)
  if (!memory) return []
  const shell32 = koffi.load('shell32.dll')
  const dragQueryFile = shell32.func('uint32_t __stdcall DragQueryFileW(void *drop, uint32_t index, _Out_ char16_t *buffer, uint32_t count)')
  const count = Math.min(dragQueryFile(memory, 0xFFFFFFFF, null, 0), 512)
  const paths = []
  for (let index = 0; index < count; index++) {
    const length = dragQueryFile(memory, index, null, 0)
    if (!length || length > 32767) continue
    const buffer = Buffer.alloc((length + 1) * 2)
    const copied = dragQueryFile(memory, index, buffer, length + 1)
    if (copied) paths.push(buffer.toString('utf16le', 0, copied * 2))
  }
  return paths
}

export function createWindowsClipboardAdapter(win) {
  if (process.platform !== 'win32') return null
  const koffi = require('koffi')
  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')
  const add = user32.func('bool __stdcall AddClipboardFormatListener(void *hWnd)')
  const remove = user32.func('bool __stdcall RemoveClipboardFormatListener(void *hWnd)')
  const sequence = user32.func('uint32_t __stdcall GetClipboardSequenceNumber()')
  const openClipboard = user32.func('bool __stdcall OpenClipboard(void *owner)')
  const closeClipboard = user32.func('bool __stdcall CloseClipboard()')
  const getClipboardData = user32.func('void * __stdcall GetClipboardData(uint32_t format)')
  const emptyClipboard = user32.func('bool __stdcall EmptyClipboard()')
  const setClipboardData = user32.func('void * __stdcall SetClipboardData(uint32_t format, void *memory)')
  const getOwner = user32.func('void * __stdcall GetClipboardOwner()')
  const getProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(void *window, _Out_ uint32_t *processId)')
  const openProcess = kernel32.func('void * __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t processId)')
  const processName = kernel32.func('bool __stdcall QueryFullProcessImageNameW(void *process, uint32_t flags, _Out_ char16_t *name, _Inout_ uint32_t *size)')
  const closeHandle = kernel32.func('bool __stdcall CloseHandle(void *handle)')
  const alloc = kernel32.func('void * __stdcall GlobalAlloc(uint32_t flags, size_t bytes)')
  const lock = kernel32.func('void * __stdcall GlobalLock(void *memory)')
  const unlock = kernel32.func('bool __stdcall GlobalUnlock(void *memory)')
  const free = kernel32.func('void * __stdcall GlobalFree(void *memory)')
  const pause = kernel32.func('void __stdcall Sleep(uint32_t milliseconds)')
  const size = kernel32.func('size_t __stdcall GlobalSize(void *memory)')
  const registerFormat = user32.func('uint32_t __stdcall RegisterClipboardFormatW(str16 name)')
  const available = user32.func('bool __stdcall IsClipboardFormatAvailable(uint32_t format)')
  const htmlFormat = registerFormat('HTML Format'), pngFormat = registerFormat('PNG')
  const format = 15
  const handle = win.getNativeWindowHandle()
  const hwnd = handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())
  const owner = koffi.as(hwnd, 'void *')
  if (!add(owner)) throw new Error('Windows 剪贴板监听注册失败')
  let last = sequence()
  win.hookWindowMessage(0x031D, () => {
    const next = sequence()
    if (next === last) return
    last = next
    setImmediate(() => onChange?.())
  })
  let onChange = null
  let cachedPaths = [], cachedSequence = -1
  const busy = () => Object.assign(new Error('CLIPBOARD_BUSY'), { code: 'CLIPBOARD_BUSY' })
  function readBuffer(format) {
    if (!available(format)) return null
    const memory = getClipboardData(format)
    if (!memory) throw busy()
    const length = Number(size(memory))
    if (!length || length > 256 * 1024 * 1024) throw busy()
    const pointer = lock(memory)
    if (!pointer) throw busy()
    try { return Buffer.from(koffi.decode(pointer, 'uint8_t', length)) } finally { unlock(memory) }
  }
  return {
    getSequenceNumber() { return sequence() },
    readSnapshot() {
      if (!openClipboard(owner)) throw busy()
      try {
        const before = sequence()
        const text = readBuffer(13)?.toString('utf16le').replace(/\0+$/, '') || ''
        const rawHtml = readBuffer(htmlFormat)
        let html = ''
        if (rawHtml) {
          const header = rawHtml.toString('utf8', 0, Math.min(1024, rawHtml.length))
          const start = Number(header.match(/StartHTML:(\d+)/)?.[1]), end = Number(header.match(/EndHTML:(\d+)/)?.[1])
          html = Number.isFinite(start) && end > start && end <= rawHtml.length ? rawHtml.toString('utf8', start, end) : rawHtml.toString('utf8').replace(/\0+$/, '')
        }
        const filePaths = readFiles(koffi, getClipboardData)
        if (before !== sequence()) throw busy()
        cachedPaths = filePaths; cachedSequence = before
        return { text, html, filePaths, sequence: before, hasImage: available(8) || available(17) || available(2) || available(pngFormat) }
      } finally { closeClipboard() }
    },
    readSource() {
      const window = getOwner()
      if (!window) return ''
      const processId = [0]
      getProcessId(window, processId)
      const process = openProcess(0x1000, false, processId[0])
      if (!process) return ''
      try {
        const buffer = Buffer.alloc(32768 * 2), size = [32768]
        if (!processName(process, 0, buffer, size)) return ''
        return path.basename(buffer.toString('utf16le', 0, size[0] * 2), '.exe')
      } finally { closeHandle(process) }
    },
    setOnChange(callback) { onChange = callback },
    readFilePaths({ strict = false } = {}) {
      if (!openClipboard(owner)) {
        if (strict) throw Object.assign(new Error('CLIPBOARD_BUSY'), { code: 'CLIPBOARD_BUSY' })
        return sequence() === cachedSequence ? [...cachedPaths] : []
      }
      try { cachedPaths = readFiles(koffi, getClipboardData); cachedSequence = sequence(); return [...cachedPaths] } finally { closeClipboard() }
    },
    writeFilePaths(paths, { preserve = false } = {}) {
      const values = paths.filter(file => typeof file === 'string' && fs.existsSync(file))
      if (!values.length) return false
      const list = Buffer.from(`${values.join('\0')}\0\0`, 'utf16le')
      const dropFiles = Buffer.alloc(20)
      dropFiles.writeUInt32LE(dropFiles.length, 0)
      dropFiles.writeUInt32LE(1, 16)
      const payload = Buffer.concat([dropFiles, list])
      const memory = alloc(0x0002, payload.length)
      if (!memory) return false
      const pointer = lock(memory)
      if (!pointer) { free(memory); return false }
      koffi.encode(pointer, koffi.array('uint8_t', payload.length), [...payload])
      unlock(memory)
      // 同时运行的剪贴板管理器可能短暂持锁；文件复制最多等待 100ms，超时明确失败。
      let opened = openClipboard(owner)
      for (let attempt = 0; !opened && attempt < 20; attempt++) { pause(5); opened = openClipboard(owner) }
      if (!opened) { free(memory); return false }
      let transferred = false
      try { transferred = Boolean((preserve || emptyClipboard()) && setClipboardData(format, memory)) }
      finally { closeClipboard(); if (!transferred) free(memory) }
      if (transferred) { cachedPaths = [...values]; cachedSequence = sequence() }
      return transferred
    },
    stop() {
      onChange = null
      if (!win.isDestroyed()) { remove(owner); win.unhookWindowMessage(0x031D) }
    }
  }
}

export function watchWindowsClipboard(win, callback) {
  const adapter = createWindowsClipboardAdapter(win)
  if (callback) adapter?.setOnChange(callback)
  return adapter
}
