# AI HTML 服务合同审计：AI、设置、技能、搜索、图片、附件与历史

日期：2026-11-06。状态：固定源码的静态合同审计与下一步实施拆解；本文不代表这些服务已经接通或通过真实模型验收。本文新增保存，不改写前三份方案、PRD 和技术设计，也不把旧进度账本当作当前代码事实。

## 1. 审计范围与可重查的来源

本次审计对象是独立源码 `vendor/genoffice-html`，官方 tag `v0.12.852`，完整 commit `4b55db9ed1994575a695160ffc6cfd0bfc866211`。该源码只用于 AI HTML 及其依赖闭包；现有 Docs、Sheets、Slides、PDF 仍由 `vendor/happyoffice` 提供，不因 HTML 的来源锁而被声明升级。

来源锁是根目录 `office-html-upstream.lock.json`，获取/只读核验工具分别为 `scripts/sync-office-html-upstream.mjs` 和 `scripts/office/html-upstream.mjs`。独立获取专项已经实际执行 `node --test scripts/tests/office-html-upstream.test.mjs`，结果 24/24 通过、0 失败、0 跳过；它证明源码获取、身份、dirty 拒绝与失败保留规则，**不证明本文任何 AI 服务已经可用**。本次审计没有向远端模型或付费媒体接口发送请求，没有更改配置或用户文档。

Friday 主仓库 HEAD 为 `631f535d53c0812bed29bfcf5c679a4485123e9d`，工作区有并行实施中的未提交修改，不能仅凭 HEAD 重建本文观察到的实现。以下是 2026-11-06T12:22:33.105Z 读取的关键文件摘要；后续代码改变时须重查相关结论。

| 文件 | SHA-256 |
|---|---|
| `vendor/genoffice-html/apps/html/src/preload/index.ts` | `bb6c31edef6b6dede726b4810a3d97990e63be431339ff13b1152930551e7f8b` |
| `vendor/genoffice-html/apps/html/src/main/html-main.ts` | `544a9c6a1a2560db928cd37717f6a95a2084d4e8a78f28ee11e141afbb5659c5` |
| `src-electron/office/office-ai-bridge.js` | `6802168b36c4c3e210490196d6afb8125b1c63c67f8f9fff09b146bf921ae693` |
| `src-electron/office/office-host.js` | `694b6aa4701cdece22f1220bd110526d97a1171decda5d169e0e62cb538e4249` |
| `src-electron/office/file-commands.js` | `8e089b8fae2190f767375d6e44b7ecb2430e33c8a804d71d11c3f7b2b196c856` |

审计方式为：解析 preload 的真实 IPC 调用及共享常量，追踪 HTML main 与 renderer 的消费者，再检索 Friday 主进程及实际沿用的四编辑器主进程。本文中的“存在”指找到了对应实现；“缺失”指在这些实际来源中未找到对应 handler；“待运行验证”表示没有把静态阅读或单元测试当成 UI、真实服务或安装版结果。

## 2. 当前最关键的六类缺口

1. **有通道但返回合同错误。** Friday 的 `ai:web-search`、`ai:image-search` 返回 `[]`；目标 HTML 分别期待有 `results`、`images` 和 `method` 的对象。图片工具会直接执行 `r.images.map(...)`，所以空数组会造成执行异常，不能解释成正常零结果。证据为 Friday bridge 第 362–363 行、目标 HTML `ai/tools.ts` 第 644–666 行。
2. **显示能力与执行配置不一致。** Friday 返回 `provider: 'genspark'`、`gskToolsEnabled: true`，并固定报告 `loggedIn: true`。目标 HTML 因此可能显示 `generate_image`，实际 `html:ai-generate-image` 却绕过 Friday bridge，读取另一份 `userData/ai-settings.json` 后调用上游媒体服务。配置、能力声明和真实执行不是同一事实源。
3. **至少六个显式 invoke 入口未接到 Friday。** `ai:open-model-settings`、`ai:open-skills-settings`、`ai:skills-list`、`ai:skill-text`、`ai:suggest-file-name`、`home:open-path` 当前未在 Friday/实际四编辑器 handler 来源中找到实现。此外，preload 导入的拖放桥还发送 `app:open-dropped-files`，也需独立接入。
4. **历史服务依赖其他编辑器先加载。** HTML 自己不注册 `project:*`；Friday 目前在 Docs/Sheets/Slides/PDF 的惰性注册分支中安装它们。HTML 冷启动时不应依赖用户先打开其他编辑器。仅仅暴露 `window.projectApi` 不代表它背后已有 handler。
5. **附件读取尚缺 Friday 的可信授权边界。** 上游附件 handler 多处忽略 sender，按 renderer 提交的路径直接 stat、解析或读取。它们有格式与体积约束，但没有在这些 handler 中绑定“该 sender 经用户选择的附件集合”。因此不能直接把路径型 API 当作 Friday 的资源授权服务。
6. **图片生成还存在资产落地链路风险。** 目标上游 BYOK 生成图会返回受管理临时图的 `file://` URL；HTML 的 `fetchImage` 只接受 HTTP(S)。后续 fallback 会把该 URL 当外链嵌入。这是源码追踪发现、尚待真实 BYOK 运行复现的缺口；不能仅以生成服务返回 URL 就判定图片已成为可携带的文档资产。

