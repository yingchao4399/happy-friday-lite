import {electronService} from '../../services/electron.js'

export function parseNoteUri(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'friday:' || url.hostname !== 'notes') return null
    const noteId = decodeURIComponent(url.pathname.slice(1))
    return noteId ? {noteId, heading: decodeURIComponent(url.hash.slice(1))} : null
  } catch { return null }
}

export async function resolveNoteTarget(value) {
  const uri = parseNoteUri(value)
  if (uri) {
    const note=await electronService.request('get_note',{noteId:uri.noteId})
    if(!note || note.isDeleted)throw new Error('NOTE_LINK_UNRESOLVED')
    return uri
  }
  const [target, heading = ''] = String(value).split('|')[0].split('#')
  const title = target.trim().normalize('NFKC').toLocaleLowerCase()
  const notes = await electronService.request('get_notes')
  const matches = notes.filter(note => !note.isDeleted && String(note.title).trim().normalize('NFKC').toLocaleLowerCase() === title)
  if (matches.length !== 1) throw new Error(matches.length ? 'NOTE_LINK_AMBIGUOUS' : 'NOTE_LINK_UNRESOLVED')
  return {noteId: matches[0].id, heading}
}

export function noteLinkAt(text, offset) {
  // Turndown 会转义富文本中的方括号；点击定位仍须识别这类 Markdown 表示。
  const expression = /\\?\[\\?\[([^\]\n]+?)\\?\]\\?\]|\[[^\]\n]*\]\((friday:\/\/notes\/[^\s)]+)\)/g
  for (const match of text.matchAll(expression)) if (offset >= match.index && offset <= match.index + match[0].length) return match[1] || match[2]
  return null
}
