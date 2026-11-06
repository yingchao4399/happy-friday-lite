import path from 'path'

/**
 * Office 文件类型路由（happyoffice-integration-plan.md）。
 * docs  = DOCX，sheets = XLSX/XLSM/CSV，slides = PPTX，pdf = PDF
 */
export const OFFICE_EDITOR_TYPES = ['docs', 'sheets', 'slides', 'pdf', 'html']

// 预览版公开 HTML bundle，稳定版仍需宿主通过环境变量显式开启。
export const isExperimentalHtmlEnabled = (environment = process.env) => environment.FRIDAY_OFFICE_EXPERIMENTAL_HTML === '1'

export function enablePackagedPreviewHtml({ isPackaged, appVersion, environment = process.env } = {}) {
  // 预览版的源码启动和打包启动保持相同策略，保留显式关闭供诊断使用。
  if (typeof appVersion === 'string' && /-preview\.\d+(?:$|[-+])/.test(appVersion) && environment.FRIDAY_OFFICE_EXPERIMENTAL_HTML !== '0') {
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
