import zhOffice from '../../src/i18n/locales/zh-CN/office.json' with { type: 'json' }
import enOffice from '../../src/i18n/locales/en-US/office.json' with { type: 'json' }
// 可视编辑只接收无作者脚本的派生预览；演示保留脚本但不接收编辑消息。
export const EDIT_PREVIEW_HELPER = `
function fridayEditPreview(html: string, inspector: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script,iframe,frame,frameset,object,embed,applet,base,meta[http-equiv],link[rel="import"],link[rel="modulepreload"],link[rel="preload"][as="script"],svg foreignObject,animate,set,animateMotion,animateTransform,template').forEach(node => node.remove())
  for (const element of Array.from(doc.querySelectorAll('*'))) {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase()
      const value = attr.value.replace(/[\\u0000-\\u0020]/g, '').toLowerCase()
      if (name.startsWith('on') || ['nonce', 'srcdoc', 'is', 'formaction', 'action', 'target', 'data-gx-inspector'].includes(name) ||
        (['href', 'xlink:href', 'src'].includes(name) && /^(javascript|vbscript|data:text\\/html):/.test(value))) element.removeAttribute(attr.name)
    }
    if (element.tagName.toLowerCase() === 'a') element.removeAttribute('href')
  }
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(24)), n => n.toString(16).padStart(2, '0')).join('')
  const policy = doc.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = "default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'unsafe-inline' html-asset: https: http:; img-src data: blob: html-asset: https: http:; font-src data: html-asset: https: http:; media-src html-asset: https: http:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri html-asset:; form-action 'none'"
  doc.head.prepend(policy)
  const script = doc.createElement('script')
  script.nonce = nonce
  script.setAttribute('data-gx-inspector', '')
  script.setAttribute('data-friday-inspector', nonce)
  script.textContent = inspector
  doc.body.append(script)
  // Chromium 的 nonce 隐藏会使 outerHTML 丢失 nonce；只修复带随机标识的可信脚本序列化结果。
  const serializedInspector = script.outerHTML
  const executableInspector = serializedInspector.replace(/^<script[^>]*>/, '<script nonce="' + nonce + '" data-gx-inspector>')
  return '<!doctype html>\\n' + doc.documentElement.outerHTML.replace(serializedInspector, executableInspector)
}
`

function replace(source, needle, value, id) {
  if (!source.includes(needle) || source.indexOf(needle) !== source.lastIndexOf(needle)) throw new Error(`OFFICE_HTML_SECURITY_ADAPTER_DRIFT: ${id}`)
  return source.replace(needle, value)
}

export function transformHtmlPreviewSource(source, id) {
  const file = id.split('?')[0].replaceAll('\\', '/')
  if (file.endsWith('/apps/html/src/renderer/i18n/strings.ts')) {
    source = replace(source, 'zh: { ...appStrings.zh, ...aiStrings.zh }', `zh: { ...appStrings.zh, ...aiStrings.zh, fridayPreviewNotice: ${JSON.stringify(zhOffice.htmlEditPreviewNotice)} }`, file)
    return replace(source, 'en: { ...appStrings.en, ...aiStrings.en }', `en: { ...appStrings.en, ...aiStrings.en, fridayPreviewNotice: ${JSON.stringify(enOffice.htmlEditPreviewNotice)} }`, file)
  }
  if (file.endsWith('/apps/html/src/renderer/preview/instrument.ts')) {
    source = replace(source, 'inspectorSource: string): string {', 'inspectorSource: string, present = false): string {\n  (window as any).fridayHtmlHost?.setPresentationSource(text)\n  if (present) return text', file)
    source = replace(source, '  return bodyClose >= 0 ? out.slice(0, bodyClose) + script + out.slice(bodyClose) : out + script',
      `  return fridayEditPreview(bodyClose >= 0 ? out.slice(0, bodyClose) + script + out.slice(bodyClose) : out + script, inspectorSource.replace('__GX_VERSION__', String(map.version)))`, file)
    return source + EDIT_PREVIEW_HELPER
  }
  if (file.endsWith('/apps/html/src/renderer/preview/PreviewFrame.tsx')) {
    source = replace(source, '  url: string | null', '  url: string | null\n  editing: boolean', file)
    source = replace(source, '  { url, nonce, zoom, onMessage, onLoad, draft },', '  { url, nonce, zoom, onMessage, onLoad, draft, editing },', file)
    source = replace(source, '  onMessageRef.current = onMessage', `  onMessageRef.current = onMessage
  const acceptsMessages = useRef(false)
  acceptsMessages.current = editing && Boolean(url)`, file)
    source = replace(source, '      if (event.source !== frameRef.current?.contentWindow) return', '      if (!acceptsMessages.current || event.source !== frameRef.current?.contentWindow) return', file)
    source = replace(source, '      <iframe\n', '      <iframe\n        key={String(editing) + ":" + src}\n', file)
    source = replace(source, '`${url}?v=${nonce}`', "`${url}${url.includes('?') ? '&' : '?'}v=${nonce}`", file)
    source = replace(source, '      {draft != null && <DraftPreview html={draft} />}', `      {editing && <div style={{ position: 'absolute', right: 8, bottom: 8, fontSize: 11, background: 'Canvas', color: 'CanvasText', padding: 4 }}>{t('fridayPreviewNotice')}</div>}
      {draft != null && <DraftPreview html={draft} />}`, file)
    return source
  }
  if (file.endsWith('/apps/html/src/renderer/PresentView.tsx')) {
    source = replace(source, '  const frameRef = useRef<PreviewFrameHandle>(null)', `  const frameRef = useRef<PreviewFrameHandle>(null)
  const [fridayNonce, setFridayNonce] = useState(0)
  useEffect(() => (window as any).fridayHtmlHost?.onPresentationChanged(() => setFridayNonce(n => n + 1)), [])`, file)
    source = replace(source, 'nonce={0}', 'nonce={fridayNonce} editing={false}', file)
    return replace(source, 'setUrl(info.url)', "setUrl(info.url + '&present=1')", file)
  }
  if (file.endsWith('/apps/html/src/renderer/App.tsx')) {
    source = replace(source, '  const prevCanvasModeRef = useRef(canvasMode)', `  const [fridayPreviewReady, setFridayPreviewReady] = useState<string | null>(null)
  useEffect(() => {
    if (status !== 'ready') return
    let alive = true
    setFridayPreviewReady(null)
    const map = getMap()
    window.htmlApi.updatePreview(instrumentForPreview(textRef.current, map, inspectorSource, canvasMode === 'present'))
    void (window as any).fridayHtmlHost.flushPreview().then(() => {
      if (!alive) return
      pushedTextRef.current = textRef.current
      frameVersionsRef.current = new Set([map.version])
      setFridayPreviewReady(canvasMode)
      setPreviewNonce(n => n + 1)
    })
    return () => { alive = false }
  }, [canvasMode, status, getMap])
  const prevCanvasModeRef = useRef(canvasMode)`, file)
    source = replace(source, 'instrumentForPreview(nextText, map, inspectorSource)', "instrumentForPreview(nextText, map, inspectorSource, canvasModeRef.current === 'present')", file)
    source = replace(source, '                  url={previewUrl}', '                  url={fridayPreviewReady === canvasMode ? previewUrl : null}\n                  editing={canvasMode === "edit" && fridayPreviewReady === canvasMode}', file)
    return source
  }
  return null
}

export function htmlPreviewSecurityPlugin() {
  return { name: 'friday-html-preview-security', enforce: 'pre', transform(source, id) {
    const code = transformHtmlPreviewSource(source, id)
    return code == null ? null : { code, map: null }
  } }
}
