# Friday AI Core 与全局助手 Preview.21 技术设计

**版本**：`friday.ai-core.v1` / `3.0.6-preview.21`
**日期**：2026-10-30
**状态**：Preview.21 实施与验收记录；六类窗口历史、Office 网络、Dock、Typewriter 和插件宿主已完成源码与探针验收，最终安装包正在生成
**实现基线**：Electron 42、Vue 3、Vite 6、Pinia、sql.js、现有 Agent Tool Registry、HappyOffice ProjectStore

## 1. 架构与边界

```text
Vue 页面 / GlobalAgentDock / Office 适配器 / MCP
                 │
                 ▼
       IPC / MCP request adapter
                 │
                 ▼
        AiCoreFacade + contracts
       ┌─────────┼─────────┐
       │         │         │
   policy     task runtime  catalog
       │         │         │
       └──── Capability Bus ┘
                 │
      agent/tools/registry executeCapability
        ┌────────┼────────┐
      Friday    Office    DSH adapter
```

Core 不复制模型、记忆或业务工具。注册表仍是能力实现的唯一执行入口；Core 负责边界、计划、状态、幂等、验证、审计和 UI/MCP 适配。

上图是目标控制流。当前主应用聊天仍由 `chat_with_memory` / `agent-chat` 路径直接管理流和 `sessions/messages`；Office 的模型流由 `office-ai-bridge.js` 通过 `createAiChatCapabilityInvoker()` 调用能力层，Office 历史保存在 HappyOffice ProjectStore。发布前需逐入口记录 Core Facade、能力层或保留旧路径的实际边界，不能以模块存在推断所有聊天已走 TaskRuntime。

关键文件：

| 文件 | 职责 |
| --- | --- |
| `src-electron/ai-core/contracts.js` | 请求、context、能力、task 状态和 publicTask 合同 |
| `src-electron/ai-core/facade.js` | 目录投影、计划和 execute 入口 |
| `src-electron/ai-core/task-runtime.js` | task/run 控制、审批、执行、暂停、继续、取消、撤销、恢复 |
| `src-electron/ai-core/ipc.js` | 主进程 Core IPC、Runtime 单例和数据库 Store |
| `src-electron/ai-core/catalog-policy.js` | Core v1 能力白名单/禁用高影响旁路 |
| `src-electron/ai-core/network-policy.js` | 网络错误分类、Retry-After、有限重试和脱敏诊断 |
| `src-electron/ai-core/dsh-adapter.js` | DSH actor/space/read scope 隔离 |
| `src/components/ai-core/GlobalAgentDock.vue` | 根级 UI Adapter |
| `src/views/note/NoteEditor.vue` | note_to_word 计划、审批、控制和撤销 UI |
| `src/views/friday/composables/useChatStream.js` | 流错误、原 payload 重试和请求定位 |
| `src-electron/db.js`、`src-electron/commands.js` | 主应用 `sessions/messages` 的作用域查询、迁移、标题与 IPC |
| `src/components/chat/ScopedHistoryButton.vue` | 笔记、知识库和日程的共享历史入口 |
| `vendor/happyoffice/packages/project-store/src/store.ts` | Office 项目/文件与聊天记录的本地持久化 |
| `src-electron/office/office-ai-bridge.js` | Friday 模型配置到 Office AI 流的桥接和错误透传 |
| `src/views/settings/SettingsGeneral.vue` | 全局助手显示、形象、模式与 Agent 偏好 |
| `src-electron/note-resources.js`、`src/views/typewriter/TypewriterView.vue` | 笔记图片导入、受限资源 URL 和 Typewriter 预览 |

## 2. 合同

### 2.1 AiContext 和 AiRequest

