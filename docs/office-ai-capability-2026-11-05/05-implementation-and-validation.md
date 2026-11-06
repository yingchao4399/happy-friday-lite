# Friday Office 下一预览版实施记录与验收账本

日期：2026 年 11 月 6 日。版本：0.3。状态：preview.36 本地候选安装器已经生成，包内 PDF/Core 确定性交付探针、PDF AI 真实模型复测及十组合成质量探针通过；真实安装、升级、回滚、复杂真实 PDF、主助手真实模型自由规划与 GitHub 发布仍未关闭。第 2.1、2.2 节记录最新证据和剩余清单；第 2 节原表及后文 preview.35/初始 AC 状态是历史快照，不能覆盖本轮新证据。AI HTML 下一版已开始基础接入，完整对等尚未实现。本文承接本目录三份研究/规划文件和第 04 份持续上游集成合同，不改写历史总体文档。

## 1 本次迭代的完整目标

本次以用户遇到的“PDF 内 AI 无法把 PDF 转成 Word，返回 document creation is unavailable in this host”为直接问题，完成 PDF→DOCX 与内容→DOCX 的业务闭环，并为后续持续跟随 GenOffice 新功能保留可维护边界。

完成需要同时证明：PDF 菜单、PDF 内 AI、Friday 主助手调用同一领域服务；转换读取指定 PDF 的当前快照；创建等待真实 Docs 导入和序列化；交付经过格式和落盘回读校验；取消、重试、失败恢复不会重复写入或破坏原件；安装后的资源组合可追溯；后续新应用和新 route 有明确接入与验收方式。

“已有代码”“测试 fixture 通过”“完整 Office 构建通过”“真实 Electron 通过”“安装通过”“GitHub 发布”是不同事实。本文逐项记录，不用某一层绿灯代替其余层。

## 2 来源、版本与交付状态

| 项目 | 当前已核对事实 | 解释 |
|---|---|---|
| 研究主仓库基线 | `631f535d53c0812bed29bfcf5c679a4485123e9d` | 三份研究与方案的固定源码位置 |
| 本次 vendor 基线 | `8ed0c8d099c3c3d87b1a998d9189da3d120ff820` | 当前改造基于此定制源码，工作区尚有未提交差异 |
| vendor describe | `v0.10.639-27-g8ed0c8d0` | 不是原封不动的官方 tag |
| 当前 package releaseVersion | `3.0.7.01-preview.35` | 本轮本地候选编号；安装器已生成，安装态验收仍需完成 |
| 历史总体融合目标 | `v0.12.600` | 原三份总体文档保留 |
| 2026-11-05 核验候选 | `v0.12.852`；tag 引用 SHA `4b55db9ed1994575a695160ffc6cfd0bfc866211` | 后续全量融合候选，本次未因此宣称已经升级；实际启动融合时重新核验 |
| Office 全量资源构建 | 本轮已重建 `3.0.7.01-preview.35`，manifest `builtAt=2026-11-05T20:19:36.642Z`；renderer/CLI/native 均 `fresh` | `identityDigest=bfd823df5d6c334926d1e130777c9e18e2e9b1217968ca42ee2b919abb41ef3a`；`resourcesDigest=a5016f4ccd2b588b848e0f8d6dc5905db27abeb8da8269322f97d5f5ca7047af`；manifest SHA-256=`C572DE7D6CA87A4DB862E6A02677CA198BB0161BA4E7F3C11FB6C125A30DE7B1`。verify 返回 `ok=true`、`issues=[]`；main/vendor 仍 `dirty=true`，不是 `--require-clean` 正式发布组合 |
| 真实 Electron fixture probe | `artifacts/office-core-delivery-report.json` 与 `artifacts/office-pdf-ai-delivery-report.json` 均为 `ok=true` | 覆盖 Core 主助手创建/转换、PDF AI 创建/转换、菜单转换等确定性路径；验证 DOCX 正文、摘要、打开状态与源 PDF hash；不等价于远端模型自由规划或复杂样本质量验收 |
| 占位符修复后的 Windows x64 候选 | `release/Happy-Friday-Lite-3.0.7.01-preview.35-win-x64-setup.exe`；268,045,593 bytes；SHA-256=`381F43EF8779BF7A922F4A7BBB8D3B6C2D51C1A0698EA121E104B46F6A096D99`；SHA-512=`b+V7rmyD4EbZFF4MZpyPLsng7EtXqAyj+ziHTr2spW6bGeyHUM2XxSSe7KedajNC7UXCd+ZSYdagqBWvrVEpcw==` | 包内 Office、原生模块和启动 smoke 已通过；electron-builder 在最后写 `latest.yml` 时返回 `UNKNOWN: unknown error`。元数据已按此安装器的实测值校正；安装器尚未安装验收，候选未签名 |
| GitHub 提交/发布 | 本轮尚未完成 | 后续需分别验证源码、子模块可拉取、Release 资产和更新元数据 |

本文的固定源码基线用于解释起点。最终发布必须另记实际 Friday commit、vendor commit、manifest 摘要、安装包 SHA-256、平台、测试报告和版本号，不能沿用此表的起点 SHA 当作最终交付身份。

### 本轮工作区再核验（2026-11-06）

本次继续执行时，`package.json` 已冻结 `releaseVersion=3.0.7.01-preview.35`。在全量重建前，既有 manifest 只能证明它对应自己记录的源码摘要，不能证明它与此后全部源码变更一致；因此下文将以本轮最终重建后 `npm run office:verify` 的新结果作为 Office 资源状态。Office 门禁相关测试已重新执行，结果 `22/22` 通过，证明它能发现资源漂移、复制 bundle、参数错误和源码在校验期间变化，但测试通过不等于 bundle 已重建。

