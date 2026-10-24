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
  contents.on('context-menu', (_event, params) => {
    if (!params.isEditable && !params.selectionText) return
    const template = []
    if (params.isEditable) template.push({ role: 'undo', enabled: params.editFlags.canUndo }, { role: 'redo', enabled: params.editFlags.canRedo }, { type: 'separator' })
    const editItem = (role, enabled) => ({
      label: Menu.buildFromTemplate([{ role }]).items[0].label,
      enabled,
      click() { if (!contents.isDestroyed()) { contents[role](); capture() } },
    })
    if (params.isEditable) template.push(editItem('cut', params.editFlags.canCut))
    template.push(editItem('copy', params.editFlags.canCopy))
    if (params.isEditable) template.push({ role: 'paste', enabled: params.editFlags.canPaste })
    template.push({ type: 'separator' }, { role: 'selectAll', enabled: params.editFlags.canSelectAll })
    const menu = Menu.buildFromTemplate(template)
    menu.popup({ window: BrowserWindow.fromWebContents(contents) || undefined })
  })
}