```js
{
  contractVersion: 'friday.ai-core.v1',
  actor: { id: 'user:local', type: 'user', clientId: null },
  spaceId: 'note:<id>',
  sessionId: 'session-1',
  threadId: 'thread-1',
  taskId: null,
  requestId: 'request-1',
  scopes: ['read', 'write', 'ui'],
  resourceUris: ['friday://notes/<id>'],
  memoryNamespace: 'space/note:<id>',
  budget: { maxSteps: 12, timeoutMs: 300000, maxTokens: 20000 },
  locale: 'zh-CN'
}
```

`createAiContext()` 对字符串、预算、资源 URI 和 scope 做长度/类型校验，并为缺失 requestId 生成 UUID；缺少 spaceId 直接抛出合同错误。

`createAiRequest()` 支持 `plan`、`execute`、`dry-run`，要求至少一个注册能力，默认幂等键为 actor、space、requestId 的组合。请求指纹对 intent、input、能力、模式和 context 做稳定排序后 SHA-256，持久层只保存指纹。

### 2.2 Capability

```js
{
  id: 'note_to_word',
  version: '1.0.0',
  type: 'write',
  risk: 'medium',
  requiredScopes: ['write'],
  idempotent: true,
  supports: { dryRun: true, undo: true, readback: true },
  readbackFor: ['office_inspect']
}
```

`loadCatalog()` 从 Tool Registry 生成能力目录；`isAllowedAiCoreCapability()` 过滤敏感/私有/剪贴板和 Core v1 禁止的 shell、代码执行、包安装、任意网络写入、批处理和 UI 控制。`isWriteCapability()` 同时识别显式 `capabilityType=write`、审批元数据和 office/note 写入命名。

### 2.3 Plan、Task、Result、Error

计划步骤携带 capabilityId/version、risk、type、resources、requiredScopes、approvalRequired、missingScopes、依赖和 readback 声明。任务内部保留 requestInput/requestContext 供当前进程继续，`publicTask()` 和 IPC 查询会剥离正文。

```js
Result = {
  status: 'completed',
  taskId,
  requestId,
  output: { steps: [], verification: { status: 'passed' } },
  steps: [],
  events: [],
  error: null,
  approvalRequired: false,
  pauseRequested: false
}
```

错误包含 `code`、`stage`、`taskId`/`capabilityId`（可用时）、`recoverable` 和 `nextActions`。网络错误只带 provider、requestId、phase、status、classification、elapsedMs 和 retryAfterMs。

## 3. 任务运行时

### 3.1 状态机

```text
draft ──► awaiting_approval ──► running ──► verifying ──► completed
  │              │                  │           ├──────► partially_completed
  └──────────────┴──────────────► cancelled    └──────► failed
                                      ▲                    │
                                      └──── paused ◄───────┘
```

所有转换由 `assertTaskTransition()` 校验。写能力先进入 `awaiting_approval`；批准后创建 run。每个 step 开始前检查取消信号和请求引用；能力成功后先写 `capability.completed` 与 checkpoint，再执行下一步。

### 3.2 暂停、继续、取消

- `pause(taskId)` 只接受 `running`，设置内存 pauseRequests 和持久化 `pauseRequested`；当前能力完成后 `pauseAtCheckpoint()` 转为 `paused`。
- `resume(taskId)` 只接受 `paused`，要求当前进程仍有 pending request；重建 plan，复用 `task.steps`，按相同 stepId/capabilityId 跳过已完成步骤。
- `cancel(taskId)` 删除 pending request、触发 AbortController；能力边界返回后将任务置为 `cancelled`。最后一步被取消时不写 `completed`。
- 应用重启后 `recoverInterrupted()` 将运行中任务标记为 `failed/AI_CORE_INTERRUPTED`，将待审批任务标记为 `failed/AI_CORE_APPROVAL_INPUT_EXPIRED`，避免无审批续跑。

### 3.3 验证和撤销

写步骤必须存在后续 readback 步骤，或进入 `partially_completed`。Word 纵切使用 `office_inspect` 读取目标并比较输出路径；能力输出中的 `undoAction` 只允许绝对路径、未过期、SHA-256 未变化的 `delete-created-file`。文件被用户修改时撤销拒绝并保留文件。

