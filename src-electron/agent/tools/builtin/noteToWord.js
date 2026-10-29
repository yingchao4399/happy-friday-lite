/** AI Core 纵切：把一篇笔记写入新建 Word，并留下来源关系。 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import TurndownService from 'turndown'
import { registerTool, executeCapability } from '../registry.js'

const schema = z.object({
  noteId: z.string().describe('来源笔记 ID'),
  out: z.string().describe('新建 Word 文件的绝对路径'),
  title: z.string().optional().describe('文档标题；未提供时使用笔记标题')
})

function safeName(value) {
  return String(value || '未命名笔记').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80) || '未命名笔记'
}

registerTool({
  name: 'note_to_word',
  description: '读取指定笔记，自动使用笔记标题生成 Markdown 源文件，并新建一个 Word 文档。会记录笔记到 Word 的来源关系；写操作需要用户审批。',
  schema,
  handler: async (args, ctx) => {
    const db = await import('../../../db.js')
    const note = db.getNote(args.noteId)
    if (!note) return `错误：未找到笔记 ${args.noteId}`
    const out = path.resolve(args.out)
    const title = String(args.title || note.title || '未命名笔记').trim()
    const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
    const markdown = `# ${title}\n\n${turndown.turndown(note.content || note.contentText || '').trim()}\n`
    const root = ctx.agentRootDir || ctx.dataDir || process.cwd()
    const sourceDir = path.join(root, 'SANDBOX', 'ai-core')
    await fs.mkdir(sourceDir, { recursive: true })
    const sourcePath = path.join(sourceDir, `${Date.now()}-${randomUUID()}.md`)
    await fs.writeFile(sourcePath, markdown, 'utf8')
    try {
      const createOutput = await executeCapability('office_create', {
        type: 'docx', out, from: sourcePath,
        riskAssessment: { level: 'medium', evaluation: `为笔记“${title}”创建新的 Word 文件 ${out}` }
      }, ctx, {
        actor: ctx.actor || 'user:local',
        scopes: Array.isArray(ctx.scopes) ? ctx.scopes : [],
        approvalGranted: true
      })
      if (typeof createOutput === 'string' && /^(?:错误[:：]|工具执行失败[:：]|操作失败[:：])/.test(createOutput.trim())) throw new Error(createOutput)
      const created = await fs.stat(out).catch(() => null)
      if (!created?.isFile() || created.size <= 0) throw new Error('Word 文件未生成或文件为空')
      const sha256 = createHash('sha256').update(await fs.readFile(out)).digest('hex')
      const sourceUri = `friday://notes/${encodeURIComponent(note.id)}`
      const targetUri = `friday://office/${encodeURIComponent(out)}`
      db.linkResources(sourceUri, targetUri, 'exported-to-office', 'AI Core note_to_word', {
        fromVersion: String(note.revision || note.updatedAt || ''), toVersion: new Date().toISOString()
      })
      return JSON.stringify({
        success: true, noteId: note.id, title, out, sourceUri, targetUri, createOutput,
        undoAction: { type: 'delete-created-file', path: out, sha256, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }
      })
    } finally {
      await fs.rm(sourcePath, { force: true }).catch(() => {})
    }
  },
  meta: {
    requireApproval: true,
    exposedViaMcp: true,
    capabilityType: 'write',
    supportsUndo: true,
    supportsReadback: true,
    readbackFor: ['office_inspect'],
    requiredScopes: ['write']
  }
})
