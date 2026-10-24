import { loadConfig } from '../config.js'
import { approvalMessages } from './approvalMessages.js'

export async function requestExternalApproval(name, args, ctx) {
  const { BrowserWindow, dialog } = await import('electron')
  const window = ctx.mainWindow || BrowserWindow.getAllWindows().find(item => !item.isDestroyed())
  if (!window) throw new Error('该操作需要在 Friday 应用内审批后执行')
  const text = approvalMessages[loadConfig().language] || approvalMessages['en-US']
  const result = await dialog.showMessageBox(window, {
    type: 'question', title: text.title, message: text.message,
    detail: `${text.actor}: ${ctx.actor}\n${text.capability}: ${name}\n\n${JSON.stringify(args, null, 2).slice(0, 12000)}`,
    buttons: [text.deny, text.allow], defaultId: 0, cancelId: 0, noLink: true,
    ...(ctx.signal ? { signal: ctx.signal } : {})
  })
  if (ctx.signal?.aborted) throw new Error('任务已取消')
  return result.response === 1
}
