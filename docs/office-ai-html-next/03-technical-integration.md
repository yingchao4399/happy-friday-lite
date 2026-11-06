# GenOffice AI HTML 融合技术对接设计

日期：2026-11-06。状态：**研究及设计，尚未实施、尚未验收**。本文件只规定下一版本的技术方案，不表示已启用 HTML，也不替代此前 Office 总体规划或 PDF 专项。

## 1. 技术目标与事实边界

目标是把经过批准的 GenOffice AI HTML **完整应用**接入 Friday Office：文件、可视编辑、源码、实时预览、AI 面板及其工具、资源、演示、导入导出和运行时配套均需逐项对齐；不能只做一个聊天面板、把 HTML 当普通文本打开、或者仅点亮 registry。用户同时要求便于未来持续跟随上游，故优先复用上游应用与格式逻辑，通过版本化 adapter 承接 Friday 宿主差异。

**来源固定但未批准**：当前 Friday 的 `office-upstream.lock.json:4-24` 记录 vendor HEAD `8ed0c8d099c3c3d87b1a998d9189da3d120ff820`、`v0.10.639-27-g8ed0c8d0`，工作区有未提交变更；所记录官方观察候选为 `v0.12.852`、commit `4b55db9ed1994575a695160ffc6cfd0bfc866211`。`approvedTarget`、`vendorBaseSha`、`integrationCommit` 均为空。候选是研究样本，不宣称最新、已批准或已融合；开工前需在线复核 tag、提交身份、许可证与维护策略。正式对等基准必须在 G0 批准固定 commit，并冻结其工具和功能矩阵。

