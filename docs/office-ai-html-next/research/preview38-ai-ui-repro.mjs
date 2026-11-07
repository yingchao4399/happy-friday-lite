// 仅使用合成输入重放真实实现；不读取模型配置、用户文档，不发网络请求。
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const load = file => import(pathToFileURL(path.join(root, file)).href)
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const { mergeOfficeToolDelta, finalizeOfficeToolCalls } = await load('src-electron/office/office-ai-stream.js')
const { createIpcTransport } = await load('vendor/happyoffice/packages/agent-core/src/electron-transport.ts')
const { transformHtmlHostSource } = await load('scripts/office/html-host-adapter.mjs')
const checks = []
const check = (name, pass, detail = {}) => checks.push({ name, pass, ...detail })

const payload = { questions: [{ id: 'audience', label: 'Audience?', options: ['Consumer', 'Business'] }] }
const chunks = ['{"questions":[', '{', '"id":"audience","label":"Audience?","options":["Consumer","Business"]', '}', ']', '}']
const merged = chunks.reduce(mergeOfficeToolDelta, '')
const [call] = finalizeOfficeToolCalls(new Map([[0, { id: 'fixture', name: 'ask_clarification', args: merged }]]), 'tool_calls')
check('合法嵌套澄清参数的分片保真', JSON.stringify(call.input) === JSON.stringify(payload), {
  validOriginal: JSON.stringify(JSON.parse(chunks.join(''))) === JSON.stringify(payload),
  expected: payload, merged, inputError: call.inputError || null, truncated: Boolean(call.truncated),
})
for (const [name, parts] of [
  ['连续数字分片保真', ['{"value":', '1', '1', '}']],
  ['连续文字分片保真', ['{"label":"', '好', '好', '"}']],
]) {
  const expected = JSON.parse(parts.join(''))
  const actual = JSON.parse(parts.reduce(mergeOfficeToolDelta, ''))
  check(name, JSON.stringify(expected) === JSON.stringify(actual), { expected, actual })
}

let listener
const events = []
const transport = createIpcTransport({
  onStream: fn => { listener = fn; return () => {} },
  start: request => queueMicrotask(() => {
    listener({ requestId: request.requestId, type: 'delta', text: 'reply before usage' })
    listener({ requestId: request.requestId, type: 'usage', usage: { inputTokens: 12, outputTokens: 5 } })
    listener({ requestId: request.requestId, type: 'done' })
  }),
  cancel: () => {}, getSettings: () => ({}), unknownErrorText: () => '未知错误',
})
transport.stream({ system: '', messages: [], tools: [] }, {
  onDelta: text => events.push(['delta', text]), onToolCall: () => {},
  onDone: () => events.push(['done']), onError: error => events.push(['error', error]),
})
await new Promise(resolve => setImmediate(resolve))
check('正文和用量事件后正常结束', !events.some(event => event[0] === 'error') && events.some(event => event[0] === 'done'), { events })

const htmlRoot = 'vendor/genoffice-html/apps/html/src/'
const adapt = relative => {
  const file = htmlRoot + relative
  const original = read(file)
  return transformHtmlHostSource(original, file) ?? original
}
const panel = adapt('renderer/ai/AiPanel.tsx')
const preload = adapt('preload/index.ts')
const ribbon = adapt('renderer/components/Ribbon.tsx')
check('HTML 面板已移除上游产品标题', !panel.includes('          Genspark\n'))
check('HTML Ribbon 已移除上游产品标题', !ribbon.includes('<span>Genspark AI</span>'))
check('HTML 提供会话历史入口', panel.includes('AiHistoryButton'))
check('HTML preload 提供会话列表合同', preload.includes('project:listChatsForFile'))
check('HTML 新聊天创建持久化会话', preload.includes('project:createChat') && panel.includes('.createChat('))

const moduleFile = 'src-electron/office/office-ai-stream.js'
const moduleRoots = [
  root, path.join(root, 'release/win-unpacked/resources/app'),
  ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, 'Programs/Happy Friday Lite/resources/app')] : []),
]
const identity = moduleRoots.flatMap(base => {
  const file = path.join(base, moduleFile)
  if (!fs.existsSync(file)) return []
  return [{ file, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') }]
})
const report = {
  checkedAt: new Date().toISOString(), node: process.version,
  ok: checks.every(item => item.pass), checks, identity,
  limitations: ['真实函数与源码合同的离线复现，不等于用户当次 SSE 字节回放或 GUI 全链验收。', '品牌/历史检查为静态合同红灯，不能证明消息已丢失。'],
}
fs.writeFileSync(fileURLToPath(new URL('./preview38-ai-ui-repro.json', import.meta.url)), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.ok ? 0 : 1
