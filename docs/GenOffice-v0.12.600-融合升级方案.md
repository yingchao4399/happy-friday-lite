# GenOffice v0.12.600 融合升级方案

日期：2026-11-05。用途：下一版 Friday Office 升级的实施与验收依据；已纳入 AI Markdown、AI HTML 全功能对等范围。

配套文档：[升级分析报告](./GenOffice-v0.12.600-升级分析报告.md)、[融合升级 PRD](./GenOffice-v0.12.600-融合升级PRD.md)。

## 1. 实施结论与当前交付边界

可以向 `v0.12.600` 融合，但这是一次跨 Office 引擎、嵌入宿主和资源构建的升级，不能只移动子模块指针。下一版由当前 Docs / Sheets / Slides / PDF 四类扩展为六类，必须新增 AI Markdown 和 AI HTML，并与固定目标 `v0.12.600` 的对应模块功能对等；两模块是 P0 交付门槛，不能降为候选或缩减为基础编辑加聊天。建议先独立实施 PDF 转 Word 的 P0 修复，再进行上游融合；两者分别留证据，避免把一个故障的修复等同于整个升级完成。

**本次只交付研究与规划文档，不修改业务代码，不执行上游合并，不构建或发布新版。PDF 转 Word 当前仅完成静态根因分析；修复、真实转换和安装版验证均待后续实施。** 下文步骤、工期、用例和门槛是拟执行工作，不是通过记录。

| 项目 | 研究时状态 | 实施时处理 |
| --- | --- | --- |
| 根仓库研究基线 | 分支 `codex/friday-3.0.7-preview.28`，提交 `dd4afd4` | 开工前重新记录 HEAD；分支名不是发布版本 |
| Friday Office 基线 | `8ed0c8d099c3c3d87b1a998d9189da3d120ff820`；`v0.10.639-27-g8ed0c8d0` | 保留共同历史及 Friday 定制，不能称纯官方 `v0.10.639` |
| 官方目标 | `v0.12.600` → `1a0fcec971c714d11777cbd5c68da1c933572d14` | 固定标签提交，不跟随可移动 main |
| 差异规模 | 共同祖先后 Friday 14 提交、上游 920 提交；端点变更 349 / 4,617 路径，交集 273 | 是排查规模，273 不是实际冲突数 |
| 静态合并预演 | 固定双方提交的 merge-tree 得到 128 个 unmerged 路径：127 content、1 add/add | 未修改 index/worktree；只反映文本合并，不证明功能兼容 |
| 完整融合 | 未执行 | 依预演清单分工，开工时针对最终基线复核冲突和排期 |
| PDF 转 Word | 宿主漏接 IPC，原界面吞异常；未修复验收 | 独立 P0 补丁，在融合分支重新验证 |
| AI Markdown / AI HTML | 上游目标已有，Friday Office 当前未形成对应完整接入链 | 全功能对等接入为下一版 P0；具体清单绑定 PRD 的 MD / HTML 验收 ID |
| 工作区 | 有既存 `.gitignore` 修改；当前交付仅三份规划文档 | 开工前重录两层状态，不删除或混入他人修改 |

版本结论的适用边界：gitlink/HEAD 只能证明源码基线。当前 `resources/office` 有 554 个受版本管理的路径，未发现能把全部生成物绑定到 vendor HEAD 的构建版本 manifest；因此不能据此证明所有现有 bundle 来自同一源码提交，更不能确认用户已安装二进制的实际 Office 版本。下一版需补齐此证据链。

## 2. 目标架构与范围

保留 Friday Vue 导航、Office Tab、文件管理、模型设置和主进程桥接。嵌入上游六类编辑器及必要公共包，不引入完整上游 Shell、独立窗口导航、自动更新器或第二套模型配置。宿主、品牌、窗口组织和模型配置可按 Friday 适配；编辑命令、AI 工具与交互、格式、导出、预览和自动化不能因此缩水。上游某能力需要外部模型、搜索或图像服务时，保留等价接入与失败恢复，不能删除功能后宣称对等。

```text
Friday Vue / Tab / 文件与模型设置
  └─ src-electron/office：会话、宿主、AI、导出与知识库联动
       ├─ 受限 preload / IPC → Docs、Sheets、Slides、PDF renderer
       ├─ 受限 preload / IPC → AI Markdown、AI HTML renderer / 预览
       └─ 构建入口 → 上游 editor main + 公共引擎 / 转换 / CLI
                         ↓ 正式 build-office 脚本
                    resources/office（生成物）
                         ↓ electron-builder
                    安装包 resources/office 等资源
```

主仓库继续以 Electron 42 为验证起点。目标上游开发依赖为 Electron 43，是否不兼容需用真实 Friday 宿主证明。若需升级主应用 Electron，另列评估并覆盖原生模块和其他主应用功能，不能夹带升级。

首期按 Windows x64 安排可复现构建和候选包验证。macOS/Linux 需对应 helper 和真实平台运行；未执行平台标为未覆盖，不从 Windows 结果推导通过。

## 3. 开工前固定输入

| 输入 | 必须记录 | 用途 |
| --- | --- | --- |
| 两层 Git | 根 HEAD、gitlink、vendor HEAD、两层 diff 和未跟踪清单 | gitlink 不含 vendor 未提交修改，保护既有工作 |
| 资源 | `resources/office` 列表、大小、SHA256、旧构建日志 | 源码和生成物成套回退 |
| 工具链 | Windows/架构、Node、npm、Electron 实际版本、cargo、OCR 编译工具 | 区分工具/路径问题与升级回归 |
| 依赖 | 两层 manifest/lockfile 哈希、安装参数 | 根安装遵循 `--legacy-peer-deps`，保留必需 postinstall |
| 数据副本 | Office 文件、项目索引、按文件 AI 多会话、最近文件、配置 | 不使用唯一原件做升级/回退试验 |
| 测试基线 | Node、Office 构建、四类打开保存、打印、生命周期 | 区分既有失败和新增回归 |
| 新模块参考基线 | v0.12.600 的 Markdown / HTML 实际命令、菜单、快捷键、AI 工具、导出、headless 与依赖配置 | 逐条对应 MD / HTML ID；现状四类与目标六类不能混用 |

