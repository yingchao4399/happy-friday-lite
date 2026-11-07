# preview.38 Office AI 品牌、会话与运行错误根因研究

日期：2026-11-07，北京时间。研究对象：用户已安装的 Happy Friday Lite `3.0.7.01-preview.38`（技术版本 `3.0.10-preview.38`）。本报告基于三张用户截图、已安装代码、源码、发布构建目录、脱敏日志及确定性离线重放。

**本轮状态：根因研究已完成，运行时代码尚未修复，没有生成新的修复安装包。** 新增报告和复现材料，保留原总体升级、PDF 专项及 HTML 三份原始规划。此前的资源/启动/转换探针通过，只能证明其实际覆盖的路径，不代表这些 AI 用户流程已经通过验收。

## 1. 结论和影响范围

这些问题属于 Friday 与两套 Office 源码之间的协议及产品适配缺口，不能解释成用户没装好、找错入口或 AI 天生无法调用。当前安装版确实含 HTML；问题发生在已集成的运行链路中。

| 用户现象 | 确认的代码原因 | 范围 | 优先级与证据强度 |
| --- | --- | --- | --- |
| HTML Ribbon、面板显示 Genspark AI / Genspark 及其图标 | 独立固定 HTML 源保留硬编码产品身份，构建适配遗漏 Friday 标题、图标与折叠入口 | HTML | P2；源码、构建适配结果和安装 bundle 均确认 |
| HTML 没有其他组件的会话历史按钮 | 未迁入 Friday 旧分支的历史组件与 list/create/select/update 合同 | HTML | P1；静态合同确认；已有单会话保存并不等于多会话管理 |
| HTML 生成页面时三次 Tool input was unusable | Friday 的工具参数合并函数会吞正常增量分片；实际日志三次 ask_clarification JSON 解析失败 | 所有经过共享桥接的 Office 工具调用 | P0；合并函数错误及静默改值已确定性复现；当次原始 SSE 未保留，不能精确还原用户请求的每个字节 |
| 其他 Office 已有回答，末尾突然“未知错误” | 宿主发送 usage，旧共享 transport 将所有未识别事件当 error，并提前终止订阅 | Docs / Sheets / Slides / PDF | P1；真实 transport 离线重放得到相同症状，安装版四类 renderer 均含该逻辑 |
| Docs 出错后显示“登录 Friday” | 任意错误都检查 Genspark 登录状态；Friday API 模式返回未登录，被 UI 当作需登录；按钮宿主实现为空 | Docs / Sheets / Slides | P1；完整条件链确认；PDF 无此登录分支 |

其中 P0 的理由是：该函数不仅可能产生错误 JSON，还会把合法参数静默改成另一个合法值。已复现 `11 → 1`、`好好 → 好`。这不证明用户已有文档发生了这种修改，但说明仅检查 JSON 能解析或 schema 合法不足以保证参数保真。

## 2. 当前安装与双来源架构

HTML 固定来源为 GenOffice `v0.12.852` / `4b55db9ed1994575a695160ffc6cfd0bfc866211`，从 `vendor/genoffice-html` 构建。Docs、Sheets、Slides、PDF 从 `vendor/happyoffice` 的 `e4160be053612108bfa041efd75402dc985f133a` 构建。固定 tag 是本次集成目标，不是最新版本声明。

来源选择在 `scripts/build-office.mjs:31-32、146、316`。HTML 编译使用 `scripts/office/html.electron-vite.config.mjs:16-17` 中的宿主及预览安全适配器。两套源码最终都使用 Friday 的 `ai:*` 主进程桥。

这种组合允许保留旧版四编辑器修复，同时引入新的 HTML，但必须显式补齐两类差异：一是新 HTML 需要继承 Friday 的品牌、历史等产品增强；二是旧编辑器必须理解新版宿主的事件与错误合同。本次两个方向都存在遗漏。

安装目录为 `C:/Users/Administrator/AppData/Local/Programs/Happy Friday Lite`，已读取其 package.json 确认 preview.38。安装版与 `win-unpacked` 的 HTML renderer 中都能检出 `Genspark AI`。源码、unpacked、安装目录三份 `office-ai-stream.js` 的 SHA-256 均为：

