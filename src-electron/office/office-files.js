import path from 'path'

/**
 * Office 文件类型路由（happyoffice-integration-plan.md）。
 * docs  = DOCX，sheets = XLSX/XLSM/CSV，slides = PPTX，pdf = PDF
 */
export const OFFICE_EDITOR_TYPES = ['docs', 'sheets', 'slides', 'pdf']

// 仅内部实验运行显式接受 HTML，系统默认关联仍沿用四类已发布编辑器。
export const isExperimentalHtmlEnabled = (environment = process.env) => environment.FRIDAY_OFFICE_EXPERIMENTAL_HTML === '1'

export function enablePackagedPreviewHtml({ isPackaged, appVersion, environment = process.env } = {}) {
  if (isPackaged === true && typeof appVersion === 'string' && /-preview\.\d+(?:$|[-+])/.test(appVersion)) {
    environment.FRIDAY_OFFICE_EXPERIMENTAL_HTML = '1'
  }
  return isExperimentalHtmlEnabled(environment)
}

const EXT_TO_TYPE = {
  '.docx': 'docs',
  '.xlsx': 'sheets',
  '.xlsm': 'sheets',
  '.csv': 'sheets',
  '.pptx': 'slides',
  '.pdf': 'pdf',
}

/** 返回文件对应的编辑器类型，不支持的类型返回 null */
export function resolveEditorType(filePath, { experimentalHtml = false } = {}) {
  if (!filePath) return null
  const extension = path.extname(filePath).toLowerCase()
  if (experimentalHtml === true && ['.html', '.htm'].includes(extension)) return 'html'
  return EXT_TO_TYPE[extension] || null
}
