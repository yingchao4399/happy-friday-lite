import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { transformHtmlHostSource } from '../office/html-host-adapter.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const aiRoot = path.join(root, 'vendor/genoffice-html/apps/html/src/renderer/ai')
// Execute the same prompt builders and live tool predicate used by the editor.
// No model, network, user settings or documents are involved.
const compiled = await build({
  stdin: {
    contents: `export { createDocumentSkill } from './html-skill.ts'
export { buildPageWriterRequest } from './page-writer.ts'
export { buildBriefWriterRequest } from './brief-writer.ts'
export { injectBrief, parseBrief } from '../document/brief.ts'`,
    resolveDir: aiRoot,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  plugins: [{ name: 'tested-friday-html-adapter', setup(builder) {
    builder.onLoad({ filter: /[/\\]apps[/\\]html[/\\]src[/\\]renderer[/\\]ai[/\\](html-skill|page-writer|brief-writer|tools)\.ts$/ }, async args => {
      const source = fs.readFileSync(args.path, 'utf8')
      return { contents: transformHtmlHostSource(source, args.path) ?? source, loader: 'ts' }
    })
  } }],
})
const product = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'))
const brief = {
  core_hook: 'Fixture brief',
  style: { tone: 'clear', palette: {}, typography: {} },
  sections: [{ title: 'Report', brief: 'A short report' }],
  version: 1,
}
const access = {
  getText: () => '',
  getMap: () => ({ version: 0, elements: [], bySid: new Map(), errorCount: 0 }),
}

test('HTML assistant、design/content writer 和 brief writer 的真实请求统一使用 Friday 身份', () => {
  const assistant = product.createDocumentSkill(access, () => true)
  const requests = [
    { system: assistant.systemPrompt },
    product.buildPageWriterRequest({ kind: 'design', brief, instruction: 'Create a report' }, ''),
    product.buildPageWriterRequest({ kind: 'content', plan: 'A short report', instruction: 'Write a report' }, ''),
    product.buildBriefWriterRequest({ mode: 'new' }, [], ''),
  ]
  for (const request of requests) {
    assert.match(request.system.split('\n')[0], /Friday/)
    assert.doesNotMatch(request.system, /GenOffice HTML|Genspark/)
  }
})

test('生图能力关闭时工具与提示一致，恢复指向 Friday AI 工具设置，能力恢复后即时可用', () => {
  let available = false
  const skill = product.createDocumentSkill(access, () => available)
  assert.equal(skill.tools.some(tool => tool.name === 'generate_image'), false)
  assert.match(skill.systemPrompt, /Friday Settings > AI Tools > Image, Media & Search/)
  assert.match(skill.systemPrompt, /设置 > AI 工具 > 生图、媒体与搜索/)
  assert.match(skill.systemPrompt, /Use search_images only if that tool is available/)
  assert.doesNotMatch(skill.systemPrompt, /Genspark|signed out|cloud tools off/)
  available = true
  assert.equal(skill.tools.some(tool => tool.name === 'generate_image'), true)
  assert.doesNotMatch(skill.systemPrompt, /reports generate_image as unavailable/)
})

test('Friday 产品适配保留上游文档 brief 元数据的可读写合同', () => {
  const html = product.injectBrief('<!doctype html><html><head></head><body></body></html>', brief)
  assert.match(html, /name="genoffice:brief"/)
  assert.deepEqual(product.parseBrief(html), brief)
})

test('上游 prompt 锚点变化时拒绝构建，非目标 provider/header 源码不被替换', () => {
  const prompt = fs.readFileSync(path.join(aiRoot, 'html-skill.ts'), 'utf8')
  assert.throws(() => transformHtmlHostSource(prompt.replace('assistant inside GenOffice HTML,', 'assistant inside a different product,'), path.join(aiRoot, 'html-skill.ts')), /ADAPTER_DRIFT/)
  const protocolSource = `const provider = 'genspark'; const header = 'X-Genspark-Token-Pass'`
  assert.equal(transformHtmlHostSource(protocolSource, '/packages/ai-provider/src/protocol.ts'), null)
})
