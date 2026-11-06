// 真实应用入口的 HTML/HTM → PDF/DOCX 验收；不通过测试替身或直调转换器。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
let packagedExecutable = null
let reportFile = path.join(root, 'artifacts/office-html-headless-report.json')
for (const argument of process.argv.slice(2)) {
  const field = argument.startsWith('--packaged-executable=') ? 'executable' : argument.startsWith('--report=') ? 'report' : null
  if (!field) throw new Error('HTML_HEADLESS_PROBE_ARGUMENT_INVALID')
  const value = argument.slice(argument.indexOf('=') + 1)
  if (!path.isAbsolute(value) || value.includes('\0')) throw new Error('HTML_HEADLESS_PROBE_ABSOLUTE_PATH_REQUIRED')
  if (field === 'executable') packagedExecutable = fs.realpathSync(value)
  else reportFile = value
}

const executable = packagedExecutable || require('electron')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-html-headless-'))
const manifestFile = packagedExecutable
  ? path.join(path.dirname(executable), 'resources/office/integration-manifest.json')
  : path.join(root, 'resources/office/integration-manifest.json')
const report = {
  ok: false, checkedAt: new Date().toISOString(),
  mode: packagedExecutable ? 'packaged-application-main-entry' : 'source-application-main-entry',
  executable, executableSha256: hash(fs.readFileSync(executable)),
  manifestSha256: hash(fs.readFileSync(manifestFile)), isolatedDataDir: directory, steps: [],
  limitations: ['实际应用 --headless-export 入口与真实导出产物；不覆盖操作系统安装/升级、真实用户 GUI 打印或复杂页面排版保真。'],
}

async function run(args) {
  const env = { ...process.env, FRIDAY_OFFICE_EXPERIMENTAL_HTML: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(executable, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  let timedOut = false
  const collect = chunk => { output = (output + chunk.toString()).slice(-64000) }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  const timer = setTimeout(() => { timedOut = true; child.kill() }, 180000)
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  }).finally(() => clearTimeout(timer))
  const envelopes = output.split(/\r?\n/).map(line => {
    try { return JSON.parse(line) } catch { return null }
  }).filter(value => value && typeof value === 'object' && ('status' in value || 'ok' in value))
  return { ...result, timedOut, envelope: envelopes.at(-1) || null, output: output.slice(-14000) }
}

try {
  const marker = 'FRIDAY_HTML_HEADLESS_NATIVE_2731'
  const source = `<!doctype html><html><head><meta charset="utf-8"><title>Headless fixture</title></head><body><h1>${marker}</h1><p>Native editable Word text and a local image.</p><img src="fixture.png" width="16" height="16"></body></html>`
  fs.writeFileSync(path.join(directory, 'fixture.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jU1EAAAAASUVORK5CYII=', 'base64'))
  for (const extension of ['html', 'htm']) {
    const input = path.join(directory, `中文 headless.${extension}`)
    fs.writeFileSync(input, source)
    const before = hash(fs.readFileSync(input))
    for (const format of ['pdf', 'docx']) {
      const target = path.join(directory, `${extension}-export.${format}`)
      const dataDir = path.join(directory, `${extension}-${format}-profile`)
      const args = [
        ...(!packagedExecutable ? [root] : []), `--friday-data-dir=${dataDir}`, '--disable-gpu',
        '--headless-export', input, '--to', format, '--out', target, '--json',
      ]
      const result = await run(args)
      const step = { extension, format, input, target, ...result }
      report.steps.push(step)
      assert.equal(result.timedOut, false, `${extension} → ${format} 超时`)
      assert.equal(result.code, 0, `${extension} → ${format} 失败: ${result.output}`)
      assert.ok(fs.existsSync(target), '应用未生成导出文件')
      const bytes = fs.readFileSync(target)
      if (format === 'pdf') {
        assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
        const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
        const loadingTask = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
        const document = await loadingTask.promise
        try {
          assert.ok(document.numPages > 0)
          const texts = []
          for (let page = 1; page <= document.numPages; page++) texts.push((await (await document.getPage(page)).getTextContent()).items.map(item => item.str || '').join(' '))
          assert.ok(texts.join('\n').includes(marker), 'PDF 无法回读源标题')
          step.readback = { pageCount: document.numPages, markerPresent: true }
        } finally { await loadingTask.destroy() }
      } else {
        const zip = new AdmZip(bytes)
        assert.ok(zip.readAsText('word/document.xml').includes(marker), 'DOCX 缺少原生文字标题')
        assert.ok(zip.getEntry('[Content_Types].xml'))
        const media = zip.getEntries().filter(entry => entry.entryName.startsWith('word/media/') && !entry.isDirectory)
        assert.ok(media.length > 0, 'DOCX 缺少本地图片')
        step.readback = { markerPresent: true, mediaCount: media.length }
      }
      assert.equal(hash(fs.readFileSync(input)), before, '导出修改了输入文档')
      Object.assign(step, { bytes: bytes.length, sha256: hash(bytes), sourceUnchanged: true })
      // 成功记录只保留 envelope；错误才需要完整诊断尾段。
      delete step.output
    }
  }
  report.ok = true
} catch (error) {
  report.error = error.stack || String(error)
  console.error(report.error)
  process.exitCode = 1
} finally {
  fs.mkdirSync(path.dirname(reportFile), { recursive: true })
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ok: report.ok, report: reportFile, cases: report.steps.length }))
}