证据目录按日期、根提交、vendor 提交命名。使用生成或获授权的脱敏样本；日志不保存密码、API Key 和不必要正文。

```powershell
git status --short
git rev-parse HEAD
git submodule status vendor/happyoffice
git -C vendor/happyoffice status --short
git -C vendor/happyoffice describe --tags --always
git -C vendor/happyoffice rev-parse 'v0.12.600^{commit}'
git -C vendor/happyoffice merge-base HEAD v0.12.600
```

以上只记录状态，不自动清理或重置。新 worktree 不携带未提交修改；未来 PDF 补丁若尚未提交，应先保存并核验，再纳入隔离集成副本。

## 4. 合并和适配工作流

### 4.1 提交组织

1. 先完成 PDF 修复与真实产物验证，形成独立可回退补丁。
2. 从实际基线建隔离分支，记录根/vendor 对应关系，不在用户安装目录试验。
3. 以 Friday vendor 分支为主体合并固定目标提交，复核静态预演的 128 个冲突路径，按功能分责任；若基线已含 PDF 修复等新提交，重新计算。
4. 逐项保留 Friday 定制并融合上游逻辑，不用整目录 `ours/theirs` 覆盖；每个冲突关联保留内容与用例。
5. 分开记录源码融合、宿主/构建适配、回归修复。最终根 gitlink 指向可获取的融合提交。
6. 统一最终依赖声明后生成锁文件，不手拼锁文件；记录两层安装与检查命令。

### 4.2 模块任务与证据

| 模块 | 实施点 | 完成证据 |
| --- | --- | --- |
| Docs | 解析/布局更新；保留多页页眉页脚、撤销边界、菜单、只读和首开改进 | 复杂 DOCX 保存重开，页眉页脚/表格/图片截图，不能跨文档撤销 |
| Sheets | 工作簿/外链/连接；保留 Univer 菜单扩展、语言、dirty、打印选项 | 多表/公式/中文/外链样本保存重开，sidecar 实际执行 |
| Slides | 对象/文本更新；保留事务 dirty、撤销、长菜单、讲义导出 | 编辑→撤销→重做→保存→重开，备注/图片/对象数可核对 |
| PDF | 保留全文选区/虚拟渲染/OCR 几何/只读；迁移转换补丁 | 普通/扫描/加密/CJK PDF→DOCX，源保护、取消、失败矩阵 |
| AI Markdown | 完整接入目标模块、文件生命周期、编辑/预览、AI 工具/交互、导出/打印与 headless | PRD MD-01～MD-12 逐项功能对照与候选包证据，不能仅证明编辑器可打开 |
| AI HTML | 完整接入目标模块、源码/预览、AI 工具/交互、导出/打印与 headless | PRD HTML-01～HTML-12 逐项证据；预览受限且不会暴露 Friday 宿主权限 |
| AI/Provider | 比较 renderer/preload/agent/provider；保留 Friday 配置桥接 | 流式、主动取消、超时/模型错误、两文件历史隔离 |
| ProjectStore | 语义融合 Friday `chatIdsByPath`、`activeChatIdByPath`、`chatMetaById` 和上游 `canonicalPathKey`、读取上限等 | 多会话迁移、路径归一化、另存/重命名和回退 |
| 公共 IPC | renderer 调用→preload 暴露→主进程注册，尤其原 Shell handler | 已展示命令有 Friday 处理器，不能只验证编译 |
| 旧格式导入 | 当前 `src-electron/office/office-files.js` 仅识别 DOCX/XLSX/XLSM/CSV/PPTX/PDF；另补导入路由/转换/副本打开 | doc/dot/hwp/hwpx 各自实测，原件不变；未接通不宣传 |
| CLI/Agent | 保留现有 happyfriday-office / office_* 接口，扩展类型路由、headless协议、skills与运行时定位 | 既有命令不退化，新增两类按目标真实convert/create能力从正式包执行 |
| 知识库 | 保留 `office-session.js` 保存通知 | 已入库文件保存后索引刷新，读取新内容且不重复循环 |

### 4.3 公共工具和 Windows 打印阻塞

目标 `electron-utils` 缺少 Friday 自增的 `office-file-bridge`，这不是上游新 `main-proxy` 的替代关系；后者负责 HTTP 代理。必须保留/适配 Friday bridge、`fridayOffice` preload API、`registerPdfProjectIpc` 和 Docs `openGeneratedPath` 等定制。

打印存在两套实现：`print-job-settings`、system-print/window、`packages/electron-utils/native/build-win.mjs` 与 `system-print.exe` 是 Friday 相对共同祖先新增的定制，目标标签未包含；上游目标新增 `print-job`、`print-window`、`print-cups` 等接口。三方合并通常保留本地新增文件，不能据此断言合并必失败；直接重置到目标标签才会丢失当前构建要求的 helper。处理顺序：

1. 对照目标 exports、实际打印调用与新链，形成旧→新接口表；不能只删除存在性检查。
2. 默认先保留已有 Friday 定制打印链，对照上游新链决定逐项融合还是迁移；同步更新入口、构建、stage、包内审计和探针，保留页范围/纸张/方向/缩放/选区等已支持参数。
3. 既有四类及新增 Markdown / HTML 共六类真实窗口打印，保留各模块目标已提供的参数、布局和预览行为，验证系统对话框、焦点、取消、正常退出；虚拟打印 PDF 必须打开且内容可见。
4. 若 Electron 42 不兼容，以 API/栈/最小复现决定兼容实现、单独宿主升级或延后融合，不能静默移除打印。

### 4.4 PDF→Word P0 设计（待实施）

静态链为 PDF renderer `convertTo` → preload `pdfApi.convertOffice` → `pdf:convert-office`。上游 Shell 注册该 handler，Friday 自有宿主未等价注册；原 renderer 捕获异常无提示。现有算法在 Shell `pdf2docx-local.ts`，应独立打包复用，不能为算法初始化整套 Shell。