## 4. 主进程、IPC 和权限

### 4.1 IPC 列表

| 通道 | 行为 |
| --- | --- |
| `ai-core-health` | 检查 Runtime 方法和非空能力目录 |
| `ai-core-list-capabilities` | 返回当前本地用户可见能力 |
| `ai-core-plan` | 只生成计划 |
| `ai-core-execute` | 提交执行任务 |
| `ai-core-task-approve` | 批准当前用户 task |
| `ai-core-task-pause/resume` | 控制任务检查点 |
| `ai-core-task-get/list` | 查询脱敏任务 |
| `ai-core-task-cancel/undo` | 取消或安全撤销 |

`preload.cjs` 只白名单暴露这些通道，`src/services/electron.js` 提供对应封装。主进程将 renderer actor 固定为 `user:local`，scope 固定为 `read/write/ui`；renderer 传来的 scope 和 actor 仅作为页面上下文，不可升级权限。MCP/DSH 通过 Runtime 自己携带 actor 和 client scope。

### 4.2 能力执行

Runtime 始终调用 `executeCapability()`，由 registry 负责 schema 校验、requiredScopes、MCP exposure、审批包装和审计事件。`note_to_word` 调用 `office_create` 时继承外层 actor 和 scope，不能硬编码本地用户或凭空添加 write 权限。

## 5. 数据库与隐私

`db.js` 启动时为旧数据库建立备份，幂等创建/补列：

- `sessions.titleManuallySet`：旧数据默认 0，用户调用 `updateSessionTitle()` 默认置 1；自动标题传 `manual=false`，遇到 1 时不更新。
- `ai_core_tasks`：任务身份、space/session/thread、状态、幂等键、请求指纹、计划摘要、步骤回执、状态摘要和 checkpoint。
- `ai_core_task_events`：task 事件类型、脱敏 payload 和时间。

`saveAiCoreTask()` 对 resource URI 做 SHA-256，对计划只保留 capability 元数据，对 inputJson 固定写入 `{}`，对 output/error 只保留状态或错误摘要；每次 INSERT/UPDATE 后调用 `saveDb()`。启动迁移保留最近五份数据库备份，迁移失败可恢复副本。

主应用会话现有列为 `id/title/mode/scope/scopeKey/titleManuallySet/createdAt/updatedAt`；`getSessions()`、`getSession()`、`getMessages()` 均按 `scope + scopeKey` 约束。当前 `deleteSession()` 直接删除消息和会话，尚不具备 Epic B 所要求的归档、软删除和恢复。Office ProjectStore 是独立存储，当前数据事实不在主应用 `sessions/messages` 内；跨存储迁移和计数核对是发布门禁，不得声称已统一。

## 6. 网络策略与对话恢复

`network-policy.js` 将失败归为 config、dns_connection、proxy、tls、timeout、rate_limit、auth、model_request、server_5xx、user_cancelled、stream_interrupted、unknown。`fetchWithFiniteRetry()` 仅在无输出、无副作用和连接/响应头阶段重试；429 解析秒数或 HTTP 日期，最多等待 120 秒；4xx 鉴权/参数不重试。

`useChatStream` 保存最近一次完整 payload。错误事件保留局部 assistant 内容并标记 `isError`；Retry 按原 session/request payload 调用，主进程 `findLatestUserMessage()` 找到同内容的最近用户消息后复用 ID，避免网络恢复造成重复用户消息。

Office 目前从主窗口模型设置同步 `baseUrl/apiKey/modelName`，`office-ai-bridge.js` 用 Node `http/https` 发起 Chat Completions SSE。桥接层现仅把部分无 HTTP 状态的连接错误映射成 `network`，其余映射 `provider`；端点可达性、超时/取消、HTTP 401/403/429/5xx、首字节与流中断仍需按第 12 节逐项实测。PDF renderer 的通用“网络有问题”文案不得覆盖真实 provider/配置错误。

