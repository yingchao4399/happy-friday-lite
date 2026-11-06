# Friday Office AI 业务能力架构方案与技术拆解

日期：2026 年 11 月 5 日。版本：1.0。状态：Proposed，待实施。本文所有新增模块名、operationId、协议字段和工作量均为设计建议，不表示当前源码已经具有这些能力。

本方案承接根因研究报告与 PRD，交付目标是用 PDF→Word 验证一条可持续扩展的业务能力链：按钮、PDF AI、主助手共用执行器，真实交付文件，并保持后续跟进 GenOffice 的可维护性。不是重写整个 Office，也不把本次未实现的能力藏在“统一架构”名下。

## 1 工程目标与约束

### 1.1 需要改变的结构

当前链路是“菜单一套 handler、编辑器 AI 一套工具、主助手 CLI 一套路线、宿主缺少部分回调”。目标是“一份领域能力定义、多个入口投影、一套交付与校验机制、可替换的上游 adapter”。新增路线仍需实现真正的转换器，但不应再复制授权、保存、取消和错误逻辑。

### 1.2 不得破坏的边界

1. 复用中央 registry 的 schema、scope、审批与审计；复用 AI Core 的任务存储和请求身份，不另建竞争性全局工具平台。
2. Office renderer 保持沙箱边界，不能获得任意文件写入、任意 IPC 或主进程脚本执行能力。
3. 主仓库继续 JavaScript ESM，vendor 沿用自己的 TypeScript 规范。resources/office 是生成物，禁止手工修补。
4. 不改变既有 Agent 沙箱写入白名单。AI 默认输出到既有 SANDBOX；另选目录必须通过现有策略认可的用户文件授权。若现有政策不允许授权扩展，则不能仅因选择对话框出现就放行。
5. GenOffice 继续作为编辑器、转换器和格式实现来源；Friday 保持窗口、资源、授权、任务与用户数据治理。
6. Markdown、HTML 完整对等和后续上游功能跟进保留在总体计划，本次专项不能引入阻止未来接入的四编辑器硬编码。

### 1.3 本版最小完整闭环

PDF→DOCX 转换、从内容创建 DOCX、能力投影、可信交付和必要的可靠性机制必须一起验收。这里只补创建回调不构成完整闭环；一次性迁移所有编辑命令也不是本版前置。

## 2 现状与目标结构

### 2.1 现状调用图

~~~text
PDF 菜单 → pdf:convert-office → Friday exportPdfToDocx → 本地 converter
PDF AI   → create_document → PDF main → 缺 createDocument 回调 → 原样错误
主助手   → office_export/office_create → CLI 路由与另一组文件写入规则
模型流   → office-ai-bridge → 统一模型 transport，但并未统一上述业务执行
Docs 创建 → queueDocsAiContent → 立即 ok → renderer 之后才导入与保存
~~~

### 2.2 目标调用图

~~~text
菜单/快捷键 ── UI adapter ────────────┐
PDF 内 AI ── vendor tool adapter ────┼─ 受控入口 → 中央能力策略/授权
Friday 主助手 ── registry 工具 ──────┘                │
                                                     ▼
                            Office 领域执行器（宿主，不含模型推理）
                 资源解析 → 快照 → route → 转换/创建 → 校验 → 提交
                         │          │                      │
                  Resource adapter  │               artifact / journal
                                    ▼                      │
                         GenOffice adapter                 ▼
                     PDFium / Docs / CLI             Friday 标签打开
                                    │
                    持续上游升级只替换或调整 adapter

任务身份、存储、审计：复用 AI Core / registry
Office phase、quality、artifact：任务的领域结果与事件
~~~

这些是职责边界，不要求每个箭头各写一个框架。首期可采用少量内聚模块，避免十几个只有转发函数的空层。

## 3 模块划分与复用映射

| 职责 | 现有基础 | 建议实施位置 | 不能误做的事情 |
|---|---|---|---|
| 统一工具与权限 | agent/tools/registry.js | 注册 Office operation 投影 | 另做不经审批的新万能 invoke |
| 能力发现 | builtin/appActions.js、AI Core facade | 由同一 operation 描述生成已迁移能力 | 重复维护一份 AI 专用支持表 |
| Core 任务与事件 | ai-core/task-runtime.js、现有 store | 绑定 Core taskId，增领域 phase/result 映射 | 建第三套长期任务数据库 |
| Office 业务执行 | office/file-commands.js、office-host.js | 建议 office/operations.js、operation-catalog.js | 把所有 UI 逻辑搬到主进程 |
| 资源与快照 | host entry、snapshot/export 基础 | 建议 office/document-resources.js | 把当前 active tab 当持久身份 |
| 文件交付 | 现有 temp/backup、export-document | 建议 office/artifact-delivery.js | 多入口继续各自 rename |
| 上游适配 | configureRuntime、ShellHooks、build entries | 建议 office/adapters/genoffice.js | 在 vendor 引入 Friday DB/审批实现 |
| CPU 执行 | PDFium converter、OCR helper | adapter 调用隔离 worker/utility 原型 | 以 async 函数名代替性能隔离 |
| UI 状态 | task-progress、Office 页与 vendor App | 订阅有权限的任务事件 | 依赖聊天文本判断成功 |

实际文件数量可在实现评审中合并；逻辑依赖必须保持单向：入口依赖领域能力，领域能力依赖 adapter；vendor 不反向 import Friday 模块。

## 4 业务能力合同

### 4.1 operation 与 route 分层

operationId 表达稳定语义，例如 office.document.convert、office.document.create；routeId 表达可用实现，例如 genoffice.local.pdf-to-docx。它们是建议标识，落地时与现有 capability 命名规范映射，不能悄悄废弃已有 office_export 等工具名。

convert 的 schema 不能等价于任意 from/to 字符串。先从受支持 route 生成当前上下文的 format 枚举，再在执行时查同一路由表。工具名稳定，但 route 及其版本可以升级。

~~~json
{
  "operationId": "office.document.convert",
  "contractVersion": "1.0",
  "routeId": "genoffice.local.pdf-to-docx",
  "sourceKind": "pdf",
  "targetKind": "docx",
  "implementation": "genoffice-adapter",
  "effects": ["read-source-snapshot", "write-new-artifact"],
  "approvalPolicy": "existing-office-file-policy",
  "supports": {"cancel": "cooperative-or-isolated", "readback": true, "undo": false},
  "limits": {"profileId": "windows-x64-validated-profile"},
  "exposure": {"menu": true, "officeAi": true, "mainAgent": true}
}
~~~