这些问题应按领域服务合同统一处理。接入方案需要同时规定能力发现、配置解析、身份授权、任务取消、返回类型和资源生命周期，而不是单独给六个按钮补空 handler。

## 3. preload 的完整 AI/app/project/home 通道台账

固定版本 `apps/html/src/preload/index.ts` 中有 **29 个显式相关调用点：22 个 invoke、7 个事件订阅**。另有从 `@genoffice/electron-utils/drop-open` 引入的一个 send。下表的行号均指固定版本；`HTML_CHANNELS`/`AI_CHANNELS` 的真实字符串来自 `apps/html/src/shared/ipc.ts`。

### 3.1 22 个显式 invoke

| 通道 / preload 行 | 实际输入 → 目标输出 | Friday 当前映射与边界 |
|---|---|---|
| `home:open-path` / 12 | `path: string` → `Promise<void>` | 未检出 handler。应接入 Friday 的受控文档路由；不能把模型给出的路径直接交给 OS 任意执行。 |
| `app:get-language` / 77 | 无 → 上游 `Lang`，如 `zh`、`en` | 目标 HTML main 第 1880–1881 行自行替换这个共享 handler，返回本 bundle 的 `getUiLang()`。Friday host 已在配置 HTML runtime 时设置该实例的初始语言；动态语言变更仍需验证。 |
| `app:get-theme` / 83 | 无 → `light`、`dark` 或 `system` | `office-host.js` 的 `registerAppPrefsIpc()` 读取 `userData/app-settings.json`；静态映射存在。 |
| `app:get-auto-save-default` / 89 | 无 → `{ on: boolean, updatedAt: number }` | 同上，返回的更新时间未设置时为 0。不能返回 `office-file-preferences` 的另一种键名代替该 shape。 |
| `app:get-ai-panel-prefs` / 95 | 无 → `{ side, fontSize, customFontSize, spellcheck }` | bridge 第 415 行；从 `office-ai-panel-prefs.json` 读取并规范化。 |
| `app:set-ai-panel-prefs` / 96 | 偏好 patch → 规范化的完整偏好 | bridge 第 417 行；已有持久化与广播。需补 sender/字段/作用域验收，不能因 setter 存在就认为所有授权已正确。 |
| `ai:get-settings` / 107 | 无 → `AiSettings` | bridge 第 331 行返回 `fridaySettings()`；当前为托管伪装对象，并非目标版本完整配置与实际能力状态。 |
| `ai:set-settings` / 108 | `AiSettings` → 实际生效的 `AiSettings` | bridge 第 332 行原样回传参数，未在该 handler 中落盘、切换 `state.model` 或广播；不能视为设置成功。 |
| `ai:open-model-settings` / 114 | 无 → `Promise<void>` | 未检出 handler。应映射到 Friday 的模型/搜索/媒体配置入口，并带回成功打开或可恢复错误。 |
| `ai:open-skills-settings` / 115 | 无 → `Promise<void>` | 未检出 handler。应映射到现有 Friday 技能管理界面，避免另建一套不可同步的技能目录。 |
| `ai:skills-list` / 116 | 无 → `Array<{ name, description, relevant }>` | 未检出该同名 handler；Friday 有 `agent-list-skills` 和底层 `listSkills()` 可复用，需做 shape 与身份适配。 |
| `ai:skill-text` / 117 | 已列出的技能 `name: string` → 技能正文 string | 未检出 handler。不得将 name 当文件路径拼接或接受任意磁盘路径。 |
| `ai:gsk-status` / 118 | 无 → `{ loggedIn: boolean, email?: string }` | bridge 第 333 行固定返回已登录与本地占位邮箱。它不证明真实 Genspark 账户、搜索或媒体可用。 |
| `ai:stream` / 119 | `AiStreamRequest` → invoke 完成；内容经 chunk 事件发送 | bridge 第 340 行到 `runFridayStream()`，再经共享 `ai_chat_inference` 调用模型。已有流式实现，仍需目标合同、owner 和多窗口验证。 |
| `ai:stream-cancel` / 120 | `requestId: string` → `Promise<void>` | bridge 第 341–342 行仅按全局 requestId 查 controller；该处未检查取消者 sender。必须防止跨窗口取消、ID 冲突及关闭后的迟到执行。 |
| `ai:web-search` / 126 | `query: string, maxResults?: number` → `WebSearchResult` | bridge 第 362 行返回 `[]`，与目标对象合同不符。 |
| `ai:image-search` / 128 | 同上 → `ImageSearchResult` | bridge 第 363 行返回 `[]`，目标工具读取 `r.images` 会出错。 |
| `project:resolveChat` / 135 | `{ filePath, tempChatId?, sessionId? }` → `{ projectId, chatId }` | 现有四编辑器各有共享 handler；HTML 冷启动注册、sender 到文档的绑定及文件路径授权待实现/验证。 |
| `project:appendChat` / 136 | `{ projectId, chatId, role, text, tools?, attachments?, scope? }` → void | 可以复用当前历史存储逻辑；现有 Docs handler 未在该处验证 sender 对 project/chat 的所有权。 |
| `project:loadChat` / 137 | `{ projectId, chatId, limit? }` → `ChatMessage[]` | 同上；不能信任 renderer 自报 projectId/chatId 作为跨会话读取授权。 |
| `project:rebindChat` / 138 | `{ projectId, tempChatId, newChatId?, newFilePath?, sessionId? }` → `{ projectId, chatId }` | 需在第一次保存/另存为后绑定真实文档，保留 Friday 已有的稳定聊天标识与多会话扩展。 |
| `ai:suggest-file-name` / 158 | `{ content: string }` → `{ ok, name?, reason? }` | 未检出 handler。不能直接返回裸 string；上游客户端按 `result.ok` 判断，并在失败时保留原名。 |