| 环节 | 预期实现 | 失败/保护行为 |
| --- | --- | --- |
| 发起 | 仅登记且当前有效 PDF WebContents，格式显式白名单；所有 PDF 转换格式共享全流程 inFlight 或串行队列，固定源 entry/path | 从对话框前到收尾持续占用，切换文档/格式不能绕过；PDFium 调用串行；对话框/flush 等 await 后复核源仍存活且 entry 未替换，非法/关闭 caller 不写 |
| 文档状态 | dirty PDF 先经用户确认正式保存/flush，未完成则终止 | 保存确认取消不改源及 dirty；已确认完成源保存后再取消输出，保留该保存状态、不额外改源，也不转换旧磁盘版本 |
| 密码 | 优先复用 `convertWithPasswordRetry` / `convertPdfFileToDocxLocalWithPrompt` 并接入 Friday 密码对话框，不 trim；若选 renderer 内存传递，则绑定文件会话并清理 | 前者可能二次询问但主进程有完整重试；后者少一次询问但需防会话串用。仅 password-required 重试，unsupported/corrupt 直接分类反馈；不记录密码 |
| 加载 | 独立转换 bundle 按需加载，传递密码和进度 | 不提前初始化转换器拖慢查看器，缺 bundle 可见失败 |
| 资源 | PDFium/字体子集 WASM、OCR helper 用运行时相对路径 | 开发/安装均实测，缺资源不静默生成空白文件 |
| 选目标 | 默认同名 docx，可取消，禁止源及等价别名覆盖 | 取消不写输出、不额外修改源；已确认完成的源保存保留，已有目标替换行为明确 |
| 写盘 | 完整有效结果后，再正常关闭已打开目的文档（dirty 有确认），以同盘临时文件替换；这是相对原 writeFileSync 的增强设计 | 目的关闭取消则不写；算法失败不先关闭用户目的文档，不截断旧目标 |
| 打开 | 通过 Friday `openOfficeFile` 打开，保留原 PDF | 打开失败区分“已保存”，告知位置 |
| 收尾 | i18n 原因/下一步，finally 清进度和 busy | 异常、切换/关闭、OCR 失败不残留锁定 |

扫描 PDF 的可编辑正文取决于 OCR；纯图片 DOCX 只能说明保留图像，不能宣称文字识别完成。真实结果含 `docx/pages/warnings/pageResults/scannedDocument`；`pageResults.status` 为 `ok`、`degraded`、`scanned`、`ocr`。其中 `ocr` 是成功识别但需校对，`degraded/scanned` 是整页图像回退，必须透明说明；不发明计数字段。同一缺失 IPC 影响的 XLSX/PPTX 一并审计，Word 为主验收，不能以其他格式成功替代。

不能将上游 Shell 的密码窗口原样裸搬：它依赖专用 preload/HTML。优先提供 Friday prompt callback，复用纯重试状态机。资源修复须区分 viewer 和 converter：viewer 已有部分 `../ocr` 定位，converter 的 OCR 路径仍缺 Friday `office/ocr` 候选，WASM 在开发 bundle 中也需相邻路径验证。

保存协议也有版本差异：当前基线的 `flushPdfSave(contents)` 无第二参数；目标 `apps/pdf/src/main/pdf-main.ts:1089` 为 `flushPdfSave(contents, flushAll = false)`。目标 Shell 的三种 PDF 转换均传 `true`，使仍打开、尚未点 Done 的表单编辑卡片也写入转换输入。W02 在旧基线沿用其保存协议；融合时必须连同 renderer 的 `{ flushAll }` 合同迁移，不能只接旧签名后漏掉屏幕上的表单值。PDF-03 增加对应样本。

响应性风险：转换函数虽为 async，内部提取仍可能同步执行，OCR 还使用逐页最多 30 秒的 `spawnSync`。进度条不证明主进程可响应。W02 对长扫描件测事件循环/窗口响应；若需要 worker/utilityProcess 隔离，再按取消、错误序列化、密码与资源传递补设计并增加工期，不能把长时间冻结当成功实现。

专项用例见 PRD `PDF-01` 至 `PDF-12`。DOCX 同时检查 ZIP/XML 文本与 Friday Docs 实际打开；只验文件存在/PK 文件头不够。旧基线修复通过后，融合目标仍需同矩阵复验。

### 4.5 AI Markdown / AI HTML 全功能接入（下一版 P0）

以分析报告中固定提交的源码清单及 PRD 的稳定 `MD-xx` / `HTML-xx` ID 为基准，建立“上游能力→renderer→preload→Friday handler→依赖服务/资源→真实验收”映射。验收时使用同文件、同平台、同模型能力和同外部服务有效配置对照开源 `v0.12.600`；上游支持但 Friday 缺失的能力属于阻塞项。AI 输出不要求逐字相同，但工具行为、生成资产、流式/取消、交互和错误恢复必须等价。不能用“菜单已显示”“聊天有回复”、disabled 或空实现替代通过。宿主组织可不同，用户能完成的任务、结果格式与交互阶段必须等价。

