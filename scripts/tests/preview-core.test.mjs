import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import initSqlJs from 'sql.js'
import { applyPreviewMigrations, rollbackPreviewMigrations, previewTables } from '../../src-electron/preview-migrations.js'
import { classifyClipboard, protectedText, clipboardMatches, isSensitiveClipboardExpired } from '../../src-electron/clipboard-policy.js'
import { wheelIntent, findHorizontalWheelTarget, routeHorizontalWheel } from '../../src/utils/tabNavigation.js'
import * as db from '../../src-electron/db.js'
import { analyzeRecitation, buildRecitationStudy, importRecitationAudio, listRecitations, reanalyzeRecitation, transcribeRecitation, correctRecitationTranscript } from '../../src-electron/recitation.js'
import { setDataDir as setConfigDataDir } from '../../src-electron/config.js'

test('3.0.6 数据升级、重复迁移与回滚保留原表数据', async () => {
  const SQL = await initSqlJs()
  const database = new SQL.Database()
  try {
    database.run("CREATE TABLE notes(id TEXT PRIMARY KEY, content TEXT); INSERT INTO notes VALUES ('original', '保留原有内容')")
    assert.equal(applyPreviewMigrations(database), true)
    assert.equal(applyPreviewMigrations(database), false)
    for (const table of previewTables) assert.equal(database.exec(`SELECT COUNT(*) FROM ${table}`)[0].values[0][0], 0)
    database.run('INSERT INTO clipboard_items (id, payload, capturedAt) VALUES (?, ?, ?)', ['clip-1', '{"plainText":"保留”}', new Date().toISOString()])
    database.run('INSERT INTO module_order VALUES (?, ?)', ['clipboard', 2])
    rollbackPreviewMigrations(database)
    assert.equal(database.exec('SELECT content FROM notes')[0].values[0][0], '保留原有内容')
    assert.equal(database.exec('SELECT id FROM clipboard_items')[0].values[0][0], 'clip-1')
    assert.equal(database.exec('SELECT position FROM module_order')[0].values[0][0], 2)
    assert.equal(applyPreviewMigrations(database), true)
    assert.equal(database.exec('SELECT payload FROM clipboard_items WHERE id = \'clip-1\'')[0].values[0][0], '{"plainText":"保留”}')
  } finally { database.close() }
})