本轮最终重建身份：main HEAD `631f535d53c0812bed29bfcf5c679a4485123e9d`，vendor HEAD `8ed0c8d099c3c3d87b1a998d9189da3d120ff820`（`v0.10.639-27-g8ed0c8d0`），manifest `builtAt=2026-11-05T20:19:36.642Z`，`sources.identityDigest=bfd823df5d6c334926d1e130777c9e18e2e9b1217968ca42ee2b919abb41ef3a`，`resourcesDigest=a5016f4ccd2b588b848e0f8d6dc5905db27abeb8da8269322f97d5f5ca7047af`，manifest SHA-256=`C572DE7D6CA87A4DB862E6A02677CA198BB0161BA4E7F3C11FB6C125A30DE7B1`。`npm run office:verify` 和打包后 `verify-packaged-office` 均返回 `ok=true`。manifest 仍明确 `upstream.targetTag=null`、`targetSha=null`、`integrationState=current-vendor-not-latest-claim`；这只证明资源和当前 Friday/vendor 工作区匹配，不能宣称已经合并 GenOffice `v0.12.600`、`v0.12.852` 或官方最新版本。若构建期间源码再次变化，必须重新构建；不得手工修改 manifest 或沿用旧的 `ok=true` 报告。

### 2.1 preview.36 的迭代与证据（2026-11-06）

本轮展示版本为 `3.0.7.01-preview.36`，技术 semver 为 `3.0.8-preview.36`。旧 preview.35 的技术版本是 `3.0.7`；若改成 `3.0.7-preview.36`，semver 会把它视为旧版，因此不能用于升级。专项验证已经覆盖该反例和 `3.0.8-preview.36 > 3.0.7`，下一预览的技术版本也必须单调递增。

| 本轮变更 | 当前证据 | 保留的边界 |
|---|---|---|
| 官方来源锁与私有集成账本 | 锁校验及既有组合门禁最初 `64/64`；增加验证中漂移回归后锁专项 `47/47`；候选官方引用在线复核通过。新增页眉引擎差异后共九类记录 | 当前仍未融合上游；patch 状态保持待审计；验证字段属于人工登记，正式门禁按预期拒绝当前候选 |
| 三方审计工具 | 固定官方 bare 研究仓库；三组树 diff、工作区身份、依赖/构建/许可证变化；JSON `artifacts/office-upstream-audit-preview36.json` | 比较起点为 vendor 最近旧 tag，尚非批准官方基线；浅历史不支持完整祖先结论；文件交集不等于语义冲突 |
| Windows metadata 流水线 | 初次 `12/12`；增加同版本配置/manifest/安装器漂移回归后 `18/18`；真实 builder 内部函数验证 `publishAutoUpdate:false` 不再覆盖 metadata；版本比较通过。preview.36 的测量摘要已写入 `release/preview.36-build-info.txt` 和 `SHA256SUMS-preview.36.txt` | 元数据正确不证明安装、自动更新下载或回滚通过 |
| 从 preview.35 包加载 PDF 三入口和 Core | `office-preview35-packaged-pdf-probe.json`、`office-preview35-packaged-core-probe.json`；真实 DOCX 正文、hash、源 hash、打开结果均通过 | 这是隔离进程加载包内模块与资源，使用相同 Electron 运行时；不是完整安装器或远端模型验收 |
| 真实模型 PDF AI 探针 | 旧失败报告保留；preview.36 初次失败也保留。`artifacts/office-real-model-preview36-rerun-report.json` 于 `2026-11-06T09:29:15.011Z` 复测 `ok=true`：实际 PDF AiPanel 输入和发送，真实模型分别选择 `convert_document`、`create_document`，有效 DOCX 正文回读、编辑文字、打开和源 PDF hash 均通过 | 基于解包目录的隔离运行，审批由 harness 替代原生交互；`coreFreePlanning.tested=false`。不能据此关闭真实主窗口、安装器、原生审批、主助手自由规划及任意复杂 PDF 的验收 |
| PDF 负向运行验证 | 包内能力只声明 DOCX；Excel/PPT/非法格式无 artifact；空内容/仅活动节点无成功交付；保存取消无最终文件 | 原生对话框在隔离测试进程替代，仍需真实交互体验验收 |
| 未登记格式的统一错误 | 操作目录新增 capabilityName 映射，宿主与领域执行共用格式校验；拒绝发生在源读取和任务创建前 | 不新增 Excel/PPT 转换引擎，也不扩大已支持能力 |
| 合成质量矩阵与引擎修复 | preview.35 失败和引擎修复证据保留；`artifacts/office-conversion-quality-preview36.json` 于 `2026-11-06T09:25:48.928Z` 包内复测 `ok=true`、`10/10`，覆盖多页标题、多栏、表格、图文、OCR、中文、损坏输入与执行中取消 | `visualFidelity=not assessed`；未做人类版式比较，不证明真实扫描件和任意复杂 PDF 的质量。引擎的七项字体条件跳过仍不能算通过 |
| preview.36 包内 PDF/Core 交付 | `artifacts/office-preview36-packaged-pdf-probe.json`、`artifacts/office-preview36-packaged-core-probe.json` 均 `ok=true`，明确加载 `release/win-unpacked/resources/app` 与旁置 Office；覆盖共享转换/创建、正文/hash、源 hash、拒绝不支持格式和取消无文件 | 确定性隔离驱动；不能代替真实主窗口菜单/对话框、远端 Core 自由规划或无源码安装 |
| preview.36 全量构建与安装器 | 已生成 `release/Happy-Friday-Lite-3.0.7.01-preview.36-win-x64-setup.exe`，`268052025` bytes，SHA-256=`E3D53900318C5525F2791FE8CACD183F4839F53C5E6AC2815C4AEA1CF33CFB65`；manifest SHA-256=`a5c38a63af1706c7c83bc730ccbd2d77cf83d6f9ee9e3807edf9cc7fede69255`；source identity=`ce0b40ab6002699491059d23e965f9e4134290751082ef293eee470eaf2109bb`，resource digest=`ed4ef9b4653bfec5c14b17285df33aba2d8be3f5970a86cd1062cadaed90c7ce` | 包内资源、原生模块、启动 smoke 和 metadata 校验已有通过记录；安装器未在隔离用户环境安装，未签名，25 个第三方组件许可文本复核待完成。包包含未提交源码，不可从当前 commit 单独重现；后续 HTML 源码变更不属于这个包 |