这是设计示例，不代表 limits 对应性能已经验证。源或目标涉及覆盖时，effects 与授权绑定包含覆盖事实。undo=false 表示不能把恢复备份误称为用户可用的通用撤销。

### 4.2 动态 availability

描述返回 implementation 状态与运行时 availability，避免只用一个布尔值混淆：

| 维度 | 示例 | 执行含义 |
|---|---|---|
| implemented | true/false | 是否有已注册实现 |
| available | true/false | 当前依赖、资源、授权是否满足 |
| loadState | unloaded/loading/ready/failed | Docs 未加载可按需加载，不等于未实现 |
| reasonCode | SOURCE_MISSING、FORMAT_NOT_INTEGRATED、ENGINE_MISSING、POLICY_DENIED | 可本地化并用于测试 |
| qualityProfile | text、ocrOptional、imageFallback | 告知质量能力，不能预判每份文件质量 |
| catalogRevision | 版本或摘要 | 捕捉查询与执行间变化 |

能力目录不持有用户密码。构建可用与当前授权可用分开探测，不能因未获授权就泄露别人的资源元数据。

### 4.3 投影和执行的一致性

目录是主进程权威数据。菜单投影负责显示或禁用；PDF AI 投影只返回当前允许类型；中央 registry 投影保留现有纯 z.object 约束；执行器重新校验全部字段。静态类型声明和菜单缓存不构成授权。

建议主进程提供版本化的 capabilities 查询与 execute/getTask/cancel/reopen 端口。是否复用现有 IPC 通道由实现评审决定，不要求新增同义通道。历史 pdf:convert-office 与 create_document 只做受控转发，不再持有文件写入逻辑。

### 4.4 防止再漏接的完整性检查

CI 逐项断言：已启用路线有 handler、schema 输入可被 parser 接受、有结果 schema、有授权策略、有 fixture、有失败测试、有 bundle export、有安装资源声明。禁止通过把所有东西标 available=true 解决检查。

宿主启动也进行轻量 handshake。声明支持而资源缺失时标具体 unavailable，不让用户先调用再得到通用“host 不支持”。新上游能力默认为候选，须经过 adapter 与产品验收才能进入可执行投影。

## 5 请求、结果与错误协议

### 5.1 转换请求

~~~json
{
  "protocolVersion": "1.0",
  "operationId": "office.document.convert",
  "requestId": "host-generated-request-id",
  "idempotencyKey": "stable-original-tool-call-id",
  "source": {"resourceId": "office-resource-id", "revision": "r17"},
  "target": {"format": "docx", "destinationToken": "host-issued-selection-token"},
  "options": {"openAfterSave": true, "snapshotPolicy": "current-confirmed"}
}
~~~

主体、spaceId、sender、授权凭证由主进程上下文确定，不信任 renderer 自报。resourceId 和 destinationToken 也不是单独的权限凭证，执行仍验证所属主体与用途。

AI schema 可以只接收 format 和明确源引用，由 adapter 注入请求关联与主机交互；模型不必看到真实 OS 路径和内部 token。工具重试使用原调用身份，不能每次随机生成新 key。

### 5.2 创建请求

~~~json
{
  "protocolVersion": "1.0",
  "operationId": "office.document.create",
  "idempotencyKey": "original-create-call-id",
  "content": {"kind": "html-fragment", "value": "<h1>摘要</h1><p>经过确认的摘要正文。</p>"},
  "target": {"format": "docx", "title": "材料摘要", "destinationToken": "host-issued-token"},
  "provenance": {"mode": "generated-summary", "sourceResourceIds": ["office-resource-id"]}
}
~~~

content 大小限制、允许节点、外部资源策略与 HTML 清洗必须定义。清洗不能只靠字符串正则；复用编辑器已有安全解析器并补协议测试。provenance 不把内容来源伪装成整份原件格式转换。输入内容不得写进普通任务日志。

### 5.3 成功结果

~~~json
{
  "ok": true,
  "status": "succeeded_with_warnings",
  "taskId": "core-task-id",
  "operationId": "office.document.convert",
  "data": {
    "artifact": {
      "id": "artifact-id",
      "format": "docx",
      "path": "D:/用户确认的输出目录/材料.docx",
      "bytes": 18342,
      "persisted": true,
      "source": {"resourceId": "office-resource-id", "revision": "r17"},
      "quality": {"class": "mixed", "imageOnlyPages": [4], "ocr": "unavailable"},
      "open": {"state": "failed", "errorCode": "OFFICE_OPEN_FAILED"}
    }
  },
  "warnings": [{"code": "PAGE_IMAGE_FALLBACK", "pages": [4]}, {"code": "ARTIFACT_OPEN_FAILED"}],
  "error": null,
  "affectedResources": ["artifact-id"],
  "undo": null
}
~~~

数值与路径是协议示例，不是本轮实测产物。给模型的投影按权限只保留必要字段；给 UI 的投影可包含已获授权的真实路径。不能生成并不存在的下载 URL。

### 5.4 失败、取消与未知提交状态

失败返回 ok=false、status=failed、data=null；取消返回 ok=false、status=cancelled、error=null。提交中崩溃的任务用 interrupted 待恢复核对，不能立刻写成 failed 并自动重做。统一沿用 file-commands 的 ok/data/warnings/error/affectedResources/undo 结构，增加领域状态，不破坏原消费者。

| 建议 code | stage | 可恢复动作 |
|---|---|---|
| OFFICE_FORMAT_NOT_INTEGRATED | preflight | 选择已支持格式 |
| OFFICE_SOURCE_CHANGED | snapshot | 重新取得并确认版本 |
| OFFICE_POLICY_DENIED | authorize | 按既有政策选择有效资源 |
| OFFICE_PASSWORD_REQUIRED / INCORRECT | input | 本地输入或取消 |
| OFFICE_CONTENT_EMPTY | import | 修改内容后新建请求 |
| OFFICE_IMPORT_FAILED / SERIALIZE_FAILED | render | 检查内容或重启目标编辑器 |
| OFFICE_DOCX_INVALID | validate | 不交付；保留脱敏诊断 |
| OFFICE_TARGET_CHANGED | commit | 重新选择或确认覆盖 |
| OFFICE_WRITE_FAILED / RECOVERY_REQUIRED | commit/recover | 更换路径或人工恢复备份 |
| OFFICE_ACK_TIMEOUT / RENDERER_CRASHED | render | 终止任务；晚到 ack 无效 |
| OFFICE_BUSY / LIMIT_EXCEEDED | schedule | 稍后重试或缩小文档 |
| OFFICE_IDEMPOTENCY_CONFLICT | preflight | 拒绝，不返回其他主体结果 |

