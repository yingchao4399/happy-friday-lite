import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTranscriptionResult } from '../../src-electron/rag/mediaTranscription.js'
import { transcriptionCapability } from '../../src-electron/model-capabilities.js'

test('DeepSeek 聊天模型明确不可转写，未知兼容服务仍可配置并验证', () => {
  assert.equal(transcriptionCapability({ baseUrl: 'https://api.deepseek.com/v1', modelName: 'deepseek-chat' }).supported, false)
  assert.equal(transcriptionCapability({ baseUrl: 'http://localhost:8080/v1', modelName: 'deepseek-flash' }).supported, false)
  assert.equal(transcriptionCapability({ baseUrl: 'http://localhost:8080/v1', modelName: 'whisper-local' }).supported, null)
  assert.equal(transcriptionCapability({ capabilities: { transcription: true } }).supported, true)
  assert.equal(transcriptionCapability({ capabilities: { transcription: false } }).supported, false)
})

test('无时间戳或置信度时保留未知，有原始模型 logprob 时按依据转换', () => {
  assert.deepEqual(normalizeTranscriptionResult({ text: ' 原文 ' }), { text: '原文', segments: [], durationSeconds: null })
  const value = normalizeTranscriptionResult({ text: '原文', segments: [{ start: 1, end: 2, text: '原文', avg_logprob: Math.log(0.4) }] })
  assert.equal(value.durationSeconds, 2)
  assert.equal(value.segments[0].confidence, 0.4)
  assert.equal(normalizeTranscriptionResult({ text: '原文', duration: 3, segments: [{ start: 0, end: 1, text: '原文' }] }).segments[0].confidence, null)
})

test('拒绝负数、倒置、重叠、超时长和伪造置信度，避免错误分析与来源跳转', () => {
  const part = { start: 0, end: 2, text: '原文', confidence: 0.8 }
  for (const patch of [{ start: -1 }, { end: 0 }, { start: NaN }, { end: Infinity }, { end: 5 }, { confidence: 1.1 }, { confidence: -0.1 }]) {
    assert.throws(() => normalizeTranscriptionResult({ text: '原文', duration: 4, segments: [{ ...part, ...patch }] }), /MEDIA_TRANSCRIPTION_RESULT_INVALID/)
  }
  assert.throws(() => normalizeTranscriptionResult({ text: '原文', segments: [part, { ...part, start: 1 }] }), /RESULT_INVALID/)
})