| 工作面 | 必须完成的接入 | 保护和证据 |
| --- | --- | --- |
| 文件入口 | Office 首页新建/打开六类；Markdown 显式“用 AI Markdown 编辑”直接读写 `.md` 文件，HTML 显式“用 AI HTML 编辑”进入编辑器 | 既有笔记和 HtmlViewer 保留独立动作；不自动导入笔记，不按同名更新 SQLite 笔记；不把未经核实的 `.mdx` 当普通 Markdown 承诺 |
| 偏好迁移 | 当前 `docOpenModes` 只有 internal/system，需要兼容的 Office 编辑/原内置查看/系统打开决策，旧偏好有明确迁移规则 | 默认行为变更可理解、可恢复；同名笔记、多目录同名文件和 HTML 原查看入口均不误路由、不覆盖 |
| 新建到关闭 | 类型注册、空白模板、标题/dirty、打开/保存/另存/重命名、最近文件、外部变更、关闭确认与 Tab 隐藏/恢复 | 新文件取消保存、已有文件写失败、多窗口/多标签操作不丢内容，保存通知继续进入知识库链 |
| 编辑与预览 | 保留目标全部命令、视图切换、格式/资源行为、导航、快捷键及预览 | 用各模块专项样本逐项操作，不把 HTML 预览等同编辑，不以 Friday 旧笔记替代 Markdown 模块 |
| AI 与工具 | 复用 Friday 主进程统一模型配置，接通模块原有 Agent、tool-call、stream、取消、交互反馈、生成/改写和错误重试合同 | 不要求绑定 Genspark 账号；需要模型/搜索/图片等能力时提供等效可用服务，按同等前提实测工具和文档修改结果 |
| 服务缺口 | 当前 `src-electron/office/office-ai-bridge.js` 的 web-search/image-search 空数组、fetch-image 空值、generate-image/analyze-media unsupported 均须按模块实际调用补通 | 不能继续用空返回掩盖缺失，不能将这类宿主截断称为“优雅降级”；无服务、无权限、断网时保留目标错误/恢复交互，正常配置必须实际可用 |
| 会话与数据 | 两模块接入 Friday 按文件多会话、标题和活跃会话；融合目标 ProjectStore 的路径规范化、项目、资源和历史语义 | 初次保存、另存、重命名、同名异目录、移动文件及关闭恢复都不串历史；先记目标行为，再定义兼容迁移 |
| HTML 预览边界 | 将本地/生成 HTML 的运行放在与 Friday 宿主隔离的预览环境，沿用目标已提供的脚本/交互能力并审计协议 | 不暴露 Node、Electron、preload、模型密钥和任意文件写权限；弹窗、导航、外链、资源访问有明确策略，不能靠删除上游交互实现安全 |
| 导出/打印 | 逐格式复用目标快照、导出、打印及选项链；临时页、资源、页面尺寸和字体随包可用 | 核对目标支持格式，不额外承诺未提供格式；读取当前内容，取消/失败不覆盖旧目标，输出实际打开核对 |
| Headless / CLI | 复用现有 happyfriday-office / office_* 链，扩展两模块类型检测、runtime、worker、IPC/协议、导出工具、skills 和打包定位 | 两类目标已有convert/create路由从候选包运行，不以隐藏打开另一个交互UI或vendor源码替代；不杜撰独立HTML read/apply命令 |
| 菜单/i18n/包体 | 统一 Friday 菜单入口，保留模块已提供快捷键、语言、主题、缩放等能力；新建所需资源和许可证完整 | 目标语言项与至少中英实测；renderer、preload、main、preview/export/headless 和运行依赖都进入 manifest |

不能只添加 Office 首页卡片：`src/router/index.js` 的编辑器路由、`src/utils/tabSession.js` 的 `OFFICE_TAB_RE`、`src/views/office/OfficeWorkspace.vue` 的 `EDITOR_TYPES`、`src/views/office/home/fileMeta.js` 元数据、`src-electron/office/office-host.js` 的 `EDITORS` / 扩展名映射，以及 createView、save、close、queryDirty 等四类分支都要扩展并统一类型校验。当前 createView 尾部分支会默认进入 PDF；新增类型必须显式注册，未知类型可见失败，不能误落 PDF。会话持久化/恢复、前进后退和布局切换一并覆盖。

两模块 main 不自带完整应用菜单，上游 Shell 承担新建、打开、save/saveAs、export、print、close 和活动 detached 目标分发。Friday 必须按当前六类型分发真实命令，把编辑视图、拥有它的Tab/窗口与请求caller绑定；用户切Tab、激活演示/独立窗口或对话框期间关闭owner时，不能把动作发送到最后一个四类视图或新激活文档。开始操作时固定owner/文档身份，await后重验；菜单enabled状态、快捷键与菜单点击共用同一分发合同。单有菜单/i18n而动作仍只分发四类属于P0失败。

当前 Markdown 导入链在 `src/views/knowledge/composables/useFileSystem.js` 调用 `importMarkdownAsNote`，同名更新 SQLite 笔记不适合承担 Office 文件打开；`src/utils/docOpen.js` 的 Markdown 分组包含 `md/markdown/mdx` 也不代表目标模块支持全部扩展名。按目标实际检测规则建立文件类型表。`docOpenModes` 的既有 system 偏好必须保持；不能改变 internal 含义后无提示迁移用户打开行为。Office 首页和显式编辑动作可以直接进入新模块，默认双击决策需有兼容迁移与回退。

HTML 的“脚本可运行”和“可访问主应用权限”必须分开验证。若目标存在受信任内置预览页与不受信任文档 iframe 两层结构，应保持边界；发现上游权限风险时单独修复并提供功能等价实现，不能直接把文件内容加载到拥有 Friday preload 的页面。资源相对路径、项目根、外链和 URL 解析需覆盖本地/远程混合样本。

对等清单在 W01 固定目标后逐项填实证：源码符号/菜单证据、依赖条件、参考行为、Friday 对应实现、候选证据、状态和责任人。研究中的源码能力不等同运行通过；待查明的能力不能擅自发明为承诺，也不能从 P0 列表消失。任何 `MD-xx` / `HTML-xx` 缺口都阻断下一版六模块交付，须修复或重新由用户明确调整目标。

模块自有 AI 通道也要审计：Markdown `generate_image` 不只经过公共桥，还经过 Markdown 自有主进程通道及本地 `ai-settings`；HTML 图片生成同样读取自身主进程 settings 和 `documentMediaRoots`。必须映射统一 Friday 配置并保留各模块资源根、权限和返回合同。Markdown的8个本地具名工具为get_document_context/read_blocks/apply_ops/write_document/image_search/insert_image/generate_image/read_frontmatter，加共享MIND_MAP_TOOL（generate_mindmap）组成AGENT_TOOLS共9；AiPanel组合createMarkdownSkill和createSearchSkill的web_search后共10，markdown-skill.tools getter在每请求按imageGenerationAvailable(settings)隐藏generate_image时为9。insert_image内部经markdownApi.fetchImage调用ai:fetch-image，fetch_image不是独立Agent tool，思维导图也不是第三个独立skill。

拟复用目标搜索/媒体实现，在主进程增加“已解析设置/配置读取注入”适配，使Friday SQLite继续成为唯一密钥持久化源；不为满足原settingsPath helper另写明文ai-settings.json或建立第二套配置。renderer仅获取所需脱敏设置及能力标志。搜索provider、图片provider和文字模型能力分别解析，文字LLM可用不证明可生成图片。下表是拟实施合同，不代表本轮已改代码。

