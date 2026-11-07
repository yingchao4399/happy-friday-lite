import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const replaceOnce = (source, needle, replacement, id) => {
  if (!source.includes(needle) || source.indexOf(needle) !== source.lastIndexOf(needle)) throw new Error('OFFICE_HTML_HISTORY_ADAPTER_DRIFT: ' + id)
  return source.replace(needle, replacement)
}
const replaceRegion = (source, start, end, replacement, id) => {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  if (from < 0 || to < 0 || source.indexOf(start, from + 1) >= 0) throw new Error('OFFICE_HTML_HISTORY_ADAPTER_DRIFT: ' + id)
  return source.slice(0, from) + replacement + source.slice(to)
}

const PANEL_IMPORTS = `import { AiHistoryButton } from '@friday-office/history-button'
import { createHtmlHistorySession } from '@friday-office/html-history-session'
import { htmlHistoryLabels } from '@friday-office/html-history-labels'
import fridayIcon from '@friday-office/brand-icon'
`
const PANEL_STATE = `  const [historyReady, setHistoryReady] = useState(false)
  const historyReadyRef = useRef(false)
  const [historyChanging, setHistoryChanging] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const historyLabelsRef = useRef(htmlHistoryLabels(lang))
  historyLabelsRef.current = htmlHistoryLabels(lang)
  const chatStateRef = useRef(chat)
  chatStateRef.current = chat
  const tempChatIdRef = useRef('unsaved-' + crypto.randomUUID())
  const historyInvalidateRef = useRef<() => void>(() => {})
  const restoreHistoryRef = useRef<(messages: any[]) => void>(() => {})
  const historyRef = useRef<ReturnType<typeof createHtmlHistorySession> | null>(null)
  if (!historyRef.current) historyRef.current = createHtmlHistorySession({
    api: window.projectApi as any,
    filePath,
    tempChatId: tempChatIdRef.current,
    onState: (state: any) => {
      chatIdsRef.current = state.ids
      historyReadyRef.current = state.ready && !state.changing
      setHistoryReady(historyReadyRef.current)
      setHistoryChanging(state.changing)
      setActiveChatId(state.ids?.chatId ?? null)
    },
    onLoad: (messages: any[]) => { setHistoryError(''); restoreHistoryRef.current(messages) },
    onError: () => setHistoryError(historyLabelsRef.current.failed),
    onInvalidate: () => historyInvalidateRef.current(),
  })
`
const PERSIST = `  const persistMessage = (
    role: 'user' | 'assistant', text: string, tools?: ToolActivity[],
    attachments?: AttachmentMeta[], scope?: AiScopeQuoteData,
  ) => {
    void historyRef.current?.append({ role, text,
      ...(tools?.length ? { tools } : {}),
      ...(attachments?.length ? { attachments } : {}),
      ...(scope ? { scope } : {}),
    }).catch(() => {})
  }

`
const HISTORY_EFFECTS = `  // 共享会话服务负责串行写入、独立新会话和加载世代校验。
  restoreHistoryRef.current = (messages: any[]) => {
    loopRef.current?.reset()
    const restored: ChatEntry[] = messages.map(message => ({
      role: message.role, text: message.text,
      tools: message.tools?.map((tool: any) => ({ ...tool, output: tool.output?.slice(0, TOOL_OUTPUT_MAX_CHARS) })),
      attachments: message.attachments?.filter((item: any) => item.path).map((item: any) => ({
        name: item.name, path: item.path, ext: item.ext ?? '', sizeBytes: item.sizeBytes ?? 0,
      })),
      ...(message.scope ? { scope: message.scope } : {}),
    }))
    setChat(restored)
    loopRef.current?.restore(messages.map(message => ({ role: message.role, text: message.text })))
    sentAttachmentsRef.current = restored.flatMap(message => message.attachments ?? [])
    setReceipts([])
    setAttachments([])
    setAttachedSkills([])
    setAttachNotice(null)
    setSessionUsage(undefined)
  }
  useEffect(() => {
    void historyRef.current?.initialize().catch(() => {})
    return () => historyRef.current?.dispose()
  }, [])
  useEffect(() => {
    filePathRef.current = filePath
    if (filePath) void historyRef.current?.rebind(filePath).catch(() => {})
  }, [filePath, historyReady])

`
const HISTORY_ACTIONS = `  historyInvalidateRef.current = () => {
    // 在途结果属于旧会话；重置 loop 世代后不得落进新的聊天。
    const last = chatStateRef.current.at(-1)
    if (last?.role === 'assistant' && last.streaming && last.text) persistMessage('assistant', last.text, last.tools?.filter(tool => !tool.running))
    sendSeqRef.current++
    msgQueue.clear()
    dismissCards()
    loopRef.current?.reset()
    depsRef.current.previewDraft(null)
    depsRef.current.clearHighlights()
    setBusy(false)
  }
  const newChat = async (): Promise<void> => {
    await historyRef.current?.createChat()
    inputRef.current?.focus()
  }
  const switchHistory = async (chatId: string): Promise<void> => { await historyRef.current?.selectChat(chatId) }
  const updateHistory = async (chatId: string, patch: any): Promise<void> => { await historyRef.current?.updateChat(chatId, patch) }

`
const HISTORY_BUTTON = `          <AiHistoryButton
            locale={lang}
            entries={chat}
            activeChatId={activeChatId}
            disabled={historyChanging || !historyReady}
            loadSessions={() => historyRef.current!.listChats()}
            onSelectSession={switchHistory}
            onNewChat={newChat}
            onUpdateSession={updateHistory}
          />
`
const NEW_CHAT = `          {chat.length > 0 && (
            <button
              className="ai-header-btn"
              onClick={() => void newChat().catch(() => {})}
              disabled={historyChanging || !historyReady}
              data-tip={t('aiNewChat')}
              aria-label={t('aiNewChat')}
            >
              <IconNewChat />
            </button>
          )}
`

