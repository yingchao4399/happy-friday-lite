import fs from 'node:fs'
import path from 'node:path'

const configPath = process.argv[2] || path.join(process.env.APPDATA || '', 'happy-friday-lite', 'config.json')
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const model = (config.customModels || []).find(item => item.provider === 'deepseek')
if (!model?.apiKey || !model?.baseUrl || !model?.modelName) throw new Error('DeepSeek 配置不完整')

const baseUrl = String(model.baseUrl).trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '')
const headers = { Authorization: `Bearer ${model.apiKey}`, 'Content-Type': 'application/json' }

async function request(url, init = {}) {
  let last = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const startedAt = Date.now()
    try {
      const response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(30000) })
      const text = await response.text()
      let payload = null
      try { payload = JSON.parse(text) } catch (_error) {}
      return {
        ok: response.ok,
        status: response.status,
        attempts: attempt,
        latencyMs: Date.now() - startedAt,
        modelCount: Array.isArray(payload?.data) ? payload.data.length : undefined,
        responseModel: payload?.model || undefined,
        choices: Array.isArray(payload?.choices) ? payload.choices.length : undefined,
        error: payload?.error?.message ? String(payload.error.message).slice(0, 200) : undefined
      }
    } catch (error) {
      last = { ok: false, status: null, attempts: attempt, latencyMs: Date.now() - startedAt, errorType: error.name, error: String(error.message).slice(0, 200), cause: error.cause?.code || error.cause?.message || undefined }
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 1000))
    }
  }
  return last
}

const models = await request(`${baseUrl}/models`)
const chat = await request(`${baseUrl}/chat/completions`, {
  method: 'POST',
  body: JSON.stringify({ model: model.modelName, messages: [{ role: 'user', content: '只回复 OK' }], stream: false, max_tokens: 4 })
})
const result = { provider: model.provider, configuredModel: model.modelName, baseUrl, models, chat, checkedAt: new Date().toISOString() }
console.log(JSON.stringify(result, null, 2))
if (!models.ok || !chat.ok || chat.choices !== 1) process.exitCode = 1
