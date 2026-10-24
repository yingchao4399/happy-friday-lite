import { z } from 'zod'
import { registerTool } from '../registry.js'
import { observeUi, performUi } from '../../uiControl.js'

registerTool({
  name: 'ui_observe',
  description: '读取 Friday 当前窗口的可操作控件、可访问名称、状态与位置。操作前先调用，取得控件 ID。',
  schema: z.object({}),
  handler: async (_args, ctx) => JSON.stringify(await observeUi(ctx)),
  meta: { requireApproval: false, exposedViaMcp: true, capabilityType: 'navigation' }
})

registerTool({
  name: 'ui_perform',
  description: '按 ui_observe 返回的控件 ID 在 Friday 界面点击、填写、选择、按键或滚动，并检查结果。必须在调用前观察目标。',
  schema: z.object({
    id: z.string().regex(/^ui-\d+-\d+$/).optional(),
    actionId: z.string().min(1).max(200).optional(),
    action: z.enum(['click', 'fill', 'select', 'press', 'scroll']),
    value: z.string().optional(),
    expect: z.object({ text: z.string().optional(), route: z.string().optional(), selector: z.string().optional() }).optional()
  }),
  handler: async (args, ctx) => {
    if (!args.id && !args.actionId) throw new Error('必须提供控件 ID 或稳定 actionId')
    return JSON.stringify(await performUi(args, ctx))
  },
  meta: { requireApproval: true, exposedViaMcp: true, requiredScopes: ['ui', 'write'] }
})