export function transformHtmlIdentityHistorySource(source, id) {
  const file = id.split('?')[0].replaceAll('\\', '/')
  // 产品身份也参与模型行为：只适配已审阅的 prompt，不触碰 provider ID、
  // HTTP header、文档元数据等上游协议字符串。升级时任一锚点漂移即阻止构建。
  if (file.endsWith('/apps/html/src/renderer/ai/html-skill.ts')) return replaceOnce(source,
    'You are the assistant inside GenOffice HTML,',
    'You are Friday, the assistant inside Friday HTML,', file)
  if (file.endsWith('/apps/html/src/renderer/ai/page-writer.ts')) {
    source = replaceOnce(source, 'You are the page writer of GenOffice HTML,', 'You are the page writer of Friday HTML,', file)
    return replaceOnce(source, 'You are the document writer of GenOffice HTML.', 'You are the document writer of Friday HTML.', file)
  }
  if (file.endsWith('/apps/html/src/renderer/ai/brief-writer.ts')) return replaceOnce(source,
    'You are the brief writer of GenOffice HTML,',
    'You are the brief writer of Friday HTML,', file)
  if (file.endsWith('/apps/html/src/renderer/ai/tools.ts')) return replaceOnce(source,
    'Note: generate_image is currently unavailable (no image provider: signed out of Genspark or cloud tools off, and no media API key in Settings). Do not call or promise it; use search_images for imagery.',
    'Note: Friday reports generate_image as unavailable. Direct the user to Friday Settings > AI Tools > Image, Media & Search (设置 > AI 工具 > 生图、媒体与搜索) to configure an image provider. Do not call or promise generate_image while it is unavailable. Use search_images only if that tool is available; do not assume search is configured.', file)
  if (file.endsWith('/apps/html/src/renderer/ai/AiPanel.tsx')) {
    source = PANEL_IMPORTS + source
    source = replaceOnce(source, '  const chatIdsRef = useRef<{ projectId: string; chatId: string } | null>(null)', '  const chatIdsRef = useRef<{ projectId: string; chatId: string } | null>(null)\n' + PANEL_STATE, file)
    source = replaceRegion(source, '  /** messages sent before resolveChat returned, flushed once the chat id is known */', '  const patchLast = ', '', file)
    source = replaceRegion(source, '  const persistMessage = (', '  // The loop is built once;', PERSIST, file)
    source = replaceRegion(source, '  // ── chat-history persistence:', '  useEffect(() => {\n    if (stickToBottomRef.current)', HISTORY_EFFECTS, file)
    source = replaceOnce(source, '    if (!instruction || !loop || loop.busy) return false', '    if (!instruction || !loop || loop.busy || !historyReadyRef.current) return false', file)
    source = replaceOnce(source, '    if (loopRef.current?.busy) setPrompt(preset.displayText ?? preset.text)', '    if (loopRef.current?.busy || !historyReadyRef.current) setPrompt(preset.displayText ?? preset.text)', file)
    source = replaceOnce(source, '  const copyMessage = (text: string, idx: number): void => {', HISTORY_ACTIONS + '  const copyMessage = (text: string, idx: number): void => {', file)
    source = replaceOnce(source, '          Genspark\n', '          Friday\n', file)
    source = replaceOnce(source, '          {chat.length > 0 && (', HISTORY_BUTTON + '          {chat.length > 0 && (', file)
    source = replaceRegion(source, '          {chat.length > 0 && (', '          <button\n            className="ai-header-btn ai-panel-collapse"', NEW_CHAT, file)
    source = replaceOnce(source, '      <div className="ai-chat" ref={chatRef} onScroll={onChatScroll}>', `      <div className="ai-chat" ref={chatRef} onScroll={onChatScroll}>
        {historyError && <div className="ai-msg ai-msg-error" role="alert">{historyError} <button type="button" onClick={() => void historyRef.current?.retry().catch(() => {})}>{historyLabelsRef.current.retry}</button></div>}
        {!historyReady && !historyError && <div role="status">{historyLabelsRef.current.loading}</div>}`, file)
    source = replaceOnce(source, '    const { system, user } = buildPageWriterRequest(spec, aiLangDirective(langRef.current))', '    const writerHistoryEpoch = historyRef.current?.epoch\n    const { system, user } = buildPageWriterRequest(spec, aiLangDirective(langRef.current))', file)
    source = replaceOnce(source, '      if (closed) return\n      depsRef.current.previewDraft(draft)', '      if (closed || signal?.aborted || writerHistoryEpoch !== historyRef.current?.epoch) return\n      depsRef.current.previewDraft(draft)', file)
    source = replaceOnce(source, '          if (closed) return\n          draft = html', '          if (closed || signal?.aborted || writerHistoryEpoch !== historyRef.current?.epoch) return\n          draft = html', file)
    source = replaceOnce(source, '    const done = () => depsRef.current.previewDraft(null)', "    if (writerHistoryEpoch !== historyRef.current?.epoch) return { ok: false, error: 'Conversation changed; generated page was cancelled.' }\n    const done = () => depsRef.current.previewDraft(null)", file)
    source = replaceRegion(source, '/** Genspark brand mark, inline for crisp device-resolution rendering */', '\n', '', file + ':brand-comment')
    const brandAt = source.indexOf('export function GensparkMark(')
    if (brandAt < 0) throw new Error('OFFICE_HTML_HISTORY_ADAPTER_DRIFT: brand')
    return source.slice(0, brandAt) + `// 使用 Friday 与其他 Office 相同的品牌资源，函数名保留上游调用合同。
export function GensparkMark({ size = 18 }: { size?: number }): React.JSX.Element {
  return <img src={fridayIcon} width={size} height={size} alt="" aria-hidden style={{ objectFit: 'contain' }} />
}
`
  }
  if (file.endsWith('/apps/html/src/preload/index.ts')) {
    source = replaceOnce(source, "const projectApi: Pick<ProjectApi, 'resolveChat' | 'appendChat' | 'loadChat' | 'rebindChat'> = {", "type FridayChatScope = { filePath: string | null; tempChatId?: string }\nconst projectApi: Pick<ProjectApi, 'resolveChat' | 'appendChat' | 'loadChat' | 'rebindChat'> & {\n  listChatsForFile(args: FridayChatScope): Promise<any[]>\n  createChat(args: FridayChatScope): Promise<{ projectId: string; chatId: string }>\n  selectChatForFile(args: FridayChatScope & { chatId: string }): Promise<{ projectId: string; chatId: string }>\n  updateChatForFile(args: FridayChatScope & { chatId: string; patch: any }): Promise<{ projectId: string; chatId: string }>\n  copyChatsToFile(args: { sourceFilePath: string; currentChatId: string; newFilePath: string }): Promise<{ projectId: string; chatId: string }>\n} = {", file)
    return replaceOnce(source, "  rebindChat: (args) => ipcRenderer.invoke('project:rebindChat', args),", `  rebindChat: (args) => ipcRenderer.invoke('project:rebindChat', args),
  listChatsForFile: (args) => ipcRenderer.invoke('project:listChatsForFile', args),
  createChat: (args) => ipcRenderer.invoke('project:createChat', args),
  selectChatForFile: (args) => ipcRenderer.invoke('project:selectChatForFile', args),
  updateChatForFile: (args) => ipcRenderer.invoke('project:updateChatForFile', args),
  copyChatsToFile: (args) => ipcRenderer.invoke('project:copyChatsToFile', args),`, file)
  }
  if (file.endsWith('/apps/html/src/renderer/components/Ribbon.tsx')) return replaceOnce(source, '<span>Genspark AI</span>', '<span>Friday</span>', file)
  if (file.endsWith('/apps/html/src/renderer/i18n/ai/zh.ts')) return replaceOnce(source, "aiOpenAssistant: '打开 AI 助手'", "aiOpenAssistant: '打开 Friday'", file)
  if (file.endsWith('/apps/html/src/renderer/i18n/ai/en.ts')) return replaceOnce(source, "aiOpenAssistant: 'Open AI assistant'", "aiOpenAssistant: 'Open Friday'", file)
  return null
}

export function fridayHtmlProductPlugin() {
  const aliases = {
    '@friday-office/history-button': 'vendor/happyoffice/packages/ui/src/AiHistoryButton.tsx',
    '@friday-office/brand-icon': 'vendor/happyoffice/apps/docs/src/renderer/assets/friday-icon.png',
    '@friday-office/html-history-session': 'scripts/office/html-history-session.js',
    '@friday-office/html-history-labels': 'scripts/office/html-history-labels.js',
  }
  return { name: 'friday-html-product-services', resolveId(id) { return aliases[id] ? path.join(root, aliases[id]) : null } }
}
