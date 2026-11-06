import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { transform } from 'esbuild'
import { transformHtmlHostSource } from '../office/html-host-adapter.mjs'
import { transformHtmlPreviewSource } from '../office/html-renderer-adapter.mjs'
import { transformHtmlMainSource } from '../office/html-main-adapter.mjs'

const source = file => fs.readFileSync(new URL('../../vendor/genoffice-html/' + file, import.meta.url), 'utf8')
for (const file of ['apps/html/src/renderer/App.tsx', 'apps/html/src/preload/index.ts', 'apps/html/src/renderer/ai/AiPanel.tsx', 'apps/html/src/renderer/ai/tools.ts', 'apps/html/src/renderer/preview/PreviewFrame.tsx', 'apps/html/src/renderer/preview/instrument.ts', 'apps/html/src/renderer/PresentView.tsx', 'apps/html/src/renderer/i18n/strings.ts', 'packages/ui/src/ai-model-picker-options.ts']) {
  test(`固定上游适配锚点和 TypeScript 编译：${file}`, async () => {
    const original = source(file)
    const first = transformHtmlHostSource(original, '/' + file) ?? original
    const result = transformHtmlPreviewSource(first, '/' + file) ?? first
    assert.ok(result !== original, '目标文件未应用适配')
    await transform(result, { loader: file.endsWith('tsx') ? 'tsx' : 'ts', format: 'esm' })
    assert.equal(source(file), original, '适配不得修改固定上游文件')
  })
}
test('上游锚点变化时阻断而非静默漏应用安全补丁', () => {
  assert.throws(() => transformHtmlPreviewSource('export const stub=1', '/apps/html/src/renderer/preview/PreviewFrame.tsx'), /ADAPTER_DRIFT/)
  assert.throws(() => transformHtmlHostSource('export const stub=1', '/apps/html/src/renderer/ai/tools.ts'), /ADAPTER_DRIFT/)
})

for (const file of ['apps/html/src/main/html-main.ts', 'apps/html/src/main/preview-protocol.ts']) {
  test(`主进程权限和输出适配可编译：${file}`, async () => {
    const result = transformHtmlMainSource(source(file), '/' + file)
    assert.ok(result)
    await transform(result, { loader: 'ts', format: 'esm' })
  })
}