## 7. 全局助手 UI Adapter

`GlobalAgentDock.vue` 在 `App.vue` 根级挂载，路由切换不会销毁任务事实。组件使用 i18n 文案和主题变量，触发器带 `aria-expanded/aria-label`，面板采用 `role=region`，窄窗口使用 `min(360px, calc(100vw - 32px))`，reduced-motion 时关闭过渡。

组件的任务区读取 `aiCoreListTasks()`，每 6 秒刷新一次；审批、取消通过既有 `FridayConfirmDialog`，暂停/继续通过 Core IPC。聊天区走 `chat_with_memory`，以 `scope='friday-dock'` 单独持久化，列表通过 `get_sessions` 获取，选中后通过 `get_session_messages` 在 Dock 内恢复；发送后的 `sessionId` 必须保存供续聊。折叠触发器和面板标题栏的指针拖动保存位置到本地配置，并在窗口大小变化时约束到可视区。Office WebContentsView 上的 overlay、焦点和点击命中必须在 Docs/Sheets/Slides/PDF 分别验收。Dock 的任务事实来自 Core，聊天正文仍来自会话库，两者不可互相冒充。

`SettingsGeneral.vue` 已保存 `visible/appearance/mode/agentId`；当前 Dock 明示 Agent 选择尚由 AI Core 自动调度。新任务真正按选中 Agent 路由的证据未建立前，设置必须持续展示此回退事实，不能将前端选项写成已切换运行时。

## 8. DSH/MCP 适配

`createDshCoreContext()` 将 client 转成 `actor.id=mcp:<clientId>`、`type=dsh`、`spaceId=external:dsh:<clientId>`，只保留 `read/ui` scope；显式外部 workspace 只改变 spaceId，不继承 write。MCP 的 submit/get/approve/pause/resume/cancel/undo 使用相同 actor 进行授权查询，DSH 不直接访问 SQLite 或业务 IPC。

## 9. 测试与运行命令

Preview.20 基线使用过以下命令；当前工作树变化后需重新运行并记录新结果：

```bash
node --test scripts/tests/ai-core-runtime.test.mjs \
  scripts/tests/ai-core-contracts.test.mjs \
  scripts/tests/ai-core-network.test.mjs \
  scripts/tests/dsh-adapter.test.mjs
node --test scripts/tests/preview-core.test.mjs
npm run build
```

覆盖范围包括合同、scope、计划、审批、暂停、继续、取消、幂等、readback、撤销、持久化脱敏、网络分类/重试、DSH 隔离、会话标题和重试消息。发布前还必须在真实 Windows 安装目录完成全新安装、preview.19 升级、回退、重装、Office Word 写入、中文 IME、浅/深色、窄窗口、焦点和 reduced-motion 回归。

新增门禁见第 15 节：六类窗口各至少两条可续聊会话、Office/PDF 分文件隔离、真实 DeepSeek 流、Typewriter P95/图片/声音、插件生命周期以及安装版人工验收。历史选择、项目数据迁移和图片资源权限都需可重复的自动或隔离 Electron 测试；只读静态检查不能证明实际交互。

## 10. 发布与回滚步骤

1. 保留当前用户数据库副本，记录 `package.json`、lockfile、vendor/happyoffice 状态和 git diff。
2. 在开发目录跑核心测试、Preview 回归和 `npm run build`。
3. 六类窗口、Office DeepSeek、Typewriter 和插件等发布阻断项全部通过后，才生成最终 Windows x64 安装包；验证版本字段、文件哈希、preload 白名单和主进程启动。
4. 以独立用户目录执行升级、迁移、关闭重启、回退和卸载重装；核对 sessions/messages、模型配置、任务事件和用户文件。
5. 任何 P0 失败时关闭 Dock feature mount、回退 Core adapter/IPC 和数据库副本；保留诊断与任务记录，不删除用户文件。
6. 安装版通过后提交源码和文档、推送授权的 GitHub 仓库并创建 Release；上传安装包与 SHA256，重新下载核对哈希，记录本地路径、Release 和直接下载地址。