原始异常进入脱敏诊断；面向用户返回稳定 code 与 nextAction。取消不应转成异常文字后被模型当成网络故障重试。

## 6 资源身份、未保存编辑与快照

### 6.1 资源对象

DocumentResource 至少包含 resourceId、editorKind、所属主体/工作区、webContents 绑定、规范化源引用、revision、dirty 状态。resourceId 生命周期不得随标签标题变化；源重开或 renderer 重建须更新绑定世代，阻止旧消息访问新资源。

revision 必须覆盖编辑器内修改与已保存文件变化。只有 mtime 不足以区分内容；内部递增编辑版本加文件 stat，冻结快照后计算内容摘要。不能将外部新文件直接当成旧 resource 同一版本。

### 6.2 首选快照路径

复用已有 PDF 当前内容序列化能力，取得包含未保存修改的字节，写到任务私有临时文件；converter 只读取该快照。任务完成或安全失败后清理。转换不得调用普通保存去悄悄覆盖原 PDF。

实施前必须通过原型验证 PDF 的可见文字修改、批注、页面增删及旋转能否进入同一完整快照。若某种操作只保存在异步编辑状态，需等待其 flush-to-memory 完成，而非 flush-to-original-file。

如现有编辑器无法在不保存源的情况下产生完整快照：提供明确“保存后转换”交互，由用户选择；拒绝时取消。不能以本地转换器只能读路径为由强制覆盖原件，因为临时快照本身也可以是路径。

### 6.3 快照期间的竞态

~~~text
读取 revision r17 → 请求序列化 → 收到 bytes + revision
→ 再核对仍为 r17 → hash/冻结 → release 源短锁 → 转换固定快照
                              若变为 r18：丢弃，重新准备或询问
~~~

源锁只覆盖必要的快照阶段，不应在长转换期间把整个编辑器冻结。快照完成后切换或关闭源可继续；准备阶段发起视图关闭则取消。必须在 task metadata 写清使用哪个 revision。

离线源先验证授权，再打开受控句柄或复制到私有快照，并核对复制前后的身份。文件改动、删除或移动时不能自动替换成其他路径文件。临时目录用随机名、限制权限，密码只在内存或受控 IPC 中短暂使用。

## 7 共用转换执行器

### 7.1 首期 route 表

| 路线 | 本版后端 | 状态 | 说明 |
|---|---|---|---|
| 当前 PDF→DOCX | shell/pdf2docx-local 适配 | P0 实施 | 转换器复用，不复制算法 |
| 授权磁盘 PDF→DOCX | 同上，先快照 | P0 实施 | 不另走 CLI 文本成功判断 |
| 内容→DOCX | Docs renderer 序列化适配 | P0 实施 | 创建与转换是不同 operation |
| 已有内容→PDF/MD | 现有宿主实现核实后适配 | P0 防回归 | 不凭上游存在就宣称嵌入可用 |
| PDF→XLSX/PPTX | 本版不开放 | 后续总体项目 | CLI 有路线不等于此宿主已可用 |
| Markdown/HTML 新应用 | 独立应用 adapter | 后续总体项目 | 保留完整对等需求 |

本地转换入口实际为 vendor/happyoffice/apps/shell/src/main/pdf2docx-local.ts；构建经 scripts/office/entries/pdf.ts 导出。不要在 PDF main 目录新复制一份同名算法。

### 7.2 执行顺序

preflight → authorize → acquire source snapshot → choose/validate destination → reserve route capacity → run converter → validate temp DOCX → revalidate target/approval → commit → register artifact → open → finalize。

权限检查可在早期拒绝，目标选择可在快照前后调整以减少浪费，但实际写入前必须重新核对。交互取消时释放全部已取得资源。获取多个锁按稳定顺序，避免源锁与目标锁交错造成死锁。

### 7.3 转换器错误边界

adapter 捕获 converter 异常并转稳定错误；返回页数、OCR 能力、降级页与字节，不能把 Promise<void> 当完整结果。主进程最终判定合法输出，不信任下游自行写“success”。

旧 CLI 对本路线应转发同一 service，或在无法同进程复用时使用严格结构化协议调用同一转换 backend；不能让打开文档绕过快照与锁。本版优先直接本地 adapter，保留 CLI 对其他路线的原行为和迁移标记。

## 8 create_document 的完整修复时序

### 8.1 宿主回调与冷加载

Friday configurePdfRuntime 注入 createDocument adapter。adapter 先执行目录与授权校验，再 ensureEditor('docs')，等待 runtime 配置、IPC 和 ShellHooks 注册完成。不能为避免冷加载错误而要求用户先手动打开 Word。

wireShellHooks 需要实现嵌入式 Docs 的 openAiDocTab 路径，由 Friday 分配受控目标 view。上游 standalone 回退可以保留给独立应用；在 Friday embedded 模式缺 hook 则 fail closed，不允许意外创建独立 BrowserWindow。

### 8.2 双确认而非排队即成功

~~~text
主进程：分配 taskId / jobId / view generation / 一次性 nonce
  → 创建空白、无已打开路径的 Docs 目标 view
  → 发送 AI 内容导入任务（避免 pending open 路径抢先消耗）
renderer：等待 editor ready → 解析/清洗内容 → 检查有效节点
  → 导入 → 序列化 DOCX → 发 job 完成 ack / bytes 或受控临时句柄
主进程：校验 sender + view generation + jobId + nonce
  → 回读、验证 → 同一 artifact-delivery 提交
  → 更新目标路径与标题 → 获取加载/打开确认 → 最终结果
~~~

必须复用 Docs 真实序列化器，不能手写 ZIP XML 替代编辑器能力。若当前 API 只能由 renderer 保存，主进程仅授予任务私有 temp 位置，收到 ack 后自己回读再提交，禁止 renderer 决定任意最终目标。更优先使用 bytes 传输或受控流，但大文件不能无上限复制。

### 8.3 必须补的确认内容

applyAiDocContent 不能忽略 editor 未就绪、节点为空或 save=false。ack 必须在序列化/任务临时写入成功后产生，包含导入节点统计与受控输出引用。主进程不以这些自报统计代替文件验证。

每个 pending job 注册 timeout、renderer destroyed/crashed、用户关闭与取消清理。完成只允许一次；nonce 在取消后失效，晚到或重复 ack 丢弃。任务不能串到下一个新建标签。

