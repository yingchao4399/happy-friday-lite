# Friday AI Core 与全局助手 Preview.20 技术设计

**版本**：`friday.ai-core.v1` / `3.0.6-preview.20`  
**日期**：2026-10-29  
**实现基线**：Electron 42、Vue 3、Vite 6、Pinia、sql.js、现有 Agent Tool Registry

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

## 6. 网络策略与对话恢复

`network-policy.js` 将失败归为 config、dns_connection、proxy、tls、timeout、rate_limit、auth、model_request、server_5xx、user_cancelled、stream_interrupted、unknown。`fetchWithFiniteRetry()` 仅在无输出、无副作用和连接/响应头阶段重试；429 解析秒数或 HTTP 日期，最多等待 120 秒；4xx 鉴权/参数不重试。

`useChatStream` 保存最近一次完整 payload。错误事件保留局部 assistant 内容并标记 `isError`；Retry 按原 session/request payload 调用，主进程 `findLatestUserMessage()` 找到同内容的最近用户消息后复用 ID，避免网络恢复造成重复用户消息。

## 7. 全局助手 UI Adapter

`GlobalAgentDock.vue` 在 `App.vue` 根级挂载，路由切换不会销毁任务事实。组件使用 i18n 文案和主题变量，触发器带 `aria-expanded/aria-label`，面板采用 `role=region`，窄窗口使用 `min(360px, calc(100vw - 32px))`，reduced-motion 时关闭过渡。

组件只读取 `aiCoreListTasks()`，每 6 秒刷新一次；审批、取消通过既有 `FridayConfirmDialog`，暂停/继续通过 Core IPC。它不监听鼠标全局事件、不改变 Office view bounds、不保存业务正文。错误只显示本地化摘要，详细事实仍由 task 查询和事件记录承载。

## 8. DSH/MCP 适配

`createDshCoreContext()` 将 client 转成 `actor.id=mcp:<clientId>`、`type=dsh`、`spaceId=external:dsh:<clientId>`，只保留 `read/ui` scope；显式外部 workspace 只改变 spaceId，不继承 write。MCP 的 submit/get/approve/pause/resume/cancel/undo 使用相同 actor 进行授权查询，DSH 不直接访问 SQLite 或业务 IPC。

## 9. 测试与运行命令

当前已验证：

```bash
node --test scripts/tests/ai-core-runtime.test.mjs \
  scripts/tests/ai-core-contracts.test.mjs \
  scripts/tests/ai-core-network.test.mjs \
  scripts/tests/dsh-adapter.test.mjs
node --test scripts/tests/preview-core.test.mjs
npm run build
```

覆盖范围包括合同、scope、计划、审批、暂停、继续、取消、幂等、readback、撤销、持久化脱敏、网络分类/重试、DSH 隔离、会话标题和重试消息。发布前还必须在真实 Windows 安装目录完成全新安装、preview.19 升级、回退、重装、Office Word 写入、中文 IME、浅/深色、窄窗口、焦点和 reduced-motion 回归。

## 10. 发布与回滚步骤

1. 保留当前用户数据库副本，记录 `package.json`、lockfile、vendor/happyoffice 状态和 git diff。
2. 在开发目录跑核心测试、Preview 回归和 `npm run build`。
3. 生成 Windows x64 安装包后验证版本字段、文件哈希、preload 白名单和主进程启动。
4. 以独立用户目录执行升级、迁移、关闭重启、回退和卸载重装；核对 sessions/messages、模型配置、任务事件和用户文件。
5. 任何 P0 失败时关闭 Dock feature mount、回退 Core adapter/IPC 和数据库副本；保留诊断与任务记录，不删除用户文件。

