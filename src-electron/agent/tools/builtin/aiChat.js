/**
 * 模型推理的受控入口。正文标记为 private/sensitive，不能进入能力目录或 MCP；
 * 业务层仍负责会话持久化，所有模型请求先经过能力校验、审计和取消上下文。
 */
import { z } from 'zod'
import { registerTool } from '../registry.js'

const schema = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.any() })).min(1),
  tools: z.array(z.any()).optional(),
  stream: z.boolean().optional()
})

registerTool({
  name: 'ai_chat_inference',
  description: 'Friday 内部模型推理入口；只允许应用内部调用，正文不会进入 AI Core 能力目录或 MCP。',
  schema,
  handler: async (args, ctx) => {
    if (typeof ctx.chat !== 'function') throw new Error('模型推理上下文未绑定')
    return ctx.chat(args)
  },
  meta: {
    sensitive: true,
    privateOnly: true,
    capabilityType: 'read',
    requiredScopes: ['read']
  }
})
