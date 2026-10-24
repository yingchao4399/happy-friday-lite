import test from 'node:test'
import assert from 'node:assert/strict'
import { pasteInputBuffer, performWindowPaste } from '../../src-electron/windows-paste.js'

function environment(patch = {}) {
  const calls = []
  const ops = { valid: () => true, matches: () => true, ownForeground: () => false, restore: () => calls.push('restore'), activate: () => true, modifiersHeld: () => false, send: () => { calls.push('send'); return 4 }, release: () => calls.push('release'), ...patch }
  return { calls, ops, write: async () => calls.push('write') }
}
test('Windows INPUT 在 x86/x64/arm64 下按系统布局发送 Ctrl+V 和释放键，不发送 Enter', () => {
  for (const arch of ['ia32', 'x64', 'arm64']) {
    const { inputs, size } = pasteInputBuffer(arch), offset = arch === 'ia32' ? 4 : 8
    assert.equal(size, arch === 'ia32' ? 28 : 40)
    assert.equal(inputs.length, size * 4)
    assert.deepEqual(Array.from({ length: 4 }, (_, i) => [inputs.readUInt32LE(i * size), inputs.readUInt16LE(i * size + offset), inputs.readUInt32LE(i * size + offset + 4)]), [[1, 17, 0], [1, 86, 0], [1, 86, 2], [1, 17, 2]])
  }
})
test('缺失/切换目标及取消时不写剪贴板，不发送按键', async () => {
  for (const [patch, code, cancelled] of [[{ valid: () => false }, 'TARGET_MISSING'], [{ matches: () => false }, 'TARGET_CHANGED'], [{}, 'CANCELLED', () => true]]) {
    const env = environment(patch)
    await assert.rejects(performWindowPaste({}, env.write, { ops: env.ops, cancelled }), new RegExp(code))
    assert.deepEqual(env.calls, [])
  }
})
test('剪贴板写入期间目标变化、取消或写失败均不发送；激活失败保留可恢复错误', async () => {
  for (const scenario of ['change', 'cancel', 'write', 'focus']) {
    let changed = false
    const env = environment({ matches: () => !changed, activate: () => false, ownForeground: () => scenario === 'focus' })
    await assert.rejects(performWindowPaste({}, async () => { changed = true; if (scenario === 'write') throw new Error('write failed') }, { ops: env.ops, cancelled: () => scenario === 'cancel' && changed }), /TARGET_CHANGED|CANCELLED|write failed|FOCUS_FAILED/)
    assert.ok(!env.calls.includes('send'))
  }
})
test('等待物理修饰键释放后只发送一次；等待期间每轮检查前台与取消，超时不发送', async () => {
  let held = true, polls = 0
  const env = environment({ modifiersHeld: () => held })
  assert.deepEqual(await performWindowPaste({}, env.write, { ops: env.ops, pause: async () => { polls++; held = false } }), { ok: true, clipboardWritten: true, inputSent: true })
  assert.equal(polls, 1); assert.equal(env.calls.filter(c => c === 'send').length, 1)
  for (const scenario of ['target', 'cancel', 'timeout']) {
    let tick = 0
    const blocked = environment({ modifiersHeld: () => true, matches: () => scenario !== 'target' || tick === 0 })
    await assert.rejects(performWindowPaste({}, blocked.write, { ops: blocked.ops, cancelled: () => scenario === 'cancel' && tick > 0, pause: async () => { tick++ } }), /TARGET_CHANGED|CANCELLED|MODIFIERS_HELD/)
    assert.ok(!blocked.calls.includes('send'))
  }
})
test('拒绝与部分发送均释放按键，部分发送提示先检查目标而不是假定未粘贴', async () => {
  for (const count of [0, 1, 2, 3]) {
    const env = environment({ send: () => count })
    await assert.rejects(performWindowPaste({}, env.write, { ops: env.ops }), new RegExp(count ? 'INPUT_PARTIAL' : 'INPUT_DENIED'))
    assert.ok(env.calls.includes('release'))
  }
})
