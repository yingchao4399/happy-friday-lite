import { electronService } from '@/services/electron'

export function createBlankAdapter(title = 'Untitled') {
  let content = ''
  return {
    id: `blank:${Date.now()}`,
    type: 'blank',
    title,
    path: '',
    editable: true,
    async open() { return content },
    async save(next) { content = String(next ?? ''); return { success: true, content } },
    async saveAs() { return null },
    async close() {}
  }
}

export function createFileAdapter(filePath, type = 'file') {
  const name = String(filePath || '').split(/[\\/]/).pop() || 'Untitled'
  let content = ''
  return {
    id: filePath,
    type,
    title: name,
    path: filePath,
    editable: true,
    async open() {
      const result = await electronService.invoke('kb-read-file', { filePath })
      if (!result?.success) throw new Error(result?.error || 'File not found')
      content = result.content || ''
      return content
    },
    async save(next) {
      content = String(next ?? '')
      const result = await electronService.invoke('typewriter-file-save', { filePath, content })
      if (!result?.success) throw new Error(result?.error || 'Save failed')
      return result
    },
    async saveAs() { return null },
    async close() {}
  }
}

export function adapterForPath(filePath) {
  const lower = String(filePath || '').toLowerCase()
  const type = /\.(md|markdown|mdx)$/.test(lower) ? 'markdown' : /\.(js|mjs|cjs|ts|tsx|jsx|py|go|rs|java|c|cpp|h|css|html|json|yaml|yml|sh|ps1|vue)$/.test(lower) ? 'code' : 'file'
  return createFileAdapter(filePath, type)
}