创建失败应清理任务专属空白 view；若用户已在该 view 输入新内容，则先保留为用户未保存文档，不可自动删除。应用退出恢复也不得凭 job 消息重放覆盖。

## 9 文件交付、校验与恢复

### 9.1 校验分层

1. 路径与扩展名：由格式决定后缀，标题过滤非法字符，拒绝路径穿越。
2. 容器：ZIP 可读，关键部件与关系存在，设合理解压限制避免 ZIP bomb。
3. 内容：document XML 安全解析，不加载外部实体；正文与预期对象非空，扫描图片型结果按质量规则允许。
4. fixture：唯一标记、数字、中文、表格/图片与页映射可回读；生产文件不要求模型提供全文作为比较基准。
5. 打开：单独验证 Friday Docs 可加载。打开失败不推翻已完成文件交付。

仅看大小、扩展名或工具 ok 不够；反过来，ZIP 合法也不等于复杂版面与全文语义完全正确。

### 9.2 安全提交

临时输出位于目标同目录、唯一命名并排他创建；写完关闭并尽可能执行文件同步。已存在目标先做身份快照和覆盖授权。提交前再次核对目标身份；目标变化使旧授权失效。

用目标锁、同目录 rename、可恢复备份与 journal 保护提交。所有 targetPath、tempPath、backupPath 在明确可清理作用域声明，修正当前 targetPath finally 风险。备份恢复失败必须显式返回恢复位置，不吞异常后仍说原件安全。

### 9.3 不承诺不存在的跨进程原子性

Windows 目标占用、杀毒软件、网络共享、权限变化和 reparse point 都影响 rename；多步 temp/backup/rename 并非数据库事务。Node 的通用文件 API 不能保证对恶意外部进程完全消除所有路径竞态。

首期支持范围优先本机普通文件目录，规范化 realpath/父目录，检测源目标同文件身份、大小写别名、硬链接和链接风险。对于无法可靠核对的 reparse/网络目标应拒绝、改用新唯一文件名或明确降级策略，不能声称完全安全后直接覆盖。若要承诺更强保证，需 Windows 原生句柄级实现与专项测试，另列工作量。

### 9.4 journal 与事实恢复

journal 只记录 taskId、受控路径/身份、预期 hash、提交阶段和授权摘要，不记录文档全文或密码。按 prepared、backup-created、new-installed、verified、cleanup-complete 记录状态；每次恢复对实际文件重新 stat/hash。

| 重启时事实 | 恢复原则 |
|---|---|
| 只有 temp，无最终提交 | 不当成功，清理或保留待诊断 |
| 旧目标已备份，新目标不存在 | 验证后恢复旧目标，不重新转换 |
| 新目标存在且 hash/结构正确 | 登记已交付，保留并补完任务记录 |
| 新目标不符且备份存在 | 停止自动删除，提供恢复诊断与人工选择 |
| 任务记录写失败但 artifact 已提交 | journal 重建交付事实，不把结果当不存在 |

文件与 SQLite 之间无跨介质原子事务；journal 是核对与补偿机制，不是“永不丢数据”的承诺。sql.js 现有 saveDb 行为及写盘时序需要验证，必要时给本提交使用独立原子小文件 journal，并在既有任务记录存引用，不能再建一套通用任务库。

## 10 任务生命周期与既有 AI Core 的映射

### 10.1 一个任务身份，领域阶段单独记录

现有 Core 使用 draft、awaiting_approval、running、verifying、completed、failed、cancelled 等全局状态，不能直接把 PRD 中 importing、opening 等阶段字符串写进全局 status，否则 assertTaskTransition 会拒绝。Office phase 作为领域事件与 checkpoint 保存。

| Office 状态/阶段 | Core 映射建议 | 注意 |
|---|---|---|
| queued/preflight | draft 或 running + phase | 使用现有合法迁移，不新增同义全局状态 |
| 等待高风险授权 | awaiting_approval | 沿用既有审批，不保存密码到待审批正文 |
| 等待路径/密码 | running + waiting_input phase | UI 输入不是另一份工具授权 |
| snapshot/convert/import | running | 保存 sourceVersions 和进度 |
| validate/commit | verifying，需按现有验证流程接入 | 取消行为必须与提交边界协调 |
| open | verifying + opening phase | 文件交付已完成，打开独立判定 |
| succeeded / with_warnings | completed + domain result | 警告不能被 Core 错当全部失败 |
| interrupted | interruption/checkpoint，恢复协调 | 若需新增全局状态，必须另做兼容迁移评审 |

实现时审查 Core capabilityOutputSucceeded 的字符串兜底与 readbackSatisfies 的工具名硬编码。新 operation 必须返回结构化对象并提供明确 readback 绑定，不能依赖“非空字符串算成功”或盲目再读任意文件。

### 10.2 按钮如何接入任务，而不制造第二套系统

按钮入口建立有明确 user-action 来源的确定性请求，接入现有 Core task/store 和领域策略；不需要先调用模型规划。主助手已存在 Core task 时把 taskId/stepId 注入领域操作，禁止再创建一个彼此不关联的顶层任务。

需要在 G1 做小原型确认：当前 Core 是否能接受确定性 Office 单步计划、领域事件和文件提交后警告。优先扩展既有 runtime 的窄入口；若存在结构限制，编写最小桥接并复用 store，不允许跳过 Core 创建长期独立任务表。该适配本身纳入测试，不能只写“以后统一”。

### 10.3 结果是事实，事件只是通知

task-progress 事件携带 taskId、sequence、phase、resourceId 和已知页数。订阅者按权限过滤；序号可去重，但断线后查询 task 详情恢复，不能从事件是否收到推测文件存在。百分比仅在确实知道页数与阶段权重时使用。

## 11 授权、幂等、锁与取消

### 11.1 同一策略，不同授权来源

菜单点击可作为特定操作的用户动作来源；工具通过 registry 的审批规则取得授权。两者最后都检查同一资源和文件策略，不要求菜单模拟模型 riskAssessment，也不允许 AI 借“等价于点按钮”绕过审批。

不得从 renderer 传 approvalGranted=true。主进程签发或保存的授权上下文绑定 actor、space、operation、source revision、destination identity 和用途。既有 invoke_app_action 的审批等价判定不能扩大成对子调用的通用信任。CLI 旧内部审批若复用要梳理责任，确保既不漏审，也不发生无法结束的重复审批循环。

### 11.2 幂等键

作用域至少包含 actor/space、operation 与原始调用 ID；fingerprint 覆盖规范化参数、源快照版本、目标授权身份及影响结果的选项。相同 key 与相同 fingerprint 返回已有任务；同 key 不同参数拒绝。不同主体的 key 即使文字相同也不能查询到他人的任务。

