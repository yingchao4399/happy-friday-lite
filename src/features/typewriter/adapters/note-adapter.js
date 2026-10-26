import TurndownService from 'turndown'
import { marked } from 'marked'
import { electronService } from '@/services/electron'

export function noteToMarkdown(html) {
  const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
  // Turndown 的空节点规则先于自定义规则，会吞掉没有 textContent 的图表。
  // 在转换前保护整个不透明节点，转换后恢复，避免这种无声的数据损失。
  const parsed = new DOMParser().parseFromString(html || '', 'text/html')
  const kept = []
  const protect = parent => {
    for (const node of [...parent.children]) {
      const opaque = ['TABLE', 'VIDEO', 'AUDIO'].includes(node.nodeName) ||
        [...node.attributes].some(attr => attr.name.startsWith('data-')) || node.hasAttribute('style')
      if (opaque) {
        const token = `FRIDAYNODE${crypto.randomUUID().replaceAll('-', '')}END`
        kept.push([token, node.outerHTML])
        const placeholder = parsed.createElement('p')
        placeholder.textContent = token
        node.replaceWith(placeholder)
      } else protect(node)
    }
  }
  protect(parsed.body)
  let markdown = converter.turndown(parsed.body.innerHTML)
  for (const [token, original] of kept) markdown = markdown.replace(token, original)
  return markdown
}
export function markdownToNote(source) {
  const parsed = new DOMParser().parseFromString(marked.parse(source), 'text/html')
  parsed.querySelectorAll('script,iframe,object,embed,base,meta,link,style').forEach(node => node.remove())
  parsed.querySelectorAll('*').forEach(node => {
    for (const attr of [...node.attributes]) {
      if (/^on/i.test(attr.name) || (['href', 'src', 'xlink:href'].includes(attr.name) && /^\s*(javascript|vbscript):/i.test(attr.value))) node.removeAttribute(attr.name)
    }
  })
  return { content: parsed.body.innerHTML, contentText: parsed.body.textContent || '' }
}
export function createNoteDocument(noteStore, note, status = () => {}, initialSource) {
  let source = initialSource ?? noteToMarkdown(note.content)
  let saved = source, timer = null, queue = Promise.resolve()
  const id = note.id
  const recoveryKey = `happy-friday-typewriter-draft:${id}`
  let baseline = note.content || ''
  try {
    const draft = JSON.parse(localStorage.getItem(recoveryKey) || 'null')
    if (draft?.base === baseline && typeof draft.text === 'string') source = draft.text
  } catch {}
  const journal = () => {
    try {
      if (source === saved) localStorage.removeItem(recoveryKey)
      else localStorage.setItem(recoveryKey, JSON.stringify({base: baseline, text: source}))
    } catch { /* 本地缓存满时，仍继续写入笔记数据库。 */ }
  }
  const document = {
    id, viewId: crypto.randomUUID(), type: 'note', title: note.title, content: source, noteId: id,
    change(next) {
      source = next; journal(); clearTimeout(timer); status('unsaved')
      timer = setTimeout(() => { void document.flush().catch(() => {}) }, 600)
    },
    flush() {
      clearTimeout(timer); timer = null
      queue = queue.catch(() => {}).then(async () => {
        if (source === saved) return
        const next = source; status('saving')
        try {
          const latest = await electronService.request('get_note', { noteId: id })
          if (!latest || latest.isDeleted) throw new Error('NOTE_NOT_FOUND')
          const updated = await electronService.request('update_note', {noteId: id, title: latest.title, ...markdownToNote(next)})
          if (!updated?.id) throw new Error('NOTE_SAVE_FAILED')
          const index = noteStore.notes.findIndex(item => item.id === id)
          if (index >= 0) noteStore.notes[index] = updated
          else noteStore.notes.unshift(updated)
          saved = next; baseline = updated.content || ''; journal(); status(source === saved ? 'saved' : 'unsaved')
        } catch (error) { status('saveFailed'); throw error }
      })
      return queue
    },
    async close() { await document.flush() }
  }
  if (source !== saved) timer = setTimeout(() => { void document.flush().catch(() => {}) }, 600)
  return document
}
