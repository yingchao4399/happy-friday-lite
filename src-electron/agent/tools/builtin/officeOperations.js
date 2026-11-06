import { z } from 'zod'
import { registerTool } from '../registry.js'

// 工具只是宿主能力的注册表投影；模型参数和渲染载荷不能选择身份、空间或入口。
function trustedContext(ctx = {}) {
  return { ...ctx, actor: ctx.actor || 'user:local', spaceId: ctx.spaceId || 'friday',
    sourceEntry: ctx.sourceEntry || 'main-assistant' }
}
const targetSchema = z.object({
  format: z.literal('docx'), title: z.string().max(180).optional(), out: z.string().optional()
})
const optionsSchema = z.object({ openAfterSave: z.boolean().optional() }).optional()
const operationMeta = { requireApproval: true, exposedViaMcp: true, auditSensitive: true, capabilityType: 'write', requiredScopes: ['write'], version: '1.0.0' }

registerTool({
  name: 'office_html_create',
  description: '从完整 HTML 源码创建 AI HTML 文档，原子保存在当前空间 SANDBOX 并回读验证，默认在内置编辑器打开。需用户审批；脚本只在隔离演示中运行。返回 documentId、任务和已保存文件，随后可 office_html_read/apply 继续编辑。',
  schema: z.object({ source: z.string().min(1).max(8 * 1024 * 1024), title: z.string().max(180).optional(), openAfterSave: z.boolean().optional(), idempotencyKey: z.string().max(400).optional() }),
  handler: async (args, ctx) => (await import('../../../office/office-host.js')).createOfficeHtmlDocument(args, trustedContext(ctx)),
  meta: operationMeta
})

registerTool({
  name: 'office_html_read',
  description: '读取已打开 AI HTML 的当前源码、documentId 和 revision（包括未保存编辑）。修改前必须先读取，以 sid 或源码版本执行原子操作；不读取任意文件路径。',
  schema: z.object({ documentId: z.string().optional(), offset: z.number().int().nonnegative().optional(), maxChars: z.number().int().min(1).max(48000).optional() }),
  handler: async ({ documentId, offset = 0, maxChars = 32000 }, ctx) => {
    const result = await (await import('../../../office/office-host.js')).readOfficeHtmlDocument(documentId, trustedContext(ctx))
    return { ...result, source: result.source.slice(offset, offset + maxChars), offset, totalChars: result.source.length, truncated: offset + maxChars < result.source.length }
  },
  meta: { exposedViaMcp: true, auditSensitive: true, capabilityType: 'read', requiredScopes: ['read'] }
})

registerTool({
  name: 'office_html_apply',
  description: '在 AI HTML 当前文档和精确 revision 上原子应用上游 HtmlOp 批次，或 replaceSource 替换全文；两者择一。需审批，保留撤销。revision 过期拒绝，批次有错误全批不写。不自动保存，调用后可用原文档保存入口。',
  schema: z.object({ documentId: z.string().min(1), revision: z.number().int().nonnegative(), ops: z.array(z.record(z.string(), z.unknown())).min(1).max(100).optional(), replaceSource: z.string().max(8 * 1024 * 1024).optional(), idempotencyKey: z.string().max(400).optional() }),
  handler: async (args, ctx) => {
    if ((args.ops !== undefined) === (args.replaceSource !== undefined)) throw new Error('OFFICE_HTML_REQUEST_INVALID')
    return (await import('../../../office/office-host.js')).executeOfficeHtmlDocument({ ...args, kind: args.replaceSource === undefined ? 'apply' : 'replace', source: args.replaceSource }, trustedContext(ctx))
  },
  meta: operationMeta
})

registerTool({
  name: 'office_html_export',
  description: '通过 AI HTML 与按钮相同的原生导出管线，将指定 revision 导出 PDF、DOCX 或单文件 HTML。需审批，并显示保存对话框由用户选择目标。仅在回读实际产物后报告成功；取消保留文档。',
  schema: z.object({ documentId: z.string().min(1), revision: z.number().int().nonnegative(), format: z.enum(['pdf', 'docx', 'html']), idempotencyKey: z.string().max(400).optional() }),
  handler: async (args, ctx) => (await import('../../../office/office-host.js')).executeOfficeHtmlDocument({ ...args, kind: 'export' }, trustedContext(ctx)),
  meta: operationMeta
})