创建内容的摘要可参与 fingerprint，但明文内容不进入普通审计。快照冻结前的 provisional 请求与冻结后的实际版本分开记录，避免同一请求重试时静默换源。用户明确改参数或换源是新任务；重试打开是同一 artifact 的独立后续动作。

进程崩溃后只靠内存 Map 不足以提供幂等。需持久化 key 映射与提交事实，并在恢复阶段先核对 journal。保证可诊断的去重与不重复覆盖，不泛称跨崩溃“严格 exactly-once”。

### 11.3 锁

- 源快照短锁：防止序列化时读到混合版本。
- route capacity：首期全局转换并发建议 1，待测量后调整。
- 目标锁：以规范化目标身份为键，覆盖提交与恢复，限制同目录同名竞争。
- renderer job 锁：同一个目标 view 的导入与用户编辑不能并行覆盖。

锁必须在 finally 释放，并为进程级崩溃提供租约/恢复语义；不能用永久 busy 布尔值。外部应用占用不受内部锁控制，应作为独立文件系统错误处理。

### 11.4 取消提交竞态

~~~text
可取消：等待输入 / 快照 / 转换 / 导入 / 校验
    cancel → revoke job nonce → abort worker → 清临时输出 → cancelled

提交临界区：持目标锁并进行最后取消检查 → commit journal → 安装新文件
    此区间取消 → 标记请求，等待核对提交事实，不能删除已交付文件

已提交：cancel → 返回已生成结果，必要时只停止自动打开
~~~

如果 Core verifying 状态目前不允许直接 cancelled，应通过窄协议或合法状态变化协调，不能强行写非法状态。该问题在 G1 设计冻结，在 G3 故障注入验证。

没有安全中断 API 的 WASM 任务放隔离执行单元；取消时先阻止提交，必要时终止执行单元。终止子进程不等于完成清理，超时后必须继续核对 temp 与 journal。

## 12 OCR、性能与资源隔离

### 12.1 不以合法 DOCX 冒充可编辑转换

adapter 收集每页文本、OCR 与图像回退信息；无法取得可靠质量信号时标 unknown。editable 表示存在可编辑文字并通过对应检查，不等于版式无损；mixed/imageOnly 要明确受影响页。helper 可用也不能推断识别准确。

现有系统 helper 候选为 Windows win-ocr.exe、macOS vision-ocr，源候选目录 packages/pdf2docx/ocr-helper。实际是否打包、运行权限、系统语言包与 CPU 架构必须探测并测试。缺 helper 时按已声明策略图片降级或明确不可用；禁止静默外发。

### 12.2 隔离方案选择

| 方案 | 好处 | 代价/限制 | 本版判断 |
|---|---|---|---|
| 主进程直接调用 | 接入少 | CPU/WASM 可阻塞，取消弱 | 仅作为性能对照，不默认视为合格 |
| worker_threads | Node/WASM 易共享代码 | 崩溃/内存隔离较弱，原生兼容要测 | 原型候选 |
| Electron utility process / 受控子进程 | 可终止，故障隔离清楚 | 资源定位、IPC、大字节传输、打包更复杂 | 优先验证的生产候选 |
| 外部 Python/云端转换 | 可选算法多 | 新依赖与隐私/分发问题 | 不是本版默认方案 |

G1 用同一数字、扫描和大图样本比较主进程延迟、峰值 RSS、总耗时、冷加载与取消耗时，决定执行单元。无论选择何种方案，主进程保留最终提交权；worker 只写受控 temp，不得直接覆盖用户文件。

### 12.3 资源预算

PDFium 首次加载、图片解码、OCR 子进程和 DOCX ZIP 可能叠加内存。按页流式或分批处理的可行性需要验证，不能盲目把整个 PDF 多次 structuredClone。大块数据优先受控 temp/流或可转移 buffer，校验总字节上限与超时。

性能报告记录样本 hash、页数、图片分辨率、CPU/RAM、系统版本、冷暖态和构建 SHA。尺寸/页数限制由实测确定并进入能力目录；“超限前拒绝”和“可停止”也是发布测试。

## 13 持续跟进 GenOffice：维护模型

### 13.1 当前远端关系必须先厘清

本地 .gitmodules 指向 yingchao4399/happyoffice，submodule 的 fork remote 同样指向该 fork，origin 指向 cheney-plus/happyoffice。它们都不能仅凭 remote 名称被当成 genspark-ai/genoffice 官方上游。当前固定 vendor SHA 及 describe 已在研究报告记录。

后续升级首先建立“官方目标 tag/SHA → 中间来源/fork → Friday vendor SHA → 构建资源”溯源表，核验共同祖先、许可证与分叉改动。不要直接把 origin/main 拉进来就称跟进了 GenOffice 最新版。2026-11-05 已通过官方 releases/latest 核验 v0.12.852 为查询时的 Latest，并以 git ls-remote 核对 tag 引用 SHA 4b55db9ed1994575a695160ffc6cfd0bfc866211。v0.12.600 继续作为原总体文档的历史目标；v0.12.852 是下一次完整融合的评估候选，尚未建立其与当前 fork 的祖先、差异和兼容性结论。

官方 v0.12.852 说明包含 PDF→Word 的重复页眉、连续页码与 DOCX 兼容性改进，以及 agent 权限、兼容模型上下文处理变更。下次 U1 对这几类变更逐项定位提交、接口和依赖；U3/U4 用固定样本验证新转换器与 Friday 能力投影。优先复用上游格式实现，避免重新造同类算法；宿主回调、完成 ack、权限与 artifact 合同仍需独立验证。发布页信息不能替代代码审计或安装版测试。

### 13.2 四类代码所有权

| 区域 | 所属责任 | 后续上游升级的规则 |
|---|---|---|
| GenOffice 原生编辑器/格式算法 | 上游为主 | 尽量保持原结构，升级时接受上游实现并跑对等回归 |
| 通用嵌入 hooks/ack/protocol | vendor 薄扩展 | 独立小提交、无 Friday 业务依赖，优先向上游贡献 |
| Friday 权限、任务、窗口、交付 | 主仓库宿主 | 不在 vendor 复制，升级主要修改 adapter |
| resources/office | 生成物 | 固定来源全量重建，禁止手工合并或热改 |

并非承诺 vendor 零修改：当前 Docs 的完成确认与通用宿主接口可能必须修改 vendor。目标是最小且可解释的接口差异，而非把 bug 留着以追求零 diff。

