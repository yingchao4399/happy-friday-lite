import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { verifyDeepseekImports } from './afterpack.cjs'

const root = path.resolve(process.argv[2] || 'node_modules')
const entries = [
  '@deepseek-ai/dsh/lib/bin.js',
  'typebox/build/system/memory/index.mjs'
]
const missing = []
try { verifyDeepseekImports(root) } catch (error) { missing.push({ entry: 'dsh-plugin-tree', reason: 'unresolved_imports', message: error.message }) }
entries.push('@deepseek-ai/dsh-llm-pi-ai/lib/index.js', '@deepseek-ai/dsh-mcp-client/lib/index.js', '@deepseek-ai/dsh-acp/lib/index.js')
for (const entry of entries) {
  const file = path.join(root, entry)
  if (!fs.existsSync(file)) {
    missing.push({ entry, reason: 'file_missing', file })
    continue
  }
  if (entry.endsWith('bin.js')) {
    try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }) } catch (error) {
      missing.push({ entry, reason: 'syntax_check_failed', message: error.message })
      continue
    }
    console.log(`[verify-dsh-runtime] ${entry} OK`)
    continue
  }
  try {
    await import(pathToFileURL(file).href)
    console.log(`[verify-dsh-runtime] ${entry} OK`)
  } catch (error) {
    missing.push({ entry, reason: 'import_failed', message: error.message })
  }
}
if (missing.length) {
  console.error(JSON.stringify({ ok: false, missing }, null, 2))
  process.exitCode = 1
} else {
  console.log('[verify-dsh-runtime] all entries OK')
}