test('笔记置顶重启后保留，取消置顶不改正文', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-preview-db-'))
  db.setDataDir(root)
  try {
    await db.initDb()
    const note = db.createNote(null, null, '置顶验收')
    db.updateNote(note.id, note.title, '<p>正文</p>', '正文')
    assert.equal(db.setNotePinned(note.id, true).isPinned, true)
    db.closeDb()
    await db.initDb()
    assert.equal(db.getNote(note.id).isPinned, true)
    assert.equal(db.setNotePinned(note.id, false).isPinned, false)
    assert.equal(db.getNote(note.id).contentText, '正文')
    assert.throws(() => db.setNotePinned('missing', true))
  } finally { db.closeDb(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('会话手动标题不会被异步自动标题覆盖', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-session-title-'))
  db.setDataDir(root)
  try {
    await db.initDb()
    const manual = db.createSession('首条消息', 'chat', 'friday', null)
    assert.equal(db.updateSessionTitle(manual.id, '用户命名', 'friday', null), true)
    assert.equal(db.updateSessionTitle(manual.id, 'AI 建议标题', 'friday', null, false), false)
    assert.equal(db.getSession(manual.id, 'friday', null).title, '用户命名')

    const automatic = db.createSession('另一条消息', 'chat', 'friday', null)
    assert.equal(db.updateSessionTitle(automatic.id, 'AI 建议标题', 'friday', null, false), true)
    assert.equal(db.getSession(automatic.id, 'friday', null).title, 'AI 建议标题')
  } finally {
    db.closeDb()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('会话历史按 scope 和 scopeKey 隔离，省略范围只回退到 Friday 全局', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-session-scope-'))
  db.setDataDir(root)
  try {
    await db.initDb()
    const friday = db.createSession('Friday 全局', 'chat', 'friday', null)
    const noteA = db.createSession('笔记 A', 'agent', 'note-agent', 'note:a')
    const noteB = db.createSession('笔记 B', 'agent', 'note-agent', 'note:b')
    const noteMessage = db.saveMessage(noteA.id, 'user', '只属于笔记 A')

    assert.deepEqual(db.getSessions().map(item => item.id), [friday.id])
    const unscopedStats = db.getSessionsWithStats()
    assert.deepEqual(unscopedStats.sessions.map(item => item.id), [friday.id])
    assert.equal(unscopedStats.sessions.some(item => item.preview === '只属于笔记 A'), false)
    assert.deepEqual(db.getSessions('note-agent', 'note:a').map(item => item.id), [noteA.id])
    assert.deepEqual(db.getSessions('note-agent', 'note:b').map(item => item.id), [noteB.id])
    assert.equal(db.getSession(noteA.id), null)
    assert.equal(db.getMessages(noteA.id).length, 0)
    assert.equal(db.updateSessionTitle(noteA.id, '越权改名'), false)
    assert.equal(db.deleteSession(noteA.id).deleted, false)
    assert.equal(db.updateSessionTitle(noteA.id, '越权改名', 'note-agent', 'note:b'), false)
    assert.equal(db.deleteSession(noteA.id, 'note-agent', 'note:b').deleted, false)
    assert.equal(db.rollbackSession(noteA.id, noteMessage.id), false)
    assert.equal(db.getSession(noteA.id, 'note-agent', 'note:a').title, '笔记 A')
    assert.equal(db.getMessages(noteA.id, 'note-agent', 'note:b').length, 0)
    assert.equal(db.getMessages(noteA.id, 'note-agent', 'note:a').length, 1)
    assert.equal(db.rollbackSession(noteA.id, noteMessage.id, 'note-agent', 'note:a'), true)
    assert.equal(db.getMessages(noteA.id, 'note-agent', 'note:a').length, 0)
  } finally {
    db.closeDb()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('重试同一轮定位原用户消息而不产生重复用户记录', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-session-retry-'))
  db.setDataDir(root)
  try {
    await db.initDb()
    const session = db.createSession('重试测试', 'chat', 'friday', null)
    const first = db.saveMessage(session.id, 'user', '同一条消息')
    db.saveMessage(session.id, 'assistant', '请求失败：暂时离线', { error: true })
    const found = db.findLatestUserMessage(session.id, '同一条消息', 'friday', null)
    assert.equal(found.id, first.id)
    assert.equal(db.getMessages(session.id, 'friday', null).filter(item => item.role === 'user').length, 1)
  } finally {
    db.closeDb()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('敏感识别先于链接类型，加密不可用不返回原文', () => {
  for (const value of ['验证码：123456', '密码 abc', 'token=secret-value', 'https://example.test/?token=secret', 'sk-1234567890123456', '123456']) assert.equal(classifyClipboard(value), 'secret')
  assert.equal(classifyClipboard('普通笔记正文'), 'text')
  assert.equal(classifyClipboard('https://example.test/'), 'link')
  assert.equal(classifyClipboard('hello', '<b>hello</b>'), 'html')
  assert.throws(() => protectedText('secret', { isEncryptionAvailable: () => false }), /未保存/)
  assert.equal(clipboardMatches({ sensitivity: 'secret', plainText: 'secret', tags: ['secret'] }, 'secret'), false)
  assert.equal(isSensitiveClipboardExpired({ sensitivity: 'secret', expiresAt: '2026-10-23T00:00:00.000Z' }, Date.parse('2026-10-23T00:15:00.000Z')), true)
  assert.equal(isSensitiveClipboardExpired({ sensitivity: 'normal', expiresAt: '2026-10-23T00:00:00.000Z' }, Date.parse('2026-10-23T00:15:00.000Z')), false)
})

test('选项卡溢出滚动、不溢出切换、连续手势去抖', () => {
  assert.deepEqual(wheelIntent({ scrollWidth: 800, clientWidth: 400, deltaY: 100 }), { scroll: 100, switchBy: 0 })
  assert.deepEqual(wheelIntent({ scrollWidth: 400, clientWidth: 400, deltaY: -60, now: 1000 }), { scroll: 0, switchBy: -1 })
  assert.deepEqual(wheelIntent({ scrollWidth: 400, clientWidth: 400, deltaY: 60, now: 1100, lastSwitchAt: 1000 }), { scroll: 0, switchBy: 0 })
})

test('全局横向滚轮路由到笔记表格和代码等溢出区域，并保留边界与选项卡行为', () => {
  const root = { contains: () => true }
  const scrollBox = {
    nodeType: 1,
    parentElement: root,
    style: { overflowX: 'auto' },
    scrollWidth: 900,
    clientWidth: 300,
    scrollLeft: 10,
    closest: () => null
  }
  const event = {
    target: scrollBox,
    deltaX: 0,
    deltaY: 120,
    defaultPrevented: false,
    preventDefault() { this.prevented = true }
  }
  assert.equal(findHorizontalWheelTarget(scrollBox, root), scrollBox)
  assert.equal(routeHorizontalWheel(event, { root }), true)
  assert.equal(scrollBox.scrollLeft, 130)
  assert.equal(event.prevented, true)

  const tabs = { ...scrollBox, scrollLeft: 10, closest: selector => selector.includes('.tabs-scroll') ? {} : null }
  const tabEvent = { ...event, target: tabs, prevented: false, preventDefault() { this.prevented = true } }
  assert.equal(routeHorizontalWheel(tabEvent, { root }), false)
  assert.equal(tabs.scrollLeft, 10)

  const edge = { ...scrollBox, scrollLeft: 0, scrollWidth: 300, clientWidth: 300 }
  const edgeEvent = { ...event, target: edge, prevented: false, preventDefault() { this.prevented = true } }
  assert.equal(routeHorizontalWheel(edgeEvent, { root }), false)
})

test('背诵分析只依据片段和参考文本，不猜测重复遍数', () => {
  const segments = [
    { start: 0, end: 1.5, text: '今天天气', confidence: 0.9 },
    { start: 3, end: 4.5, text: '很好', confidence: 0.8 }
  ]
  const result = analyzeRecitation('今天天气很好', { durationSeconds: 4.5, segments })
  assert.equal(result.pacePerMinute, 80)
  assert.equal(result.pauseCount, 1)
  assert.equal(result.repetitionCount, null)
  assert.equal(result.alignment, null)
  const aligned = analyzeRecitation('今天天气很好', { durationSeconds: 4.5, segments, referenceText: '今天天气真好' })
  assert.equal(aligned.alignment.status, 'aligned')
  assert.ok(aligned.alignment.accuracy > 0 && aligned.alignment.accuracy < 1)
  assert.equal(analyzeRecitation('文本', { referenceText: '参考' }).alignment.accuracy, 0)
})

test('背诵练习保存准确来源，低置信度片段进入首轮校对', () => {
  const segments = [
    { start: 0, end: 2, text: '阅读可以增加知识', confidence: 0.9 },
    { start: 3, end: 5, text: '运动可以保持健康', confidence: 0.4 },
    { start: 6, end: 8, text: '环境需要大家保护', confidence: 0.8 }
  ]
  const study = buildRecitationStudy(segments.map(item => item.text).join('。'), segments)
  assert.deepEqual(new Set(study.questions.map(question => question.type)), new Set(['blank', 'choice', 'recall']))
  for (const question of study.questions) {
    assert.equal(question.source.text, segments[question.source.id].text)
    assert.equal(question.source.start, segments[question.source.id].start)
    assert.ok(question.source.text.includes(question.answer))
    if (question.options) assert.equal(question.options.filter(option => option === question.answer).length, 1)
  }
  assert.deepEqual(study.plan[0].sourceIds, [1])
  assert.deepEqual(study.plan.map(step => step.afterHours), [0, 24, 72])
  const withoutTimestamps = buildRecitationStudy('阅读可以增加知识。运动可以保持健康。')
  assert.ok(withoutTimestamps.questions.every(question => question.source.start === null))
})

test('背诵历史迁移、重新分析、重启持久化与无效音频失败状态', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-recitation-db-'))
  db.setDataDir(root); setConfigDataDir(root)
  try {
    await db.initDb()
    const audio = path.join(root, 'sample.wav')
    fs.writeFileSync(audio, 'invalid audio fixture')
    fs.mkdirSync(path.join(root, 'recitation'))
    const legacyPath = path.join(root, 'recitation', 'sessions.json')
    fs.writeFileSync(legacyPath, JSON.stringify({ old: { id: 'old', filePath: audio, name: '旧音频', updatedAt: new Date().toISOString(), status: 'analyzed', transcript: '阅读可以增加知识', segments: [{ start: 0, end: 2, text: '阅读可以增加知识', confidence: 0.9 }], analysis: { durationSeconds: 3 } } }))
    assert.equal(listRecitations().length, 1)
    assert.equal(fs.existsSync(legacyPath + '.migrated'), true)
    const analyzed = reanalyzeRecitation('old', '阅读可以增加知识')
    assert.equal(analyzed.analysis.alignment.accuracy, 1)
    assert.equal(analyzed.analysis.voicedSeconds, 2)
    assert.equal(db.queryAllRaw('SELECT * FROM recitation_segments').length, 1)
    db.closeDb(); await db.initDb()
    assert.equal(listRecitations()[0].referenceText, '阅读可以增加知识')
    const imported = importRecitationAudio(audio)
    await assert.rejects(transcribeRecitation(imported.id, 'missing-model'), /请选择/)
    assert.equal(listRecitations().find(item => item.id === imported.id).status, 'error')
    assert.throws(() => importRecitationAudio(root), /非空音频/)
    const empty = path.join(root, 'empty.wav'); fs.writeFileSync(empty, '')
    assert.throws(() => importRecitationAudio(empty), /非空音频/)
  } finally { db.closeDb(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('人工校对保留原始识别、时间和置信度，拒绝旧版本覆盖，重启后练习仍定位正确', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-recitation-correct-'))
  db.setDataDir(root); setConfigDataDir(root)
  try {
    await db.initDb()
    const item = { id: 'correct', transcript: '误报\n阅读增加继续\n运动保持健康', filePath: path.join(root, 'audio.wav'), updatedAt: new Date().toISOString(), status: 'analyzed', analysis: { durationSeconds: 10 }, segments: [
      { start: 0, end: 1, text: '误报', confidence: 0.1 },
      { start: 2, end: 4, text: '阅读增加继续', confidence: 0.4 },
      { start: 6, end: 9, text: '运动保持健康', confidence: 0.9 },
    ] }
    db.queryAllRaw('INSERT INTO recitation_sessions VALUES (?, ?, ?)', [item.id, JSON.stringify(item), item.updatedAt])
    const saved = correctRecitationTranscript(item.id, { expectedUpdatedAt: item.updatedAt, texts: ['', '阅读增加知识', '运动保持健康'], referenceText: '阅读增加知识，运动保持健康' })
    assert.equal(saved.rawTranscript, item.transcript)
    assert.deepEqual(saved.rawSegments, item.segments)
    assert.equal(saved.segments[1].start, 2)
    assert.equal(saved.segments[1].confidence, 0.4)
    assert.equal(saved.segments[1].corrected, true)
    assert.equal(saved.analysis.alignment.accuracy, 1)
    assert.ok(saved.study.questions.some(question => question.source.id === 1 && question.source.start === 2 && question.source.text.includes('知识')))
    assert.ok(!saved.study.questions.some(question => question.source.id === 0))
    assert.throws(() => correctRecitationTranscript(item.id, { expectedUpdatedAt: item.updatedAt, texts: ['旧版本', '', ''] }), /RECITATION_TRANSCRIPT_CHANGED/)
    assert.throws(() => correctRecitationTranscript(item.id, { expectedUpdatedAt: saved.updatedAt, texts: ['', '', ''] }), /RECITATION_CORRECTION_INVALID/)
    db.closeDb(); await db.initDb()
    const reopened = listRecitations()[0]
    assert.equal(reopened.transcript, saved.transcript)
    assert.deepEqual(reopened.rawSegments, item.segments)
    assert.equal(reopened.study.questions.find(question => question.source.id === 1).source.start, 2)
  } finally { db.closeDb(); fs.rmSync(root, { recursive: true, force: true }) }
})
