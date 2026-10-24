import { parentPort, workerData } from 'node:worker_threads'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { convert } from 'html-to-text'
import TurndownService from 'turndown'
import XLSX from 'xlsx'
import AdmZip from 'adm-zip'
import { buildSlidesHandout } from './handout.js'

const run = promisify(execFile)
const { kind, format, bytes, html, plainText, directory, targetPath } = workerData
try {
  const original = { docs: 'docx', sheets: 'xlsx', slides: 'pptx' }[kind]
  const archive = new AdmZip(Buffer.from(bytes))
  const requiredPart = { docs: 'word/document.xml', sheets: 'xl/workbook.xml', slides: 'ppt/presentation.xml' }[kind]
  if (!archive.getEntry('[Content_Types].xml') || !archive.getEntry(requiredPart)) throw new Error('OFFICE_EXPORT_SNAPSHOT_INVALID')
  if (kind === 'slides' && format === 'handout.docx') await fs.writeFile(targetPath, await buildSlidesHandout(workerData.pages))
  else if (format === original) await fs.writeFile(targetPath, bytes)
  else if (kind === 'docs' && ['md', 'txt'].includes(format)) {
    if (typeof html !== 'string' || typeof plainText !== 'string') throw new Error('OFFICE_EXPORT_TEXT_MISSING')
    const markdown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
    markdown.addRule('officeTables', {
      filter: 'table',
      replacement: (_content, node) => {
        const rows = Array.from(node.querySelectorAll('tr')).map(row => Array.from(row.querySelectorAll('th,td')).map(cell => markdown.turndown(cell.innerHTML).trim().replaceAll('|', '\\|').replaceAll('\n', '<br>')))
        const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
        if (!width) return ''
        const table = rows.map(row => '| ' + Array.from({ length: width }, (_, index) => row[index] || '').join(' | ') + ' |')
        table.splice(1, 0, '| ' + Array(width).fill('---').join(' | ') + ' |')
        return '\n\n' + table.join('\n') + '\n\n'
      },
    })
    const text = format === 'md'
      ? markdown.turndown(html)
      : plainText || convert(html, { wordwrap: false })
    await fs.writeFile(targetPath, '\ufeff' + text, 'utf8')
  } else if (kind === 'sheets' && ['md', 'txt'].includes(format)) {
    const workbook = XLSX.read(bytes, { type: 'array' })
    const text = workbook.SheetNames.map(name => {
      const sheet = workbook.Sheets[name]
      if (format === 'txt') return `[${name}]\n` + XLSX.utils.sheet_to_csv(sheet, { FS: '\t' })
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false })
      const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
      const escape = value => String(value).replaceAll('|', '\\|').replaceAll('\n', '<br>')
      const table = rows.map(row => '| ' + Array.from({ length: width }, (_, i) => escape(row[i] ?? '')).join(' | ') + ' |')
      if (table.length) table.splice(1, 0, '| ' + Array(width).fill('---').join(' | ') + ' |')
      return `## ${name}\n\n` + table.join('\n')
    }).join('\n\n')
    await fs.writeFile(targetPath, '\ufeff' + text, 'utf8')
  } else {
    if (process.platform !== 'win32') throw new Error('OFFICE_NATIVE_EXPORT_UNAVAILABLE')
    const inputPath = path.join(directory, 'snapshot.' + original)
    await fs.writeFile(inputPath, bytes)
    const script = fileURLToPath(new URL('./native-export.ps1', import.meta.url))
    const native = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-InputPath', inputPath, '-OutputPath', targetPath, '-Kind', kind, '-Format', format, '-OwnershipPath', path.join(directory, 'owned-processes.json')], { windowsHide: true, timeout: 570000, maxBuffer: 1024 * 1024, encoding: 'utf8' })
    let pending = ''
    native.child.stdout.on('data', chunk => {
      pending += chunk
      const lines = pending.split(/\r?\n/)
      pending = lines.pop()
      for (const line of lines) {
        try {
          const progress = JSON.parse(line.trim())
          if (['native-starting', 'native-ready', 'native-converting'].includes(progress.stage)) parentPort.postMessage({ stage: progress.stage })
        } catch {}
      }
    })
    const { stdout } = await native
    const result = stdout.trim().split(/\r?\n/).map(line => JSON.parse(line.trim())).findLast(item => typeof item.ok === 'boolean')
    if (!result) throw new Error('OFFICE_NATIVE_EXPORT_RESULT_INVALID')
    if (!result.ok) throw Object.assign(new Error(result.code || 'OFFICE_NATIVE_EXPORT_FAILED'), { detail: result.detail })
  }
  parentPort.postMessage({ ok: true })
} catch (error) {
  parentPort.postMessage({ ok: false, code: error.message, detail: error.detail })
}