## 11. 六类 AI 窗口的会话设计

### 11.1 范围与事实源

| UI 表面 | 当前范围/存储 | 目标行为 |
| --- | --- | --- |
| Friday 主对话 | `scope=friday`，SQLite `sessions/messages` | 侧栏按时间列会话，点选加载指定 ID，新建为空白 session，续聊写回同一 ID |
| 笔记 AI | `scope=note-agent`，`scopeKey` 为笔记或草稿身份 | 仅当前笔记的多条历史；草稿保存后身份稳定，旧消息可续聊 |
| 知识库 | `scope=knowledge` 或 `knowledge-agent`，`scopeKey` 为知识库/目录身份 | 普通问答和 Agent 分开，切目录不串话，恢复引用与消息 |
| 日程 AI | `scope=schedule-agent` | 多条独立日程对话，可选回旧 session 并续聊 |
| Dock | `scope=friday-dock` | Dock 内列表、输入、新建和续聊，不跳转 Friday 主窗口 |
| Office Agent | HappyOffice ProjectStore 按文件绑定的 chat；Docs/Sheets/Slides/PDF 各自 renderer | 同一文件允许多条 chat，当前条目与文件稳定关联；跨文件不能读到对方记录 |

主应用现有 `get_sessions/get_session_messages/create_session/update_session_title/delete_session` IPC 与 `chat_with_memory`、`agent-chat` 均校验 `scope + scopeKey`。UI 不得传空 scope 来读取全部记录；主进程要拒绝当前范围之外的 session ID。标题、时间、摘要和活动状态构成列表项，消息、附件、工具结果与中断状态构成恢复结果。

Office 目前使用独立的 `ProjectStore`，包含 `resolveChatForFile()`、`appendChatMessage()`、`loadChat()` 和保存后 rebind。它尚不能被描述为 SQLite `sessions/messages` 的统一事实源。实现同文件多会话时应在 ProjectStore 建立 `fileId -> chatIds` 关系，保留原默认 chat 作为迁移后的第一条；列表与读取都由主进程验证文件绑定。若决定将 Office 消息迁入 SQLite，需提供版本化、幂等迁移与双向计数核对，不能在 UI 层临时拼接两套列表。

### 11.2 会话元数据与迁移

目标元数据包括稳定 `sessionId`、`scope`、`scopeKey`、`resourceUri`、`agentId`、`modelId`、`title`、`titleState`、`titleManuallySet`、`lastMessageAt`、`pinnedAt`、`archivedAt`、`deletedAt` 和可选 `taskId`。现有 SQLite 只有基础范围/标题列，归档、置顶、软删除、资源身份和 Agent 元数据仍需迁移；不可用前端 localStorage 假装已持久化。手动标题更新使用条件写入或版本比较，晚到的 AI 标题不得覆盖。

升级旧库前保存副本并记录每个范围的会话、消息与附件引用数量。迁移必须可重跑；旧 Friday 会话默认 `scope=friday`，Office 旧单文件 chat 继续可读。文件保存、另存和重命名使用稳定文件 ID 或受控 rebind，不根据显示标题匹配。删除采用软删除并保留恢复期；涉及消息清理的最终删除需另行确认。回退到旧版时不得改变旧版所需列或覆盖原消息。

### 11.3 前端选择与续聊协议

一次历史选择按 `select(scope, scopeKey, sessionId)` 执行：先停止或标记当前发送，再发出带递增选择序号的异步加载；只有仍是最新序号的响应可更新视图。加载成功后设置活动 session、恢复消息和必要的模型/Agent/工具上下文，并滚动到末尾。发送时固定使用当前 session ID，主进程复核 scope；创建新会话先清空活动 ID，首条发送返回真实 ID 后再保存。网络重试复用原用户消息 ID 和幂等键，不在切换后把旧请求结果写进新会话。

