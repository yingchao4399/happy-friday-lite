// 固定上游源码保持干净；所有 Friday 宿主适配作为受测的构建输入登记。
const replaceOnce = (source, needle, replacement, id) => {
  if (!source.includes(needle) || source.indexOf(needle) !== source.lastIndexOf(needle)) throw new Error(`OFFICE_HTML_ADAPTER_DRIFT: ${id}`)
  return source.replace(needle, replacement)
}

export function transformHtmlHostSource(source, id) {
  const file = id.split('?')[0].replaceAll('\\', '/')
  if (file.endsWith('/apps/html/src/renderer/ai/AiPanel.tsx')) {
    source = replaceOnce(source, '  const stop = (): void => {', `  const stop = (): void => {
    void (window as any).fridayHtmlHost.cancelServices().catch(() => {})`, file)
    return replaceOnce(source, '() => imageGenerationAvailable(settingsRef.current, gskLoggedInRef.current)',
      '() => (settingsRef.current as any)?.capabilities?.generateImage === true', file)
  }
  if (file.endsWith('/packages/ui/src/ai-model-picker-options.ts')) {
    source = replaceOnce(source, '  const settings = resolveCustomEndpoints(input)\n  const groups:',
      `  const managed = input as any
  if (managed.capabilities) return managed.capabilities.chat && managed.model
    ? [{ id: managed.provider || 'custom', label: 'Friday', models: [managed.model] }] : []
  const settings = resolveCustomEndpoints(input)
  const groups:`, file)
    source = replaceOnce(source, 'export function withAiModelSelection(input: AiSettings, pick: AiModelPickerSelection): AiSettings {',
      `export function withAiModelSelection(input: AiSettings, pick: AiModelPickerSelection): AiSettings {
  if ((input as any).capabilities) return input`, file)
    return replaceOnce(source, 'export function aiModelPickerSelection(input: AiSettings): AiModelPickerSelection {',
      `export function aiModelPickerSelection(input: AiSettings): AiModelPickerSelection {
  if ((input as any).capabilities) return { provider: input.provider || 'custom', model: (input as any).model || '' }`, file)
  }
  if (file.endsWith('/apps/html/src/renderer/ai/tools.ts')) {
    source = replaceOnce(source, "  return { src: url, where: 'remote' }", "  if (url.startsWith('friday-generated-image:')) throw new Error('Generated image could not be persisted')\n  return { src: url, where: 'remote' }", file)
    source = replaceOnce(source, '  let currentSignal: AbortSignal | undefined', '  let currentSignal: AbortSignal | undefined\n  let fridayToolEpoch = 0', file)
    source = replaceOnce(source, '      currentSignal = signal', '      currentSignal = signal\n      const fridayCallEpoch = ++fridayToolEpoch', file)
    source = replaceOnce(source, '  const generateImage = async (call: AgentToolCall): Promise<ToolExecution> => {', `  const generateImage = async (call: AgentToolCall): Promise<ToolExecution> => {
    const imageSignal = currentSignal
    const imageEpoch = fridayToolEpoch`, file)
    source = source.replaceAll('if (currentSignal?.aborted)', 'if (imageSignal?.aborted || imageEpoch !== fridayToolEpoch)')
    source = replaceOnce(source, "    const summary = t('aiToolWritePage')\n    if (!access.writePage)", `    const writerSignal = currentSignal
    const writerEpoch = fridayToolEpoch
    const writerManualVersion = access.getLastManualVersion()
    const summary = t('aiToolWritePage')
    if (!access.writePage)`, file)
    source = replaceOnce(source, '    const result = await access.writePage(spec, currentSignal)', `    const result = await access.writePage(spec, writerSignal)
    if (writerEpoch !== fridayToolEpoch || access.getLastManualVersion() !== writerManualVersion || (writerSignal?.aborted && !result.truncated))
      return { output: 'Document changed or run cancelled; generated page was not applied.', isError: true, summary }`, file)
    source = replaceOnce(source, '          return planBrief(spec, currentSignal).then(async (drafted) => {', `          return planBrief(spec, signal).then(async (drafted) => {
            if (signal?.aborted || fridayCallEpoch !== fridayToolEpoch) return { output: 'Cancelled', isError: true, summary: t('aiToolPlanFailed') }`, file)
    source = replaceOnce(source, '            const decision = await confirmBrief(brief)', `            const decision = await confirmBrief(brief)
            if (signal?.aborted || fridayCallEpoch !== fridayToolEpoch) return { output: 'Cancelled', isError: true, summary: t('aiToolPlanFailed') }`, file)
    return replaceOnce(source, '          const finish = (finalOps: HtmlOp[]): ToolExecution => {',
      `          const finish = (finalOps: HtmlOp[]): ToolExecution => {
            if (signal?.aborted || fridayCallEpoch !== fridayToolEpoch) return { output: 'Cancelled before applying operations.', isError: true, summary: t('aiToolApplyOpsFailed') }
            if (stale()) return staleResult()`, file)
  }
  if (file.endsWith('/apps/html/src/preload/index.ts')) {
    return source + `
// 主进程发起的文档操作；预览子 frame 没有本 preload，不能伪造响应。
contextBridge.exposeInMainWorld('fridayHtmlHost', {
  cancelServices: () => ipcRenderer.invoke('ai:services-cancel'),
  flushPreview: () => ipcRenderer.invoke('friday:html-preview-sync'),
  setPresentationSource: (text: string) => ipcRenderer.send('friday:html-presentation-source', text),
  onPresentationChanged(handler: () => void) {
    const listener = () => handler()
    ipcRenderer.on('friday:html-preview-updated', listener)
    return () => ipcRenderer.removeListener('friday:html-preview-updated', listener)
  },
  mayCommit: (id: string) => ipcRenderer.invoke('friday:html-document-commit', id),
  subscribe(handler: (request: any) => Promise<any> | any) {
    const listener = async (_event: Electron.IpcRendererEvent, request: any) => {
      try { ipcRenderer.send('friday:html-document-result', { id: request.id, result: await handler(request) }) }
      catch (error) { ipcRenderer.send('friday:html-document-result', { id: request.id, error: String((error as any)?.message || error) }) }
    }
    ipcRenderer.on('friday:html-document-request', listener)
    return () => ipcRenderer.removeListener('friday:html-document-request', listener)
  },
})
`
  }
  if (file.endsWith('/apps/html/src/renderer/App.tsx')) {
    return replaceOnce(source, '  const aiDeps: HtmlAiDeps = {', `  useEffect(() => {
    return (window as any).fridayHtmlHost?.subscribe(async (request: any) => {
      if (statusRef.current !== 'ready') throw new Error('OFFICE_SOURCE_NOT_READY')
      flushPending()
      const snapshot = () => ({ revision: versionRef.current, source: textRef.current, filePath: pathRef.current })
      if (request.kind === 'read') return snapshot()
      if (request.revision !== versionRef.current) throw new Error('OFFICE_SOURCE_REVISION_CHANGED')
      if (!(await (window as any).fridayHtmlHost.mayCommit(request.id))) throw new Error('OFFICE_OPERATION_CANCELLED')
      flushPending()
      if (request.revision !== versionRef.current) throw new Error('OFFICE_SOURCE_REVISION_CHANGED')
      if (request.kind === 'apply') {
        const result = applyOps(request.ops, true)
        if (!result.ok) return { ok: false, errors: result.errors, ...snapshot() }
        return { ok: true, ...snapshot() }
      }
      if (request.kind === 'replace') {
        editorRef.current?.replaceDoc(request.source, false)
        commitText(request.source, true)
        return { ok: true, ...snapshot() }
      }
      if (request.kind === 'export') {
        const at = snapshot()
        const args = { html: at.source, suggestedName: pathRef.current?.split(/[\\\\/]/).pop()?.replace(/\\.html?$/i, '') || 'document' }
        const result = request.format === 'pdf' ? await window.htmlApi.exportPdf(args)
          : request.format === 'docx' ? await window.htmlApi.exportDocx(args) : await window.htmlApi.exportHtml(args)
        return { ...result, revision: at.revision }
      }
      throw new Error('OFFICE_OPERATION_UNSUPPORTED')
    })
  }, [applyOps, commitText, flushPending])

  const aiDeps: HtmlAiDeps = {`, file)
  }
  return null
}

export function htmlHostAdapterPlugin() {
  return { name: 'friday-html-host-adapter', enforce: 'pre', transform(source, id) {
    const code = transformHtmlHostSource(source, id)
    return code == null ? null : { code, map: null }
  } }
}
