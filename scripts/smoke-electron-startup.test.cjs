const assert = require('node:assert/strict')
const test = require('node:test')

const smoke = import('./smoke-electron-startup.mjs')

test('启动失败日志必须阻止冒烟通过，即使窗口已加载', async () => {
  const { hasFatalStartupOutput, hasStartupCompleted } = await smoke
  const ready = '[Main] 主窗口页面加载完成\n[Main] 主窗口 ready-to-show\n[Main] ✅ IPC commands registered successfully'
  assert.equal(hasStartupCompleted(ready), true)
  for (const error of [
    "Error: Attempted to register a second handler for 'screenshot-capture'",
    "Error invoking remote method 'clipboard-list': Error: No handler registered for 'clipboard-list'",
    '[Main] ❌ Failed to register IPC commands:',
    '[Main] 主窗口页面加载失败: -6 ERR_FILE_NOT_FOUND',
    'SyntaxError: duplicate binding'
  ]) assert.equal(hasFatalStartupOutput(`${ready}\n${error}`), true, error)
  assert.equal(hasFatalStartupOutput(ready), false)
  assert.equal(hasStartupCompleted('[Main] 主窗口页面加载完成\n[Main] 主窗口 ready-to-show'), false)
})

test('IPC 验收拒绝后端错误与无效结果，允许明确的 Python 未安装状态', async () => {
  const { validateIpcResults } = await smoke
  const valid = {
    'clipboard-list': [],
    'clipboard-settings-get': { captureEnabled: true },
    'recitation-list': [],
    'python-status': { available: false, path: null, version: null, reason: 'not_configured' },
    'rag-get-kb-summary': { success: true, summary: { notes: { total: 0, success: 0, pending: 0, processing: 0, failed: 0, vectorCount: 0 } } }
  }
  assert.doesNotThrow(() => validateIpcResults(valid))
  assert.throws(() => validateIpcResults({ ...valid, 'rag-get-kb-summary': { success: false, error: 'database unavailable' } }), /database unavailable/)
  for (const channel of Object.keys(valid)) {
    assert.throws(() => validateIpcResults({ ...valid, [channel]: undefined }), channel)
  }
  assert.throws(() => validateIpcResults({ ...valid, 'rag-get-kb-summary': { success: true, summary: {} } }), /知识库摘要为空/)
})