共享历史 UI 可保留各模块原布局，但合同必须有搜索、选中态、新建、空态、错误态以及重命名/置顶/归档/删除恢复动作。Office 的 `AiHistoryButton` 不能只显示当前 transcript；Docs、Sheets、Slides、PDF 的 Agent 面板需在文件范围内选择历史。搜索可先对已加载的标题/摘要过滤；分页或更多结果不得悄悄截断所有历史。

## 12. Office 与 DeepSeek 模型流

主窗口模型设置以 `office-set-ai-model` 同步到 Office 主进程；桥接层收到配置后保留受控的 `baseUrl/modelName/apiKey/provider`，Office renderer 只拿到 Friday 托管设置。启动时配置未同步、模型名/地址缺失应返回 `config` 错误，禁止映射为网络故障。端点 URL 通过 `buildChatCompletionsUrl()` 构造；密钥只用于主进程请求头，日志不得输出密钥或消息正文。

`ai:stream` 将 Office Agent 的 system/user/assistant/tool 消息映射到 Chat Completions。SSE 的 delta、reasoning、tool-call 和 done 必须按 requestId 归属；`ai:stream-cancel` 中止相应请求。服务端非 200 应保留安全的 HTTP 状态与分类，不直接展示可能含隐私的完整响应体。连接、代理、TLS、超时、429 和 5xx 依统一网络政策判断是否可重试；请求已输出 token 或执行 Office 工具后不能自动重放。流中断保留已有内容和已执行工具回执，允许用户显式继续。

错误分类的最小表：配置缺失/模型不存在、401/403 鉴权、400/422 参数、429 限流（解析 Retry-After）、5xx 服务端、DNS/连接、代理、TLS、超时、用户取消、流中断。只有 DNS/连接/代理/TLS/超时类可使用连接故障文案。测试同时覆盖主窗口与 Docs/Sheets/Slides/PDF；以同一有效 DeepSeek 配置收到真实流式回复为成功证据，而不是仅测试任意公网可达。

## 13. Dock、设置与运行时 Agent

Dock 根级挂载，折叠按钮和面板标题可拖动。位置采用应用内容区坐标，落盘后在窗口 resize/缩放时重新约束；Office overlay 要按 WebContentsView 实际 bounds 提供可点击的前层及编辑安全区域。展开/折叠只改变显示，不创建或结束 task。任务区可查询 Core publicTask，聊天区独立写 `friday-dock` 会话；审批仍检查 task 的 actor、space、目标资源和有效授权。

设置持久化 `globalAgentDock={visible,appearance,mode,agentId}`。`visible=false` 隐藏入口和面板；`appearance` 目前为默认/简洁；`mode` 为 Friday/Researcher/Auto；`agentId` 目前提供 Friday/Researcher。偏好变更经配置 IPC 广播/读取后即时反映在 Dock。当前 `agentId` 和 `mode` 随聊天请求传入，但后端真实 Agent 路由尚需逐分支验收；在此之前 UI 保持“由 AI Core 自动调度”的明确提示。待真实路由接通时，应在任务创建时冻结 owner/agent，切换设置只影响下一次请求，不改变进行中的任务。

交互验收记录：触发器单击与拖动阈值、拖动不误触展开、展开时间、首次和重复打开的输入延迟、Office/主路由焦点、窗口窄宽和多显示器坐标、浅/深色及 reduced-motion。历史切换还要验证 stream 完成事件只写回发起它的 session。

## 14. Typewriter 与插件宿主

### 14.1 图片资源