### 3.2 7 个事件订阅

| 通道 / preload 行 | 目标 payload | 当前发出端与剩余工作 |
|---|---|---|
| `app:language-changed` / 80 | `Lang` | 本轮未在 Friday Office 的语言设置路径找到对应广播。初始 getter 存在不等于运行中切换语言可用；需更新 HTML bundle 的语言状态后统一广播。 |
| `app:theme-changed` / 86 | `UiTheme` | `file-commands.js` 第 129 行在 Office 文件偏好更新时发出，经 host 第 1079–1083 行广播给已注册视图。需实际主题切换验证。 |
| `app:auto-save-default-changed` / 92 | `{ on, updatedAt }` | `file-commands.js` 第 130 行已有相同路径。需验证继承值、文档覆盖值与重开。 |
| `app:ai-panel-prefs-changed` / 99 | 完整 `AiPanelPrefs` | bridge 更新偏好后向 WebContents 广播。需验证仅向可信编辑器发送适当数据及两视图一致性。 |
| `app:chrome-pressed` / 104 | 无 | 未在本轮 Friday 来源中找到相应发出端。需由可信宿主 chrome 交互触发，保留上游关闭浮层/焦点行为；不能让不可信预览伪造宿主交互。 |
| `ai:settings-changed` / 111 | 无；订阅者随后重新读取设置 | 当前 bridge 的 `ai:set-settings` 与 `setOfficeAiModel` 未在所查实现中发出该事件。需在主进程实际提交设置后广播，避免 UI 仍使用旧能力快照。 |
| `ai:stream-chunk` / 123 | `{ requestId, type, text?, toolCall?, error?, errorCode?, stopReason?, usage? }` | `runFridayStream()` 已向发起者发送；支持 delta/reasoning/tool-call/done/error/ping。目标还消费 usage，需要在 provider 确实提供时透传，不能把未知使用量填 0。 |

### 3.3 间接拖放 send

`installDropOpenBridge()` 调用位于 preload 第 166 行。其来源 `packages/electron-utils/src/drop-open.ts` 定义 `DROP_OPEN_CHANNEL='app:open-dropped-files'`，在 preload 世界解析真正 OS File 后发送 `string[]`，最多 20 个文件。本轮未在 Friday 查到该通道 listener；需要映射到已有文档路由、扩展名策略、打开偏好和错误反馈。该桥有上游识别但 Friday 尚未启用的扩展名，不能因此自动承诺所有旧格式都可打开。

HTML 的 AI 面板 drop 会先接管“添加附件”事件；不要同时把同一次拖放既作为附件上传又打开新标签。`home:open-path` 用于 AI 回复的来源链接，与 OS drop 的授权证据不同，应共用路由服务、分别验证授权来源。

## 4. T05：模型、技能、命名与会话的精确合同

### 4.1 AI 设置与真实能力

目标 `packages/ai-provider/src/types.ts:272` 的设置至少包含：

```ts
interface AiSettings {
  provider: AiProviderId
  providers: Record<AiProviderId, AiProviderConfig>
  customEndpoints?: AiCustomEndpoint[]
  customEndpoint?: string
  media?: AiMediaSettings
  search?: AiSearchSettings
  gskToolsEnabled?: boolean
  maxOutputTokens?: number
}

interface AiProviderConfig { apiKey: string; model: string; baseUrl?: string }
interface AiSearchSettings { provider: AiSearchProviderId; providers: Record<string, { apiKey: string }> }
interface AiMediaSettings {
  imageProvider: AiMediaProviderId
  analysisProvider: AiMediaProviderId
  videoAnalysisProvider: AiMediaProviderId
  providers: Record<AiMediaProviderId, AiMediaProviderConfig>
}
```

完整类型以固定源码为准，以上只摘录与对接有关的字段。聊天、搜索与图片生成是分别配置和判定的能力；聊天 key 有效不证明同一 endpoint 提供图片生成，Genspark 托管推理也不意味着 Friday 已有真实 Genspark 登录。

Friday 的 `setOfficeAiModel()` 目前接收主窗口推送的模型对象并存入内存。`SettingsModel.vue:725,757,763–780` 显示已有模型列表还涉及 localStorage 与 `save-config` 同步；`config.js:20` 的配置路径为数据目录中的 `config.json`。这是当前代码事实，不能写成“所有密钥已经只保存在 SQLite”。仓库对敏感设置的约定仍应在统一配置服务中落实；HTML 接入应避免新增第二套明文 `ai-settings.json` 或把真实 key 返回给 HTML renderer。

