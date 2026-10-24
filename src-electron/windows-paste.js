import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const failure = code => Object.assign(new Error(code), { code })
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

// 只向用户选择的前台窗口发送 Ctrl+V。句柄和进程身份留在主进程，不接受渲染进程传入的任意窗口。
export function createWindowsPasteAdapter() {
  if (process.platform !== 'win32') return null
  const koffi = require('koffi'), user = koffi.load('user32.dll'), kernel = koffi.load('kernel32.dll')
  const foreground = user.func('void * __stdcall GetForegroundWindow()')
  const ancestor = user.func('void * __stdcall GetAncestor(void *window, uint32_t flags)')
  const isWindow = user.func('bool __stdcall IsWindow(void *window)')
  const visible = user.func('bool __stdcall IsWindowVisible(void *window)')
  const thread = user.func('uint32_t __stdcall GetWindowThreadProcessId(void *window, _Out_ uint32_t *processId)')
  const className = user.func('int __stdcall GetClassNameW(void *window, _Out_ char16_t *buffer, int count)')
  const openProcess = kernel.func('void * __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t processId)')
  const processName = kernel.func('bool __stdcall QueryFullProcessImageNameW(void *process, uint32_t flags, _Out_ char16_t *name, _Inout_ uint32_t *size)')
  const closeHandle = kernel.func('bool __stdcall CloseHandle(void *handle)')
  const activate = user.func('bool __stdcall SetForegroundWindow(void *window)')
  const iconic = user.func('bool __stdcall IsIconic(void *window)')
  const show = user.func('bool __stdcall ShowWindow(void *window, int command)')
  const keyState = user.func('int16_t __stdcall GetAsyncKeyState(int key)')
  const send = user.func('uint32_t __stdcall SendInput(uint32_t count, const void *inputs, int size)')
  const address = pointer => pointer ? String(koffi.address(pointer)) : ''
  const root = window => window ? ancestor(window, 2) || window : null
  function identity(window) { const pid = [0]; const tid = window ? thread(window,pid) : 0; return { pid:pid[0],tid } }
  function valid(target) {
    if (!target || !isWindow(target.handle) || !visible(target.handle)) return false
    const next = identity(target.handle)
    return next.pid === target.pid && next.tid === target.tid && next.pid !== process.pid
  }
  function matches(target) { return valid(target) && address(root(foreground())) === target.address }
  return {
    capture() {
      const handle = root(foreground()), id = identity(handle)
      if (!handle || !id.pid || id.pid === process.pid || !visible(handle)) return null
      const buffer = Buffer.alloc(512), n = className(handle,buffer,256)
      if (['Shell_TrayWnd','Shell_SecondaryTrayWnd','NotifyIconOverflowWindow','Progman','WorkerW','#32768'].includes(buffer.toString('utf16le',0,n*2))) return null
      let label = ''
      const processHandle = openProcess(0x1000,false,id.pid)
      if (processHandle) {
        try { const bytes=Buffer.alloc(65536), size=[32768]; if(processName(processHandle,0,bytes,size))label=bytes.toString('utf16le',0,size[0]*2).split(/[\\/]/).pop().replace(/\.exe$/i,'') }
        finally { closeHandle(processHandle) }
      }
      return { handle,address:address(handle),...id,label }
    },
    valid, matches,
    same(first,second) { return Boolean(first && second && first.address===second.address && first.pid===second.pid && first.tid===second.tid) },
    ownForeground() { return identity(root(foreground())).pid === process.pid },
    async paste(target, write, options = {}) {
      return performWindowPaste(target, write, {
        ...options,
        ops: {
          valid, matches, ownForeground: () => identity(root(foreground())).pid === process.pid,
          restore: () => { if (iconic(target.handle)) show(target.handle, 9) },
          activate: () => activate(target.handle),
          modifiersHeld: () => [0x10, 0x11, 0x12, 0x5B, 0x5C].some(key => keyState(key) & 0x8000),
          send: () => { const { inputs, size } = pasteInputBuffer(process.arch); return send(4, inputs, size) },
          release: () => { const { inputs, size } = pasteInputBuffer(process.arch); send(2, inputs.subarray(size * 2), size) }
        }
      })
    }
  }
}

export function pasteInputBuffer(architecture) {
  const size = architecture === 'ia32' ? 28 : 40, offset = architecture === 'ia32' ? 4 : 8
  const inputs = Buffer.alloc(size * 4)
  for (const [i, key, flags] of [[0, 0x11, 0], [1, 0x56, 0], [2, 0x56, 2], [3, 0x11, 2]]) {
    inputs.writeUInt32LE(1, i * size); inputs.writeUInt16LE(key, i * size + offset); inputs.writeUInt32LE(flags, i * size + offset + 4)
  }
  return { inputs, size }
}

// 独立注入流程以测试竞争、取消、焦点和部分发送；真实输入仍仅由上面的 Windows 适配器提供。
export async function performWindowPaste(target, write, { ops, hide = () => {}, cancelled = () => false, pause = wait }) {
  if (!ops.valid(target)) throw failure('CLIPBOARD_PASTE_TARGET_MISSING')
  if (!ops.matches(target) && !ops.ownForeground()) throw failure('CLIPBOARD_PASTE_TARGET_CHANGED')
  if (cancelled()) throw failure('CLIPBOARD_PASTE_CANCELLED')
  await write()
  if (cancelled()) throw failure('CLIPBOARD_PASTE_CANCELLED')
  if (!ops.valid(target) || (!ops.matches(target) && !ops.ownForeground())) throw failure('CLIPBOARD_PASTE_TARGET_CHANGED')
  ops.restore()
  if (!ops.matches(target) && !ops.activate()) throw failure('CLIPBOARD_PASTE_FOCUS_FAILED')
  hide()
  for (let i = 0; i < 40; i++) {
    if (cancelled()) throw failure('CLIPBOARD_PASTE_CANCELLED')
    if (!ops.matches(target)) throw failure('CLIPBOARD_PASTE_TARGET_CHANGED')
    if (!ops.modifiersHeld()) {
      const count = ops.send()
      if (count !== 4) {
        // 部分发送可能已经触发粘贴；释放按键后明确要求用户先检查目标内容。
        ops.release()
        throw failure(count ? 'CLIPBOARD_PASTE_INPUT_PARTIAL' : 'CLIPBOARD_PASTE_INPUT_DENIED')
      }
      return { ok: true, clipboardWritten: true, inputSent: true }
    }
    await pause(20)
  }
  throw failure('CLIPBOARD_PASTE_MODIFIERS_HELD')
}