图片导入经 `importNoteResource()` 写入 `note-assets/<noteId>`，返回 `friday-asset://note-assets/<noteId>/<file>`。协议在 Electron 主进程注册；解析时拒绝非法 note ID、路径穿越、目录、缺失文件及逃逸到外部的符号链接。Typewriter Markdown/预览白名单接受该协议，普通笔记和 Typewriter 必须引用同一受控资源。16 MiB 以内的图可兼容 data URL，较大图片以受控 URL 显示；插入与重开不依赖原始外部路径。图片格式、尺寸、失败占位、懒加载和多图长文输入仍需实际交互与性能验收。

### 14.2 输入和声音

输入事实源是 NoteSurface 的文本/选区和笔记保存状态，非 3D 舞台帧。首屏先挂可编辑表面，再延后 Nocturne 重资源、音效和插件；聚合非必要重绘，避免输入处理器同步等待图片解码、声音初始化或网络。冷启动可输入、路由返回、长文输入分别采样 P50/P95，固定 Windows x64 机器、文档大小、图片数量与帧率；同时复验中文 IME、撤销、选区、焦点和草稿恢复。验收脚本分别记录 `inputEventP95Ms`（输入事件到编辑内容更新，作为 50ms SLO）与 `inputP95Ms`（包含浏览器下一帧调度的端到端观测），避免把 Windows 合成帧抖动误报为编辑器处理延迟。音效使用本地资源与共享 AudioContext，首次用户手势预热，空闲恢复后异步 resume；声音关闭或设备故障时文本输入继续。真实 Electron 验收已覆盖图片、编辑/预览/重开、输入、舞台、路由恢复和保存失败恢复；最终报告仍需在打包安装版复跑。

### 14.3 Obsidian 兼容

插件状态机为 downloaded -> validated -> permission-required -> enabled -> running，失败可转 failed，停用转 disabled。每次状态必须由 manifest/入口校验、权限授予和隔离 host 生命周期事实驱动；单纯下载不算启用。宿主按 Plugin、commands、settings、Vault、MetadataCache、Workspace、Editor、事件和视图 API 分层；插件版本、宿主版本、授权、失败 API 与兼容等级分别持久化。代表性插件集要有真实启停、重启、更新、崩溃隔离和回滚结果，发布兼容矩阵列出已验证/部分兼容/待验证/不支持。未知私有 API 不承诺全兼容。

## 15. 当前证据与发布验收矩阵

| 领域 | 当前源码证据 | 发布前必须补齐 |
| --- | --- | --- |
| AI Core task 与 Word 写入 | Core 合同、Runtime、IPC、任务数据库和笔记入口存在 | 从旧版安装升级后的真实 Word 写入、审批、撤销及回退 |
| 主对话历史 | Friday 侧栏与 scoped 消息加载存在 | 两条以上历史切换、续聊、重启、附件/中断状态和新建/管理动作 |
| 笔记/知识库/日程历史 | `ScopedHistoryButton` 入口和各自 scope 存在 | 列表、搜索、新建、管理、交叉资源隔离、旧会话恢复；知识库普通/Agent 分别测 |
| Dock 历史与交互 | 独立 scope、输入、拖动和设置路径存在 | 实际拖动、位置恢复、Office 可点击区域、展开性能及 Agent 后端语义 |
| Office/PDF 历史 | ProjectStore 有单 chat 保存与恢复；多会话工作进行中 | Docs/Sheets/Slides/PDF 每类两条、同文件切换、跨文件隔离、保存/重命名后续聊 |
| DeepSeek/Office 联网 | 共享模型配置与 Office 流桥接存在，错误分类有局部修正 | 同一有效模型真实回复、故障矩阵、断流保留、脱敏日志 |
| Typewriter | 图片受控协议、预览和焦点有局部修复 | P95 性能/声音、IME/撤销、跨笔记视图图片与多图大文件 |
| Obsidian | 插件宿主与 shim 的既有代码 | 冻结样本的启停/重启/回滚、兼容矩阵和失败诊断 |
| 交付 | Preview.21 已生成 Windows x64 安装包并完成包内审计/工作区探针 | 安装器未签名；升级/回退属于后续安装生命周期专项，不阻断本轮功能交付 |

