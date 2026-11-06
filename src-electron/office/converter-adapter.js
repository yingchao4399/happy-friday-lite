import { Worker } from 'node:worker_threads'
import { officeFault } from './artifact-delivery.js'

export function convertOfficePdfSnapshot(request, { bundlePath, signal, onProgress = () => {}, timeoutMs = 180000, WorkerClass = Worker } = {}) {
  if (signal?.aborted) return Promise.reject(officeFault('OFFICE_OPERATION_CANCELLED'))
  return new Promise((resolve, reject) => {
    const worker = new WorkerClass(new URL('./conversion-worker.js', import.meta.url), { workerData: { bundlePath, request }, resourceLimits: { maxOldGenerationSizeMb: 768 } })
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', aborted)
      worker.terminate().then(() => error ? reject(error) : resolve(value), reject)
    }
    const aborted = () => finish(officeFault('OFFICE_OPERATION_CANCELLED'))
    const timer = setTimeout(() => finish(officeFault('OFFICE_CONVERSION_TIMEOUT')), timeoutMs)
    signal?.addEventListener('abort', aborted, { once: true })
    if (signal?.aborted) aborted()
    worker.on('message', message => {
      if (settled) return
      if (message.progress) {
        try { onProgress(message.progress) } catch { /* 观察者错误不能逃出主线程事件循环或撤销交付。 */ }
      }
      else finish(message.ok ? null : officeFault(message.code, message.error), message.result)
    })
    worker.once('error', error => finish(officeFault('OFFICE_CONVERSION_WORKER_FAILED', error.message)))
    worker.once('exit', code => { if (!settled) finish(officeFault('OFFICE_CONVERSION_WORKER_EXIT', String(code))) })
  })
}
