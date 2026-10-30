import TurndownService from 'turndown'
import { marked } from 'marked'
import {readNote,saveNote} from '@/features/notes/documents'

// Route reactivation of an unchanged long note should not run Turndown on
// every visit. The revision is part of the key, so saved edits invalidate the
// cached conversion naturally.
const markdownCache = new Map()
function cachedNoteMarkdown(note) {
  const html = note?.content || ''
  const key = `${note?.id || ''}:${note?.revision || 0}:${html.length}:${html.slice(0, 24)}:${html.slice(-24)}`
  const hit = markdownCache.get(key)
  if (hit !== undefined) {
    markdownCache.delete(key)
    markdownCache.set(key, hit)
    return hit
  }
  const markdown = noteToMarkdown(html)
  markdownCache.set(key, markdown)
  while (markdownCache.size > 16) markdownCache.delete(markdownCache.keys().next().value)
  return markdown
}

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
  let source = initialSource ?? cachedNoteMarkdown(note)
  let saved = source, timer = null, journalTimer = null, queue = Promise.resolve()
  const id = note.id
  const recoveryKey = `happy-friday-typewriter-draft:${id}`
  let baseline = note.content || ''
  let revision = note.revision || 0
  try {
    const draft = JSON.parse(localStorage.getItem(recoveryKey) || 'null')
    if (draft?.base === baseline && typeof draft.text === 'string') source = draft.text
  } catch {}
  const writeJournal = () => {
    try {
      if (source === saved) localStorage.removeItem(recoveryKey)
      else localStorage.setItem(recoveryKey, JSON.stringify({base: baseline, text: source}))
    } catch { /* 本地缓存满时，仍继续写入笔记数据库。 */ }
  }
  // Keep typing synchronous and cheap. Recovery data is still written shortly
  // after the user pauses, and immediate callers (save/blur/close) force a
  // final write before leaving the document.
  const journal = (immediate = false) => {
    clearTimeout(journalTimer)
    journalTimer = null
    if (immediate) { writeJournal(); return }
    journalTimer = setTimeout(() => { journalTimer = null; writeJournal() }, 450)
  }
  const document = {
    id, viewId: crypto.randomUUID(), type: 'note', title: note.title, content: source, noteId: id,
    revision,
    refresh(next) {
      if((next.revision||0)<=revision)return
      if(source!==saved){status('saveConflict');return}
      source=cachedNoteMarkdown(next);saved=source;baseline=next.content||'';revision=next.revision||0
      document.content=source;document.title=next.title;document.revision=revision;status('saved')
      window.dispatchEvent(new CustomEvent('friday:note-document',{detail:{noteId:id,text:source}}))
    },
    change(next) {
      source = next; document.content = source; journal(); clearTimeout(timer); status('unsaved')
      timer = setTimeout(() => { void document.flush().catch(() => {}) }, 600)
    },
    flush() {
      clearTimeout(timer); timer = null; journal(true)
      queue = queue.catch(() => {}).then(async () => {
        if (source === saved) return
        const next = source; status('saving')
        try {
          const latest = await readNote(id)
          if (!latest || latest.isDeleted) throw new Error('NOTE_NOT_FOUND')
          if ((latest.revision || 0) !== revision) throw new Error('NOTE_REVISION_CONFLICT')
          const updated = await saveNote({noteId: id, title: latest.title, baseRevision: revision, ...markdownToNote(next)})
          if (!updated?.id) throw new Error('NOTE_SAVE_FAILED')
          const index = noteStore.notes.findIndex(item => item.id === id)
          if (index >= 0) noteStore.notes[index] = updated
          else noteStore.notes.unshift(updated)
           revision = updated.revision || 0; document.revision = revision; saved = next; baseline = updated.content || ''; journal(true); status(source === saved ? 'saved' : 'unsaved')
        } catch (error) { status(error.message?.includes('NOTE_REVISION_CONFLICT') ? 'saveConflict' : 'saveFailed'); throw error }
      })
      return queue
    },
    async close() { await document.flush(); journal(true) }
  }
  if (source !== saved) timer = setTimeout(() => { void document.flush().catch(() => {}) }, 600)
  return document
}
