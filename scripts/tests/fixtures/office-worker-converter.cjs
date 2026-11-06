const fs = require('node:fs')
const { isMainThread, threadId } = require('node:worker_threads')

exports.convertSnapshot = async (request, onProgress) => {
  if (isMainThread) throw new Error('测试转换器必须在独立 Worker 内执行')
  if (request.mode === 'throw') throw Object.assign(new Error('测试转换器显式失败'), { code: 'FIXTURE_CONVERSION_FAILED' })
  if (request.mode === 'exit') process.exit(17)
  if (request.mode === 'worker-error') {
    // 脱离 convertSnapshot 的 try/catch，触发 Worker 原生 error 事件。
    setImmediate(() => { throw new Error('测试 Worker 未捕获异常') })
    return new Promise(() => {})
  }
  if (request.mode === 'progress-burst') {
    for (let page = 1; page <= 50; page++) onProgress(page, 50)
    return { docx: new Uint8Array([80, 75, 3, 4]), pages: 50, fixtureThreadId: threadId }
  }
  onProgress(1, request.mode === 'busy' ? 1 : 2)
  if (request.mode === 'busy') {
    const deadline = Date.now() + request.busyMs
    while (Date.now() < deadline) Math.sqrt(Math.random())
    if (request.completionFile) fs.writeFileSync(request.completionFile, '长任务未被终止')
  } else onProgress(2, 2)
  return { docx: new Uint8Array([80, 75, 3, 4]), pages: request.mode === 'busy' ? 1 : 2, pageResults: [], warnings: [], scannedDocument: false, fixtureThreadId: threadId }
}
