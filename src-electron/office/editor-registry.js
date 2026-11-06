// 构建与宿主共用的编辑器登记表。候选应用必须完成适配和验收才可启用。
export const OFFICE_HOST_PROTOCOL_VERSION = '1.0'
export const OFFICE_ADAPTER_VERSION = '1.0'

export const OFFICE_EDITOR_REGISTRY = Object.freeze([
  { id: 'docs', enabled: true, extensions: ['.docx'], requiredExports: ['configureDocsRuntime', 'createDocsView', 'registerDocsIpc', 'serializeDocsAiContent'] },
  { id: 'sheets', enabled: true, extensions: ['.xlsx', '.xlsm', '.csv'], requiredExports: ['configureSheetsRuntime', 'createSheetsView', 'registerSheetsIpc'] },
  { id: 'slides', enabled: true, extensions: ['.pptx'], requiredExports: ['configureSlidesRuntime', 'createSlidesView', 'registerSlidesIpc'] },
  { id: 'pdf', enabled: true, extensions: ['.pdf'], requiredExports: ['configurePdfRuntime', 'createPdfView', 'exportPdfSnapshot'] },
  { id: 'markdown', enabled: false, extensions: ['.md', '.markdown'], candidateReason: 'FULL_APP_PARITY_PENDING', requiredExports: [] },
  { id: 'html', enabled: false, experimental: true, extensions: ['.html', '.htm'], candidateReason: 'FULL_APP_PARITY_PENDING', requiredExports: [
    'configureHtmlRuntime', 'registerPrivilegedSchemes', 'createHtmlView', 'setHtmlUiLang', 'setHtmlHeadlessMode',
    'requestHtmlSave', 'requestHtmlClose', 'htmlIsDirty', 'htmlFilePath', 'htmlFileRenamed', 'htmlReadText',
    'setHtmlFileSavedHook', 'setHtmlProvisionalTitleHook', 'setHtmlPresentHooks',
    'setHtmlDocxExportPrepareHook', 'setHtmlDocxExportedHook',
    'sendHtmlExportRequest', 'sendHtmlPrintRequest', 'createHtmlPresentView', 'exportHtmlHeadless',
    'htmlAiWebSearch', 'htmlAiImageSearch', 'htmlAiGenerateImageWithProvider', 'htmlAiFetchRemoteImage', 'htmlAiReadBodyCapped',
  ] },
].map(editor => Object.freeze({ ...editor, extensions: Object.freeze(editor.extensions), requiredExports: Object.freeze(editor.requiredExports) })))

export const getEnabledOfficeEditors = () => OFFICE_EDITOR_REGISTRY.filter(editor => editor.enabled)
// 构建请求只增加已登记的实验应用，不修改公开启用状态或默认文件关联。
export const getBuildOfficeEditors = ({ experimentalHtml = false } = {}) => OFFICE_EDITOR_REGISTRY.filter(editor =>
  editor.enabled || (experimentalHtml === true && editor.id === 'html' && editor.experimental === true),
)
export const OFFICE_EDITORS = Object.freeze(getEnabledOfficeEditors().map(editor => editor.id))
export const OFFICE_EXT_TO_TYPE = Object.freeze(Object.fromEntries(
  getEnabledOfficeEditors().flatMap(editor => editor.extensions.map(extension => [extension, editor.id])),
))

// 服务没有可见编辑器；在 worker 内运行，不能随编辑器 registry 误注册扩展名。
export const OFFICE_SUPPORT_SERVICES = Object.freeze([
  Object.freeze({ id: 'pdf-converter', main: 'main/pdf-converter.cjs', requiredExports: Object.freeze(['convertSnapshot']) }),
])
export const OFFICE_REQUIRED_RESOURCES = Object.freeze([
  'wasm/pdfium.wasm', 'main/office-utils.cjs', 'main/attachment-parser.cjs', 'cli/happyfriday-office.cjs',
])

export function getOfficeEditorDefinition(id) {
  return OFFICE_EDITOR_REGISTRY.find(editor => editor.id === id) || null
}
