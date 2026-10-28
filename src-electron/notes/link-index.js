import {load} from 'cheerio'
import {marked} from 'marked'

/** 从语法树抽取正文引用；代码和隐藏节点不参与索引。 */
export function extractNoteLinks(content) {
  const links = []
  const add = (target, alias = '', snippet = '') => {
    if (!target) return
    const raw = String(target).trim()
    const direct = raw.match(/^friday:\/\/notes\/([^#?]+)(?:#(.*))?$/i)
    if (direct) {
      try { links.push({rawTarget: decodeURIComponent(direct[1]), targetNoteId: decodeURIComponent(direct[1]), heading: direct[2] || '', alias, snippet}) } catch {}
      return
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(raw)) return
    const [path, heading = ''] = raw.split('#')
    if (!path) return
    links.push({rawTarget: path.replace(/\.md$/i, ''), targetNoteId: null, heading, alias, snippet})
  }
  const text = value => {
    for (const m of String(value).matchAll(/(?<!!)\[\[([^\]\n]+)\]\]/g)) {
      const [target, alias = ''] = m[1].split('|')
      add(target, alias, String(value).slice(Math.max(0, m.index - 60), m.index + m[0].length + 80))
    }
  }
  const html = value => {
    const $ = load(value, null, false)
    $('pre,code,script,style,[hidden]').remove()
    $('a[href]').each((_i, el) => add($(el).attr('href'), $(el).text(), $(el).parent().text().slice(0, 200)))
    text($.root().text())
  }
  if (/^\s*<(?:p|div|h[1-6]|ul|ol|table|a)\b/i.test(content || '')) html(content)
  else {
    const walk = tokens => { for (const token of tokens || []) {
      if (['code','codespan','image'].includes(token.type)) continue
      if (token.type === 'link') add(token.href, token.text, token.raw)
      else if (token.type === 'html') html(token.text)
      else if (token.tokens) walk(token.tokens)
      else if (token.items) token.items.forEach(item => walk(item.tokens))
      else if (token.type === 'table') {
        for (const row of [token.header, ...token.rows]) for (const cell of row) walk(cell.tokens)
      } else text(token.text || '')
    }}
    walk(marked.lexer(String(content || '')))
  }
  return links.map((link, occurrence) => ({...link, occurrence}))
}

export function resolveTarget(link, notes, previous = []) {
  if (link.targetNoteId) return notes.some(n => n.id === link.targetNoteId) ? link.targetNoteId : null
  const old = previous.find(p => p.rawTarget === link.rawTarget && p.targetNoteId && notes.some(n => n.id === p.targetNoteId))
  if (old) return old.targetNoteId
  const key = link.rawTarget.normalize('NFC').toLocaleLowerCase()
  const matches = notes.filter(n => String(n.title).normalize('NFC').toLocaleLowerCase() === key)
  return matches.length === 1 ? matches[0].id : null
}