**如何复核候选源码**：本机只读研究库为工作区根 `research_sources/genoffice-v0.12.852.git`，使用 `git --git-dir=<该绝对路径> show 4b55db9ed1994575a695160ffc6cfd0bfc866211:apps/html/src/renderer/ai/tools.ts`，其他候选引用同样替换冒号后的路径。该库为浅历史，不足以证明 fork 的完整历史或 merge-base。公开对象可查 [固定提交](https://github.com/genspark-ai/genoffice/tree/4b55db9ed1994575a695160ffc6cfd0bfc866211/apps/html)。当前 vendor 路径是工作区文件，不应伪称与该候选完全相同。

### 1.1 已有代码证据

| 事实 | 可核对位置 | 对接影响 |
|---|---|---|
| HTML 被登记但关闭，`.html/.htm` 未进入已启用映射 | `src-electron/office/editor-registry.js:6-18` | 功能完成并验收后方可启用；不能仅改 enabled |
| 文件类型、Vue 工作区、Tab 和路由还有独立四类型枚举 | `src-electron/office/office-files.js:7-20`，`src/views/office/OfficeWorkspace.vue:54`，`src/components/layout/TabBar.vue:257`，`src/router/index.js:60` | 必须统一来源或加一致性测试，否则出现可打开但无法导航等半接入 |
| 宿主按编辑器懒加载并校验 bundle；runtime、IPC 和 view 分支仅覆盖四类，`createTypeView` 最后回落 PDF | `src-electron/office/office-host.js:118-140,160-232,309-333,1056-1082` | 需显式 HTML 分支；未知类型必须拒绝，不可误建 PDF |
| 构建由已启用 registry 驱动，上游 renderer/preload 和 main entry 分别构建 | `scripts/build-office.mjs:20-38,98-110,215,263-264` | 增加 HTML entry、资源、构建依赖和完整 manifest；不要手改 `resources/office/` |
| Office AI 桥复用 Friday 模型；搜索/图片通道仍有空结果或不支持实现 | `src-electron/office/office-ai-bridge.js:18-20,320-371` | 必须对接真实 provider 并准确投影不可用原因，空数组不能冒充搜索成功 |
| 共用 operation catalog 和交付当前只有 PDF→DOCX、内容→DOCX；目标扩展名硬编码 `.docx` | `src-electron/office/operation-catalog.js:1-3`，`src-electron/office/artifact-delivery.js:103-104,185` | 复用任务/授权/交付设计时须扩展格式化合同；不能把 DOCX 验证器用于 HTML |
| 上游当前 vendor 有 HTML 源码和自身独立生命周期，但 Friday 未加载 | `vendor/happyoffice/apps/html/src/main/html-main.ts:774,797-816,925-1045,1223` | 以批准目标版本真实 exports 为准，不要求暴露上游本来私有的 IPC 函数 |
| 上游现有预览可执行脚本、联网、表单和弹窗，iframe 不设 `allow-same-origin` | `vendor/happyoffice/apps/html/src/renderer/preview/PreviewFrame.tsx:23-27,43-49,60`；固定候选同路径须再次逐项核对 | 需建立威胁模型和可验证隔离；不可宣称预览已禁用 JS/网络 |

候选 `apps/html/src/renderer/ai/tools.ts` 的 `AGENT_TOOLS` 包括 `get_outline`、`read_source`、`apply_ops`、`ask_clarification`、`plan_page`、`write_document`、`search_images`、`generate_image`；`apps/html/src/renderer/document/ops.ts` 已见 `str_replace`、`replace_element`、`set_inner_html`、`set_text`、`insert_html`、`set_attr`、`set_style`、`set_tag`、`set_text_node`、`wrap_text` 等。这里是研究清单而非完整对等证明：G0 必须按批准 commit 扫描全部工具、参数、依赖与返回，并以测试冻结，不能据局部列表裁剪功能。

## 2. 架构与责任边界（拟议）

```text
Friday 窗口 / 工作区 / 主助手                 上游 HTML 应用
  route / tabs / open / save / approval  ->  main + preload + renderer
            |                              |   source document / ops / AI panel
            v                              |   preview / inspector / present
   Office capability + task service <------ HTML adapter / hooks
            |                              |
  artifact / file grants / audit            AI transport -> Friday model bridge
            |                              |              -> provider adapters
  versioned bundle + manifest  <------------ build pipeline + pinned vendor
```

1. **上游拥有文档语义**：HTML buffer、解析映射、原子编辑、预览/演示及其上游 UI 的功能，优先维持批准版本的行为，避免另造互不兼容的 HTML 编辑器。
2. **Friday 拥有宿主边界**：用户身份、可信文档 identity、路径授权、AI 写操作审批、任务、交付、脱敏日志、模型和 provider 凭据管理、窗口与路由。
3. **adapter 只转换合同**：显式转换能力发现、上下文、操作、事件和错误；任何私有 hook 必须列在差异台账，注明测试、责任人及上游等价实现出现后的删除条件。
4. **preview 是不可信内容**：它不应获得 Friday preload、凭据、主进程权限或用户未授权的本地文件。预览可执行性与上游对等需通过隔离和明确网络选择实现，而非假设页面安全。
5. **同一能力，多入口共用**：HTML 面板与主助手可以保留不同交互，但读写同一文档权威状态与相同授权/版本校验，不得由主助手另起一份隐形 HTML 副本。

## 3. 版本冻结、构建与注册

### 3.1 上游获取和差异审计

- 在隔离 worktree 按批准 tag 和 peeled SHA 获取完整历史、依赖及许可证；记录官方、当前 fork、可能旧基线三方身份及 merge-base。不得将候选 bare 的浅历史结论当作完整审计。
- 列出 HTML app、共用 packages、shell、CLI、构建配置、资源、依赖和锁文件的变更；对所有 Friday vendor 私有补丁逐项作保留、替代、冲突或删除结论，附责任人、证据及测试。当前 `office-vendor-patches.json` 只是差异入口，不是已完成审计。
- 评估“整体升级 vendor”和“把目标 HTML 及其闭包移植到现有 vendor”两条路线：前者回归范围大但维护一条上游基线；后者容易引入跨版本 package/API 断裂和后续重复移植。默认优先完整目标基线与宿主 adapter；若依赖、许可证或既有功能阻断，先完成对比实验及书面决策，不得以裁减 HTML 功能冒充对等。
- `scripts/office/upstream-lock.mjs:127-156` 的正式集成检查拒绝缺失身份或缺映射的 cherry-pick/three-way 声明；须补齐可审计逐提交/逐文件映射与证据摘要机制后才能采用这些方式。锁文件中的候选不得直接升为 integrated。

### 3.2 构建产物和 manifest

拟新增 `scripts/office/entries/html.ts`，以目标源码的实际 public exports 构造 bundle；构建 `html-main.cjs`、`html/preload/index.js`、`html/renderer/index.html`、其动态 chunk/字体/worker/协议资源，及真实所需共用包。`integration-manifest.json` 登记 HTML 版本、协议、source SHA、adapter、main/preload/renderer、依赖和每项资源摘要。阶段目录先完整构建校验再整组发布；禁止混用旧 renderer 和新 main。

现有 bundle 合同在 `src-electron/office/bundle-contract.js:82-117` 对 protocol、资源、目标平台及 clean 进行核查。扩展时验证真实 `require/import` 导出，不只信任 manifest 自报；缺资源、版本不兼容、preload 不匹配均返回明确不可用状态。发布必须 clean clone、锁定工具链和 lockfile、fresh 构建、比对包内资源及 hash；保留构建日志/命令/平台与输入 SHA。

### 3.3 main / preload / renderer 与注册时序

1. Electron ready 前按目标代码要求注册 `genoffice-app://` 和 HTML 自有特权 scheme；ready 后安装协议处理，先验证 scheme 注册次数、session 和资源所有权，再创建 HTML view。
2. `ensureEditor('html')` 懒加载经过合同验证的 bundle；先 configure runtime 路径、文件/资源/导出回调和 shell hooks；以目标源码真实顺序安装 IPC。候选 `apps/html/src/main/html-main.ts:1315` 的 `registerHtmlIpc` 为私有函数、`:2004` 的 `createHtmlView` 内触发；**不要凭空要求它是公开 export**。必须用真实加载和重复创建测试其效果及注册幂等。
3. Friday 当前 `office-host.js:143-156,208-232` 用全局替换重名 IPC 并在编辑器注册后覆盖 `ai:*`。全局 `removeHandler` 可能影响其他模块：设计阶段先列所有通道和注册方，改为受控统一分发/明确 owner；确保后加载 HTML 不覆盖已有 PDF/Docs，也不让旧模块覆盖 Friday bridge。对 `ipcMain.on` 与 `handle` 分别检查重复监听和清理。
4. renderer 只通过经过审查的 HTML preload API；禁止把任意 IPC、Node API、文件路径能力或主助手 context 直接透传到不可信预览。`contextIsolation`、sandbox、nodeIntegration 设置以真实打包运行时测量，并审计 shared process、session 和协议响应头。
5. 关闭编辑 Tab 或 renderer 崩溃时移除该 view 的授权、等待器、preview、流和 present 引用；不得注销影响其他 view 的进程级 handler。

### 3.4 路由、菜单、生命周期

从共用 registry 派生扩展名、类型、Tab 路由和用户入口；若前后端无法安全直接共享，则生成静态合同并设一致性测试。明确新增、新建未命名文件、打开/拖放、最近文件、重命名、另存为、未保存关闭、恢复、多窗口和相同路径重复打开策略。HTML 专属保存、撤销/重做、查找、打印、导出、预览与演示命令映射到目标应用实际通道；不能假设 `menu:command` 是通用合同。菜单禁用态和提示应反映当前 active view，而不是仅看类型。

上游当前文件跟踪（`html-main.ts:797-816,937-1045`）分别维护 per-webContents 路径、dirty、预览和保存 waiter。宿主需要绑定 `viewId → webContentsId → documentId → actor/space`，在保存/路径变化时同步 Tab、最近文件和授权；保存取消、目标占用、renderer 退出及另一个 view 同路径竞争均要按真实结果反馈。禁止在用户未确认时覆盖已有用户文件。

## 4. 文档权威状态与编辑协议

### 4.1 单一权威、版本和快照

提议 HTML renderer 的上游文档模型为当前打开文档的唯一可编辑权威；主进程持有 identity、权限、revision 和快照摘要，不另维护可独立修改的第二份源码。预览是带 instrument 的派生内容，不可拿它作为保存源或 AI 编辑源；上游 `html-main.ts:1041-1045` 已明确区分预览和保存序列化。

每次用户编辑、撤销、重做和 AI 成功提交都推进单调 `revision`；`documentId` 在标签生命周期稳定，`viewId` 和 sender 由宿主签发，文件 rename 不改变文档身份。基于快照开展长操作时带 `{documentId, revision, sha256}`；应用前核对当前 revision。上游已有 version 机制需在 G0 比对并映射，不能未经验证假设已满足跨进程合同。编辑期间文件被外部更改应提示冲突并可另存，不能静默覆盖。

### 4.2 建议内部消息（不是现有 API）

```json
{"protocol":"friday.office.html/1.0","requestId":"uuid","operation":"html.applyOps","documentId":"opaque-id","expectedRevision":12,"ops":[{"kind":"上游已批准操作类型","payload":{}}]}
```

```json
{"requestId":"uuid","status":"applied","documentId":"opaque-id","previousRevision":12,"revision":13,"changedRanges":[{"start":0,"end":10}]}
```

操作 shape 必须在 G0 根据真实上游 schema 生成适配及负向测试；上面只是 envelope，`kind/payload` 不是承诺的上游语法。接收时通过 sender 查文档授权，绝不相信 renderer 自报 actor、space、path 或 owner。按 `requestId + owner + documentId` 去重；参数不一致返回冲突而不是复用旧结果。

`applyOps` 先依据同一 revision 完整解析与验证全部操作、选择器/定位结果、范围重叠和大小限制，在内存生成事务补丁，再一次性提交并更新撤销栈；任何一项无效时整组不写入。若用户在模型生成期间编辑，返回 `REVISION_CONFLICT` 并提供重新读取/用户确认的安全重试，不盲目对新文档重放。AI 生成中的 draft 不能抢先成为已保存文件；只在成功提交后报告“已应用”，只有完成保存和回读后才能报告“已保存”。

### 4.3 状态机与 Stop

```text
requested -> authorized -> context_ready -> streaming -> proposal_ready
          -> applying -> applied_dirty -> saving -> persisted -> opened/ready
                    \-> conflict / failed
任何可取消阶段 -> cancelling -> cancelled（若此前已提交则保留真实提交状态）
```

每个阶段应以 `requestId`、owner、documentId、revision 和明确终态关联；取消禁止未来 delta、tool-call、迟到 ack 再写入；提交后的取消不能假装没有写入或删除已交付文件。页面关闭、模型超时、断网、进程崩溃也应取消或按已提交事实恢复。`src-electron/office/office-ai-bridge.js:270,312,341-342` 当前流表按 requestId 索引，取消 handler 未在此处检查 sender；实施时需以 sender/owner/requestId 绑定、拒绝跨视图取消、处理重复 ID 和销毁清理，并用真实多视图验证。

## 5. AI 模型、工具和 provider

### 5.1 两类入口

HTML 面板保留上游系统提示、工具定义、澄清卡、队列、附件、流式响应和文档操作体验；Friday 的模型桥负责配置、传输、能力查询和错误归一化。主助手若执行 HTML 操作，则通过注册的领域能力查询、获得用户批准后调用同一 HTML adapter，不能绕过上游的 revision/原子操作，也不能声称所有上游工具自动出现在主助手中。主助手不依赖 HTML 面板先打开；无活动 HTML、多候选或无授权时明确询问或报可恢复错误。

当前 `officeOperations.js:5-13` 的可信上下文与写操作审批是 PDF/DOCX 现有模式；`operation-tasks.js:24-30,53-79` 的 actor/space 与幂等可复用，但 HTML schema、资源授权、任务恢复需新增合同和测试。交互式用户直接点击保存与 AI 写入的授权语义要分别定义，不可用一次批准授权后续所有文件和网络访问。

### 5.2 工具、附件与服务合同

| 类别 | 必须实现/验证 | 边界与失败 |
|---|---|---|
| 内容与操作 | 按批准 commit 对照 `get_outline/read_source/apply_ops/plan_page/write_document` 等完整工具、参数和结果；选区/文档版本绑定 | 超长、定位歧义、空内容、冲突、部分失败都用结构化错误；模型不得将错误当成功 |
| 澄清/队列 | 保留上游 `ask_clarification`、计划与操作队列、人类选择以及取消/重试 | 不强制接受模型建议；卡片关闭不等同批准写入 |
| 上下文与脱敏 | 文本、选区、图像、附件按实际模型能力发送；明确大小、截断和保留语义 | 记录发送前授权/范围；密码和密钥不进 prompt 或日志；脱敏后定位映射须回归 |
| 搜索 | 实现真实 web/image search adapter，记录 provider、超时、权限、结果 URL/归属 | 禁用、无配置、认证失败、空结果、超时分别返回，不能用 `[]` 混同 |
| 图片/媒体 | 完整接入目标版本支持的图像搜索、抓取、生成和分析能力 | provider key 仅主进程使用；按 URL、体积、类型、私网/重定向策略校验；失败明确且可重试 |
| 附件/资源 | 文件选择或已授权文档；解析器按格式、大小、权限、生命周期执行；本地资源 copy/reference 策略对等 | 禁止 AI 任意路径读取；临时缓存、删除/撤销、移动文档与 Save As 的资源引用必须一致 |
| 会话/偏好 | 核对上游会话、模型、面板偏好及持久化/重开语义；Friday 映射到用户空间 | 不以 renderer 自报 owner 查历史；区分文档保存和聊天记录保存 |

拟统一服务错误 envelope：

```json
{"ok":false,"error":{"code":"PROVIDER_NOT_CONFIGURED","message":"图片服务尚未配置","retryable":false,"details":{"capability":"image.generate"}},"requestId":"uuid"}
```

这是 Friday adapter 内部建议形状，不是对上游现有协议的断言；边界转换必须逐通道适配目标源码期望的错误类型。调试日志只存 code、阶段、耗时和脱敏 requestId；不得保存 HTML 正文、选区、附件内容、token、模型密钥和 provider 原始敏感响应。API key 管理遵循项目 `AGENTS.md`，不在渲染进程可读的持久化文件或文档里保存。

### 5.3 模型兼容与取消

为 OpenAI 兼容模型逐项验证流 delta、分片 tool-call 参数合并、并行调用、工具结果回传、reasoning、token 上限、超时/重试和多模态。真实 provider 若不支持某项应在发现阶段标记，避免面板展示必然失败的功能。网络请求可限次重试，但非幂等图片生成或写操作不得自动重复；Stop 传播到 provider、工具和编辑提交。使用模拟服务覆盖所有错误，并用用户配置的真实模型跑端到端，不得将 mock 结果称作真实模型验收。

## 6. 资源、预览、演示和导出

### 6.1 资源和存储

批准版本的 `html-asset://`、`html-preview://`、相对路径、data URL、生成图和临时资产生命周期须逐项梳理。为每个 view 创建文档根目录或明确的文件授权集合，解析并规范化路径；阻断 `..`、盘符绕过、链接/junction/硬链接导致的越权和文件被替换竞态。远程资源加载/本地导入、Save As、重命名、文档移动、孤儿清理和丢失资源必须有明确策略。支持上游单文件导出和可携带资源输出，以真实输出回读与重新打开验证，不能只看对话框成功。

### 6.2 预览及演示

上游 preview 和 inspector 的编辑消息必须先经过安全设计和攻击验证，不能仅按现有协议原样接入。当前 vendor 的 `inspector-protocol.ts:128` 仅判断消息对象的 `type` 以 `gx:` 开头；`PreviewFrame.tsx` 再检查 `event.source` 和版本，`App.tsx:646,656` 将文本和 HTML 提交交给 `runManual`。相同 iframe 中的页面脚本与 inspector 共用执行环境，页面脚本可以向父窗口发送同类型消息；opaque origin 为 `null`，也不能用 origin 区分二者。因此 source、版本、schema、长度和可被同一页面读到的 token 只能作为过滤、关联或重放防护，**不能证明消息来自可信 inspector，也不能单独授权修改源码**。候选目标版本需按固定 SHA 重新核对与实测；以上是当前 vendor 的代码证据，风险后果目前限定为可能影响文档完整性，其他影响需验证。

实施前完成可运行安全 PoC，比较并经评审确定以下设计，而不是预设任何一种已经安全：

1. 将允许执行用户脚本的浏览预览与编辑预览分离。编辑预览使用不执行用户脚本的受控派生文档，隔离用户代码和 inspector；外部脚本、事件属性、可执行 URL、嵌套 frame 等处理不得改写保存源，并须覆盖 CSS、SVG 和资源带来的执行路径。动态内容展示留给受隔离的浏览模式，两种模式的差异及切换须对用户明确。
2. 如需动态网页与可视编辑同时工作，设计具备独立隔离边界的可信控制组件；明确其如何获取节点定位、如何防止页面脚本篡改 DOM 或冒充用户操作，并以攻击 PoC 证明。若无法证明可信来源，则 iframe 发出的编辑内容只是**不可信候选**，需由宿主依据真实文档 revision、源映射、允许的操作及可信用户交互生成和确认变更；页面自报的 `isTrusted`、选择状态或确认结果不能作为证据。
3. 编辑提交经宿主控制面检查当前 view、documentId、revision、活动编辑会话、操作类型与范围，验证源映射、事务和冲突；跨导航或 reload 使旧会话失效。需要显式确认时，在宿主可信 UI 展示可读变更及目标后由用户确认。常规编辑的交互成本应通过原型评估，不能以确认弹窗替代隔离的证明。
4. 如未找到同时满足安全和目标上游交互的方案，保留安全差异及未完成状态，禁止以“已完全对等”发布；由评审决定风险处置和可用模式。隔离方案必须经 Electron 打包环境及支持平台复核，不能仅凭浏览器开发模式的表现下结论。

预览产生的脚本、导航、下载、表单、剪贴板、弹窗与媒体权限在隔离 session 中逐类处理；演示窗口仅引用拥有者的 preview，owner 关闭时销毁，演示窗口不能获得编辑器或宿主权限。

网络策略须兼顾上游动态页面兼容：默认的离线/联网模式、可信来源、远端请求及表单提交授权、重定向及私网访问策略，须在方案评审明确并与用户可见反馈一致；并非声明要永久关闭上游联网能力。若某种上游网页需要放宽策略，应以显式、可撤销的用户选择和隔离边界解决。严格 CSP 或权限拦截可能破坏上游行为，必须以 CDN、脚本和离线样例记录差异，不得静默降级后宣称对等。

### 6.3 保存、打印和导出

保留上游原生 HTML 保存/另存为、打印、导出 HTML/PDF/DOCX 等批准版本实际支持的路径及其限制。PDF/DOCX 使用目标应用真实导出实现，不绕过现有资源授权；先提交并回读，再触发打开；打开失败不删除已交付文件。单文件 HTML 与多资源工程需分别定义资产打包、路径重写、目标覆盖和回滚事务。

现有 `artifact-delivery.js` 是 DOCX 专用，提出分离**格式无关**的路径授权/原子提交/日志恢复与**格式专用**验证器：HTML 检查目标文件字节、编码、引用和回读，PDF/DOCX 各用各自验证器。完成迁移前不得复用 `.docx` 强约束作为 HTML 交付。注意任意 HTML 的安全预览与源文件本身可执行内容是不同问题；不能为了打开安全而无提示破坏用户源码。

### 6.4 CLI / headless

批准目标需核实 HTML 在上游 CLI、headless、系统文件关联、命令行参数、无窗口 PDF/DOCX 导出中的真实支持范围；逐项记录可观察行为与依赖。Friday 当前 `office-headless.js` 覆盖四编辑器，不能假设 HTML 自动可用。若上游支持则在无交互、路径授权、exit code、stdout/stderr、超时、清理与资源可达方面实现同等合同；目标版本不支持的能力标注不适用，不凭空承诺。安装包中执行无源码验证。

## 7. 安全和多窗口模型

1. **信任分层**：Friday 主进程/经认证宿主控制面 > HTML 编辑器 renderer > 不可信 HTML 预览及网络资源。原始 HTML、附件、模型返回、网页和文件名都视为不可信输入；AI 提示词也不授予额外权限。
2. **owner 校验**：每个 IPC 在主进程从 `event.sender` 查注册表并核对窗口、documentId、actor、space、当前授权和生命周期。拒绝跨标签读取/修改、伪造 documentId、被销毁 sender、失效授权和旧请求；preload API 最小暴露。主窗口/编辑窗口/预览 iframe 不能互相冒用身份。
3. **文件与网络**：本地访问使用显式授权和真实路径校验；网络 provider 使用独立可配置权限及 DNS/重定向/私网防护，考虑 DNS rebinding、压缩炸弹、巨大文件与 MIME 伪装。隔离方案必须明确跨平台兼容策略并测试；不要把脚本沙箱当作网络防火墙。
4. **导航与协议**：预览不得顶层导航 Friday，不得获得宿主 preload；外链通过受控 handler 和用户操作打开，拒绝危险 scheme。`postMessage` 的 sender、token、消息类型、大小和版本检查用于过滤及关联，不能证明同一 iframe 中的可信 inspector 身份；编辑授权必须满足第 6.2 节的独立隔离或宿主可信控制方案。严格验证自定义协议解析、响应内容、CSP 和路径绑定。
5. **日志与结果**：不记录明文源码、用户内容、附件和秘密；安全错误不泄露其他文档是否存在。保存后被外部更改应与任务完成状态分开报告。搜索/图像能力可用性与模型工具声明同步。

威胁验证至少覆盖恶意 HTML `<script>`、表单上传、跨域 fetch、iframe 伪造消息、`window.open`、`file:`/自定义协议越权、SVG/资源内容伪装、外链重定向、提示注入、两窗口跨 sender 取消及请求 ID 冲突。消息攻击测试包括：在相同 iframe 伪造 `gx:textEditCommit`、`gx:htmlEditCommit`、`gx:keyCommand`、移动与缩放消息；读取或重放可观察 token 和 version；在导航、重载、切换文档、关闭视图之后重放旧消息；伪造选区与节点标识、注入超大和错误类型 payload，以及运行时篡改节点。断言未经对应宿主可信操作时源文档、保存文件、撤销栈和其他标签均无未授权变化，并验证正常编辑、撤销及浏览模式仍按冻结矩阵工作。每项记录攻击样本、前置授权、预期及实际结果、系统和 Electron 版本；安全措施对上游功能的影响单列。

## 8. 开发任务与依赖（待实施）

| 编号 | 任务 | 依赖 | 退出证据 |
|---|---|---|---|
| T00 | 批准固定上游 SHA、真实功能/工具/语言矩阵及三方差异、许可证 | 无 | 可重做源码清单与评审记录；dirty 改动归档而非覆盖 |
| T01 | 依赖、Electron/Vite/原生模块和构建兼容 PoC | T00 | 锁文件、安装、构建、启动与现有 Office 回归报告 |
| T02 | HTML main entry、renderer/preload、资源与 manifest | T01 | fresh 构建、bundle 导入及缺失/版本不匹配负向 |
| T03 | Host runtime、scheme、注册时序、路由、Tab 和菜单 | T02 | 多窗口实际打开/新建/关闭及注册冲突回归 |
| T04 | 文档 identity、快照、revision、原子操作与保存 | T03 | 跨入口同源、并发/取消/冲突/崩溃测试 |
| T05 | HTML 面板 transport、模型工具、澄清/队列 | T04 | 按批准工具矩阵逐项回放及真实模型测试 |
| T06 | 搜索、图像/媒体、附件和相应 provider | T05 | 实服务、故障与授权记录；功能矩阵无占位假成功 |
| T07 | 资源、preview/inspector、演示、打印/导出、CLI/headless | T03-T06 | 可执行网页、离线/联网及真实文件回读对等报告 |
| T08 | 主助手能力映射、审批、任务与交付 | T04-T07 | 主助手自然语言完整流程，权限与版本冲突证明 |
| T09 | 安全、性能、回归、打包/安装/升级/回滚 | T02-T08 | 见第 9 节，全部绑定最终 commit 与构建 hash |
| T10 | 最终批准启用 registry，来源/差异账本与发布归档 | T09 | 所有阻断项关闭、可追溯构建及验收签收 |

T05/T06 可并行研发，但统一合同及 T04 版本控制必须先冻结。某 provider 不可得时仅能在内部测试标注待接入；用户要求的完整对等功能未通过前，不得把整体标记为完成或公开宣称已对等。

## 9. 测试矩阵与交付证据

| 层次 | 样本与断言 | 证据与关闭方式 |
|---|---|---|
| 来源/构建 | 干净 clone、批准 SHA、锁文件、许可证、源变更；main/preload/renderer 缺失、混版 | 构建 manifest、hash、日志、真实加载及失败报告 |
| 上游对等 | 逐项 UI、快捷键、源码/可视编辑、撤销、预览、演示、文件和所有 AI 工具/provider | 批准目标同平台对照录像/结果、版本矩阵及差异关闭记录 |
| 文档一致性 | 手工编辑并发 AI、revision 变化、多 Tab 同一路径、撤销/重做、迟到 ack | 操作前后源码摘要、版本、撤销栈与 UI；无部分写入 |
| 文件生命周期 | 新建、打开、另存为、占用、只读、外部变更、硬链接/junction、崩溃/恢复 | 原文件 hash、最终文件内容、journal、提示和恢复结果 |
| AI/服务 | 真实模型工具调用、停止、超时、空结果、provider 失败、附件、多模态/搜索/图像 | 对照模型、工具、输入权限、脱敏 trace 与用户可见结果 |
| 隔离/安全 | 恶意 HTML/消息/网络/文件路径、跨窗口 sender、密钥与日志扫描 | 每项测试用例、平台、预期与实际、未修风险和签收 |
| 导出/资源 | 单文件、引用资源、中文路径、移动、离线、DOCX/PDF 回读及打印 | 文件大小/hash、实际内容与二次打开结果 |
| 性能/可用性 | 大 HTML、海量节点和图片、长流、并发 view、取消 | 启动/首交互、内存、CPU、卡顿和停止时间；预算由 T01 实测后批准 |
| 安装/回归 | 无源码干净安装、旧版升级、用户数据、回滚、现有 PDF/DOCX/XLSX/PPTX | 安装包 hash、版本、步骤、结果、日志和恢复证明 |

每条结果关联 `Friday commit`、vendor commit、批准上游 SHA、manifest digest、构建/安装包 hash、测试命令、机器/系统、时间、样本与报告位置。单元测试、隔离 harness、真实 UI、真实模型与安装验收分层记录，不能互相冒充。未执行记录为待验证，不填通过。

## 10. 依赖与难点

- 候选 package 声明的 Electron、Vite 与 Friday 现有版本不同，具体依赖闭包、native ABI、协议行为和 bundle 格式需在 T01 实测；不可仅以 `npm install` 成功判断兼容。若必须升级宿主工具链，应评估所有现有模块、许可与安装器影响。
- HTML 是可执行文档：既要保留上游脚本和 CDN 内容，又要保护本地文件、凭据和宿主 IPC。需在隔离 session、协议、网络授权和攻击测试共同证明，单独的 iframe sandbox 并不能覆盖所有威胁。
- 模型长流与手工编辑并发：必须将生成、应用、保存拆开，以 revision、原子 op 和取消 token 处理，不能以“最后一条消息”判断文件已更新。
- 上游版本更迭可能改变 HTML main exports、私有 IPC、provider 工具和资源路径。通过固定来源、能力清单、adapter、合同测试和可追溯差异台账发现变化，而不是硬编码上游私有调用永远不变。
- 引入远端搜索和图片服务涉及凭据、供应商协议、网络连通、隐私与成本；实现必须真实可配置、失败准确，不以假结果替代，也不把不支持说成完整对等。

## 11. 发布、回滚和未决事项

发布前固定 Friday 源码 commit、vendor commit、上游批准 SHA、patch set、依赖锁、资源 manifest、安装包 hash；整组构建并进行安装与更新验证。回滚以匹配的应用、Office bundle 和 manifest 为单位，并验证旧版可读用户文件、任务/偏好数据以及失败中断恢复；不能只替换单个 HTML renderer。此处是交付设计，不授权现在构建或发布。

以下必须在实施前评审并写入基准，而不是自行降低范围：最终上游批准版本与三方集成方式；HTML 文件/项目目录及附件可携带语义；预览默认网络和授权交互；实际可用的搜索、图片与媒体服务；跨应用主助手要暴露的具体领域操作；上游 CLI/headless 清单；性能预算和可支持平台。若发现上游行为与 Friday 安全或用户设置冲突，保留差异、给出替代方案和验收，不得静默屏蔽。