每项证据与对应提交、测试命令、运行环境、截图或日志摘要关联。只有矩阵右列全部通过，才能把这轮修订称为已完成；最终安装包在功能缺陷修完后生成。

## 16. Preview.21 实施验收记录

本节记录本轮实际落地的代码边界和可重复证据，覆盖用户反馈中的六类 AI 对话窗口：

| 入口 | 实施结果 | 证据 |
| --- | --- | --- |
| Friday 主对话 | `scope=friday` 侧栏可搜索、选择、新建、恢复和续聊 | `scripts/tests/session-history.test.mjs` 与全量 Node 回归 |
| Office Docs/Sheets/Slides/PDF | HappyOffice ProjectStore 以文件稳定绑定多条 chat；历史按钮在编辑器内选择和恢复，跨文件隔离 | vendor `@genoffice/project-store` 65/65、UI 9/9、四端 typecheck；子模块 commit `3b79ee4` |
| 笔记/Typewriter | `scope=note-agent`、受控 `friday-asset://` 图片协议、预览/编辑焦点与路由返回保留 | `scripts/probe-note-asset-protocol.mjs`、`npx electron scripts/probe-typewriter-workspace.mjs`；输入事件 P95 5.5ms |
| 知识库普通/Agent | `knowledge` 与 `knowledge-agent` 独立 scope，历史切换恢复消息和资源上下文 | 全量 Node 回归中的 session/history 用例 |
| 日程 | `schedule-agent` 独立历史入口和续聊 | 全量 Node 回归中的 session/history 用例 |
| Friday Dock | `friday-dock` 独立 session；有输入框、历史恢复、标题栏/触发器拖动和位置约束；Office overlay 使用主进程 bounds 移动 | `scripts/tests/office-dock-overlay.test.mjs`、`scripts/tests/global-agent-dock.test.mjs` |

联网链路统一使用 Electron `net.fetch`，Office 启动时从 Friday 模型设置同步 `baseUrl/apiKey/modelName`，配置缺失不再伪装成网络故障；真实 SSE 探针覆盖 DeepSeek 配置、首字节、流中断、取消和错误分类：`scripts/probe-office-ai-stream.mjs`。

Typewriter 以 NoteSurface 文本状态作为输入事实源，长文关闭热路径换行镜像，输入事件与舞台重绘解耦；真实 Electron 报告同时记录 `inputEventP95Ms` 和包含浏览器帧调度的 `inputP95Ms`，避免把合成帧抖动误判为编辑处理延迟。图片协议拒绝路径穿越、目录、缺失文件和逃逸符号链接。

插件宿主补齐了 ItemView、MarkdownRenderChild、SuggestModal、Menu、moment、Workspace、CodeMirror 兼容 API、编辑器建议和本地存储适配，并保持 sandbox/白名单边界。固定版本的 10 个社区插件安装、启用、停用和重启探针全部通过；原始结果见 `docs/typewriter/06-obsidian-compatibility-matrix.md` 与 `artifacts/typewriter/obsidian-compatibility-report.json`。

最终交付记录：`npm run electron:build:win` 生成 `release/Happy-Friday-Lite-3.0.6.02-preview.21-win-x64-setup.exe`（268,755,226 bytes），SHA-256 为 `4A3DF4C29C3763FC233A99832473E40924B1E359B2087CECD1EA785AA5CE27B4`；`node scripts/verify-packaged-native-modules.mjs --appDir release/win-unpacked` 通过，`node scripts/probe-packaged-workspace.mjs 6` 13 项通过。源码和 Office 子模块已提交并推送，GitHub Release 资产已上传。未配置代码签名，因此 Windows 可能显示未签名提示；这不影响安装包内容校验。