### 13.3 接口握手与兼容窗口

建议为打包产物增加 host protocol 描述：hostProtocolVersion、adapterVersion、vendorSha、可选 hooks、content schema version、实际 routes、resources digest。导出方式可为构建 manifest 加受控 runtime describe，不要求上游为 Friday 增专有全局对象。

新增可选字段按兼容版本处理；破坏性内容节点、函数签名或 ack 变化需新 major adapter。未知字段可忽略，未知必需能力应准确禁用，不能 fallback 到未经验证的任意 IPC。

只声明经过测试的“当前/目标构建组合”，不承诺兼容所有历史版本。实际默认支持当前安装基线与一个候选升级组合；如需 N-1，必须保留相应资源与测试预算。

### 13.4 可审计的差异清单

建议新增 vendor-integration manifest，记录每条 Friday 专有差异的编号、修改文件、用途、依赖的 hook、测试、上游 issue/PR（若有）、可删除条件。例如 V01 创建完成 ack，V02 源快照接口，V03 embedded 模式禁止独立窗口回退。

优先独立提交或 topic patch，而不是散落的构建时字符串替换。必须使用构建转换时，要按 AST 或精确版本前提校验，匹配失败立即停止，不能静默跳过补丁。

每次升级重新审查差异：上游已解决则删除自有实现并回归；上游改变语义则更新 adapter；仍必要的差异重新基于目标 SHA 验证。不能把旧 patch 无条件机械重放。

### 13.5 新上游模块如何进入 Friday

~~~
固定上游 tag/SHA
 → 盘点编辑器、preload、main export、资源、工具、格式、许可证
 → 实现/更新通用 adapter 与 manifest
 → 与上游功能对照验收
 → 加入构建 allowlist 并全量生成 resources
 → 运行原能力回归与新模块对等测试
 → 安装版验收
 → 统一更新目录投影后开放
~~~

Markdown 和 HTML 应按完整应用接入：入口与路由、生命周期、读写与格式、编辑器 UI、AI 工具、资源依赖、主题语言和文件关联均有对照表。只新增输出扩展名或 create_document 枚举不算具备这两个应用。

当前 build-office.mjs 的 EDITORS 仅 docs/sheets/slides/pdf。未来应使用受版本控制的 editor manifest 驱动构建与宿主注册；本版先建立 manifest 扩展点与测试，无需同时实施 Markdown/HTML 全部功能。不能以自动生成菜单代替逐项对等验收。

### 13.6 每次上游升级的固定门禁

| 门禁 | 必须产出 | 阻塞条件 |
|---|---|---|
| U0 目标冻结 | 官方 tag/SHA、来源关系、许可证差异 | 来源不明或不可复现 |
| U1 接口差异 | hooks、IPC、parser、schema、renderer 内容、资源差异表 | 必需接口缺失且无 adapter |
| U2 干净构建 | lockfile、工具链、全部编辑器产物与摘要 | 依赖开发目录、复用未知旧资源 |
| U3 既有能力 | PDF→Word、创建、保存/打开和安全负向测试 | 任一 P0 回归 |
| U4 新功能对等 | 按模块功能清单与样本报告 | 将仅存在于上游的功能宣传为已接入 |
| U5 安装和升级 | 无源码目录运行、历史数据、回滚验证 | 数据损坏、资源混版、不可恢复 |

本版需要建立 U0–U3 的模板与自动检查基础，不需要现在完成下一次完整上游合并。将“本专项完成”和“全量上游升级完成”作为独立发布事实。

## 14 技术难点与克服方式

| 难点 | 为什么不能只补一行 | 处理方法 | 证据/退出条件 |
|---|---|---|---|
| AI transport 与业务执行分离 | 模型能调用不代表宿主有 handler | 目录、入口 adapter、共用 service | 同 fixture 三入口产生同语义结果 |
| 未保存 PDF | 磁盘文件不是最新编辑状态 | revision + 内存序列化 + 私有快照 | AC12–AC16，不改源 hash |
| Docs 异步 ready/import/save | 排队成功不等于落盘 | job ack、sender 校验、主进程回读 | AC05/06/25/26 |
| 混合任务状态 | Core status 与 UI phase 不同 | 显式映射，结构化结果 | 合法状态测试与恢复查询 |
| 取消/提交竞态 | 迟到结果会覆盖或假取消 | 提交临界区、nonce 作废、journal | AC22/23/26/29/32 |
| 文件系统不是真事务 | rename/占用/备份恢复会失败 | 同目录 temp、身份重验、补偿恢复 | AC19–AC21/31/32 |
| 权限入口不同 | 直接 UI 与模型审批不能混用 | 同策略、可信授权来源、绑定范围 | AC08/09/18/20/33 |
| OCR 与转换质量 | 图片 DOCX 看起来也像成功 | 页级质量、helper 探测、样本评分 | AC27/28、质量报告 |
| CPU/内存峰值 | async 无法避免主线程阻塞 | 隔离原型、并发限额、可终止任务 | AC29/30/36 |
| 上游变化 | 签名、节点、资源都会漂移 | 薄适配器、版本握手、差异清单 | UPD01–UPD12 与 U0–U5 |
| 多入口兼容迁移 | 新层可能只变成第四套逻辑 | 旧入口转发、删除重复实现、覆盖检查 | AC37/40 |

## 15 文件级改造计划

下表是预期改造落点，不是已经提交的代码 diff。执行前按固定 SHA 再核对函数位置，行号不作为接口合同。