安装目录 probe 的用法：

~~~powershell
node scripts/probe-office-pdf-ai-delivery.mjs --packaged-app="<绝对安装路径>\resources\app" --report="<绝对报告路径>\pdf-probe.json"
node scripts/probe-office-core-delivery.mjs --packaged-app="<绝对安装路径>\resources\app" --report="<绝对报告路径>\core-probe.json"
~~~

报告同时记录 moduleRoot、officeRoot、releaseVersion、实际 Electron、manifest SHA-256、source/resource digest。指定目录缺失时直接失败，不回退开发源码。业务模块来自指定 app；样本生成与验收驱动来自工作区。真正“无源码安装验收”还需在无工作区依赖的环境启动安装后的 exe，并以产品交互完成同样操作。

本轮引擎级修复遵循保内容原则：混合页眉只有明确页码标签且所有页面除真实页码之外的模板完全相同时才折叠；独有标题数字、表单号、案例号保留原行。官方候选虽然修复了多组真实页码替换，仍会在相同独有数字样本丢失内容，不能以升级候选替代此修复。新差异登记为 `FRIDAY-OFFICE-009`，未来仅在固定官方目标通过不变失败样本、近邻、全套及安装版矩阵后删除。测试 helper 的 ASCII `thisProgram` 仅修复中文工作区的 Emscripten 测试启动问题，与业务算法分开记录。

### 2.2 原方案剩余任务清单（2026-11-06 再核对）

以下按退出条件列出未关闭项；已有局部实现或探针通过的项目仍需补齐对应验收，不表示这些代码全部尚未开发。原方案 48 项 AC 与 W01–W14 的范围继续有效。

| 优先顺序 | 未关闭工作 | 已有基础 | 还需要的完成证据 |
|---|---|---|---|
| 1 | PDF 三入口真实用户流程（W03/W07/W08/W09，AC01–AC05/10/24/34） | 共享领域服务、包内确定性探针、PDF AI 真实模型复测已通过 | 真实主窗口点击菜单、原生审批与保存对话框；Friday 主助手真实模型自由规划；停止、结果卡、打开失败重试、中英文反馈的完整产品回放 |
| 2 | 未保存 PDF 和源生命周期（W04，AC12–AC16） | 私有快照、revision/hash 与源锁已有实现 | 对实际文本修改、批注、旋转及页面变更分别转换并回读；快照前后切标签、关闭源与版本变化；证明输出采用指定版本且原件未被擅自保存 |
| 3 | 失败、取消、崩溃与恢复（W05/W06/W10，AC19–AC26/29/31/32） | 服务层竞态、journal、真子进程退出和局部取消测试已有证据 | 真 renderer/worker 崩溃、迟到 ack、重复点击/Stop、文件占用/只读/外部替换；App 整体重启后界面与磁盘事实一致，无晚提交或重复交付 |
| 4 | 真实 PDF 质量与性能（W02/W06/W11，AC11/27–AC30） | 十组合成矩阵和引擎回归通过 | 真实扫描/OCR、多语言、密码、复杂多栏/表格/图片、长文档与大文件样本；人工 Word 版式比对、页级质量及内存/CPU/UI 响应/停止耗时报告 |
| 5 | 安装、升级和整套回滚（W13，AC35/36/46/47） | preview.36 本地安装器、解包资源/原生/启动检查通过 | 无工作区依赖的隔离环境安装并完成转换；旧版本升级与数据保留；卸载及整套匹配组合回滚，用户文件与任务可读 |
| 6 | 来源与正式交付（W01/W12/W13/W14，AC39/41/48） | 来源锁、九类私有差异、三方树审计和门禁已建立 | 全历史语义审计、每类差异保留/替代/删除结论及责任；第三方许可复核；提交主仓库与 vendor 并验证干净 clone 能重建；逐项关闭 48 AC、GitHub 源码/tag/Release/校验和/更新渠道验证。当前 GitHub release 列表未见 preview.36 |
| 后续版本 | GenOffice 固定新版融合（U0–U5） | 观察候选 `.852` 可解析，来源/构建工具可用 | 批准目标与真实官方基线、依赖/接口/私有差异审计、实际合并、四类现有编辑器回归、安装升级回滚；当前 vendor 仍为旧 fork，不能宣称已融合 `.600` 或 `.852` |
| 正在开始 | AI HTML 全功能接入（HTML-01–HTML-12，T00–T10） | 三份详细文档；当前 vendor HTML 已完成一次独立 main/preload/renderer 构建；实验构建与宿主门控基础正在接入 | 固定目标及完整依赖、真实宿主/标签生命周期、全部 AI 工具/provider、文档版本与事务、资源、预览隔离攻击验证、导出/CLI、对等/安装验收和最终启用；基础构建成功不能关闭任何完整功能簇 |
| 后续版本 | AI Markdown 全功能对等 | 原总体规划及候选 registry 保留 | 完整应用接入、AI/资源/导出/生命周期、安全及安装对照；不在当前 HTML 专项内，但没有取消原需求 |

本次已完成的核心修复是将 PDF 菜单、PDF 内 AI 和 Friday 主助手的转换/创建转入同一操作服务，并以真实 DOCX 回读判定交付。尚未迁移全部 Office 按钮；PDF→Excel/PPT 没有在本版增加转换引擎。HTML 正文→DOCX 是内容创建接口，不能算作完整 AI HTML 应用。

宿主全量初轮为 Node `464/464`、CJS `22/22`，前端构建通过。随后来源锁/metadata 漂移与包内来源文件校验新增回归，按各自专项结果归档；最终汇总以冻结源码的全量结果为准。

## 3 已落实的业务路径与代码边界

