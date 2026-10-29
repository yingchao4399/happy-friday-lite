# Friday AI Core 与全局助手 Preview.20 PRD

**版本**：3.0.6-preview.20（发布展示标签：3.0.6.02-preview.20）  
**日期**：2026-10-29  
**状态**：实现验收稿；安装版升级、回退和人工 UI 验收仍是发布门禁  
**依据**：`docs/ai-core-next-iteration-plan.md`、上一版 PRD/技术设计、当前源码和测试结果

## 1. 产品定义

Friday AI Core 是 Happy Friday Lite 的应用级 AI 控制层。它把 Friday 对话、笔记 Word 导出、Office 能力、MCP/DSH 请求和根级全局助手投影到同一套请求、能力、任务、权限、事件和结果合同。全局助手是 Core 的 UI Adapter，负责让用户在切换页面后继续查看任务状态、处理审批、暂停、继续或取消任务。

本版本的用户感受应当仍然是原版 Friday：原有对话、笔记、Office 和 Typewriter 的布局、输入方式、菜单和焦点行为保持不变。新增能力以辅助层嵌入，只有在任务确实需要授权或恢复时才出现。

## 2. 用户问题与目标

当前版本的 AI 入口分散在对话、Office、笔记导出和 MCP 中，用户无法稳定知道任务是否真的执行、写入了什么、是否能撤销，也无法在切换页面后找到后台任务。Preview.20 解决以下问题：

1. 统一请求的 actor、space、session、thread、request 和 task 边界。
2. 写能力先展示计划和影响范围，再经过 scope 与审批检查。
3. Word 写入必须回读验证，失败时保留步骤和可执行的恢复动作。
4. 任务可在能力步骤边界暂停、继续和取消，重复继续不重做已确认步骤。
5. 根级全局助手跨路由投影任务事实，不抢占编辑器和 Office 焦点。
6. 网络错误提供分类、有限重试和脱敏诊断；流中断保留局部结果并支持安全重试。
7. 手动会话标题优先于异步自动标题，重试请求不重复保存用户消息。

## 3. 范围

### 3.1 本版交付

| 能力 | 用户入口 | 结果 |
| --- | --- | --- |
| AI Core 请求/能力/任务合同 | 主进程 Core Facade、IPC、MCP | 统一 schema、状态和错误 |
| 笔记写入新 Word | 笔记更多菜单 | 计划、确认、写入、回读、来源关系、撤销 |
| 任务控制 | 笔记任务菜单、全局助手 Dock、MCP | 审批、暂停、继续、取消、查询、撤销 |
| 全局助手 | App 根级浮动入口 | 跨路由查看最近任务和处理控制命令 |
| DSH 适配 | MCP `submit_core_task` | 独立 actor/space，默认只读 |
| 网络策略 | LLM/模型测试 | 错误分类、Retry-After、有限重试、脱敏诊断 |
| 对话恢复 | Friday 对话 | 断线错误提示、重试原请求、避免重复用户消息 |
| 标题保护 | 会话存储与标题生成 | `titleManuallySet` 迁移和人工命名优先 |

### 3.2 本版边界

- 全局助手是 Friday 窗口内的跨路由 Dock，不承诺操作系统级悬浮窗、托盘或系统全局快捷键。
- DSH 不能从 Core 继承 Friday 全局空间和写 scope；没有可靠空间/授权字段时降级为只读。
- Core v1 不暴露 Shell、Python、pip、任意网络写入、剪贴板、UI 控制和 Office 批处理等高影响旁路。
- Typewriter 全量性能、声音、图片、Obsidian 兼容矩阵、完整历史迁移和安装版回退保留在后续门禁，不能以 Dock 已出现替代这些验收。

## 4. 用户故事与验收

### US-01：笔记写入 Word

**Given** 用户打开一篇笔记并选择导出 Word，**When** 选择输出路径，**Then** Friday 创建 Core task 并显示写入目标、笔记标题和授权确认。

**When** 用户批准，**Then** Core 通过 `note_to_word` 读取笔记、创建 Word、写入来源标记、回读并检查目标文件存在且非空；结果返回 taskId、输出路径、来源 URI、验证状态和 undoAction。

**When** 用户拒绝，**Then** task 进入 `cancelled`，不创建文件；用户可继续编辑笔记。

**When** 目标文件已存在、Office 正在打开目标或 CLI 失败，**Then** task 不显示完成，错误带阶段和可操作原因，已完成步骤仍可查询。

### US-02：任务暂停与继续

**Given** task 正在运行，**When** 用户点击暂停，**Then** Core 设置 pauseRequested，并在当前能力完成后的检查点进入 `paused`。

**When** 用户继续，**Then** Core 重建计划，跳过已有 stepId/capabilityId 回执，不重复写入已成功的能力。