建议以主进程配置服务为权威，向编辑器返回 **不带密钥的模型选择与 capability 快照**，实际请求只传模型/服务的 opaque ID，由主进程解析 key。由于目标上游的部分 UI 判定直接读取设置中的配置字段，必须适配其能力判定入口，不能用“伪 key + 伪已登录”触发按钮显示。新增公开能力合同是拟议接口，需要版本与测试；不是上游现有 `AiSettings` 的原生保证。

设置流程必须为：校验发起者 → 验证补丁 → 主进程原子提交 → 重新计算有效能力 → 广播变更 → getter 返回真实生效状态。`ai:set-settings` 原样 echo 不满足任何持久化或生效证明。

### 4.2 流式推理

目标请求是 `{ requestId, sessionId?, settings, system, messages, tools?, maxTokens? }`；正常 invoke 本身不返回全文。目标 transport 会消费类型为 `delta/reasoning/tool-call/usage/done/error/ping` 的 chunk，并按 requestId 筛选。工具调用和工具结果回传必须保留完整结构，不能把它们压成普通聊天文本。

Friday 可复用 `ai-inference-adapter.js` 的 `createAiChatCapabilityInvoker()`、`canonical-transcript.js`、`tool-call-stream.js` 及注册的 `ai_chat_inference`。这些已形成公共推理边界，HTML 不需要另建一套 OpenAI SSE 解析器。当前 bridge 的执行对象取自 `state.model`，而非信任 renderer 传入的 key；这一方向应保留。

仍需补齐并验证：

- 将请求绑定到可信 sender、actor、space、文档 identity 与 owner 生命周期；取消采用 owner/requestId 组合，重复 ID 不覆盖其他运行。
- 明确 `sessionId`、模型切换与本轮 token 预算的映射；当前 handler 没有消费全部目标字段，不能把字段被忽略写成对等。
- provider 选择、工具能力和多模态支持必须来自有效配置；不支持的参数用明确错误或能力差异反馈，不静默丢失。
- provider 报告 usage 时透传；没有报告时保留未知。错误 code 转换需覆盖目标支持的 timeout/credits/network/overloaded/region，同时保留安全的配置/鉴权错误文字。
- Stop、视图销毁、超时、网络中断都要终止后续 delta/tool-call；已经提交的文档修改按真实状态报告，不能由“取消”删除已交付结果。

### 4.3 技能

目标来源为 shell 的 `user-cli.ts:93–110`：`skills-list` 返回已安装技能的 `{ name, description, relevant }[]`；`skill-text` 输入技能名称、输出正文 string，原实现有 32,000 字符裁剪。HTML `AiPanel.tsx:405–424` 会读取用户选中的技能正文，再交给 `withAttachedSkills()` 放入当次请求；其菜单映射目前只使用 name/description。

Friday 可复用 `agent/skills.js:260` 的 `listSkills()`、`parseSkillMetadata()`、`getSkillDir()`，以及 `agent/ipc.js:313` 已有的管理入口。现有结果是 `{ id, name, description, path, fileName, builtin? }[]`，路径是 `/SKILL/...` 虚拟路径，不能直接冒充上游输出，也不能让 renderer 通过 name 指定磁盘文件。

最小接入需要一个“已安装技能目录服务”：用当前空间/应用认可的 inventory 生成稳定 ID 与展示名映射；列表投影到目标 shape；读取时重新在 inventory 中精确查找，检查真实路径仍在技能根目录，限制大小并裁剪返回；不存在、重名、删除和无权访问均明确失败。技能正文不写普通日志，正文中提及命令也不构成额外执行授权。

可以复用固定上游 `agent-core/src/imported-skill.ts` 的相关性判定，但应记录与 Friday 技能格式的差异。不能自动扫描用户未导入的其他 Agent 技能目录。HTML preload 没有 `ai:run-cli` 调用；接通技能正文不等于授权任意 shell，也不等于承诺提供上游 shell 首页的完整 CLI 功能。

### 4.4 AI 命名

目标 shell `ai-naming-service.ts:91` 约定：输入 `{ content }`；空内容为 `{ ok:false, reason:'empty-content' }`，无可用名称为 `{ ok:false, reason:'empty-name' }`，成功为 `{ ok:true, name }`。`ui/src/ai-naming-client.ts:61–72` 会在任何失败时保持原名称，不抛弃当前文件名。

目标 HTML `file-naming.ts:66–67` 传入的是 `modelTextOf(source,map)` 的脱敏投影，不是原始 HTML。Friday 命名服务应复用公共推理能力，并复用固定上游 `apps/shell/src/main/ai-naming.ts` 的纯函数 `excerptForNaming`、`buildNamingInstruction`、`sanitizeFileStem`：默认 excerpt 4,000 字符、输出预算 2,048 token、约 30 秒超时、stem 最多 60 字符且清理 Windows 保留名/非法字符。

只复用这些纯函数和服务合同，不加载上游 shell 主入口或注册第二套模型配置。名字只预填“另存为”对话框，用户决定后才写文件；不能把命名工具变成后台自动重命名。主进程无法从传来的纯 content 恢复脱敏标记，因此还需测试 HTML 原有投影在命名路径没有被宿主重新读取原文所绕过。

### 4.5 会话与文件路由

目标 `project-store/src/ipc.ts` 定义的四个 shape 已列在 3.1。`loadChat` 返回的每条记录包括 `{ seq, ts, role, text, fileRef?, tools?, attachments?, scope? }`；`scope={label,text?}`。可复用当前 Friday 历史存储，但需要抽出唯一注册的历史 service，不能为 HTML 再初始化一套写相同 userData 的 store。