registerTool({
  name: 'office_get_capabilities',
  description: '查询当前 Office 宿主真实可用的创建/转换能力及阻塞原因。不会执行转换，也不把已有菜单当作能力已就绪的证据。',
  schema: z.object({}),
  handler: async (_args, ctx) => (await import('../../../office/office-host.js')).getOfficeCapabilities(trustedContext(ctx)),
  meta: { exposedViaMcp: true, capabilityType: 'read', requiredScopes: ['read'] }
})

registerTool({
  name: 'office_document_convert',
  description: '将 PDF 转换为可编辑 DOCX。使用统一 Office 转换服务、当前文档修订快照和受控输出目录；仅在文件已持久保存并通过校验后报告成功。扫描件或布局降级会如实返回质量提示。先用 office_get_capabilities 确认可用路线。',
  schema: z.object({
    source: z.object({ resourceId: z.string().optional(), revision: z.union([z.string(), z.number()]).optional(), filePath: z.string().optional() }),
    target: targetSchema, idempotencyKey: z.string().max(400).optional(), options: optionsSchema
  }),
  handler: async (args, ctx) => {
    const context = trustedContext(ctx)
    const source = context.resourceId ? { resourceId: context.resourceId, revision: args.source.revision } : args.source
    return (await import('../../../office/office-host.js')).executeOfficeOperation({ ...args, source, operationId: 'office.document.convert' }, context)
  },
  meta: operationMeta
})

registerTool({
  name: 'office_document_create',
  description: '从 HTML 正文片段创建新的 DOCX（与 PDF 转换是不同能力）。通过统一 Office 创建服务完成导入、保存、回读校验和文件交付。只支持能力目录中声明的格式，不会声称宿主能够创建未接通的文件类型。',
  schema: z.object({
    content: z.object({ kind: z.literal('html-fragment'), value: z.string().max(8 * 1024 * 1024) }),
    target: targetSchema, idempotencyKey: z.string().max(400).optional(), options: optionsSchema
  }),
  handler: async (args, ctx) => (await import('../../../office/office-host.js')).executeOfficeOperation({ ...args, operationId: 'office.document.create' }, trustedContext(ctx)),
  meta: operationMeta
})

registerTool({
  name: 'office_get_operation_task',
  description: '读取一个 Office 创建/转换任务的真实阶段、失败原因和已验证文件交付结果。仅能读取当前用户与空间的任务。',
  schema: z.object({ taskId: z.string() }),
  handler: async ({ taskId }, ctx) => (await import('../../../office/office-host.js')).getOfficeOperationTask(taskId, trustedContext(ctx)),
  meta: { exposedViaMcp: true, capabilityType: 'read', requiredScopes: ['read'] }
})

registerTool({
  name: 'office_cancel_operation_task',
  description: '请求取消尚未交付的 Office 转换/创建任务。已持久交付的文件仍保留真实交付结果。',
  schema: z.object({ taskId: z.string() }),
  handler: async ({ taskId }, ctx) => (await import('../../../office/office-host.js')).cancelOfficeOperationTask(taskId, trustedContext(ctx)),
  meta: { ...operationMeta, capabilityType: 'write' }
})

registerTool({
  name: 'office_reopen_artifact',
  description: '根据已成功 Office 任务的 taskId 或 artifactId 重新打开已保存文件；会复核用户与空间权限和文件状态。',
  schema: z.object({ artifactIdOrTaskId: z.string() }),
  handler: async ({ artifactIdOrTaskId }, ctx) => (await import('../../../office/office-host.js')).reopenOfficeArtifact(artifactIdOrTaskId, trustedContext(ctx)),
  meta: { exposedViaMcp: true, capabilityType: 'navigation', requiredScopes: ['ui'] }
})
