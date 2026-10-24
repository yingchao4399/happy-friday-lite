// 合并条目的 HTML 片段顺序与主进程图片索引保持一致；纯文本必须转义后交给编辑器解析。
export function clipboardRichContent(item) {
  if (item?.html) return item.html
  if (!item?.parts?.some(part => part.html)) return ''
  const escape = value => String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return item.parts.map(part => part.html || '<p>' + escape(part.text || part.filePaths?.join('\n')).replaceAll('\n', '<br>') + '</p>').join('')
}