| 服务适配 | 目标合同 | 实施与验收 |
| --- | --- | --- |
| webSearch | `{results:[{title,url,snippet}],answer?,method,error?}` | selected搜索provider映射；分别验证正常非空、真实零结果、method:error，不能把空数组透传作成功 |
| imageSearch | `{images:[{title,imageUrl,sourceUrl,source,width?,height?}],method,error?}` | 保留images而非统一改results；工具返回、选图/抓取、插入正确文档资源逐步验 |
| 图片生成/抓取 | generateImageTool原读settingsPath并接mediaRoots，返回`{url?,error?}`；抓取是模块IPC依赖而非MD独立工具 | 注入统一配置、模块资源根/权限；生成/下载实际落到正确文档，失败/取消无半成品、无密钥日志 |

### 4.6 两新模块实施接口与准确格式边界

| 模块/链 | 固定目标事实 | Friday 实施要求 |
| --- | --- | --- |
| Markdown runtime | `configureMarkdownRuntime` / `createMarkdownView` 在 `markdown-main.ts`；内部注册本模块 IPC，创建走 `rendererUrl(..., 'markdown')` | 注册共享 renderer 协议，不能只传 rendererFile；不导入直接启动 standalone 的 `main/index.ts`；保留按需加载和类型化创建 |
| Markdown 文件/模式 | `.md/.markdown` 为块模型；`.txt/.json` 走独立 CodeMirror 源码模式，`runExport` 明确 false | 文件过滤和UI按真实模式呈现，不承诺txt/json有完整块AI/导出；不凭Friday旧分组支持MDX |
| Markdown 资源 | `md-asset` 限 doc目录/配置vault realpath、防symlink逃逸；本地图片/SaveAs重写与S3兼容/S.MS/GitHub图床，失败可保留本地资产 | 注册协议与vault配置、保存/另存/图片插入/查看器完整链；包体路径和资源清理/边界分别验证 |
| Markdown GUI输出 | pdf/docx/docs/png；docs经DOCX缓存打开Docs；PNG prepare/write/finish多页流程；系统printDoc等待图片decode、afterprint（含取消）后finally移除iframe，所读此段未显式等document.fonts.ready | 复用Friday Docs打开结果，四种GUI输出和打印分别实测；字体可见性另测，不把额外字体等待写成目标现状；临时缓存、图片分页与失败收尾不能漏接 |
| Markdown AI/共享合同 | 选区apply_ops/staleness、长文stream keep/discard、editable Mermaid思维导图；projectApi resolve/append/load/rebind handlers原由Shell/Docs共享注册 | 不只接chat；统一模型/skills/token/队列及按文件多会话，保留工具修改撤销、文件首存/另存绑定 |
| HTML runtime/协议 | `configureHtmlRuntime` 仅配置preload/renderer/openGeneratedPath；Shell在app.ready前集中注册 `html-preview/html-asset` 等privileged schemes | 早期集中注册避免模块各自重复；补 project:*、home:open-path、skills、命名、主题/语言/autosave/panel prefs 等共享handler |
| HTML 文档编辑 | CodeMirror是source-of-truth；preview/split/source、静态源元素映射、设备/缩放、可视编辑/样式/图片；poke需save/export前flush | 保持源码外壳、动态无sid节点边界、undo/redo；不能只做静态预览或导出DOM造成源码丢失 |
| HTML Agent/演示 | 10工具与9种apply_ops，clarification/plan/page-writer及intent工作流、附件/skills、20个内存快照和脱敏；演示tab/fullscreen需宿主setBleed/hostWindow/openTab | tools/UI/交互全量逐项接，20快照不是持久版本库、脱敏不是加密；演示owner关闭清理且Esc可回编辑 |
| HTML GUI输出 | DOCX/PDF/single-file HTML + 系统print；DOCX真实网页html2docx，PDF A4背景且禁JS，print允JS | 已打开目标dirty保护；单文件HTML仅内联可读本地图并报告skipped，非完整离线网站包；动态print/PDF不保证相同内容 |
| HTML资源边界 | `html-asset` 限已打开文档目录且realpath校验；SaveAs跨目录资源搬迁/重写、失败rollback、pending清理/manifest | 资源manifest随文档迁移；测试越界、失败rollback和合法相对资源，不破坏上游交互 |
| 应用headless | `HEADLESS_TARGETS`：Markdown md/markdown→PDF，HTML html/htm→PDF/DOCX；退出码0/1/2/3；JSON成功`{status,summary,output_path}`、失败`{status,summary,error}` | Friday既有argv路由扩展：`--headless-export <input> --to <format> --out <path> [--json]`；两runtime/worker/协议与应用schema实际打通，不把GUI格式全搬入headless承诺 |
| CLI路由 | 上游基准 `genoffice convert notes.md --to docx/html` 走NODE_ROUTES，Markdown→PDF及HTML→PDF/DOCX走APP_ROUTES；`create --type pdf --from page.html`亦走应用链 | 在现有 happyfriday-office / office_* 接口落地，保留并更新Friday已交付CLI/启动入口/skills，指向实际Friday二进制；不另承诺独立genoffice launcher。HTML网页DOCX与restricted fragment导入不是同链，不互相替代；无HTML→HTML headless及独立HTML read/apply CLI |

Friday 的 CLI 并非从零建设：`scripts/build-office.mjs` 已构建/stage `happyfriday-office.cjs`，`package.json` 的 extraResources 已入包，`src-electron/office/office-agent.js` 已定位调用；研究目录也有现存bundle。但 `src-electron/office/office-headless.js` 当前明确拒绝 Markdown/HTML且renderer分支仅四类，`office-files.js` 类型检测也仅四类。需要扩展既有argv解析、格式校验、两模块runtime/协议和worker选择，并同步agent/skills的能力声明；现有bundle不能证明新类型已支持，也不能证明用户安装包。其内嵌 `VERSION="0.10.0"` 只是CLI模块版本，不能当GenOffice产品tag。

外层CLI须单独保留0/1/2/3/4退出码，4覆盖app unavailable/crashed；成功JSON另含command/detail/warnings，失败为`{status,command,code,error,message,suggestion?,detail?}`（error为稳定reason）。应用链wrapper收到ok envelope且输出文件存在时，即使child非0或退出阶段超时被终止仍认成功；无产物timeout为conversion=3，缺app/崩溃为app=4。迁移时分别核对应用与CLI schema，连同产物验证，不将应用0–3直接套到CLI。具体源码基准为目标electron-utils的headless-export.ts与cli的result.ts、formats/app-export.ts。