| 路径或职责 | 当前实现 | 验证边界 |
|---|---|---|
| PDF 菜单 | `pdf:convert-office` 受控入口转发到 `office.document.convert` | 真实 renderer API→IPC→host fixture 已通过；原生对话框用隔离进程 stub，人工菜单点击仍需补 |
| PDF AI 转换 | runtime `convertDocument` → registry 工具 → 共用领域服务 | 真实 renderer/preload/host/worker 已回读 DOCX；远端模型实际选择并调用工具待验收 |
| PDF AI 创建 | runtime `createDocument` → `office.document.create` | 仅 PDF 冷启动后创建真实 Docs 与 DOCX marker 已验证 |
| Friday 主助手 | 注册 `office_document_convert/create`，旧工具按 DOCX 路线转发 | 实际 registry→host 路径已验证；完整 Core 计划/对话链仍需单独验收 |
| 领域操作 | `src-electron/office/operations.js` | 共用容量、源锁、幂等、阶段、快照、转换/创建、交付、打开 |
| 真实文件交付 | `artifact-delivery.js` | OOXML 校验、目标身份、同目录临时文件、备份、journal、回读 |
| 上游算法 | `scripts/office/entries/pdf-converter.ts` 调用 vendor converter | 只做 bytes/resource/progress 包装，不复制 PDF 格式算法 |
| CPU/WASM/OCR 执行 | `converter-adapter.js` / `conversion-worker.js` | worker 生命周期、超时与取消；实际大样本响应还待测量 |
| 创建 DOCX | Docs 通用序列化 hook | 等 renderer 导入和真实 DOCX bytes ack，不以排队成功作为交付 |
| 任务与显示 | 现有 AI Core store、领域事件、Global Agent Dock | 同一 Core task 可有多笔 operation；结果需定位原 operation |

本版已迁移的业务目录只有 PDF→DOCX 和 HTML 正文→DOCX。它不代表全部 Office 按钮都已迁移，也不代表 PDF→Excel/PPT、完整 AI Markdown/AI HTML 已完成接入。

## 4 源快照与原 PDF 保护

PDF 快照 hook 接受受信任 WebContents 和 AbortSignal，返回当前序列化字节、revision 与 sourcePath。宿主根据具体 resourceId 绑定源视图，不用“当前活动标签”猜测操作对象。私有临时序列化完成后再交给 converter，不通过普通保存覆盖原 PDF。

服务保存 snapshot revision 和 SHA-256，拒绝明显不是 PDF、空内容、超出当前 128 MiB 预算或请求 revision 不匹配的输入。完成快照后核对源绑定，随后转换冻结的快照；目标不能与源路径或同 inode 文件重合。源锁由成功取得本次源使用权的任务释放，忙碌的第二个请求不能解除第一个请求的保护。

这些是当前结构约束，尚需真实编辑器验证的内容包括：未保存文字修改、批注、页面增删/旋转能否完整进入快照；快照序列化期间切页/关闭；源文件外部变化；冷打开 PDF 的就绪握手。源文件“没有被覆盖”的运行证据必须来自操作前后 hash/stat 对照，不能仅从实现意图推断。

## 5 DOCX 创建与真实交付语义

内容创建和 PDF 格式转换使用不同 operation。创建输入是 HTML 正文片段，当前限制为 8 MiB UTF-8，去除活动节点、事件属性、危险 URL 和远程图片来源；Docs renderer 使用清洗后的正文导入并序列化为 DOCX。输入正文不写入普通审计记录。

交付校验检查 ZIP/OOXML 必需部件、XML、content type、main relationship、内部关系目标与非空正文或绘图。目标在耗时工作前冻结，提交前复核；同目录临时文件先写入并同步，已有目标先留备份，最终提交不覆盖最后检查后突然出现的另一文件。提交后再次读取目标、核对摘要并重做 DOCX 校验。

`persisted=true`、`validation.valid=true` 和 artifact 路径/摘要是成功证据。创建后打开标签是独立结果：打开失败时保留已交付文件，显示明确失败原因并允许重新打开，不能要求用户重复转换。后到取消不能删除已确认交付的文件。若提交状态有歧义或清理失败，保留 journal/备份并返回恢复信息，不能伪造普通成功。

当前格式校验证明包和基本内容有效，不能证明复杂版式与源 PDF 完全一致。实际文本 marker、页数、可编辑内容、图片页、表格和布局仍需样本回读及人工比较。

## 6 任务、取消、幂等与恢复

| 机制 | 当前约定 | 要防止的失效 |
|---|---|---|
| Core task | 沿用现有任务 store/event | 另建一套与全局助手冲突的状态事实源 |
| operation identity | 幂等身份独立于 Core taskId | 同一 Core 任务的旧交付覆盖后一笔操作 |
| 请求重用 | 同 key 同输入返回原结果；输入变化冲突 | 工具重试重复写文件 |
| pending 重入 | 不删除正在执行任务的 controller | 重复请求后“取消”失效 |
| 源锁 | 同一来源只能由拥有锁的执行释放 | 忙碌失败请求解除别的任务保护 |
| 目标锁 | 每个最终路径只有一个提交者 | 两任务相互覆盖或备份错配 |
| 取消 | 开始/快照/执行/提交前检查；独立 worker 可终止 | 用户停止后晚到结果仍提交 |
| 重启恢复 | 物理 journal 与原 operation identity、actor、space 对齐 | 跨空间处理文件或重启盲目重做 |
| 重新打开 | 复核 artifact、摘要、DOCX 与权限 | 文件已被替换后仍当原交付打开 |

暂不把 Office 独立任务的“暂停”暴露为可用控制：当前提供可执行的取消与已保存结果打开。上层 Core 的既有暂停/继续逻辑仍须按自身任务边界判断，不应给无 checkpoint 的格式转换虚构暂停能力。

## 7 质量分类、用户反馈与当前限制

当前质量返回 `editable`、`mixed`、`imageOnly` 或 `unknown`，附页数、逐页状态、图片页/可编辑页、OCR 使用状态和 warnings。图片型 DOCX 不应被描述为“所有文字可编辑”。文件交付成功和转换质量必须同时展示；质量未知时不能默认最佳。

用户应能在结果中看到：文件保存位置、当前阶段/终态、质量提示、打开结果、可执行恢复动作。工具回复以 artifact 合同为依据；不能凭“任务已提交”“创建窗口已打开”或模型自己说成功就显示完成。

