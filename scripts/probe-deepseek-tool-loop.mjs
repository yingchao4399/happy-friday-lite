import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const configPath = process.env.FRIDAY_CONFIG_PATH || path.join(root, 'app-data', 'config.json')
const config = JSON.parse(await readFile(configPath, 'utf8'))
const model = config.customModels?.find((item) => item.id === config.selectedModelId) || config.customModels?.[0]
assert.ok(model?.apiKey && model?.modelName && model?.baseUrl, '没有可用的已配置模型')

const targetRounds = Number(process.env.DEEPSEEK_TOOL_ROUNDS || 100)
const endpoint = `${String(model.baseUrl).replace(/\/$/, '')}/chat/completions`
const tool = {
  type: 'function',
  function: {
    name: 'probe_step',
    description: '执行一次无副作用的协议验收步骤。每次只能调用一次。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { step: { type: 'integer', minimum: 1, maximum: targetRounds } },
      required: ['step'],
    },
  },
}

function parseSse(body) {
  const calls = new Map()
  let content = ''
  let reasoning = ''
  let finishReason = ''
  for (const line of String(body).split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    let event
    try { event = JSON.parse(payload) } catch { continue }
    if (event.error) throw new Error(`provider_error:${event.error.code || event.error.type || 'unknown'}`)
    const choice = event.choices?.[0]
    if (!choice) continue
    finishReason = choice.finish_reason || finishReason
    const delta = choice.delta || {}
    if (typeof delta.content === 'string') content += delta.content
    if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content
    for (const item of delta.tool_calls || []) {
      const current = calls.get(item.index) || { id: '', name: '', args: '' }
      if (item.id) current.id = item.id
      if (item.function?.name) current.name = item.function.name.startsWith(current.name) ? item.function.name : current.name + item.function.name
      if (item.function?.arguments) current.args += item.function.arguments
      calls.set(item.index, current)
    }
  }
  return { calls: [...calls.values()], content, reasoning, finishReason }
}

async function request(messages, tools = [tool]) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${model.apiKey}` },
    body: JSON.stringify({
      model: model.modelName,
      messages,
      tools,
      max_tokens: 256,
      temperature: 0,
      stream: true,
      thinking: { type: 'disabled' },
    }),
  })
  const text = await response.text()
  if (!response.ok) {
    let detail = ''
    try {
      const json = JSON.parse(text)
      detail = json?.error?.param || json?.error?.code || json?.error?.type || ''
    } catch { /* keep status only */ }
    throw new Error(`http_${response.status}${detail ? `:${detail}` : ''}`)
  }
  return parseSse(text)
}

const system = [
  `You are running a protocol test with exactly ${targetRounds} sequential tool continuation rounds.`,
  'For every step from 1 through the target, call probe_step exactly once with the next integer step.',
  'After each tool result, continue with the next step. Do not answer with prose until all steps are complete.',
  'After the final tool result, answer with the single word COMPLETE.',
].join(' ')
const messages = [
  { role: 'system', content: system },
  { role: 'user', content: `Perform all ${targetRounds} sequential probe steps now.` },
]
const failures = []
const calls = []
let requestCount = 0
for (let expected = 1; expected <= targetRounds; expected += 1) {
  let turn
  try {
    requestCount += 1
    turn = await request(messages)
  } catch (error) {
    failures.push({ round: expected, error: String(error?.message || error) })
    break
  }
  if (turn.calls.length !== 1 || turn.calls[0].name !== 'probe_step') {
    failures.push({ round: expected, error: 'missing_single_probe_step', callCount: turn.calls.length, finishReason: turn.finishReason })
    break
  }
  let input
  try { input = JSON.parse(turn.calls[0].args || '{}') } catch { input = null }
  if (!input || Number(input.step) !== expected) {
    failures.push({ round: expected, error: 'wrong_step', received: input?.step ?? null })
    break
  }
  calls.push({ round: expected, toolCallIdPresent: Boolean(turn.calls[0].id), reasoningPresent: Boolean(turn.reasoning) })
  messages.push({
    role: 'assistant',
    content: turn.content || null,
    ...(turn.reasoning ? { reasoning_content: turn.reasoning } : {}),
    tool_calls: [{ id: turn.calls[0].id, type: 'function', function: { name: turn.calls[0].name, arguments: turn.calls[0].args } }],
  })
  messages.push({ role: 'tool', tool_call_id: turn.calls[0].id, content: JSON.stringify({ ok: true, step: expected, instruction: expected < targetRounds ? `Continue with step ${expected + 1}.` : 'All steps complete; answer COMPLETE.' }) })
}

if (failures.length === 0) {
  try {
    requestCount += 1
    const final = await request(messages, [])
    if (!/COMPLETE/i.test(final.content)) failures.push({ round: targetRounds + 1, error: 'missing_final_completion' })
  } catch (error) {
    failures.push({ round: targetRounds + 1, error: String(error?.message || error) })
  }
}

const success = failures.length === 0 && calls.length === targetRounds
console.log(JSON.stringify({ ok: success, model: model.modelName, rounds: calls.length, targetRounds, requestCount, failureCount: failures.length, failures }))
process.exitCode = success ? 0 : 1