Markdown 外部变化不由 autosave 自动裁决：目标在 clean 且未 saving 时自动 reload/ack；dirty 或 saving 时显示 changed，未解决的保存得到 conflict，由用户选择 reload / keepMine / overwriteNow。keepMine 仅 ack 清 notice 后允许未来保存覆盖，并非立即写盘；overwriteNow 才立即保存。目标 doSave 在 await 前固定 doc/frontmatter，返回仅在两者仍为同一快照时清 dirty，否则 renderer 重申 dirty；源码模式比较保存前后 sourceText。主进程成功写盘不代表保存期间的新编辑已落盘。此流程与30秒/blur自动保存、BOM/EOL保护一并覆盖 MD-12；均为目标静态行为，尚未执行验收。

目标 HTML iframe sandbox 允许 scripts/forms/popups/modals，未授予 `allow-same-origin`，仍允许网络；因此应验证具体能力边界，不能承诺任意 HTML 绝对安全。所有键盘快捷键从目标本模块 keymap 与 Shell 动作冻结，适配 Friday 时保证相同任务可达；Markdown替换为Windows/Linux Ctrl+H、macOS Control+H，不能误用macOS系统Hide的Cmd+H。准确功能分组详见 PRD MD-01～12、HTML-01～12；当前均为静态研究，尚无实际通过记录。

### 4.7 下一版可执行任务清单（不新增工期重复项）

下表是第6节WBS的实施拆分，不在47–78人日之外再次计时。每项产出先在隔离集成分支形成可审阅结果，再进入对应候选验收；责任按模块划分，两名工程师可兼任角色。

| 任务/责任模块 | 输入与前置 | 输出 | 结束条件与对应WBS |
| --- | --- | --- | --- |
| T01 参考基线 / 集成+产品验收 | 固定目标提交、三报告、MD/HTML专项ID；无需代码变更 | 全量菜单/IPC/tools/keymap/exports子项台账、有效服务参考条件、文件/数据身份决策 | G0映射100%、未决项有责任与阻塞标记；W01/W03 |
| T02 文件与六类型 / Friday前端+宿主 | T01类型/扩展名/偏好决策 | router/tabSession/Workspace/fileMeta/office-files/office-host一致类型表，首页/显式编辑/旧查看与笔记导入独立路径 | 六类型新建/打开/恢复正确，未知类型失败，system偏好和旧笔记无误改；W15 |
| T03 runtime/协议 / 集成+模块工程师 | T01协议与IPC表、T02类型注册 | Markdown/HTML main/preload/renderer入口，app.ready前集中scheme注册及共享handler清单 | 真宿主六视图可创建/切换/关闭，无重复handler、缺handler或默认PDF回退；W13/W14，构建部分W06 |
| T04 菜单与owner / Friday宿主 | T02/T03，目标Shell菜单责任清单 | 六类型菜单/快捷键分发、dirty/save/saveAs/close、活动演示/独立窗口owner绑定 | 所有入口真实调用对应文档；切Tab/关闭owner/迟到请求不误写；W13/W14 |
| T05 AI服务与工具 / 共享AI桥+模块工程师 | T01有效模型/搜索/图片配置、T03，模块自有通道合同 | 公共桥+两模块owned AI映射，正常结果/错误形状、stream/tool/取消/交互与资源根 | MD/HTML全工具正常条件实际完成任务，无空stub/disabled截断，失败可恢复；W05+两模块专项 |
| T06 项目与身份 / ProjectStore+宿主 | T01身份决策、T02/T03、旧数据副本 | project:*与Friday多会话融合、首存/rebind/另存/rename规则、保存/知识库通知、迁移与回退记录 | 原文件/笔记/输出/资源/会话不混用，重开与回退可核验；W05/W08 |
| T07 模块功能与资产 / Markdown、HTML各自负责 | T03～T06、目标完整编辑/AI/预览清单 | MD-01～12、HTML-01～12实现；资源搬迁/回滚、预览权限、HTML演示owner | 每个子项有实际结果及源码对应；素材合法访问、越界拒绝、输出反映当前编辑；W13/W14 |
| T08 输出与打印 / 模块+公共打印 | T04/T07、目标输出格式/参数 | 两模块全部GUI导出、打开Docs、PNG多页、single-file HTML skipped反馈和系统打印适配 | 产物实际打开、分页/字体/动态限制核对，取消/失败保旧目标、临时资源回收；W07+两模块专项 |
| T09 现有CLI扩展 / office-headless+office-agent+构建 | T03/T07输出接口、目标NODE/APP路由表、现有happyfriday-office入口 | 两类argv/类型/格式/runtime/worker/协议、office_*能力与skills更新；应用0–3/CLI0–4及各自JSON schema | 正式包现有Friday入口执行目标格式；ok envelope+产物存在的wrapper成功语义、无产物timeout=3、缺app/崩溃=4分别验证；不要求新genoffice launcher；W16/W06 |
| T10 候选和对等登记 / 集成+测试 | T02～T09、独立PDF P0补丁与既有四类融合 | 六模块完整包、逐子项台账、缺口/限制、证据和数据回退记录 | G1～G3，MD/HTML/PDF全部P0无缺项，菜单owner/错误/生命周期/离线本地能力与联网工具分开通过；W09～W12 |

T04/T05/T06共享接口先固定再并行模块工作；T08和T09都依赖模块真实输出接口，不能在只有mock或旧bundle时宣告完成。PDF独立修复仍按W02先行，不因新模块增加而降级。记录实际工时与阻塞后更新同一WBS，禁止同时累加T任务与W任务。

## 5. 构建和打包迁移