```text
d4e7481f9ca8d5663f79ec2090a143a6b60dd3f47217358e0ff1877b3f3b8587
```

因此这些已复现的缺陷存在于当前安装代码，不能用“源码修了但用户装的是旧版”解释。

## 3. HTML 参数错误：正常增量被误当作重复快照

### 3.1 用户请求的实际日志

只摘录技术信号，不包含 API Key、授权头、用户正文或原始工具参数。当前本机 main.log 第 21654–21656 行记录如下（已从 UTC 换算为北京时间）：

| 北京时间 | 工具 | 合并后参数长度 | truncated | stopReason |
| --- | --- | --- | --- | --- |
| 2026-11-07 17:15:38.601 | ask_clarification | 515 | false | tool_calls |
| 2026-11-07 17:15:41.496 | ask_clarification | 484 | false | tool_calls |
| 2026-11-07 17:15:44.571 | ask_clarification | 502 | false | tool_calls |

`office-ai-bridge.js:359-368` 只在 `inputError || truncated` 时记录该告警。三次均非 truncated，证明是合并后参数无法 JSON.parse。失败发生在澄清需求阶段，还没到大段 HTML 的生成或导出阶段。这一请求没有输出长度截断证据，不能首先用加大 max_tokens 或更换生图 API 来处理。

### 3.2 真正损坏参数的代码

`src-electron/office/office-ai-stream.js:20-29` 同时猜测“本次是增量”与“本次是累计快照”：

```js
if (next === previous || next.startsWith(previous)) return next
if (previous.startsWith(next) || previous.endsWith(next)) return previous
return previous + next
```

对于任意文本，仅凭内容前后重叠无法确定语义。新来的 `{` 可能是嵌套对象的必要字符；重复的 `1` 可能是数字 11 的第二位；重复的“好”可能是原文的一部分。这些都被当前去重逻辑误删。

`office-ai-bridge.js:332` 使用该函数组装所有工具 arguments；`office-ai-stream.js:49` 到末尾才 JSON.parse。真实固定 HTML 上游的 OpenAI 实现则在 `vendor/genoffice-html/packages/ai-provider/src/protocols/openai-compatible.ts:374` 直接追加增量。Friday 接管 `ai:*` 后走自己的合并逻辑，绕过了这段上游处理。

### 3.3 不用 API 的真实函数复现

合成参数符合固定 HTML `tools.ts:345-374` 的 ask_clarification schema：

```json
{"questions":[{"id":"audience","label":"Audience?","options":["Consumer","Business"]}]}
```

拆为六个合法增量后，第二片 `{` 被吞，合并结果成为：

```text
{"questions":["id":"audience","label":"Audience?","options":["Consumer","Business"]}]}
```

真实 JSON.parse 报 `Expected ',' or ']' after array element ... position 18`。另两个合成输入仍能通过 JSON.parse，但值不正确：

| 完整原文 | 当前函数的实际值 |
| --- | --- |
| `{"value":11}` | `{"value":1}` |
| `{"label":"好好"}` | `{"label":"好"}` |

截图的三次停止提示来自固定 HTML `packages/agent-core/src/loop.ts:1180-1199、1291-1295`。这是无效工具输入的重试保护；增加重试次数会重复消耗，不能解决原始参数损坏。

**证据边界：** 当前日志未保留原始 SSE 分片，不能证明当次具体被吞的字符就是本例的 `{`。可以确定安装版存在该共享缺陷、实际三次澄清调用在 JSON 解析处失败，且两者高度吻合。修复后仍需用相同模型重试原始页面生成任务确认。

## 4. 四类旧 Office 的未知错误与错误登录提示

### 4.1 宿主与旧 transport 不同版本

Friday 主桥读取 provider 用量后，会发 `{type:'usage', usage}`：`office-ai-bridge.js:318-325、427`。旧 `vendor/happyoffice/packages/agent-core/src/electron-transport.ts:18` 的类型及 `:99-128` 的分支只认识 ping、delta、reasoning、tool-call、done，末尾直接用 else 处理所有其他事件为 error。