尚需冻结并实测的质量/性能范围包括：纯文字、中文、多栏、表格、图片混排、扫描件、OCR helper 缺失、OCR 可用、密码、损坏、零页、大文件、长文档、worker 内存与主进程响应预算。当前源码预算是实现保护，不等于全部边界样本已经通过。

## 8 持续跟随 GenOffice 的已建基础

本轮将 enabled 编辑器与候选应用放入共用 registry。Docs/Sheets/Slides/PDF 使用明确构建入口和 required exports，Markdown/HTML 保留候选项与完整对等验收模板。新增应用仍需生命周期、AI、格式、资源和安装验证，不能只改 enabled 即声称完工。

构建记录主仓库/vendor 来源身份、dirty 输入摘要、协议与 adapter 版本、平台架构、releaseVersion、实际资源大小与 SHA-256。构建前后源码身份变化会阻断发布；候选资源在 staging 生成，完成完整检查后整体切换，失败保留或恢复上一匹配组合。

宿主加载时核对 manifest、版本、资源和实际函数导出。只读 `office:verify` 在打包前比对当前源码与资源 manifest，同版本旧资源也不能通过。正式清洁候选使用 `office:build:release` / `office:verify:release`；生成物造成的 repositoryDirty 需要审计，但不能误当成运行时源码 dirty。

这一段保留 preview.35 构建时的历史判断：当时 build/verify 只能证明 Office 资源与所记录的 Friday/vendor 工作区源码相匹配并发现构建期间漂移，不能证明官方来源或私有 patch 已审查。preview.36 已增加 machine-readable upstream lock、差异账本与目标校验，实际进展和限制见第 2.1 节；批准的官方基线、完整差异审计及安装态升级/回滚仍未完成，不能把当前资源一致性当作最新版融合完成。

每次后续上游融合仍按第 04 份文档 U0–U5：官方目标固定、差异与依赖盘点、适配与能力、构建合同、端到端质量、安装回滚。此次建立合同不替代未来真实版本的合并、AI Markdown/AI HTML 对等验证，也不意味着可以无人验收地自动升级。

## 9 已取得的分层证据

以下分为较早专项证据和 2026-11-06 本轮复测。任何再次修改相关源码，都应按影响范围重新验证；最终发布记录需要保存实际命令输出与 manifest，而非仅引用本文计数。

| 检查 | 已取得结果 | 证明范围 | 不可据此推出 |
|---|---|---|---|
| `office-bundle-contract.test.mjs` | 15/15 通过 | registry、manifest、路径/摘要、协议、实际 exports、组合发布回退 | 新版本 GenOffice 全量合并、安装运行通过 |
| `office-pdf-converter.test.mjs` | 1/1 通过 | 真实 PDFium 和薄包装；无关中文 cwd；DOCX 正文回读 | 扫描/复杂版式/三入口全部通过 |
| `office-integration-gate.test.mjs` | 3/3 通过 | 同版本源码漂移、资源损坏、缺来源元数据可被阻断 | package/CI 的所有运行已通过 |
| `office-operation-service.test.mjs` | 10/10 通过 | 三入口 context 共用合同、创建清洗、pending 取消、源锁、幂等、重启与空间隔离 | 三个真实 UI/AI 工具入口已端到端通过 |
| `office-artifact-delivery.test.mjs` | 主集成最新结果 24/24 通过 | 格式负向、目标/目录竞态、取消边界、锁、真子进程退出各 journal phase、交付/恢复返回与任务持久化间隙 | 真实断电、所有文件系统或安装升级均通过 |
| `npm run office:build`（较早实现快照） | 无 skip 全量构建完成；状态已由本轮 preview.35 重建记录替代 | 四编辑器 main/preload/renderer、转换 worker、CLI 与本机资源可生成并检查 | Electron 三入口、安装包、发布完成 |
| `probe-office-pdf-ai-delivery.mjs` | 真实 Electron fixture 报告 `ok=true` | PDF 内创建/转换、菜单 IPC、主助手 registry 四路径；真实 DOCX marker/hash/open；源 hash 不变 | 远端模型实际工具选择、Core 完整任务对话、复杂样本与安装 |

### 9.1 2026-11-06 本轮候选复测