当前 HTML `AiPanel.tsx:611–613` 会吞掉 append 的错误，所以 handler 缺失可能表现为“聊天正常但重开消失”。验收必须检查真实持久化与重开，不只检查有没有异常提示。只开 HTML 的冷启动、未命名文档第一次保存、另存为、重命名、多标签同文件、现有 Friday 多会话选择都必须覆盖。

路由可复用 `office-host.js` 的 `openOfficeFile()` 与已有文件命令/类型判定。应由宿主从当前 view 推导可打开的已授权来源，区分 AI 回答中的本地引用、用户 OS 拖放与外链；不能信任 renderer 自报的任意路径或 chatId 来获得其他文档访问权。

## 5. T06：搜索、图片与附件的精确合同

### 5.1 搜索结果与失败语义

```ts
type WebSearchResult = {
  results: Array<{ title: string; url: string; snippet: string }>
  answer?: string
  method: string
  error?: string
}
type ImageSearchResult = {
  images: Array<{ title?: string; imageUrl: string; width?: number; height?: number }>
  method: string
  error?: string
}
```

正常零结果仍是对象，例如 `{ results:[], method:'provider-id' }`。未配置、禁用、鉴权失败、服务错误或超时必须区分，映射到目标兼容形状时使用 `{ results:[], method:'error', error:'...' }` 或 `{ images:[], method:'error', error:'...' }`。内部可使用更强的错误 envelope，进入目标 renderer 前必须做精确投影；不能把内部 `{ok:false,error:{...}}` 原样交给只认 `method` 的消费者。

优先复用固定上游 `packages/ai-search/src/index.ts` 的 `webSearch()`、`imageSearch()`，以主进程解析的显式 `SearchOptions` 注入设置，避免 `webSearchTool(settingsPath,...)` 再读取第二份 JSON。现有实现对 query/result-count 有边界，并包含真实 keyed provider 与 keyless fallback；它们属于待接入引擎，不因源码已经取得就自动可用。

Friday 的 `search_all` 是本地笔记、会话、画布、日程、文件索引和 RAG 搜索；`fetch_webpage_text` 是已知 URL 的正文抓取。二者可用于其他对应能力，**不能替代公网搜索或图片搜索并宣称对等**。本轮没有在 Friday 服务中找到已经完整配置的 web/image search backend。

应将已授权的 provider ID、凭据、超时、proxy、取消和网络策略注入统一搜索服务；只有实际登录且用户允许时才用 Genspark。keyless fallback 也会访问网络，需要服从相同用户设置与权限，不能因为不需要 key 就跳过网络约束。

### 5.2 生成图片与资产落地

preload 的真实入口是 **`html:ai-generate-image`**，不是共享 `ai:generate-image`。输入 `{ prompt: string, aspectRatio?: string }`，目标输出 `{ url?: string, error?: string }`。所以仅修改 Friday bridge 中 `ai:generate-image` 的 handler 不会修复目标 HTML。

上游 main 第 1627–1643 行直接调用 `generateImageTool(settingsPath,op,{mediaRoots})`；它经 `.852` 的 `activeMediaConfig()` 路由到真实 Genspark 或 BYOK provider。Friday 应复用固定上游媒体协议、模型参数解析与图像字节返回逻辑，以统一主进程配置注入服务，避免在宿主复制多家图片 API 协议。原服务主要以 settings 文件路径为输入；将它接到 Friday 需要通用配置/执行 hook，不能拿占位凭据写入 JSON 当作实际授权。

资产路径的源码追踪如下：

1. `media-tools.ts:359–365` 的 BYOK 分支得到图像 bytes/mime，调用 `storeGeneratedImage()`。
2. `generated-images.ts:58–71` 将图像写入临时目录的 UUID 文件并返回 `file://` URL；缓存清理周期不是用户文档的长期保存保证。
3. HTML `tools.ts:620–636` 调用 `fetchImage(url)`，希望复制到已保存文档的 assets，或在未保存文档内转成 data URL。
4. `html-main.ts:1670–1671` 目前只接受 HTTP(S)，会拒绝该本地生成 URL；renderer 随后回退使用原 URL。

这个风险需以真实 BYOK 或受控协议 fixture 复现，检查预览、保存、重开、移动文档及临时缓存失效后的图片。修复应建立“受管理生成资产解析”能力：仅允许读取由本次服务签发、仍属于该 actor/space/view 的生成资产，校验实际路径、字节、MIME、大小和时效，再交给原资产生命周期复制或 inline；**不得把 `fetchImage` 扩成读取任意 `file://`**。固定上游 `readGeneratedImage()` 可提供已有格式与路径规则，但还要补 owner 绑定与替换竞态验证。

`html:fetch-image` 的 HTTP 路径已经调用上游 `fetchRemoteImage()` 和 `readBodyCapped()`，可以复用其 SSRF/体积约束；仍需注入 Friday 的网络授权、sender 与取消上下文。目标 renderer 用 magic-byte sniff 决定可落地扩展名，保存/导出支持范围也要保留，不能根据声明的 Content-Type 强行扩展为任意格式。