usage 没有 error 字段，所以得到本地化兜底“未知错误”；transport 执行 settle 并取消订阅，随后的正常 done 不再交付。用户已看到的正文保留，末尾却被标错。这也可能让依赖 onDone 的收尾或历史保存路径不执行，具体消息落盘需要另验，不能仅凭屏幕有文字推断完成。

直接运行真实 TypeScript transport，只以本地 fixture 发送事件：

```text
输入：delta("reply before usage") → usage(12,5) → done
预期：delta → done，不产生 error
实际：[["delta","reply before usage"],["error","未知错误"]]
```

四类编辑器的 `src/renderer/ai/transport.ts` 都引用同一共享实现。已安装四份 renderer 均含此错误兜底，所以不能只修 Docs 一个组件。

### 4.2 为什么又出现“登录 Friday”

Docs `AiPanel.tsx:844-874`、Sheets `App.tsx:1297-1336`、Slides `AiPanel.tsx:1488-1519` 在任意 onError 后查询 GskStatus。Friday 主桥 `office-ai-bridge.js:506` 返回 `{loggedIn:false, reason:'friday-managed-provider'}`，语义是没有 Genspark 登录会话，但当前实际使用 Friday 配置的 API 模型。

面板忽略 reason 和实际 provider，只看到 false，便将 `loginRequired` 设为 true。此前品牌文案改成了 Friday，因此上游 Genspark 登录按钮显示成“登录 Friday”；点击则调用 `aiGskLogin()`，而主桥 `:507` 返回空对象，没有恢复动作。

这不能用把 loggedIn 伪造为 true 解决。需要让错误类型和恢复动作匹配：只有真实的该提供商认证失败且有可用登录流程，才显示登录；API Key 模式应指向 Friday 模型设置，额度、限流、参数、网络错误各自提供对应处理。

### 4.3 结构化错误为什么没到面板

宿主已有 errorCode 和脱敏 diagnostic（`office-ai-bridge.js:443-449`），旧 transport 却只向 AgentLoop 传递 string。旧合同还缺少新宿主的 auth、provider、transcript 等代码。面板无法按结构化原因选择恢复动作，只能调用 GskStatus 猜测，形成第二层误导。

本次日志没有为截图中这条“未知错误”绑定到具体 requestId 的 usage 原文；离线真实代码已稳定重现同样症状。仍需最终包带 requestId 的顺序事件验收，完成请求级关联。

## 5. HTML 品牌残留与会话历史

### 5.1 品牌改造未覆盖独立 HTML 树

固定 HTML：面板 `AiPanel.tsx:1232-1233`、Ribbon `components/Ribbon.tsx:281-283` 硬编码 Genspark 标题；`AiPanel.tsx:1865` 是原 Genspark SVG；折叠入口 `App.tsx:1731-1735` 也使用它。

旧 Friday Docs 的 `components/icons.tsx:1748-1751` 虽然函数仍叫 GensparkMark，内部已使用 Friday 图片。复制上游新 HTML 不会自动继承旧分支的产品改造。现有 `html-host-adapter.mjs` 与 `html-renderer-adapter.mjs` 没有品牌转换，因此源文件干净、编译通过的同时，界面仍保留上游产品身份。

修复应统一 Ribbon、面板标题、图标、折叠入口、tooltip、无障碍名称和中英文资源；上游来源、许可及第三方版权声明继续准确保留，不能对所有 Genspark 字符串做全局替换。

### 5.2 已有单会话持久化，缺少历史管理

HTML 现有 `AiPanel.tsx:588-620` appendChat、`:869-925` resolveChat/loadChat、`:931-943` 首次保存 rebindChat。Friday `office-host.js` 通过共享 Docs 项目服务提供对应 IPC。由此不能说 HTML 完全没有保存聊天。

真正缺失的是 Friday 旧分支增强的多会话能力：