| 文件/区域 | 计划修改 | 保留内容 |
|---|---|---|
| src-electron/office/office-host.js | 注入创建、受控 hooks、旧转换 handler 转发、真实 open 结果 | Friday 视图与标签生命周期 |
| src-electron/office/file-commands.js | 共用快照/取消/结果 adapter | 不相关导出路线的现有行为 |
| src-electron/office/operation-catalog.js（拟） | operation/route/availability 与投影 | 不复制全局 registry |
| src-electron/office/operations.js（拟） | convert/create 编排 | 不包含模型请求 |
| src-electron/office/document-resources.js（拟） | 资源、revision、快照、sender 校验 | 复用现有 entry 状态 |
| src-electron/office/artifact-delivery.js（拟） | 校验、temp、备份、journal、artifact | 保留既有用户文件 |
| src-electron/office/adapters/genoffice.js（拟） | vendor exports、hooks、ack 与版本兼容 | 不泄露宿主数据库给 vendor |
| src-electron/agent/tools/builtin/ 的 Office 接入 | 注册与发现投影、历史工具兼容 | scope/HITL/audit |
| src-electron/office/office-agent.js | 本路线收敛、CLI 结构化解析与写锁核对 | 其他 CLI 能力按清单保留 |
| src-electron/ai-core/{contracts,task-runtime,...}.js | 最小任务/phase/result 桥接、readback 映射 | 现有任务语义与历史记录兼容 |
| vendor PDF main/preload/renderer tools/App | 能力查询与转换工具、创建协议、显示结构化错误 | 原编辑器与 standalone 功能 |
| vendor Docs main/App/file-actions | 通用 job ack、真实导入失败、嵌入 hooks | Docs 独立应用默认行为 |
| vendor shell/pdf2docx-local.ts 与 pdf2docx | 返回质量、进度/取消适配（按原型结果） | 复用转换实现 |
| scripts/office/entries/pdf.ts、build-office.mjs | exports、manifest、资源与协议检查 | 禁止手改生成物 |
| src/i18n/locales/ 两语言 | 状态、错误、禁用原因与后续动作 | 既有 key 不重命名 |
| scripts/tests/ 与 Electron probe | 合同、故障注入、内容回读和安装测试 | 不以 Mock 替代真实 Electron |
| package build.files 与资源清单 | 新 runtime/helper/manifest 打包验证 | 不随意扩大白名单 |

若新运行时模块不在打包白名单，开发可用而安装失败，视为 P0。vendor 变更必须独立提交和推送到正确 fork 后再更新主仓库 gitlink；主仓库提交不能仅引用开发机存在的 vendor SHA。

## 16 工作包、依赖与验收追踪

### 16.1 工作包

| ID | 工作包与责任领域 | 依赖 | 输出 | 完成证据 |
|---|---|---|---|---|
| W01 | 入口/操作与上游差异盘点，架构负责人 | 固定基线 | 能力矩阵、legacy 清单、来源图 | E01–E20、CAP07、UPD01/02 |
| W02 | 复现与测试样本，测试负责人 | W01 | 红测试、授权 fixture、内容标注 | AC01/05 已红与分层测试计划 |
| W03 | 合同与 Core 桥接，宿主负责人 | W01/02 | schema、状态、错误、任务映射 | CAP01–06、TASK01/09、AC08/17 |
| W04 | 源资源/快照，编辑器负责人 | W03 | revision、dirty 序列化、sender 绑定 | SRC01–08、AC09/12–16/31 |
| W05 | 安全交付与恢复，文件服务负责人 | W03 | artifact、校验、锁、journal | OUT01–08、AC19–24/32 |
| W06 | 转换 adapter 与执行隔离，格式负责人 | W03/04 | 本地 route、质量、容量限制 | DOC01/02、AC01–04/27–30 |
| W07 | 创建 DOCX 真实确认，Docs 负责人 | W03/05 | 冷加载、通用 ack、序列化 | DOC03–09、AC05/06/25/26/38 |
| W08 | 菜单与 PDF AI 投影，前端负责人 | W03/06/07 | 同源菜单/schema、状态与错误 | AC02/07/08/10/11/24/34 |
| W09 | 主助手与 CLI 兼容，Agent 负责人 | W03/04/06 | 共用 service、审批/结果 adapter | AC03/04/09/17/18/37 |
| W10 | 生命周期与故障注入，测试负责人 | W04–09 | 取消/迟到/崩溃/占用报告 | TASK02–11、AC15–26/29/32/33 |
| W11 | OCR/质量/性能，格式与测试负责人 | W06/07 | 分类型评分、预算与限制 | QUA01–07、AC27–30 |
| W12 | 上游兼容与 manifest，集成负责人 | W01/03 | handshake、差异清单、U 门禁模板 | UPD01–12、AC40–45 |
| W13 | 构建与安装验收，发布负责人 | W10–12 | 产物摘要、安装/升级/回滚证据 | AC35/36/39/46–48 |
| W14 | 文档与交付核对，产品/研发/测试 | 各门禁 | 发布说明、限制、用户排障路径 | P0 无未关闭项 |

表中“负责人”是岗位责任，未分配真实人员或启动并行代理。W01 的全量盘点不等于把全量功能迁移到本版，移交文档须明确已迁移分母。

### 16.2 依赖与关键路径

~~~text
W01 + W02 → W03
                 ├─ W04 ─ W06 ─ W08/W09 ─┐
                 ├─ W05 ─ W07 ───────────┼─ W10/W11 → W13 → W14
                 └─ W12 ────────────────┘
~~~

最不确定的是完整未保存快照、Docs 序列化确认、隔离执行与安装资源。先做原型证明，不应最后一天才发现必须修改 vendor 协议。

### 16.3 需求追踪

| PRD 需求组 | 主工作包 | 测试/证据 |
|---|---|---|
| CAP01–07 | W01/03/08/12 | schema 投影、执行拒绝与 completeness |
| SRC01–08 | W04/09/10 | revision、sender、外部修改、源 hash |
| DOC01–10 | W06–09/12 | 三入口、冷创建、空内容、legacy 转发 |
| OUT01–09 | W05/08/09/10 | XML/内容回读、覆盖恢复、真实回复 |
| TASK01–12 | W03/05/10/13 | 状态、幂等、锁、取消、重启与打开 |
| QUA01–07 | W06/11/13 | 页级质量、helper 与基准 |
| UPD01–12 | W01/12/13 | 来源、adapter 协议、构建组合与升级 |

## 17 验证策略与故障注入

### 17.1 不同层验证不同事实

| 层级 | 覆盖 | 不足以替代 |
|---|---|---|
| 单元 | schema、投影、状态、fingerprint、路径与错误映射 | 真实 editor/preload |
| 集成 | temp/备份/journal、converter bytes、任务 store | Electron sender 和 UI lifecycle |
| Electron | 真实 PDF renderer/preload、Docs cold load、工具执行 | 安装资源与用户升级 |
| 安装 | 无源码目录、开发依赖不存在、真实 helper 与资源 | 复杂文档语义质量 |
| 内容/人工质量 | 文本、数字、对象、阅读顺序、版面 | 幂等、权限与崩溃恢复 |

现有 probe 已复现创建回调缺失，尚未真正触发 LLM 的完整工具循环，也没有验证所有转换样本。后续增加确定性的工具选择回放与至少一次真实模型 smoke；模型服务不稳定不能用来掩盖确定性业务失败。

### 17.2 故障注入点

在快照前后、converter 完成、temp 写入、旧目标备份、新文件 rename、artifact 登记、打开标签和 final 回复前逐点注入取消、异常和进程退出。每点记录源 hash、目标/备份事实、任务状态、锁和等待器数。