目标 `generateImage()` 在 await 之后检查 signal，能阻止 Stop 后插入源码；但该 IPC payload 没有 requestId/取消信息，不能仅凭这段检查就声称后台 provider 请求已取消或不会计费。服务层需统一关联运行 ID/owner/AbortSignal；无法中止的 provider 也要禁止迟到写入并如实说明状态。

### 5.3 HTML 自有的 10 个附件/图片调用

以下不是另加十个业务引擎，而是统一“已授权资源 + 解析 + 资产写入”服务的十种目标协议投影。

| preload API / 通道 | 输入 → 输出 | 目标 main 事实与对接要求 |
|---|---|---|
| `pickAttachments` / `html:files-pick` | 无 → `AttachmentAddResult` 或 null | main:1523。原生多选；取消为 null。应把真正选中的文件登记给当前 owner。 |
| `addAttachmentPaths` / `html:files-add` | `string[]` → `AttachmentAddResult` | main:1538。目标仅过滤字符串再 stat；Friday 需验证拖放/选择来源，不接收模型任意路径。 |
| `addPastedImage` / `html:files-add-pasted-image` | ArrayBuffer/TypedArray 与 ext → `AttachmentAddResult` | main:1542。保存到临时目录后再检查 metadata；宿主应在写入前限制字节并绑定 owner。 |
| `readAttachment` / `html:files-read` | `path, offset, maxChars` → `AttachmentReadResult` | main:1552。文本分页，当前 clamp 单页至 48,000 字符，文字/Office/PDF 总文件预算 50 MiB；返回 ok/name/totalChars/offset/text 或 error。读取前重新核验授权与真实文件身份。 |
| `readAttachmentImage` / `html:files-read-image` | `path` → `{ok,base64?,mime?,error?}` | main:1581。PNG/JPEG/GIF/WebP 按扩展名识别，5 MiB 上限；必须在模型传输前按有效模型多模态能力和图片字节校验。 |
| `pickImage` / `html:pick-image` | 无 → 相对资产路径或 null | main:1597。需文档已有保存路径；由用户选择并复制到 owned assets。 |
| `saveImage` / `html:save-image` | `{base64,ext}` → 相对资产路径或 null | main:1613。用于粘贴/生成/抓取结果；PNG/JPG/JPEG/GIF 受保存路径约束。进入解码与写入前补总字节/数据完整性检查。 |
| `readImage` / `html:read-image` | 文档相对 src → `{base64,mime}` 或 null | main:1652。基于该 sender 的文档路径和相对资源解析，拒绝带 scheme 的 src；保留授权与文件替换检查。 |
| `fetchImage` / `html:fetch-image` | URL string → `{base64,mime}` 或 null | main:1670。当前只支持 HTTP(S)；受管理生成资产须通过独立受控解析能力接入。 |
| `aiGenerateImage` / `html:ai-generate-image` | `{prompt,aspectRatio?}` → `{url?,error?}` | main:1627。统一 provider 配置、能力、网络、取消与资产身份；不得由 renderer 上传真实 API key。 |

公共 metadata/result：

```ts
type AttachmentMeta = { path: string; name: string; ext: string; sizeBytes: number }
type AttachmentAddResult = { accepted: AttachmentMeta[]; rejected: string[] }
type AttachmentReadResult = {
  ok: boolean; name?: string; totalChars?: number; offset?: number; text?: string; error?: string
}
```

`collectAttachments()`、`filesRead` 和 `filesReadImage` 的当前目标实现未从 event.sender 查附件授权表；文档 `readFile()` 另有 `allowedByWc`，不能误把后者的保护外推给附件。应新增通用资源授权记录，内部使用 token/resourceId 与 actor/space/view 绑定，兼容目标路径型参数时在 adapter 层查回授权对象；关闭或撤销后失效，不允许跨窗口复用。

文本提取可以复用独立 `.852` `@genoffice/file-parse`，而不混用现有四编辑器的旧附件 bundle。需保持 PDF/Office parser 的完整依赖闭包，按运行负载确定 worker/超时/内存预算，并验证图片附件确实进入模型多模态请求；不能把“可读取 Base64”当成模型已经理解图片。

## 6. 最小通用服务与 runtime hook 方案（拟实施）

### 6.1 统一后端，保留上游协议投影

建议先建立进程级 `OfficeAiServiceRegistry`，登记明确服务描述：输入 schema、输出 schema、权限、可用条件、取消方式、敏感字段与目标协议投影。每个请求的上下文由宿主从 event.sender 推导，至少包含 `ownerWebContentsId / actor / space / documentId / revision / requestId / signal`；renderer 传来的 owner、路径、chatId 或能力布尔值都不能覆盖这些可信值。

推荐的领域服务组如下。名称是内部建议，不是现有 API 声明。

