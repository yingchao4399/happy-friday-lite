import { parentPort, workerData } from 'node:worker_threads'
import { createRequire } from 'node:module'

// CPU/WASM 和系统 OCR 的同步工作仅在隔离 worker 内执行。
try {
  const converter = createRequire(import.meta.url)(workerData.bundlePath)
  const result = await converter.convertSnapshot(workerData.request, (page, total) => parentPort.postMessage({ progress: { page, total } }))
  parentPort.postMessage({ ok: true, result })
} catch (error) {
  parentPort.postMessage({ ok: false, code: error.code || 'OFFICE_CONVERSION_FAILED', error: error.message })
}
