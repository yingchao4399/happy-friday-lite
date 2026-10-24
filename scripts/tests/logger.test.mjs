import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

test('启动器管道断开后继续写文件日志，异步 EPIPE 不形成异常循环', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-logger-test-'))
  try {
    const logger = new URL('../../src-electron/logger.js', import.meta.url).href
    const code = 'const { initLogger } = await import(' + JSON.stringify(logger) + ');' +
      'console.log = () => { throw Object.assign(new Error("closed pipe"), { code: "EPIPE" }) };' +
      'initLogger(' + JSON.stringify(root) + ');' +
      'console.log("after synchronous failure");' +
      'process.stderr.emit("error", Object.assign(new Error("closed pipe"), { code: "EPIPE" }));' +
      'console.error("after asynchronous failure");' +
      'setTimeout(() => { console.log("event loop alive") }, 30);'
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { timeout: 5000, encoding: 'utf8' })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0, result.stderr)
    const log = fs.readFileSync(path.join(root, 'logs', 'main.log'), 'utf8')
    assert.match(log, /after synchronous failure/)
    assert.match(log, /after asynchronous failure/)
    assert.match(log, /event loop alive/)
    assert.ok(!log.includes('Uncaught Exception'))
    assert.ok(log.length < 2000)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
