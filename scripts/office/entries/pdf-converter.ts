// 仅包装上游纯转换管线，供 Friday 的 worker_threads 执行器调用。
// 资源路径由宿主显式传入；此模块不依赖 cwd、Electron 或开发源码目录。
import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { convertPdfToDocx } from '../../../vendor/happyoffice/packages/pdf2docx/src'
import type { ConvertResult, OcrEngine, PdfiumModule } from '../../../vendor/happyoffice/packages/pdf2docx/src'
import { createVisionOcrEngine, createWindowsOcrEngine } from '../../../vendor/happyoffice/packages/pdf2docx/src/ocr-vision'

export { PdfLoadError } from '../../../vendor/happyoffice/packages/pdf2docx/src'

export interface ConvertSnapshotInput {
  bytes: Uint8Array
  password?: string
  wasmPath: string
  ocrHelperDir?: string | null
}

const pdfiumModules = new Map<string, Promise<PdfiumModule>>()

function absoluteResource(value: unknown, code: string): string {
  if (typeof value !== 'string' || !isAbsolute(value)) throw Object.assign(new Error(code), { code })
  return value
}

async function ensurePdfium(wasmPath: string): Promise<PdfiumModule> {
  let loading = pdfiumModules.get(wasmPath)
  if (!loading) {
    loading = (async () => {
      const { init } = await import('@embedpdf/pdfium') as unknown as { init(overrides: object): Promise<object> }
      const raw = readFileSync(wasmPath)
      const wasmBinary = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
      // 防止中文文件关联启动参数触发 Emscripten ASCII argv 断言。
      const wrapped = await init({ wasmBinary, thisProgram: 'friday-pdf-worker' }) as { pdfium?: unknown }
      const pdfium = (wrapped.pdfium ?? wrapped) as PdfiumModule & { _PDFiumExt_Init(): void }
      pdfium._PDFiumExt_Init()
      return pdfium
    })()
    pdfiumModules.set(wasmPath, loading)
    loading.catch(() => { if (pdfiumModules.get(wasmPath) === loading) pdfiumModules.delete(wasmPath) })
  }
  return loading
}

function ocrFor(directory: string | null | undefined): OcrEngine | null {
  if (directory == null) return null
  absoluteResource(directory, 'OCR_RESOURCE_PATH_INVALID')
  if (process.platform === 'darwin') return createVisionOcrEngine(join(directory, 'vision-ocr'))
  if (process.platform === 'win32') return createWindowsOcrEngine(join(directory, 'win-ocr.exe'))
  return null
}

export async function convertSnapshot(
  input: ConvertSnapshotInput,
  onProgress?: (page: number, total: number) => void,
): Promise<ConvertResult> {
  if (!(input?.bytes instanceof Uint8Array) || input.bytes.byteLength === 0) throw Object.assign(new Error('PDF_SNAPSHOT_INVALID'), { code: 'PDF_SNAPSHOT_INVALID' })
  if (input.password !== undefined && typeof input.password !== 'string') throw Object.assign(new Error('PDF_PASSWORD_INVALID'), { code: 'PDF_PASSWORD_INVALID' })
  const wasmPath = absoluteResource(input.wasmPath, 'PDFIUM_RESOURCE_PATH_INVALID')
  const ocr = ocrFor(input.ocrHelperDir)
  const pdfium = await ensurePdfium(wasmPath)
  return convertPdfToDocx(input.bytes, {
    pdfium,
    ...(ocr ? { ocr } : {}),
    ...(input.password !== undefined ? { password: input.password } : {}),
    ...(onProgress ? { onProgress } : {}),
  })
}