| 层 | 其他 Friday Docs 已有 | HTML 当前缺口 |
| --- | --- | --- |
| UI | AiPanel:1319-1327 AiHistoryButton | 没导入/渲染；固定 HTML 的共享 UI 包也没有该组件 |
| 操作 | AiPanel:1104/1126/1133 切换、更新、新建 | 没有对应完整流程 |
| preload | index.ts:230-233 list/create/select/update | HTML 仅 resolve/append/load/rebind 四项 |
| 主服务 | docs-main.ts:3267/3272/3277/3289 | 服务已存在，但没有完整接到 HTML 和其权限合同 |
| store | store.ts:293/318/335/355 | 存储层可复用，需保留文档归属和已有数据 |

因此历史按钮不能只当图标补上。它需要 UI、preload、主服务、文档归属和会话状态一同接通。

### 5.3 “新聊天”仅清空屏幕，聊天 ID 没变

HTML `AiPanel.tsx:1241-1254` 清空队列、loop、可见聊天和附件，但未改变 chatIdsRef，也不调用 createChat。旧 store `store.ts:508` 使用追加 JSONL，所以正常情况下是后续消息继续追加到同一 chatId，重开可能混合恢复；这不等于覆盖删除旧记录。

不能承诺用户当前每条消息均已落盘：现有读写失败会被 catch 吞掉；首条用户消息在首个 assistant 回复前也可能仅在内存。后续应验证磁盘与会话状态，并提供明确持久化错误反馈。

新增 list/create/select/update 时，还必须扩展 `src-electron/office/html-project-boundary.js:16-39`：当前只对 resolve/rebind/load/append 明确检查文档和会话归属。应校验当前文档作用域，维护新建/选择后的合法 projectId+chatId 授权对，并处理切换竞态。直接扩大 preload 方法而不补权限边界会引入跨文档历史访问问题。

## 6. 为什么原测试通过仍漏掉

此前资源校验覆盖 bundle/export/hook、hash、来源及构建；HTML runtime 探针覆盖文件、源码编辑、保存、隔离、导出、关闭及 PDF 回归。它们本身有价值，但不执行真实 AI 规划、澄清和多轮工具循环，也不检查品牌、历史列表或旧版 renderer 对新版 usage 的理解。

`scripts/tests/office-ai-stream.test.mjs` 当前两项仍能通过，因为主要覆盖累计快照和部分工具名称合并，没有检验正常嵌套增量、重复字符/数字及完整字节保真。主进程事件发送正确也不足以证明旧 renderer 能接收。

本轮新增的离线检查共九项，当前全部为红灯，约一秒即可重跑。这些是有针对性的缺陷信号，不应为取得绿色结果删除断言。修复后再用同一组输入验证：

```powershell
node docs/office-ai-html-next/research/preview38-ai-ui-repro.mjs
```

脚本直接调用真实参数合并函数和旧共享 transport，只使用合成消息；品牌/历史项读取实际 HTML 构建适配后的源码。输出结果为 [preview38-ai-ui-repro.json](research/preview38-ai-ui-repro.json)。当前正确诊断结果是 `ok:false`、exit 1，说明缺陷仍在，不是研究执行失败。Node 24 可直接加载此处只含可剥离类型的 TS transport。

静态 UI 检查不是 GUI e2e；合成重放不是用户原始 SSE 回放；模块 hash 相同只证明这些模块相同，不代替整个安装目录逐资源复验。

## 7. 根本修复拆解及顺序

### R1：工具参数保真，先修共享传输

1. 对标准 OpenAI/DeepSeek 增量 arguments 按顺序追加，保留每个字符。
2. 工具名和参数使用独立策略；累计快照兼容必须由明确的 provider/endpoint adapter 模式声明，不能以 overlap 内容猜测。
3. 每个 tool index/id 独立缓存；验证多工具交错、Unicode、引号/反斜杠、嵌套、空分片和结束原因。
4. 除 JSON/schema，还断言重建文本和值与完整原响应一致；连续数字/文字必须保留。
5. 继续保留截断与三次错误保护，错误文案按真实阶段本地化；不靠提高重试次数掩盖失败。

### R2：统一旧四编辑器与 HTML 的事件、终态和错误合同