| 检查 | 本轮结果 | 结果边界 |
|---|---|---|
| 全量 MJS 测试 | `396/396` 通过，`66` 个 `scripts/tests/*.mjs` 文件，0 fail / 0 skip | 包含 Core/Office/转换 worker、恢复、registry、来源门禁和 Electron 专项；不替代安装版人工验收 |
| CJS 测试 | `22/22` 通过，6 个 `scripts/*.test.cjs` 文件 | 打包依赖、原生模块及第三方 notice 等现有合同测试 |
| 前端生产构建 | `npm run build` 成功；Vite 6.4.2，4499 modules transformed，47.90 秒 | 控制台有既有 chunk 大小和动态/静态 import 警告；命令退出码为 0；不证明 Electron 安装构建 |
| `fs-safe-electron.test.mjs` 隔离复跑 | 通过，单项约 1.22 秒 | 没有并发 Electron 进程时快速通过 |
| `fs-safe-electron.test.mjs` 全量复跑 | 通过，单项约 9.36 秒 | 之前在全量并行负载下曾触发约 20 秒子进程启动 timeout；隔离和完整套件均通过，现象更符合测试超时预算对高负载启动不够宽裕，未复现确定性 junction 清理回归。当前不把单次 timeout 作为产品缺陷关闭证据；后续若再次复现，应提高/拆分 Electron 探针预算并检查机器负载 |
| Core 主助手真实 Electron probe | `artifacts/office-core-delivery-report.json`，`ok=true`，报告时间 `2026-11-05T19:38:39.073Z`（上海时间 2026-11-06 03:38） | 覆盖通过 registry 与审批的 Docs 创建、SANDBOX 虚拟/相对路径交付、PDF 当前快照→worker→DOCX；marker 与正文摘要回读有效，PDF 源 hash 前后相同 |
| PDF AI / 菜单真实 Electron probe | `artifacts/office-pdf-ai-delivery-report.json`，`ok=true`，报告时间同上 | 覆盖 PDF AI 创建、PDF AI 转换、PDF 菜单转换、Friday 主助手 registry 转换；有效 DOCX、marker/hash/open 均回读成功。采用确定性测试驱动和审批/对话框 stub，不证明远端模型的工具选择 |
| Office fresh build 与只读 verify | `npm run office:build` 完成；`npm run office:verify` 返回 `ok=true`、`issues=[]`；preview `3.0.7.01-preview.35` | manifest `builtAt=2026-11-05T20:19:36.642Z`，identityDigest=`bfd823df5d6c334926d1e130777c9e18e2e9b1217968ca42ee2b919abb41ef3a`，resourcesDigest=`a5016f4ccd2b588b848e0f8d6dc5905db27abeb8da8269322f97d5f5ca7047af`，manifest SHA-256=`C572DE7D6CA87A4DB862E6A02677CA198BB0161BA4E7F3C11FB6C125A30DE7B1`；main/vendor dirty，且未宣称上游最新版，不能替代 clean release gate |
| Windows x64 包内验收 | 包已生成；`verify-packaged-office` 通过，包中 Office 资源 2497 项，identityDigest=`bfd823df5d6c334926d1e130777c9e18e2e9b1217968ca42ee2b919abb41ef3a`，resourcesDigest=`a5016f4ccd2b588b848e0f8d6dc5905db27abeb8da8269322f97d5f5ca7047af`；原生模块 3 项均为有效 PE；`smoke-electron-startup.mjs` 主窗口、preload 与剪贴板/背诵/Python/知识库 IPC 通过。安装器 268,045,593 bytes，SHA-256=`381F43EF8779BF7A922F4A7BBB8D3B6C2D51C1A0698EA121E104B46F6A096D99` | electron-builder 在最后更新 `latest.yml` 时异常退出码 1；重建后的 metadata 已按安装器 SHA-512、大小、时间核对。详细机器可读记录见 `artifacts/office-preview35-package-report.json`。尚未在隔离用户目录安装，升级/卸载/回滚未测，不能称为已安装验收 |
| GitHub 提交与 Release 上传 | 尚未完成 | 需要另行验证可拉取的 Friday/vendor commit/gitlink、Release 资产、SHA-256 与更新元数据；本地 build 不代表已经上传 |

MJS 全量复跑通过的 Windows PowerShell 收集方式：

~~~powershell
$tests = Get-ChildItem scripts/tests -File -Filter '*.mjs' | ForEach-Object { $_.FullName }
node --test $tests
~~~

该轮 MJS 测试输出总计 396、通过 396、失败 0、跳过 0。CJS 收集方式是对 `scripts` 根目录的 `*.test.cjs` 文件执行 `node --test $tests`，共 6 个文件、22 个测试通过。构建中的 Vite 动态/静态 import 与大 chunk 提示已出现于日志，当前无构建错误；后续性能优化应独立评估，不能把 warning 改写为本轮失败。

类型检查和后续故障注入结果以最终输出为准，不能把曾见到各包开始运行当成整个命令成功。原 `probe-office-pdf-ai-delivery.mjs` 红测试曾复现 host 创建回调缺失；历史真实 Electron 报告 `checkedAt=2026-11-05T19:39:25.737Z`（上海时间 2026 年 11 月 6 日 03:39）已为 `ok=true`，详细范围见上表及 JSON 报告。preview.36 的新运行报告独立保存，不覆写本条历史证据。

此 probe 启动真实 Electron、PDF renderer/preload、Friday host、worker 与 Docs renderer，初始仅 PDF editor 加载。它直接调用 renderer 提供的 `createDocument/convertDocument/convertOffice`，再调用实际主助手 registry 工具；未请求远端模型生成工具调用。测试进程用 stub 回答原生审批和保存对话框，仍经过 registry 审批入口，因此证明审批会被请求，但不证明人类交互界面已人工验收。脚本逐份校验 DOCX 正文 marker、摘要、打开状态及源 PDF hash；报告中的成功不可泛化为全部 48 AC 已通过。

## 10 三入口与关键 P0 验收待办

| 场景 | 必须保存的实际证据 | 当前状态 |
|---|---|---|
| PDF 菜单→DOCX | 真实 renderer/preload/host、保存目标、DOCX marker 回读、源 hash 不变 | Electron fixture 已过；人工点击/原生交互待验收 |
| PDF AI `convert_document` | 实际工具 schema 与执行、审批/取消、质量/结果展示、真实 artifact | renderer API→host fixture 已过；模型工具选择/Stop/展示待补 |
| PDF AI `create_document` | 仅 PDF 冷启动→Docs 冷加载→导入 ack→DOCX 正文回读 | 创建 fixture 已过；远端模型与多类输入待补 |
| Friday 主助手 | registry 与 Core 计划执行、可信 actor/space、SANDBOX 路径、真实交付验证 | registry→host fixture 已过；完整 Core 对话链待补 |
| 未保存源快照 | 多类编辑进入结果；原 PDF hash/stat 无变化 | 待样本验证 |
| 打开失败 | 文件保留、任务成功有明确打开失败、重新打开不重转 | 服务层已测，真实 UI 待验收 |
| Stop/关闭/崩溃/迟到 ack | 无未授权晚提交；任务终态和日志一致 | 局部已测，真实 renderer/worker 待补 |
| 覆盖/占用/只读/目录变化 | 原目标或可恢复备份受保护；不误报成功 | 局部已测，系统级故障待补 |
| OCR/密码/复杂样本 | helper 与资源路径、逐页质量、人工布局检查 | 待完整质量报告 |
| 中英文反馈 | 状态、错误、质量和恢复动作无裸 key，语言切换正常 | 源码双语，实际界面待验收 |
| 安装/升级/回滚 | 无源码安装运行、旧数据保留、匹配组合恢复 | 未执行 |

