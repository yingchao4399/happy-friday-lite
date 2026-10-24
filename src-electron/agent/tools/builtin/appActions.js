import { z } from 'zod'
import { registerTool, listRegisteredTools, describeCapability, executeCapability, getRequiredScopes } from '../registry.js'

registerTool({
  name: 'list_app_actions',
  description: '发现 Friday 已注册的应用业务动作，包括笔记、日程、画布、知识库、聊天、自动化和 Office。keyword 可按模块名筛选。',
  schema: z.object({ keyword: z.string().max(100).optional() }),
  handler: async ({ keyword = '' }, ctx) => JSON.stringify(await Promise.all(listRegisteredTools().filter(def => def.meta?.catalogOnly && def.meta?.exposedViaMcp && def.name.includes(keyword) && (!ctx.capabilityPolicy?.scopes || getRequiredScopes(def).every(scope => ctx.capabilityPolicy.scopes.includes(scope)))).map(describeCapability))),
  meta: { exposedViaMcp: true, capabilityType: 'read' }
})

registerTool({
  name: 'invoke_app_action',
  description: '执行 list_app_actions 中的一个稳定应用动作。args 是该动作的 IPC 参数数组。执行前需审批，返回实际业务结果并保留审计。',
  schema: z.object({ name: z.string().regex(/^app_[a-zA-Z0-9_]+$/), args: z.array(z.unknown()).max(12).default([]) }),
  handler: async ({ name, args }, ctx) => {
    const def = listRegisteredTools().find(item => item.name === name && item.meta?.catalogOnly && item.meta?.exposedViaMcp)
    if (!def) throw new Error('此应用动作未开放')
    // 外层审批弹窗已展示目标名称及完整参数，仅向这个相同调用转交审批，
    // 避免一次业务写入重复弹窗。直接调用目标能力仍须独立审批。
    const approval = ctx.approvedInvocation
    const sameApprovedCall = approval?.name === 'invoke_app_action' && approval.args.name === name && approval.args.args === args
    return executeCapability(name, { args }, ctx, { ...ctx.capabilityPolicy, approvalGranted: !!sameApprovedCall })
  },
  meta: { requireApproval: true, exposedViaMcp: true, capabilityType: 'write' }
})