1. 统一版本化 stream envelope：requestId、事件类型、usage、stopReason、结构化错误、可重试性和恢复动作。
2. 共享 transport 明确处理 usage，只有 type=error 才进入错误路径；新增可选元数据不能自动变成终止错误。
3. 验证 delta→usage→done、tool-call→usage→done、无 usage、取消、超时、重复终态，保证一个请求最多一个终态。
4. 逐应用对照旧/新 renderer 合同，保证四类旧编辑器和 HTML 都有实测；不能只修改主桥或只测试一个组件。
5. 保留脱敏诊断 code，不在日志或报告加入密钥、完整正文和 authorization。

### R3：统一错误恢复，去掉错误登录动作

1. 将 provider/auth/config/network/rate-limit/transcript/tool-input 等原因传至面板，避免再次退化成一条字符串。
2. API Key 模式的配置或认证问题链接 Friday 模型设置；真实上游登录仅在该模式下可用时显示。
3. “登录 Friday”空操作不再作为通用失败恢复；不通过伪造 Genspark loggedIn 状态压制错误。
4. 保留已收到正文、重试上下文和用户输入；落盘/错误/取消结果有明确区分。

### R4：补齐 HTML 产品身份与会话管理

1. 固定上游保持可校验，通过受测的产品适配层注入 Friday 品牌与历史能力。
2. 从 Friday 现有历史实现提取可复用 UI/合同，保持按钮位置、样式、交互与其他 Office 一致。
3. 补 list/create/select/update 的 preload 与主服务连接，维护新旧 chat pair 与当前文档归属。
4. 新聊天创建新持久化 ID；切换时停止在途请求、保存当前会话、装载目标、拒绝旧结果串入新会话。
5. 首次保存、另存、重命名、未命名文档、多标签同名不同路径及重启恢复均验证。迁移保留原 JSONL，不擅自将混在同一个历史内的消息猜测拆开或删除。

### R5：面向后续 GenOffice 更新的发布门槛

每次来源更新都记录双树版本、共享合同版本、Friday 产品增强映射；新增 upstream chunk/tool/IPC 均有兼容性检查。发布门禁除资源来源外，还必须覆盖真实 renderer 事件消费、参数保真、历史新建/切换、品牌 UI 和正确恢复动作。

不需要为每个按钮单独模拟点击。将修改集中在共享传输合同、产品身份/会话适配和文档作用域服务层，再让各编辑器使用这些合同；后续跟随 GenOffice 时只审核显式差异及受影响矩阵。

## 8. 验收清单与当前未完成项

| 验收 | 通过标准 | 当前状态 |
| --- | --- | --- |
| 合法工具参数 | 本报告三组原文/分片值完全一致，所有边界/并行用例通过 | 缺陷已复现，待修复 |
| usage 顺序兼容 | 四类旧编辑器与 HTML 正常回复/工具调用后均 done，无误报错误 | 缺陷已复现，待修复 |
| 恢复动作 | API Key 模式不出现空登录；真实错误给出正确设置/重试动作 | 条件链已确认，待修复 |
| 产品身份 | HTML Ribbon、面板、折叠入口、图标、tooltip 中英符合 Friday | 遗漏已确认，待修复 |
| 历史 | 新建、列表、选择、改名/更新、首存重绑、重启恢复且无跨文档访问 | 缺口已确认，待实现与验证 |
| 数据保留 | 原聊天文件保留；保存失败明确；旧会话不会被新会话清空或错误覆盖 | 待迁移与恢复验证 |
| 真实 AI 页面生成 | 同一 DeepSeek 模型完成需求→澄清→计划→write_document→可见页面→保存→重开 | 待修复后实测；本轮未调用远程 API |
| 最终安装包 | 新资源/源码身份一致，四类 Office、PDF→Word、HTML 回归通过；安装升级保留数据 | 本轮未构建修复版 |

本轮研究使用本地源码和合成输入即可确定多个缺陷，不需要用户再次提交 API Key，也不应要求用户通过反复重装来试错。修复后的真实模型与最终包验收仍必须完成，才能把这些问题标为解决。