PRD 的 48 项 AC 仍是发布依据。上表按运行路径聚合待办，未消除未逐项核验的 AC，也不应把服务层三种 context 测试当作真实三入口验收。

### 10.1 四十八项 AC 的初始关闭状态

“局部已测”只指该行列出的低层事实；整项 AC 仍未关闭。后续关闭时需在相应行补具体执行记录和产物位置。

| AC | 当前证据或实现 | 尚需关闭的证据 |
|---|---|---|
| AC01 | 真实 PDF renderer API→host→worker→DOCX 回读和打开 fixture 已过 | 远端模型实际工具选择、完整 AI 交互验收 |
| AC02 | 同样本菜单 IPC 与转换 API 均交付有效 DOCX、质量 editable | 人工菜单点击、真实对话框和授权体验对照 |
| AC03 | 主助手 registry→正确 resourceId→真实交付 fixture 已过 | Core 完整对话与未保存版本的主助手运行 |
| AC04 | 文件源可进入同 service | 授权离线路径、可信上下文、实际读权限及结果 |
| AC05 | 仅 PDF 冷启动后 Docs 创建、HTML marker、落盘回读已过 | 远端模型摘要生成与工具选择、多类输入 |
| AC06 | 清洗/空内容拒绝逻辑已实现 | 空白、仅危险节点、无有效节点的实际创建负向 |
| AC07 | 目录与 schema 仅声明 DOCX | PDF AI 请求 Excel/PPT 时真实工具投影与明确反馈 |
| AC08 | 服务拒绝非 DOCX，主进程有参数校验 | 直接伪造 IPC/format 的运行回放 |
| AC09 | sender 与资源入口检查已接；任务权限已测 | 伪造 sender/跨文档 ID 的真实 IPC 拒绝及无泄露 |
| AC10 | 服务取消/无最终文件已测 | 真实保存对话框取消与界面终态 |
| AC11 | 密码重试与取消流程已接 | 加密样本、错误密码、取消与脱敏日志 |
| AC12 | 私有当前态快照 hook 已接 | 各类 dirty 编辑进入 DOCX、源前后 hash 不变 |
| AC13 | revision 不匹配服务负向已测 | 实际快照准备期间编辑的 revision 竞态 |
| AC14 | 服务持有具体 source 快照 | 快照后真实切换标签，确认不改用新标签 |
| AC15 | waiter 有关闭/取消清理路径 | 准备阶段关闭源的实际 renderer 生命周期 |
| AC16 | 提交前源绑定复核已接 | 快照后关闭源的既定取消/继续策略和结果 |
| AC17 | 同 key、同结果、重启不重做已测 | 真实工具重试仍使用稳定调用身份 |
| AC18 | key/参数冲突与 actor/space 访问已测 | 主助手和嵌入 AI 负向及 UI 不泄露既有结果 |
| AC19 | 最终路径锁已实现 | 两实际任务争用同目标的提交/备份结果 |
| AC20 | 目标在提交前变化会拒绝，专项已测 | 对话框确认后外部改动的实际系统场景 |
| AC21 | 备份/journal 故障恢复局部已测 | 写入/提交/恢复失败、占用、只读和歧义现场 |
| AC22 | 提交前取消无目标文件，专项已测 | 真实 Stop/worker 停止及临时文件检查 |
| AC23 | 提交后取消保留已交付，专项已测 | 真实 UI/任务反馈始终保留交付事实 |
| AC24 | 打开失败保留 artifact、重新打开已测 | 真实标签加载失败及再次打开不重转 |
| AC25 | 创建等待序列化而非排队成功 | 真实导入/serializer 失败，无提前交付 |
| AC26 | nonce/ack 等待器与生命周期已接 | renderer crash、超时、晚到 ack 的实际注入 |
| AC27 | imageOnly/mixed 质量分类与提示已接 | 无 OCR 扫描样本的逐页事实和真实反馈 |
| AC28 | 本地 OCR helper 构建并纳入资源 | helper 可用、语言覆盖和 OCR 逐页质量样本 |
| AC29 | worker 取消/终止与容量预算已接 | 大文件持续执行时 UI、Stop、无晚提交 |
| AC30 | CPU/WASM 从主线程移入 worker | 冻结响应预算、测量主进程/UI 延迟 |
| AC31 | 同路径/inode、真实 SANDBOX 及目录身份保护已接 | Windows 大小写/硬链接/junction 与系统竞态样本 |
| AC32 | journal/原 operation/space 已测，真进程退出各 phase 和跨层返回间隙已测 | App 整体重启后的任务/结果界面与安装场景 |
| AC33 | 正文/password 审计 scrub 与 auditSensitive 已接 | 日志、任务、会话导出与错误全路径脱敏核查 |
| AC34 | 新文案有 zh-CN/en-US | 实际语言切换、错误/质量/恢复动作回放 |
| AC35 | 尚无本版安装证据 | 干净安装、旧版本升级、旧数据保留 |
| AC36 | 显式资源路径与无关中文 cwd fixture 已测 | 无源码安装目录实际 PDFium/OCR/worker 运行 |
| AC37 | 旧 DOCX 工具路径已转发 | 历史调用形状、旧 IPC 和其他格式回归 |
| AC38 | 未主动替换普通保存入口 | 已有 PDF/MD 创建和各编辑器保存实际回归 |
| AC39 | manifest 已生成主/vendor/resource 身份 | 最终 commit、安装包与 checksum 对照 |
| AC40 | operation 描述与多入口投影已建立 | 新测试 adapter 的接入/投影验证（P1） |
| AC41 | 固定来源、fork、候选与未融合边界已记录 | 最终子模块提交可拉取及发布来源归档 |
| AC42 | 协议/版本/资源不匹配 fixture 已测 | 运行时能力准确不可用与界面反馈 |
| AC43 | required hooks/导出检查已测，ack 已接 | 缺 hook/混用 renderer 的真实运行负向 |
| AC44 | 合同兼容/不兼容 fixture 已测 | 最终组合验收；不得外推到未合并上游候选 |
| AC45 | 第 04 篇完整应用对等模板已建立 | 按实际 registry/构建审查模板，保留双应用要求 |
| AC46 | 本轮 `npm run office:build` 无 skip 完成，`npm run office:verify` 已返回 `ok=true`、`issues=[]`，manifest 对应 preview.35 | `--require-clean` 正式清洁构建、最终安装包对照、无开发路径依赖仍待完成 |
| AC47 | 资源发布失败回退 fixture 已测 | 安装候选整套回滚、旧任务和用户文件保留 |
| AC48 | 第 04 篇列通用 hooks 差异账本与删除条件 | 最终 vendor commit、测试、维护责任逐条签收 |

