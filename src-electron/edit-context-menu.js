import { Menu, BrowserWindow } from 'electron'

// 未自行处理右键的正文/输入框使用系统编辑菜单，保留编辑器自己的表格等专用菜单。
export function installEditContextMenu(contents, { captureClipboard } = {}) {
  // copy/cut 是发往 renderer 的异步命令。等待该页面处理完一轮事件后才读取系统剪贴板，
  // 避免主进程 keyUp/菜单回调抢先收录用户上一次复制的外部内容。
  const capture = () => {
    if (contents.isDestroyed()) return
    contents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 0))')
      .then(() => { if (!contents.isDestroyed()) captureClipboard?.() })
      .catch(() => {})
  }
  contents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyUp' && (input.control || input.meta) && ['c', 'x'].includes(input.key?.toLowerCase())) capture()
  })
  contents.on('context-menu', async (_event, params) => {
    if (!params.isEditable && !params.selectionText) return

    // Electron's role labels follow the Windows UI language, while Friday's
    // other context menus follow the app locale. Resolve the renderer locale
    // at the moment the menu opens and provide explicit labels so a Chinese
    // Friday window never shows an English editor menu (and vice versa).
    let language = 'zh-CN'
    try {
      const value = await contents.executeJavaScript('document.documentElement.lang || "zh-CN"')
      if (typeof value === 'string' && value) language = value
    } catch { /* a destroyed/initializing renderer keeps the safe default */ }
    if (contents.isDestroyed()) return
    const labels = language.toLowerCase().startsWith('zh')
      ? { undo: '撤销', redo: '重做', cut: '剪切', copy: '复制', paste: '粘贴', selectAll: '全选' }
      : { undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select all' }
    const template = []
    if (params.isEditable) template.push(
      { role: 'undo', label: labels.undo, enabled: params.editFlags.canUndo },
      { role: 'redo', label: labels.redo, enabled: params.editFlags.canRedo },
      { type: 'separator' },
    )
    const editItem = (role, enabled) => ({
      role,
      label: labels[role],
      enabled,
      click() { if (!contents.isDestroyed()) { contents[role](); capture() } },
    })
    if (params.isEditable) template.push(editItem('cut', params.editFlags.canCut))
    template.push(editItem('copy', params.editFlags.canCopy))
    if (params.isEditable) template.push({ role: 'paste', label: labels.paste, enabled: params.editFlags.canPaste })
    template.push({ type: 'separator' }, { role: 'selectAll', label: labels.selectAll, enabled: params.editFlags.canSelectAll })
    const menu = Menu.buildFromTemplate(template)
    menu.popup({ window: BrowserWindow.fromWebContents(contents) || undefined })
  })
}