**When** 应用已重启导致临时请求正文不存在，**Then** 继续命令明确返回重新提交提示，不猜测或自动执行旧写入。

### US-03：全局助手

**Given** 用户在任意主路由，**When** 点击 Friday 全局助手入口，**Then** Dock 显示当前 actor 的最近任务、状态、失败摘要和可用动作。

**When** 用户切换路由或关闭 Dock，**Then** 后台 task 继续按 Core 事实运行，重新打开 Dock 能看到同一 taskId。

**When** 用户点击审批、暂停、继续或取消，**Then** Dock 只调用 Core IPC，不直接修改业务资源或绕过确认弹窗。

### US-04：只读与外部调用

**Given** DSH/MCP 客户端只有 `read`，**When** 请求写能力，**Then** plan 阶段返回 scope 拒绝，不能靠 prompt 或参数伪造审批。

**When** DSH 请求带有外部 workspace，**Then** spaceId 保留为 `external:dsh:<workspace>`，actor 与 Friday 用户隔离。

### US-05：网络中断和重试

**Given** 请求尚未产生模型输出且没有副作用，**When** DNS、代理、TLS、超时、429 或 5xx 短暂失败，**Then** Core 按有限次数和 Retry-After 重试。

**When** 4xx 鉴权/参数错误或已有流式正文，**Then** 不盲目重放；前端保留错误/局部内容并提供显式重试。

**When** 用户点重试，**Then** 原用户消息 ID 可复用，不产生重复用户记录。

### US-06：标题

**Given** 会话尚未人工命名，**When** 异步标题生成完成，**Then** 自动标题更新会话列表。

**When** 用户已手动命名，**Then** 晚到的自动标题不修改标题或时间戳。

## 5. 功能需求

### FR-01 请求合同

每次请求必须含 `contractVersion`、`intent`、`input`、`mode`、`requestedCapabilities`、`idempotencyKey`，并通过 context 带 `actor`、`spaceId`、`sessionId`、`threadId`、`requestId`、`scopes`、`resourceUris`、`budget` 和 `locale`。缺少 spaceId 必须拒绝。

### FR-02 能力目录

能力包含稳定 ID、版本、输入/输出 schema、类型、风险、requiredScopes、幂等、dry-run、readback 和 undo 声明。能力必须先进入注册表，再进入 Core 目录；`catalog-policy.js` 过滤敏感、私有、剪贴板和 Core v1 禁止的高影响能力。

### FR-03 计划与审批

`plan` 只生成步骤，不执行副作用。写能力或中高风险能力标记 `approvalRequired`；缺少 scope 返回 `missingScopes` 和 `request_scope:<scope>`。审批只对当前 task 的请求有效，不能转化为全局通行证。

### FR-04 任务状态

任务至少支持 `draft`、`awaiting_approval`、`running`、`verifying`、`paused`、`completed`、`failed`、`cancelled`、`partially_completed`。状态转换必须经过 `assertTaskTransition`，每次转换和能力执行产生事件。

### FR-05 可靠写入

写能力成功后才保存 step 回执；写入 task 必须进行 readback 或明确进入 `partially_completed`。幂等键与规范化请求指纹同时校验；同一键内容不同必须拒绝。

### FR-06 任务隐私

Core 数据库只保存计划摘要、资源哈希、actor/space 元数据、状态和错误摘要。请求正文、完整资源 URI、API Key 和私有文件正文不写入普通审计日志。

### FR-07 全局助手行为

Dock 只显示脱敏 publicTask，每 6 秒刷新一次，最多显示 8 条最近任务；任务执行不依赖 Dock 生命周期。审批、取消继续复用既有 `FridayConfirmDialog`。

### FR-08 UI/UX 保护

Core 只固定 command/event/task/result 合同，不固定页面布局。新增 Dock 使用现有主题变量、无障碍 label、窄窗口宽度约束和 reduced-motion 规则；不注入鼠标、不操作 Office WebContentsView、不改变原编辑器焦点和快捷键。

## 6. 指标与发布门禁

记录任务完成/部分完成率、审批拒绝、重复幂等拒绝、readback 失败、跨空间拒绝、恢复成功率、网络分类、标题手动保护命中和 Dock 控制错误。发布候选必须同时满足：核心单测、Preview 回归、Vite 构建、Electron 构建、旧数据迁移、Windows 安装升级/回退和人工 UI 回归。当前源码门禁已通过，安装生命周期和人工 UI 仍需在真实安装目录完成。

## 7. 回滚

回滚单位为 Core Facade、任务控制 IPC、Dock 挂载和数据库迁移；保留任务记录、笔记、会话、Office 文件和备份副本。任务在回滚前应先取消或暂停在检查点，数据库迁移失败恢复最近备份，不删除用户数据。