| 服务组 | 共用职责 | 目标通道投影 |
|---|---|---|
| `ai.configuration` | 主进程有效设置、公开模型选择、能力快照、提交与事件 | `ai:get-settings/set-settings/settings-changed/gsk-status` 及新增宿主能力查询 |
| `ai.inference` | 现有公共推理、流式工具、预算、usage、错误、owner 取消 | `ai:stream/stream-cancel/stream-chunk`、命名内部推理 |
| `skills.inventory/read` | 已安装技能目录、稳定标识、按授权读取与裁剪 | `ai:skills-list/skill-text` |
| `documents.naming` | 脱敏投影、命名提示/预算、stem 清洗 | `ai:suggest-file-name` |
| `search.web/images` | 真实 provider、显式配置、网络、取消与零结果/失败区分 | `ai:web-search/image-search` |
| `media.generate/assets` | 图片协议、受管理生成资产、获取与落地 | `html:ai-generate-image/fetch-image/save-image` 等 app adapter |
| `resources.attachments` | 选择/拖放/粘贴授权、限额、解析与生命周期 | `html:files-*` 与 `read-image` 等 |
| `documents.history` | 单一历史 store、所有权、冷启动、重绑定 | `project:*` |
| `host.navigation/preferences` | Friday 模型/技能设置路由、来源文档、OS drop、偏好广播 | 缺失导航通道及 `app:*` |

这样新增上游功能时，先为新功能选择现有服务合同或扩展领域服务，再声明目标 adapter。一次服务缺陷可覆盖多个应用和入口；不能把“Registry 中有名字”当成能力已可用，每项能力还要绑定真实 provider/资源/运行证据。

### 6.2 对 HTML 最小的通用扩展点

共享的 `ai:* / app:* / project:* / home:*` 应由 Friday 唯一注册；不得加载上游 shell `index.ts` 或调用 `startHtmlStandalone()` 来补 handler。HTML main 仍拥有其 `html:*` 文档操作，使用通用服务 hook 接入那些会绕过共享 bridge 的请求。

拟议配置形状：

```ts
configureHtmlRuntime({
  preloadPath, rendererFile, openGeneratedPath,
  hostServices: {
    // 宿主注入的、已绑定 owner 的领域接口；不是 renderer 的任意 invoke 代理。
    capabilities: context => officeServices.describe(context),
    attachments: officeServices.attachments,
    media: officeServices.media,
    assets: officeServices.assets,
  },
})
```

hook 实现必须在 main handler 得到真实 sender 后建立 context；`media` 内包括生成/取消，`assets` 内分别处理网络图、受管理生成图和文档资产，`attachments` 内维护授权再解析。共享配置/技能/命名/历史由唯一服务注册器转发，无需每个应用再创建一套 store。renderer 只暴露明确白名单方法，不能给不可信网页一个 `invoke(arbitraryCapability, arbitraryArgs)`。

该 hook 当前不在固定官方源码中。实施时应作为可追溯通用 adapter/overlay，记录固定上游 SHA、受影响原文件摘要、变更版本与 patch 摘要，并进入构建身份及回归；保持原始官方 checkout 可核验。不能直接修改 ignored 的官方源码后继续声称 clean 固定来源，也不能把无版本校验的广泛字符串替换当成长期集成合同。

兼容 standalone 的 fallback 可以保留，但 Friday 宿主已注入服务时必须全部使用统一服务；不能某条媒体路径悄悄回退到另一份 ai-settings.json。动态能力变化时，目标 UI 使用宿主公开快照；上游自身判定在 standalone 模式继续使用原始设置，避免牺牲功能对等或暴露密钥。

### 6.3 错误与任务语义

内部建议统一 `{ok,data?,error:{code,message,retryable?},requestId}`，但目标边界按 3–5 节逐通道投影：命名仍返回 ok/name/reason，搜索仍返回 method/results/images，附件仍返回其原有对象。无配置、真实零结果、禁用、用户取消、失败、超时、权限拒绝须不同；不要用 `[]`、`null`、void 或模型自己的话将它们混成成功。

异步任务至少区分请求、授权、执行、资源产生、文档应用、保存和失败/取消。图片已产生与已插入 HTML 不同，已插入与已保存不同；Stop 后未授权的迟到响应不得修改文档。付费生成不得因 UI 重试或断线而无界重复，按稳定 operation identity 做幂等或显式重新生成。

## 7. 可直接进入下一轮实施的工作包

| 编号 | 任务与最小交付 | 依赖 | 关闭证据 |
|---|---|---|---|
| AS00 | 冻结本台账的通道/shape，建立 schema 和目标投影，标记真实能力而非占位登录 | 固定 `.852` 来源 | 29 显式点 + 拖放 + 10 个 HTML 自有点全部有对应注册/事件责任人；shape 反例能被捕获 |
| AS01 | owner/context/取消与进程级唯一注册器 | AS00 | 跨窗口取消、重复 ID、已销毁 sender、未知服务、伪造身份均拒绝且不影响其他文档 |
| AS02 | 模型/搜索/媒体有效配置与公开能力快照，设置提交/事件 | AS01 | 主助手/HTML 显示与执行同一配置；不暴露 key；重开与切换生效；未配置明确失败 |
| AS03 | 技能目录/正文、设置导航和安全命名，复用 Friday 管理与公共推理 | AS01–02 | 技能选择注入当次请求；删技能/重名/路径穿越拒绝；脱敏命名与保留原名；真实设置入口可达 |
| AS04 | 真实 web/image search 与准确目标结果投影 | AS02 | 有结果、零结果、禁用、未配置、鉴权失败、超时/取消均不同；搜索结果实际被工具消费 |
| AS05 | HTML 媒体通用 hook、真实 provider、受管理生成资产读取/落地 | AS01–02、资源边界 | 配图产生→assets/inline→预览→保存→重开完整通过；停止/重试不重复插入；任意 file URL 拒绝 |
| AS06 | 统一附件授权、分页文本与多模态、资源撤销/清理 | AS01 | 真选择/拖放/粘贴、格式/大小、跨窗口读取拒绝、源被替换、取消/关闭、真实模型图片输入 |
| AS07 | 唯一历史 service 与来源/拖放路由，保留已有 Friday 聊天扩展 | AS01 | 只开 HTML 冷启动、重开历史、首次保存/另存为/重命名、两个标签与旧四编辑器回归 |
| AS08 | T05/T06 合同与真实模型/真实 UI/最终包验收 | AS03–07 | 固定源码/overlay/资源/包身份对应的逐项证据；所有未执行项仍保持待验证 |

