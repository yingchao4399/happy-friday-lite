// 固定 HTML 源保持干净，在构建边界统一错误合同和恢复动作。
import { fileURLToPath } from 'node:url'

const recoverySource = fileURLToPath(new URL('../../vendor/happyoffice/packages/agent-core/src/error-recovery.ts', import.meta.url)).replaceAll('\\', '/')
const replace = (source, needle, value, file) => {
  if (!source.includes(needle) || source.indexOf(needle) !== source.lastIndexOf(needle)) throw new Error(`OFFICE_HTML_ERROR_ADAPTER_DRIFT: ${file}`)
  return source.replace(needle, value)
}
const errorFields = `
export interface AgentStreamError {
  protocolVersion?: string
  errorCode?: 'timeout' | 'credits' | 'network' | 'overloaded' | 'parameter' | 'auth' | 'provider' | 'config' | 'transcript' | 'region'
  provider?: string
  hostMode?: 'friday-managed' | 'standalone'
  recovery?: 'model-settings' | 'login' | 'retry' | 'none'
  diagnostic?: Record<string, unknown>
}
`

export function transformHtmlErrorSource(source, id) {
  const file = id.split('?')[0].replaceAll('\\', '/')
  if (file.endsWith('/packages/agent-core/src/types.ts')) {
    source = replace(source, '  onError(error: string): void', '  onError(error: string, detail?: AgentStreamError): void', file)
    return source + errorFields
  }
  if (file.endsWith('/packages/agent-core/src/index.ts')) {
    return replace(source, '  AgentImage,', '  AgentImage,\n  AgentStreamError,', file)
  }
  if (file.endsWith('/packages/agent-core/src/electron-transport.ts')) {
    source = replace(source, '  AgentStreamRequest,', '  AgentStreamRequest,\n  AgentStreamError,', file)
    source = replace(source, 'export interface IpcStreamChunk {', 'export interface IpcStreamChunk extends AgentStreamError {', file)
    source = replace(source, "  errorCode?: 'timeout' | 'credits' | 'network' | 'overloaded' | 'region'", '', file)
    source = replace(source, '                      : (chunk.error ?? options.unknownErrorText()),', `                      : (chunk.error ?? options.unknownErrorText()),
            {
              ...(chunk.protocolVersion ? { protocolVersion: chunk.protocolVersion } : {}),
              ...(chunk.errorCode ? { errorCode: chunk.errorCode } : {}),
              ...(chunk.provider ? { provider: chunk.provider } : {}),
              ...(chunk.hostMode ? { hostMode: chunk.hostMode } : {}),
              ...(chunk.recovery ? { recovery: chunk.recovery } : {}),
              ...(chunk.diagnostic ? { diagnostic: chunk.diagnostic } : {}),
            },`, file)
    return replace(source, '      return { cancel: () => options.cancel(requestId) }', `      return { cancel: () => {
        if (settled) return
        settle()
        try { options.cancel(requestId) } finally { cb.onDone() }
      } }`, file)
  }
  if (file.endsWith('/packages/agent-core/src/loop.ts')) {
    source = replace(source, '  AgentImage,', '  AgentImage,\n  AgentStreamError,', file)
    source = replace(source, '  onError?(error: string): void', '  onError?(error: string, detail?: AgentStreamError): void', file)
    source = replace(source, '          onError: (error) => {', '          onError: (error, detail) => {', file)
    return replace(source, '            this.options.events?.onError?.(error)', '            this.options.events?.onError?.(error, detail)', file)
  }
  if (file.endsWith('/apps/html/src/renderer/ai/AiPanel.tsx')) {
    source = `import { resolveAiErrorRecovery } from ${JSON.stringify(recoverySource)}\n` + source
    source = replace(source, 'interface ChatEntry {', `interface ChatEntry {
  errorDetail?: import('@genoffice/agent-core').AgentStreamError
  modelSettingsRequired?: boolean`, file)
    const first = source.indexOf('        onError: (error) => {')
    const last = source.indexOf('\n        },', first)
    if (first < 0 || last < 0) throw new Error(`OFFICE_HTML_ERROR_ADAPTER_DRIFT: ${file}`)
    let block = source.slice(first, last)
    block = replace(block, '        onError: (error) => {', '        onError: (error, detail) => {\n          const errorDetail = detail ?? {}', file)
    block = replace(block, '                text: error,', '                text: error,\n                errorDetail,\n                modelSettingsRequired: false,', file)
    block = replace(block, '          queueRunRef.current = false', `          void resolveAiErrorRecovery(detail, settingsRef.current?.provider)
            .then((recovery) => {
              if (recovery !== 'model-settings') return
              setChat((prev) => prev.map((entry) => entry.errorDetail === errorDetail ? { ...entry, modelSettingsRequired: true } : entry))
            })
            .catch(() => {})
          queueRunRef.current = false`, file)
    source = source.slice(0, first) + block + source.slice(last)
    return replace(source, '              {showToolbar && (', `              {entry.modelSettingsRequired && (
                <button className="ai-header-btn" onClick={() => void window.htmlApi.openAiModelSettings()}>
                  {t('fridayOpenModelSettings')}
                </button>
              )}
              {showToolbar && (`, file)
  }
  if (file.endsWith('/apps/html/src/renderer/i18n/strings-ai.ts')) {
    const locales = ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'th', 'id', 'ru', 'ar', 'pt', 'it', 'pl', 'cs', 'nl', 'ms', 'he', 'hi', 'vi', 'tr']
    for (const lang of locales) {
      source = replace(source, `  ${lang},`, `  ${lang}: { ...${lang}, fridayOpenModelSettings: ${JSON.stringify(lang === 'zh' ? '打开模型设置' : 'Open model settings')} },`, file)
    }
    return replace(source, "  'zh-TW': zhTW,", "  'zh-TW': { ...zhTW, fridayOpenModelSettings: '開啟模型設定' },", file)
  }
  return null
}

export function htmlErrorAdapterPlugin() {
  return { name: 'friday-html-error-contract', enforce: 'pre', transform(source, id) {
    const code = transformHtmlErrorSource(source, id)
    return code == null ? null : { code, map: null }
  } }
}
