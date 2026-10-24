import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
const run = promisify(execFile)

export async function recognizeImage(filePath) {
  if (process.platform !== 'win32') throw new Error('当前平台未配置图片 OCR 引擎')
  const script = fileURLToPath(new URL('./windows-ocr.ps1', import.meta.url))
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-ImagePath', filePath], { windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' })
  return JSON.parse(stdout.replace(/^\uFEFF/, '').trim())
}