| 层 | 核对内容 | 验证 |
| --- | --- | --- |
| Renderer/preload | 六类输出、协议、React 去重；新增 Markdown/HTML 编辑器和预览，renderer 不引用 Node/Electron | 正式重建后六类真实启动，不能只有新增主包而无 preload |
| Main bundle | 入口 exports、CJS/ESM、运行时 `import.meta.url`、external electron | 中文空格目录运行，无开发机绝对路径 |
| WASM | PDFium/hb-subset 版本、stage、定位 | office/wasm 与安装映射真实调用 |
| OCR | helper 版本/架构和 office/ocr 相对路径 | 扫描实识别，缺资源有提示，不依赖 vendor |
| XLSX sidecar | Sheets 与 CLI native 路径完整，缓存不删旧二进制 | 包目录公式/保存；跳过 cargo 不算全量通过 |
| 打印 | 比较 Friday 定制链与上游新链，新增两模块全部目标打印链 | 六类系统输出和取消，不只检查 exe |
| CLI/skills/notices | CLI 依赖、headless、技能、许可证 | 包内清单+代表命令+功能文案 |
| Markdown/HTML 专用链 | 两模块 renderer/main/preload、预览/导出/截图窗口、各自 headless runtime 与依赖 | PRD 专项 ID 对应真实包内路径，UI/CLI 结果可读且内容一致 |
| electron-builder | 现 office→office、额外 WASM→wasm 映射；新增路径明确 | 解包清单+移出开发环境运行，防 fallback 掩盖漏包 |

`resources/office` 只由 `npm run office:build` 生成，禁止手修。缓存可作局部诊断，最终候选全量重建 renderer/preload/main/CLI/native/资源；不能沿用旧产物冒充升级成功。保留根 postinstall 补丁。

下一版建议由正式脚本生成 build manifest，至少记录 Friday SHA、vendor SHA、上游目标 tag/commit、构建时间、Node/npm/Electron、native 架构、锁文件与资源哈希。将 manifest 纳入资源与包体验收，检测“源码已升级但资源未重建”。本次仅提出设计，不实现该文件或改构建脚本。

## 6. WBS、依赖、工期

这是下一版六模块全功能范围的估算，不是已完成工时。假设 2 名熟悉 Electron/Office 的工程师、1 名约半时测试，Windows 工具和样本齐备；首期 Windows x64。1 人日按 8 小时有效工作，不含审阅等待、模型/设备等待、签名发布。新模块的 renderer 本体以复用为主；宿主、服务、数据、headless 和打包全部需要实施，不能按“增加两个菜单”估算。

原 **22–37 人日只覆盖原四模块升级及 PDF 修复**，未包含 AI Markdown / AI HTML 全功能接入，已不适用于当前承诺。下表为新的完整总量；两模块专项包只计本模块接入，公共 AI/数据/构建/打印/回归等放在共享包中，避免重复计算。

| WBS | 工作包 | 建议责任 | 依赖 | 人日 | 输出 |
| --- | --- | --- | --- | --- | --- |
| W01 | 源码/资源/数据/参考能力基线、原有失败 | 集成+测试 | 无 | 1–2 | manifest、样本、可恢复副本、G0全量能力映射台账 |
| W02 | PDF P0 修复及真实产物 | 宿主 | W01 | 1–2 | 独立补丁+PDF 矩阵证据 |
| W03 | 复核合并预演、冲突、协议审计 | 集成 | W01 | 2–3 | 128 路径责任分工及语义/exports/handler 清单 |
| W04 | 四编辑器源码融合 | 两工程师 | W03 | 4–6 | 编译通过，定制未被覆盖 |
| W05 | 六模块共享 AI/工具服务、历史/Store/会话 | 宿主 | W03，可部分并行 W04/W13/W14 | 3–5 | 统一配置与可用工具服务，多会话/隔离/取消/恢复 |
| W06 | 六模块构建/资源/CLI/许可证 | 集成 | W03，分阶段接入 W13/W14/W16 | 3–5 | 全量 stage、迁移运行，无新模块漏包 |
| W07 | Windows 打印双实现整合及两新模块 | 宿主+测试 | W04/W06/W13/W14 | 3–4 | 六类目标打印能力、输出和取消 |
| W08 | 六模块数据升级/降级/恢复 | 测试+集成 | W04/W05/W13/W14/W15 | 2–3 | 笔记/文件路由、会话、项目与不可逆变化，副本有效 |
| W09 | 六模块功能/格式/错误/离线回归 | 两工程师+测试 | W04–W08/W13–W16 | 4–7 | 全部 P0 与 MD / HTML 对等项有证据，无阻塞 |
| W10 | 六模块性能和生命周期 | 测试 | W09 稳定候选 | 2–3 | 对照、各 20 次释放、预览/任务回收、滚动 |
| W11 | 候选包、目录迁移、安装 | 集成+测试 | W09/W10 | 2–3 | 清单、升级/回退冒烟 |
| W12 | 审阅和交付记录 | 两工程师 | W11 | 1–2 | 源码/产物/证据对应 |
| W13 | AI Markdown 全功能宿主接入与专项验证 | 模块工程师 | W03，配合 W05/W15 | 7–12 | MD-01～MD-12 全部目标能力，含本模块编辑/预览/Agent/资源/导出；共享链另计 |
| W14 | AI HTML 全功能宿主接入与专项验证 | 模块工程师 | W03，配合 W05/W15 | 7–12 | HTML-01～HTML-12 全部目标能力，含源码/预览/Agent/交互/导出和权限边界；共享链另计 |
| W15 | 新建/打开/偏好迁移及笔记、HtmlViewer 共存 | 宿主 | W01，接口供 W13/W14 使用 | 2–4 | 不自动导入笔记，不按同名覆盖，旧入口与偏好可恢复 |
| W16 | Markdown 与 HTML 双 headless 链和包内命令 | 集成 | W13/W14 接口稳定，配合 W06 | 3–5 | 两类 runtime/worker/协议/导出命令，从候选包实际执行 |
| 合计 | 当前六模块全功能范围 | — | — | **47–78** | 工作量，非自然日；不含下述风险缓冲 |

增量核算：原四模块 **22–37** + 原共享工作包扩展 **6–8**（W05–W10 的新增覆盖）+ Markdown **7–12** + HTML **7–12** + 路由/偏好共存 **2–4** + 双 headless **3–5** = **47–78 人日**。模块专项包含自身的功能验证，W09 只计跨模块、安装环境与错误组合回归；W06 计构建打包，W16 计 headless 业务链，不能再次把同一修改重复计入。