AS03、AS04、AS05 可在 AS01/02 冻结后并行；涉及同一服务注册器的变更应由一个责任人维护，避免后注册覆盖前注册。能力查询、设置 getter、实际 provider 和 UI 投影必须一起验收，避免再出现“工具被显示但宿主未绑定”的问题。

建议先建立合同反例与 owner 边界，再接可复用服务。真实 API 凭据缺失时可使用受控本地服务验证协议、取消和错误，但报告必须标注 fixture；不能据此把联网、付费生成或真实模型功能写成已通过。最终应至少用一个有效搜索后端、一个有效图片后端和用户实际配置的聊天模型完成目标条件下的业务闭环。

## 8. 本轮必须保留的验收反例

| 类别 | 关键反例 / 必须断言 |
|---|---|
| 通道合同 | 每个 invoke 有 handler；getter shape 正确；搜索裸数组、错误对象缺 method、命名裸字符串均不能伪通过 |
| 冷启动 | 不开 Docs/PDF，仅打开 HTML；模型、技能、命名、history 和导航正常，历史失败不能被静默吞掉后判成功 |
| 配置/能力 | 聊天可用但媒体无配置；真实 Genspark 未登录；搜索关闭；更换模型后能力及时更新；任何状态都不能由占位登录推导 |
| 流式 | 分片/并行 tool-call、reasoning、usage、max-token 截断、超时、断网、Stop、重复 ID、跨 sender 取消与关闭后响应 |
| 技能/命名 | 不存在/刚删除/重名技能、伪路径/链接越界、超大正文；秘密投影不进命名请求；空名/非法设备名/模型拒绝保留当前名称 |
| 搜索 | 有结果、确实零结果、provider 错误、禁用、鉴权失败、限流、超时、取消；图片结果可抓取并进入文档 |
| 生成图 | 有效 HTTP 图与 BYOK file URL 图分别测试；缓存删除后文档已保存图片仍完整；未保存文档 inline；Save As 和移动资源可携带 |
| 资源授权 | 任意 file URL、私网/重定向目标、跨 view 附件、路径穿越、链接/文件替换、MIME 伪装与超大 Base64 均受控拒绝 |
| 附件/多模态 | 真 OS 选择/拖放/粘贴与伪造路径分开；分页内容准确；图片送入真实支持视觉的模型；不支持视觉的模型明确反馈 |
| 会话/路由 | 两文档/两空间互不读写；首次落盘和重命名保持正确历史；AI 来源链接与 OS drop 分别授权；既有四编辑器聊天与路由回归 |
| 打包 | 同一最终包无源码运行，服务/技能/parser/媒体资源实际可达；记录模型/provider、配置标识、脱敏 trace、样本与文件 hash |

## 9. 证据索引与后续记录规则

- 固定上游：`apps/html/src/preload/index.ts`、`src/shared/ipc.ts`、`src/main/html-main.ts`、`src/renderer/ai/AiPanel.tsx`、`src/renderer/ai/tools.ts`、`src/renderer/file-naming.ts`。
- 通用目标服务：`packages/ai-provider/src/types.ts`、`src/media.ts`、`src/media-protocols.ts`；`packages/ai-search/src/index.ts`、`src/search-tools.ts`、`src/media-tools.ts`；`packages/electron-utils/src/generated-images.ts`；`packages/project-store/src/ipc.ts`、`src/types.ts`。
- 上游 shell 合同参考：`apps/shell/src/main/user-cli.ts`、`ai-naming-service.ts`、`ai-naming.ts`。它们用于提取合同和纯函数，不用于在 Friday 中启动第二个 shell。
- Friday 可复用边界：`src-electron/office/office-ai-bridge.js`、`ai-inference-adapter.js`、`canonical-transcript.js`、`tool-call-stream.js`、`office-host.js`、`file-commands.js`；`src-electron/agent/tools/builtin/aiChat.js`、`searchAll.js`、`webpageScraper.js`；`src-electron/agent/skills.js`、`ipc.js`。
- 新增来源获取证明：`scripts/tests/office-html-upstream.test.mjs` 的 24 项通过结果。其证明范围仅为固定来源，不外推为 T05/T06、HTML-01～12 或安装验收完成。

实施后在本篇新增“变更后的服务合同与运行证据”或另建实施账本，逐项记录已采用的服务 API、overlay、源码摘要、实际 provider/配置标识、命令与运行报告。若代码在本轮并行工作中已经变化，应更新对应观察和证据，不把本次静态缺口描述冒充新的运行结果。
