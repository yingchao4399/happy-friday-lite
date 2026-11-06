// 保留上游 HTML 应用；宿主通过 runtime hook 接入，不复制编辑器逻辑。
export * from '../../../vendor/genoffice-html/apps/html/src/main/html-main'
// 各 main bundle 内部有独立语言/headless 状态，显式注入到同一依赖图。
export { setUiLang as setHtmlUiLang } from '../../../vendor/genoffice-html/packages/i18n/src/index'
export { setHeadlessMode as setHtmlHeadlessMode } from '../../../vendor/genoffice-html/packages/electron-utils/src/index'
// 复用相同固定来源的服务实现；凭证及文档授权由 Friday 主进程管理。
export { webSearch as htmlAiWebSearch, imageSearch as htmlAiImageSearch } from '../../../vendor/genoffice-html/packages/ai-search/src/index'
export { generateImageWithProvider as htmlAiGenerateImageWithProvider, AI_MEDIA_PROVIDERS as htmlAiMediaProviders } from '../../../vendor/genoffice-html/packages/ai-provider/src/index'
export { fetchRemoteImage as htmlAiFetchRemoteImage, readBodyCapped as htmlAiReadBodyCapped } from '../../../vendor/genoffice-html/packages/electron-utils/src/remote-image'
export { testMediaProvider as htmlAiTestMediaProvider, analyzeMediaWithProvider as htmlAiAnalyzeMedia } from '../../../vendor/genoffice-html/packages/ai-provider/src/index'
export { probeDecision as htmlAiProbeDecision, SearchReranker as HtmlFileSearchReranker } from '../../../vendor/genoffice-html/apps/shell/src/main/file-index/rerank'
