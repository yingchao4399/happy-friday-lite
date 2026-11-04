// Bundles the upstream PDF editor main-process module for embedding into the
// Happy Friday Lite main process (see scripts/build-office.mjs).
export * from '../../../vendor/happyoffice/apps/pdf/src/main/pdf-main'
export { ocrPagePng as recognizePdfPage } from '../../../vendor/happyoffice/apps/pdf/src/main/ocr'
// The embedded Friday host also needs the shell's local PDF→DOCX pipeline.
// Exporting it from the PDF main bundle keeps PDFium/OCR resolution and the
// converter implementation in the same generated runtime artifact.
export {
  convertPdfFileToDocxLocalWithPrompt,
  convertPdfFileToDocxLocal,
  convertWithPasswordRetry,
} from '../../../vendor/happyoffice/apps/shell/src/main/pdf2docx-local'
