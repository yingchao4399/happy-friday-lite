export const DECISION_ENDPOINTS = Object.freeze([
  ['openrouter', 'Jev (OpenRouter)'], ['direct', 'Jev (TypeSafe API)'],
  ['perplexity', 'Perplexity (v1 27B)'], ['perplexity-v12', 'Perplexity (v1.2)'], ['perplexity-flash', 'Perplexity (Flash v1.2)'],
  ['liquid', 'Liquid AI (d1)'], ['liquid-ultra', 'Liquid AI (d1-ultra)'], ['openai', 'OpenAI (gpt-6-luna)'],
  ['cloudflare', 'Cloudflare (Clef)'], ['cloudflare-flash', 'Cloudflare (Clef-flash)'],
  ['kev', 'Kev (local)'], ['rizzo', 'Rizzo Flow (local)'], ['custom', 'Custom (/v1/systemone)'],
].map(([id, label]) => Object.freeze({ id, label })))

export function normalizeFileSearchPatch(patch = {}, previous = {}) {
  const text = (value, n) => typeof value === 'string' ? value.trim().slice(0, n) : ''
  const ids = DECISION_ENDPOINTS.map(item => item.id)
  const value = { ...previous, ...patch, keys: { ...previous.keys, ...patch.keys } }
  return {
    rerank: value.rerank === true,
    endpoint: ids.includes(value.endpoint) ? value.endpoint : 'openrouter',
    keys: Object.fromEntries(ids.map(id => [id, text(value.keys[id], 512)])),
    customBaseUrl: text(value.customBaseUrl, 512), customModel: text(value.customModel, 128),
    cloudflareAccountId: text(value.cloudflareAccountId, 128),
    cloudflareModel: text(value.cloudflareModel, 256) || '@cf/cloudflare/clef',
  }
}

export function publicFileSearchSettings(value) {
  const { keys, ...settings } = value
  return { ...settings, keysConfigured: Object.fromEntries(Object.entries(keys).map(([id, key]) => [id, Boolean(key)])) }
}
