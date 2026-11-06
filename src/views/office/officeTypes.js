// 渲染进程共用的类型合同；实际可用性由宿主判断，避免路由、标签和扩展名漂移。
export const OFFICE_EDITOR_TYPES = Object.freeze(['docs', 'sheets', 'slides', 'pdf', 'html'])
export const OFFICE_ROUTE_TYPES = OFFICE_EDITOR_TYPES.join('|')
export const OFFICE_TAB_RE = new RegExp(`^office-(${OFFICE_ROUTE_TYPES})-(\\d+)$`)
const OFFICE_VIEW_RE = new RegExp(`^(${OFFICE_ROUTE_TYPES})-(\\d+)$`)

export const OFFICE_TYPE_EXTENSIONS = Object.freeze({
  docs: Object.freeze(['docx']),
  sheets: Object.freeze(['xlsx', 'xlsm', 'csv']),
  slides: Object.freeze(['pptx']),
  pdf: Object.freeze(['pdf']),
  html: Object.freeze(['html', 'htm']),
})

export function isOfficeEditorType(value) {
  return OFFICE_EDITOR_TYPES.includes(value)
}

export function officeEditorPath(viewId) {
  const match = typeof viewId === 'string' ? viewId.match(OFFICE_VIEW_RE) : null
  return match ? `/office/${match[1]}/${match[2]}` : null
}

export function officeTypeFromPath(filePath) {
  const name = String(filePath || '').split('/').pop().split('\\').pop()
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  const ext = name.slice(dot + 1).toLowerCase()
  return OFFICE_EDITOR_TYPES.find(type => OFFICE_TYPE_EXTENSIONS[type].includes(ext)) || null
}

export function defaultOfficeEditorCapabilities() {
  return Object.fromEntries(OFFICE_EDITOR_TYPES.map(id => [id, {
    id,
    // 兼容旧宿主的四类入口；新候选在能力缺失、异常或旧版响应时一律关闭。
    available: ['docs', 'sheets', 'slides', 'pdf'].includes(id),
    reasonCode: id === 'html' ? 'FULL_APP_PARITY_PENDING' : null,
  }]))
}

export function normalizeOfficeEditorCapabilities(payload) {
  const fallback = defaultOfficeEditorCapabilities()
  const list = Array.isArray(payload?.editors) ? payload.editors : null
  if (!list) return fallback
  for (const item of list) {
    if (!item || !isOfficeEditorType(item.id)) continue
    fallback[item.id] = {
      id: item.id,
      available: item.available === true,
      reasonCode: item.available === true ? null : (item.reasonCode || 'OFFICE_EDITOR_UNAVAILABLE'),
    }
  }
  return fallback
}

/** 显式 HTML 编辑动作每次重新核实能力，不把缓存的按钮状态当作授权。 */
export async function openOfficeHtmlFile(filePath, invoke) {
  if (officeTypeFromPath(filePath) !== 'html') return { success: false, reasonCode: 'OFFICE_SOURCE_TYPE_INVALID' }
  const capabilities = normalizeOfficeEditorCapabilities(await invoke('office-get-editor-capabilities'))
  if (!capabilities.html.available) return { success: false, reasonCode: capabilities.html.reasonCode }
  const result = await invoke('office-open-file', { filePath })
  const editorPath = officeEditorPath(result?.viewId)
  return result?.success === true && editorPath?.startsWith('/office/html/')
    ? { ...result, editorPath }
    : { success: false, reasonCode: 'OFFICE_SOURCE_OPEN_FAILED' }
}

/** HTML 关闭必须有宿主明确成功回执，取消、异常或未知结果均保留标签。 */
export async function closeOfficeEditorTab(tabId, invoke) {
  const match = typeof tabId === 'string' ? tabId.match(OFFICE_TAB_RE) : null
  if (!match) return true
  const viewId = `${match[1]}-${match[2]}`
  if (match[1] === 'html') {
    try {
      const result = await invoke('office-close', { viewId })
      return result === true || result?.success === true
    } catch {
      return false
    }
  }
  try {
    await invoke('office-auto-save', { viewId })
    await invoke('office-close', { viewId })
  } catch { /* 兼容既有编辑器的关闭行为 */ }
  return true
}
