import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const fault = code => Object.assign(new Error(code), { code })
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const aborted = signal => { if (signal?.aborted) throw fault('OFFICE_OPERATION_CANCELLED') }

// 新建 HTML 与 DOCX 分开校验，使用同目录临时文件和不可覆盖的原子发布。
export async function createHtmlArtifact({ directory, title = 'document', source, signal, id = randomUUID }) {
  if (typeof source !== 'string' || !source.trim() || source.length > 8 * 1024 * 1024 || source.includes('\0')) throw fault('OFFICE_HTML_CONTENT_INVALID')
  aborted(signal)
  const root = await fs.realpath(directory)
  const stat = await fs.lstat(directory)
  // Windows TEMP 可能采用 ADMINI~1 等真实短路径别名；规范化后在同一个根内发布。
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw fault('OFFICE_OUTPUT_OUTSIDE_SANDBOX')
  const stem = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/, '').slice(0, 120) || 'document'
  const token = id()
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(token)) throw fault('OFFICE_HTML_ARTIFACT_ID_INVALID')
  const target = path.join(root, `${stem}-${token}.html`)
  const temp = path.join(root, `friday-${randomUUID()}.html.tmp`)
  const bytes = Buffer.from(source, 'utf8')
  const expected = hash(bytes)
  let handle
  try {
    handle = await fs.open(temp, 'wx', 0o600)
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close()
    handle = null
    aborted(signal)
    if (await fs.realpath(directory) !== root) throw fault('OFFICE_OUTPUT_OUTSIDE_SANDBOX')
    // link 不会覆盖同名目标；不使用 rename-over-existing 或截断写入回退。
    await fs.link(temp, target)
    const actual = await fs.readFile(target)
    if (hash(actual) !== expected) throw fault('OFFICE_ARTIFACT_CHANGED')
    return { id: token, path: target, format: 'html', size: actual.length, sha256: expected, persisted: true, validation: { valid: true, sourceBytesMatch: true } }
  } finally {
    await handle?.close().catch(() => {})
    await fs.rm(temp, { force: true }).catch(() => {})
  }
}
