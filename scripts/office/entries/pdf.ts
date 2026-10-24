// Bundles the upstream PDF editor main-process module for embedding into the
// Happy Friday Lite main process (see scripts/build-office.mjs).
export * from '../../../vendor/happyoffice/apps/pdf/src/main/pdf-main'
export { ocrPagePng as recognizePdfPage } from '../../../vendor/happyoffice/apps/pdf/src/main/ocr'
