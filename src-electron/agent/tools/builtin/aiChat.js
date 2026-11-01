/**
 * 模型推理的受控入口。正文标记为 private/sensitive，不能进入能力目录或 MCP；
 * 业务层仍负责会话持久化，所有模型请求先经过能力校验、审计和取消上下文。
 */
import { z } from 'zod'
import { registerTool } from '../registry.js'

const contentPartSchema = z.object({
  type: z.string(),
}).passthrough()

const toolCallSchema = z.object({
  id: z.string().min(1),
  type: z.string().optional(),
  function: z.object({
    name: z.string().min(1),
    arguments: z.string(),
  }).passthrough(),
}).passthrough()

// AI Core 是私有 provider 边界，不能使用 Zod 默认 strip 行为。
// tool_calls/tool_call_id/reasoning_content 必须完整穿透 schema，未来 provider
// 扩展字段也先保留，再由 adapter 的白名单序列化。
const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.array(contentPartSchema), z.null()]),
  id: z.string().optional(),
  name: z.string().optional(),
  tool_calls: z.array(toolCallSchema).optional(),
  tool_call_id: z.string().optional(),
  reasoning_content: z.string().optional(),
}).passthrough()

const schema = z.object({
  messages: z.array(messageSchema).min(1),
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
