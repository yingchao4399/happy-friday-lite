export const OFFICE_OPERATION_CATALOG = Object.freeze([
  Object.freeze({ operationId: 'office.html.create', capabilityName: 'office_html_create', sourceType: 'content', targetFormats: Object.freeze(['html']), protocolVersion: '1.0', requiredEditors: Object.freeze(['html']) }),
  Object.freeze({ operationId: 'office.html.apply', capabilityName: 'office_html_apply', sourceType: 'html', targetFormats: Object.freeze(['html']), protocolVersion: '1.0', requiredEditors: Object.freeze(['html']) }),
  Object.freeze({ operationId: 'office.html.export', capabilityName: 'office_html_export', sourceType: 'html', targetFormats: Object.freeze(['pdf', 'docx', 'html']), protocolVersion: '1.0', requiredEditors: Object.freeze(['html']) }),
  Object.freeze({ operationId: 'office.document.convert', capabilityName: 'office_document_convert', sourceType: 'pdf', targetFormats: Object.freeze(['docx']), protocolVersion: '1.0', requiredEditors: Object.freeze(['pdf', 'docs']), requiredService: 'pdf-converter' }),
  Object.freeze({ operationId: 'office.document.create', capabilityName: 'office_document_create', sourceType: 'content', targetFormats: Object.freeze(['docx']), protocolVersion: '1.0', requiredEditors: Object.freeze(['docs']) }),
])

// 入口与领域执行共用格式校验，避免把未支持的路线交给工具 schema 后变成泛化错误。
export function findOfficeOperation({ operationId, capabilityName, targetFormat } = {}) {
  if ((!operationId && !capabilityName) || typeof targetFormat !== 'string') return null
  return OFFICE_OPERATION_CATALOG.find(item =>
    (!operationId || item.operationId === operationId) && (!capabilityName || item.capabilityName === capabilityName) && item.targetFormats.includes(targetFormat)) || null
}

// 菜单、编辑器 AI 与主助手均投影这份目录；未集成的上游应用不冒充可用能力。
export async function projectOfficeCapabilities(check) {
  return Promise.all(OFFICE_OPERATION_CATALOG.map(async definition => {
    const result = await check(definition)
    return { ...definition, available: result.ok === true, ...(result.ok ? {} : { reasonCode: result.code || 'OFFICE_CAPABILITY_UNAVAILABLE' }) }
  }))
}