按上述人员与依赖合理并行，基础排程约 **6–9 周**；另预留 **20%–30%** 工作量缓冲（约 10–24 人日），用于 AI 服务等价性、预览权限、IPC/数据、打印和复杂格式，排期粗略按 **8–12 周**准备。工期是研究阶段区间，不是交付日期承诺。单工程师不能采用两工程师的并行排程。静态已见 128 个文本冲突路径，仍需审计其余无文本冲突路径的语义兼容；不能将 273 共同路径或 128 冲突路径乘固定分钟估工时。

旧格式额外转换桥、Electron 主版本升级、helper 重写、外部服务采购/账号审批、额外平台安装验收超出基础假设，W03 后另估。W03 结束依据真实接口与对等清单重估；MD / HTML 已是 P0，重估不能擅自删功能或移到后续版本。本次研究文档时间不在实施工时内。

## 7. 验证层次与证据

| 层 | 待执行 | 标准 |
| --- | --- | --- |
| L1 引擎 | 受影响 workspace 测试/typecheck，六编辑器、Store、AI/Provider、公共包、两新增 headless、CLI | 失败有命令、日志、是否原有的判断 |
| L2 Friday | `npm run office:build`、`npm run build`、`node --test scripts/tests/`，其他按影响执行 | 无新失败，缓存旧产物不算通过 |
| L3 宿主 | `npm run electron:dev`，六类真实 preload/IPC、打开保存导出/AI/打印；同条件对照 MD / HTML 全能力 | P0 可重复、有产物，mock/空工具结果不替代 |
| L4 数据/生命周期 | 升级回退副本、20 次开关、异常取消退出、历史隔离 | 无丢失/误覆盖/串历史/持续实例残留 |
| L5 包体 | 解包、中文空格路径、无 vendor fallback、离线、隔离安装 | 资源真实执行，记录 SHA256 与环境 |

复用现有 file-menu、secondary-menus、pdf-context-menu、ai-stream、export-cancellation、print-dialog、startup、lifecycle、pdf-scroll 探针。先核对新契约，不为变绿删有效断言。

既有 [首开验收](./Office-startup-acceptance-2026-10-24.md)、[菜单/导出/选区验收](./Office-menu-export-selection-acceptance-2026-10-24.md) 是旧基线开发记录。其中首开各阶段达到基线 80%、部分系统打印、最终安装版仍未完整通过，须保留状态。

建议性能非回归阈值：同机同文件交替至少 5 轮，记录冷/暖启动、实际可输入中位数/P95和内存；相对有效开发基线退化 >20% 阻断定位。20% 是拟定阈值，在 W01 固定，不能事后调整。旧“80% 提速目标”另列，不与非回归混用。

## 8. 数据兼容与回退

### 8.1 对照内容

- 文件：正文、表格、图片、公式/备注/页数语义。未保存原件哈希不变；正常保存 OOXML 不要求二进制哈希相同。
- 历史：同文件多会话、活跃会话和标题正确，不同文件不串台。归一化不合并不同文件；重命名/另存行为明确。
- 新模块：Markdown 原文件与 SQLite 笔记按来源/ID 分离，不能以文件同名作为覆盖依据；HTML 旧查看偏好与新编辑偏好迁移有可恢复记录；两模块项目/资源/AI 历史均入备份。
- 存储：新增字段、schema/version、首次迁移写入、旧版可读性。若不可逆，写前备份对应数据，不能只退二进制。
- 新版保存文件由旧版副本读取，记录新特性降级损失，不承诺全部无损降级。

### 8.2 触发条件和顺序

数据丢失/误覆盖、串历史、核心打开保存失效、打印回归、漏包、可复现崩溃或无恢复路径阻断候选。任一 MD / HTML 功能对等缺口、正常配置仍被空工具实现截断、预览越权或包内 headless 不可用同样阻断。P0 不能只列已知问题后宣称完成。

1. 关闭候选和 helper，保存诊断和新增文件副本。
2. 成套恢复上一可用代码、vendor 指针、匹配 resources/office，不能只退一层。
3. 仅在不兼容存储写入时恢复对应数据备份；保留新工作后核对合并，避免旧备份全覆盖。
4. 旧版在副本复验原四类样本、历史、保存、打印，再判恢复成功；新增 Markdown/HTML 原文件、资源和历史另行保留，旧版不具备对应编辑能力不能误称无损降级。
5. 记录问题、版本、恢复清单、遗留差异；新候选号保留原失败证据。

`8ed0c8d…` 是研究锚点。若 PDF 先修形成新基线，回退对象应是“含修复的上一可用构建”，而非机械回到旧故障版本。

## 9. 技术闸门与交付

| 闸门 | 需要的结果 | 未通过 |
| --- | --- | --- |
| G0 开始融合 | 源码/资源/数据已保存，PDF 状态明确，隔离环境可运行；MD/HTML全部菜单、IPC、tools、shortcuts、exports冻结并100%映射 | 补基线/参考清单，不覆盖原工作区，不以抽样映射开工后补 |
| G1 系统回归 | 冲突/IPC 审计、六模块/服务/打印路线、双 headless、全量构建完成 | 留在适配阶段，重估排期 |
| G2 生成候选 | 全部 P0，含 MD / HTML 逐项功能对等、数据回退、资源定位、重大退化排查通过 | 缺任何新模块能力继续修复，不能静默延期或降 P0 |
| G3 候选可评审 | Windows 清单、隔离安装运行、源码产物 SHA 对应 | 保持开发候选并列具体缺口 |

G0 的计划检查输出为一份版本固定的能力映射台账（Markdown / HTML 分表，Markdown表或CSV/JSON均可）：每个菜单、IPC、tool、shortcut、export记录唯一子项ID、MD/HTML父ID、目标文件/符号、条件、Friday对应入口/handler、拟验收操作与责任人；逐项覆盖率须100%，未知/缺映射单独列阻塞清单。另附两层Git/资源/数据快照及参考环境记录。这里规定未来交付格式，不表示当前已生成完整运行台账或参考运行结果。

本次文档交付不包含实施、推送、签名上传或发布。后续发布以 G3 的具体候选和证据评审。

最终实施交付包括两层提交、锁文件、标签、资源 manifest、候选 SHA256、环境、实际命令/退出码/日志、产物截图、MD / HTML 全功能对照台账、外部服务配置前提、未覆盖项、兼容与回退记录。每个“通过”绑定具体版本和样本，不能沿用旧基线。