模拟满盘/权限错误必须使用受控测试目录或 mock fs，不破坏用户盘。恢复测试使用临时用户配置，不读取或覆盖真实资料。对晚到 ack 验证它不能提交、覆盖、误完成新任务。

### 17.3 需要执行的命令与当前状态

~~~powershell
# 已有红测试：当前仍应失败，不作为通过证明
node scripts/probe-office-pdf-ai-delivery.mjs

# 实施后：相关单元/集成与全量脚本测试
node --test scripts/tests/
node --test scripts/*.test.cjs

# vendor 源码变化后必须重新生成；不能用旧 resources 冒充
npm run office:build
npm run build

# 真实 Electron 冒烟；测试账号和数据目录隔离
npm run electron:dev

# 安装候选：确认脚本与目标平台后执行，不自动发布
npm run electron:build:win
node scripts/verify-packaged-native-modules.mjs x64
~~~

这些是后续执行清单，不表示本轮已经运行并通过。新专项测试命令和报告路径在实施中补入，不能预先列不存在的脚本为已可运行。

## 18 分阶段估算与发布门禁

### 18.1 工作量建议

以下是已有证据基础上的范围估算，单位为工程人日，不是承诺交付日期；不含完整 GenOffice 合并、Markdown/HTML 完整应用或全新 OCR 引擎。

| 方向 | 初步范围 | 不确定性 |
|---|---|---|
| 盘点、合同、原型 W01–03 | 3–5 人日 | Core 与领域阶段桥接 |
| 源快照、转换、创建 W04/06/07 | 6–10 人日 | vendor 序列化与执行隔离 |
| 文件交付与生命周期 W05/10 | 5–8 人日 | Windows 失败恢复、任务提交 |
| 入口投影与兼容 W08/09 | 3–5 人日 | 双审批与旧工具迁移 |
| 上游兼容基础 W12 | 2–4 人日 | 当前 fork 关系与协议差异 |
| 质量、安装与交付 W11/13/14 | 5–8 人日 | OCR 语言、样本和升级 |
| 合计 | 24–40 人日 | W03 原型后重估；部分工作可由团队并行 |

若只需消除一个错误字符串，工作量明显更小，但不能满足用户本次的根因治理与升级维护要求。若资源不足，应减少公开能力或拆候选里程碑，不能跳过源保护和真实交付门禁。

### 18.2 门禁

G0 文档与红测试 → G1 合同/快照/隔离原型冻结 → G2 真实主链路 → G3 故障/恢复 → G4 分类型质量与性能 → G5 安装候选。任一 P0 失败停止专项发布；架构验证 P1 未完成要说明影响，不能宣称后续接入已自动化。

版本号和发布日期在 G5 候选生成前确定。安装包、GitHub release、自动更新清单是三项独立动作，均需证据，不能因编译成功就声称已经发布。

## 19 迁移、回滚与旧路径退出

### 19.1 迁移次序

先让共用 service 独立通过 fixture，再让旧按钮 handler 转发，再接 PDF AI 和主助手，最后删除重复文件写入逻辑。flag 对同一 operation 的全部入口一起生效；不能把 AI 留在已知坏回调。

历史工具名和旧 IPC 在一个明确兼容窗口内转发并记录 legacy 来源。真实执行只有一个；如果仍有第二套转换流程存在，要在覆盖矩阵标未迁移，不得称完成。

### 19.2 回滚原则

回滚主程序时同时回滚匹配的 vendor gitlink、生成 bundle 与 manifest。禁止仅替换 main bundle 混用旧 renderer。数据库新增字段必须向后兼容，旧安装版不能因未知字段损坏用户数据。

暂停能力时同步禁用菜单和 AI 投影，保留已有 artifact 与只读能力。已生成用户文件不随回滚删除；提交未决任务先 journal 核对，不能回滚后盲目重放。

### 19.3 旧路径删除条件

新旧行为对照、P0 全过、安装验证、兼容调用观测和差异清单齐全后删除旧执行逻辑。旧 alias 的移除另行记录兼容变更，不能让现有会话保存的工具调用突然变成无说明错误。

## 20 架构决策记录（Proposed）

| ADR | 决策 | 放弃的选项与代价 | 复审条件 |
|---|---|---|---|
| ADR01 | 复用 Core + Office 领域执行器 | 只补 callback 不治共性；全重写阻断交付 | Core 证明无法承载领域任务时 |
| ADR02 | 操作族 + route，目录同源投影 | 每按钮一工具重复；万能 IPC 权限失控 | 新业务语义无法用现有族表达 |
| ADR03 | 私有源快照，提交权在宿主 | 直接读路径遗漏编辑；静默 flush 改源 | 编辑器快照 API 变化 |
| ADR04 | 创建必须 ack + 主机回读 | 排队即成功；仅监听标签创建 | 上游提供等价可靠 API |
| ADR05 | 交付与打开分离 | 打开失败删结果或重复转换 | 新生命周期方案不损交付事实 |
| ADR06 | 通用薄 hooks + 主仓库 adapter | 深改 vendor；自动更新上游即启用 | 官方提供稳定嵌入协议 |
| ADR07 | 本地默认、OCR 状态显式 | 静默云上传；图片结果称全可编辑 | 独立授权云方案获产品批准 |
| ADR08 | 隔离与并发由原型决定 | async 等于后台的错误假设 | 实测足以证明更简单方案合格 |

ADR 状态保持 Proposed，只有实现评审与测试证据齐全后转 Accepted/Implemented。文档本身不能代替工程验证。

## 21 交付清单与完成定义

研发交付代码与 vendor 独立提交、协议/差异 manifest、更新后的生成资源、专项与全量测试报告、分类型质量报告、无源码安装验证、构建摘要、发布限制与排障路径。所有 AC 的“实际结果”都有版本和证据，不允许仅填“符合预期”。

从根上改善的检验方式不是文件数量或架构图：增加一个测试转换 adapter 时，菜单、PDF AI 和主助手能否通过同一目录得到一致支持，权限/任务/交付代码无需复制；上游替换候选 bundle 后，协议不兼容能否在构建或启动时发现，而不是等用户遇到“host unavailable”。

本轮交付是研究、PRD 和技术拆解，尚未完成产品修复、安装候选生成或 GitHub 发布。下一步可以按 W01–W03 冻结合同与原型，再依据门禁推进实施；原总体升级文档和旧 PDF 专项文档继续保留作为后续依据。