## 11 十四个工作包的实施追踪

| 工作包 | 目前已落实 | 仍需完成的退出证据 |
|---|---|---|
| W01 入口/来源盘点 | 三链路根因、固定 vendor、候选/实际来源分开 | 最终差异清单与提交身份 |
| W02 复现/样本 | 真实创建红测试、授权 PDF fixture、包回读样例 | 分类型复杂样本集 |
| W03 合同/Core | 注册工具、operation ledger、Core 事件映射 | 实际规划/审批/结果展示完整回放 |
| W04 快照 | 当前 PDF 私有快照 hook、revision/hash、源锁 | dirty 编辑与生命周期验证 |
| W05 交付/恢复 | OOXML、原子不覆盖提交、journal、回读及真退出 phase/跨层返回间隙测试 | 系统占用/只读与安装后的恢复界面 |
| W06 转换隔离 | bytes-in/out vendor converter worker | 大文件/取消/内存与安装资源运行 |
| W07 创建确认 | Docs 导入/序列化 ack、冷加载，真实创建 marker 回读 fixture | 短文、多类内容、失败 ack 与实际模型流程 |
| W08 菜单/PDF AI | 动态能力、同服务转发、质量提示、Stop 信号；真实 API/菜单 IPC fixture | 人工菜单、原生交互、实际模型工具调用与 Stop |
| W09 主助手/兼容 | 新注册工具、旧 DOCX 路径转发、严格 artifact 判定；registry fixture | Core 完整对话端到端与旧路线回归 |
| W10 故障生命周期 | pending/source busy/幂等/重启/空间隔离测试 | crash/迟到/占用/重启完整报告 |
| W11 质量/性能 | 逐页质量协议与 worker 预算 | 正式样本矩阵、测量、限制说明 |
| W12 上游合同 | registry、manifest、required hooks、U0–U5 模板 | 最终差异责任与组合门禁证据 |
| W13 构建安装 | preview.35 候选安装器已生成；包内 Office、Windows 原生 helper 和启动 IPC smoke 通过；更新元数据已核对 | installer exit code 1 的具体 Windows 写入原因仍未定位；无源码安装、升级/回滚和发布流程待补 |
| W14 文档核对 | 原文保留、三份专项、持续升级与本账本 | 48 AC 最终核对与发布说明 |

状态描述的是实施事实，不是完成比例。W13/W14 未关闭前，本专项不能标为已交付。

## 12 构建、安装和 GitHub 交付顺序

1. 关闭 P0 实现缺口，冻结本轮 Friday 与 vendor 源码及下一预览编号。
2. 将必要 vendor 改动提交到正确 fork，确认 clean clone 可以取得该 SHA，再更新 Friday gitlink。
3. 执行专项/全量测试、完整类型检查和前端构建，保留命令输出与失败处置。
4. 完整重建 Office，运行 `office:verify`，保存 manifest 与源码/资源组合摘要。
5. 运行真实 Electron 三入口和完整样本验证；任何源码修正后重新构建对应资源并验收。
6. 生成 Windows x64 候选安装包，验证包内文件、WASM/helper/worker、启动和 IPC；运行无源码目录的安装测试。
7. 对已有用户数据执行升级和匹配组合回滚，保留任务与已生成用户文件。
8. 在验收通过后单独验证 GitHub 提交、tag/Release、安装包与 SHA-256、更新元数据和下载可达性。

构建成功不等于上传成功；仓库有 commit 不等于 Release 含安装包；Release 可下载也不等于自动更新链路正确。每步记录独立证据。

## 13 验证命令与证据归档

~~~powershell
node --test scripts/tests/office-bundle-contract.test.mjs scripts/tests/office-integration-gate.test.mjs scripts/tests/office-pdf-converter.test.mjs
node --test scripts/tests/office-operation-service.test.mjs scripts/tests/office-operation-tasks.test.mjs scripts/tests/office-artifact-delivery.test.mjs scripts/tests/office-registry-contract.test.mjs
node --test "scripts/tests/*.test.mjs"
node --test scripts/*.test.cjs
npm run build
npm run office:build
npm run office:verify
node scripts/probe-office-pdf-ai-delivery.mjs
npm run electron:build:win
node scripts/verify-packaged-native-modules.mjs x64
~~~

以上是待最终归档的验证集合，命令列出不等于执行通过。各测试输出应保存时间、平台、源码身份与结果；真实 probe 报告需包含输入 fixture、源前后 hash、目标路径/hash、DOCX 内容回读、质量和打开结果。密码、Key 和文档全文不得进入普通审计或公开发布附件。

建议保留 manifest、脱敏验证 JSON、测试日志、安装日志、SHA256SUMS 和版本说明，并以最终版本命名。README 只摘录可被这些证据证明的能力和限制。

## 14 文档保留与本记录的更新规则

原三份 GenOffice v0.12.600 总体文档、原三份 PDF 转 Word 文档继续保留。第 01–03 份文档保存研究与 Proposed 设计，第 04 份定义持续上游合同，本第 05 份用于记录实际实施与验收，后续更新应写明新增证据和未关闭项。

只有真实通过后才把待办改为通过，并附命令/样本/结果位置。若某项方案因实现改变，记录实际接口与原因，不把旧报告改成“当时已实现”。下一次 GenOffice 全量融合、新 AI Markdown、新 AI HTML 的交付记录独立建立，继续复用本次能力合同和升级门禁。
