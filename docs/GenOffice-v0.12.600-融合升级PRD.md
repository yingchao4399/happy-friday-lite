# GenOffice v0.12.600 融合升级 PRD

日期：2026-11-05。产品：Happy Friday Lite Office，现状 Docs / Sheets / Slides / PDF 四类，下一版目标增加 AI Markdown / AI HTML，共六类。

需求类型：上游引擎融合、Friday 体验保留、PDF 转 Word P0 缺陷修复、AI Markdown / AI HTML 全功能对等接入规划。

关联：[升级分析报告](./GenOffice-v0.12.600-升级分析报告.md)、[实施方案与 WBS](./GenOffice-v0.12.600-融合升级方案.md)。

## 1. 文档状态和立项目标

**当前只交付研究与规划，不实施代码修改，不合并 vendor，不构建/发布新版。** 本 PRD 是下一版立项和实施前提，所有新增验收用例均为待执行。PDF 转 Word 已定位静态调用链缺口，但尚未完成修复和真实产物验证。

升级目标是让用户在 Friday 中得到可用的新版 Office 能力，同时保留文档、AI 历史、文件菜单和宿主生命周期。**下一版必须同时交付与 GenOffice v0.12.600 功能对等的 AI Markdown、AI HTML，两者均为 P0，不能缩成最小编辑加聊天，不能静默延期。** 可调整 Friday 品牌、宿主布局和统一模型配置，不能缩减目标模块已有功能。源码、宿主桥接、构建产物和真实运行结果需要一致。

| 基线 | 值 | 解释 |
| --- | --- | --- |
| Friday vendor | `8ed0c8d099c3c3d87b1a998d9189da3d120ff820` | 固定提交，含 Friday 定制 |
| 与官方标签关系 | `v0.10.639-27-g8ed0c8d0` | 不能等同纯官方 v0.10.639 |
| 官方目标 | `v0.12.600` / `1a0fcec971c714d11777cbd5c68da1c933572d14` | 下一版融合目标 |
| 差异规模 | Friday 14 / 上游 920 提交；349 / 4,617 端点路径，交集 273 | 交集不是实际冲突数，也不是工期承诺 |
| 静态合并预演 | 固定双方提交得到 128 个 unmerged 路径：127 content、1 add/add | 未修改工作区；文本合并不等于语义/运行时验收 |

该基线只证明源码。现有 554 个受版本管理的 `resources/office` 路径缺少可见的统一构建版本 manifest，不能证明每个 bundle 都由该 HEAD 构建；本研究也未确认用户已安装二进制的实际 Office 版本。FR-01 应补齐源码→资源→安装包的可追溯性。

## 2. 用户问题和典型场景

| 用户场景 | 当前问题/风险 | 期望结果 |
| --- | --- | --- |
| PDF 转 Word | 界面有入口，Friday 自有宿主未接 `pdf:convert-office`，原捕获异常无反馈 | 用户选择目标后得到可打开、含实际内容的 DOCX；失败可理解、可重试 |
| 长期本地文档编辑 | 上游持续改进格式兼容，但直接切标签会丢 Friday 定制 | 保存重开正常，页眉页脚、菜单、撤销、只读和性能行为保留 |
| Office AI | Friday 按文件多会话与上游 Store 演进可能相互覆盖 | 同文件恢复正确历史，不同文件隔离；继续用 Friday 模型配置 |
| AI Markdown | 上游完整模块尚未接入 Friday Office；当前 `.md` 打开可能自动导入并按同名更新笔记 | 原 `.md` 文件直接进入 AI Markdown，功能与目标版对等；导入笔记另设显式动作，不误覆盖同名笔记 |
| AI HTML | 现有 HtmlViewer 是查看入口，不等于目标的 AI HTML 编辑器 | 源码/预览/AI/导出等全部目标能力可用；旧查看行为与用户系统打开偏好保留 |
| 多格式导入 | 官方版本提供新导入能力，Friday 路由尚未必接入 | 完成桥接的格式才能显示可用，不把上游发布说明直接当成 Friday 功能 |
| 安装版使用 | 开发目录 fallback 可能掩盖 WASM/OCR/sidecar 漏包 | 无源码、无 vendor/node_modules 的安装目录也能运行 |
| 升级后回退 | 新 Store 写入和新增特性可能不被旧版理解 | 有成套版本/资源/数据恢复方案，用户新工作不被旧备份覆盖 |

## 3. 范围和优先级

P0：下一版候选必须通过，失败阻断，包含 AI Markdown / AI HTML 的全部目标对等项。P1：仅适用于本节其他明确列出的条件能力，完成接入与验收后纳入；若推迟，必须取消对应宣传/入口并记录。P2：后续优化，不作为本次升级完成前提。不得将两新模块的 P0 缺口归入 P1 延期清单。

### 3.1 必须保留与修复

- 保留原四编辑器，并新增 AI Markdown / AI HTML；六类在 Friday Tab/窗口中打开、编辑、保存、关闭重开，具备各自在目标版已提供的完整导出和打印能力。
- AI Markdown / AI HTML 全功能对等：编辑/预览、AI Agent 与工具、stream/取消/交互、文件与会话/项目生命周期、资源、菜单/快捷键、国际化及两模块 headless 链全部纳入 P0。
- Friday 品牌、统一菜单/选项、多页页眉页脚、dirty/撤销规则、PDF 全文选区与虚拟渲染。
- Friday 模型桥接、流式和取消、按文件多会话/标题、保存后的知识库联动。
- PDF→DOCX 从入口到实际文件的完整闭环，包含取消、错误、密码、OCR、资源与路径情况。
- 完整构建与资源打包、现有数据副本兼容/回退，Windows x64 实际宿主和候选包验证。

### 3.2 上游新能力的条件接入

| 能力 | 产品价值 | Friday 接入条件 |
| --- | --- | --- |
| DOC/DOT、HWP/HWPX 导入为 DOCX 副本 | 读取更多历史/地区文档 | 文件路由、过滤器、原 Shell 导入 handler、转换依赖、结果打开均接通；原件不改 |
| Docs 页边框/水印/绘制笔库 | 丰富文档呈现 | renderer 与格式读写均可用，保存重开检查，界面不被 Friday 菜单定制覆盖 |
| Sheets 外部工作簿实时值、Queries & Connections | 跨工作簿数据分析 | 实际命令/菜单/权限与宿主依赖可用；外源失败能保留文档和说明状态 |
| Sheets CLI/MCP links 等 | 自动化外链操作 | Friday CLI/Agent 暴露契约与包内运行验证，不自动引入另一套 MCP 配置 |
| Slides 小屏上下文菜单改进 | 窄窗口可操作 | Friday 窄窗口、键盘、长菜单与原菜单定制一起回归 |
| PDF OCR/坏页稳定性修复 | 避免扫描文档转后空白或重开失败 | 本地 OCR 资源和主进程链可执行；逐页状态和重开内容核验 |

当前 `office-files.js` 只识别 DOCX、XLSX、XLSM、CSV、PPTX、PDF。Markdown / HTML 路由扩展属于本版 P0；上表旧格式能力仍是 P1 条件，不能仅因 vendor 合并就标为已支持。完整上游差异与证据由分析报告负责，PRD 只列对用户可见的目标和接入条件。

### 3.3 不包含

完整上游独立 Shell、自动更新器、另一套模型/API Key 存储、重做 Friday 导航、无证据地升级主应用 Electron、宏执行承诺、所有 PDF 完全还原原排版、跨平台未测试即宣称支持。远程推送、签名上传、发布不在当前文档任务和本地实施范围。

## 4. 功能需求

| 编号 | 需求和可观察行为 | 优先级 | 关键依赖 |
| --- | --- | --- | --- |
| FR-01 | 源码可追溯至目标标签和 Friday 定制历史；根 gitlink、锁文件、产物对应 | P0 | 隔离合并、版本 manifest |
| FR-02 | 六类编辑器使用 Friday Tab/窗口/布局，切换隐藏后能继续编辑，恢复会话不误认类型 | P0 | 路由、tabSession、host/view 生命周期、preload |
| FR-03 | 六类打开/新建→编辑→保存/另存→关闭重开，正文和结构正确；dirty/外部变更规则正确 | P0 | 六类型注册、归档和 flush |
| FR-04 | 关闭 dirty 文件有保存/不保存/取消；取消保留编辑，无静默丢失 | P0 | 会话与关闭协议 |
| FR-05 | PDF 转 Word 完整闭环、可见进度/错误、有效 DOCX、源/目标保护 | P0 | 独立转换 bundle、IPC、资源 |
| FR-06 | Friday AI 配置和主进程桥接、流式/取消/错误及两新模块全部工具交互可用，正常配置不被空实现截断 | P0 | agent/provider、搜索/图片/媒体服务等价适配 |
| FR-07 | 同文件多会话、活跃会话、标题可恢复，不同文件无混用 | P0 | Friday Store 字段与上游归一化语义融合 |
| FR-08 | 保留品牌、多页页眉页脚、菜单/i18n、只读、选区、撤销边界 | P0 | 冲突逐功能处理 |
| FR-09 | 已有导出读取当前快照，取消/失败不破坏已有目标；普通导出不清 dirty，PDF 转换依第 5 节确认保存约定 | P0 | export-document、worker/native |
| FR-10 | 六类 Windows 打印具备各自目标能力，输出/取消/退出正确，保留已支持参数 | P0 | Friday 定制链与上游新链整合 |
| FR-11 | WASM、OCR、sidecar、CLI、技能与许可证完整，移动目录可运行 | P0 | build/stage、运行时相对路径 |
| FR-12 | 旧项目/文件/历史在副本升级与回退可用，新工作有保留路径 | P0 | 数据差异审计和恢复 |
| FR-13 | Office 保存后仍触发知识库刷新，索引读取新内容 | P0 | office-session/knowledge |
| FR-14 | 旧格式导入为 DOCX 副本，原件不变；转换不支持有明确反馈 | P1 条件 | 路由、导入 handler、依赖 |
| FR-15 | 页边框/水印/绘制及外链/连接新能力通过专项验收后可用 | P1 条件 | 模块接入，格式往返 |
| FR-16 | 小屏/深浅色/中英菜单和键盘可操作，长菜单可滚动 | P0 保留 / P1 新优化 | 上游 UI 与 Friday 菜单融合 |
| FR-17 | 同环境性能无重大退化，20 次开关无持续实例残留 | P0 | 稳定候选与基线 |
| FR-18 | CLI/Agent 样例命令在候选包可用，不依赖开发目录；MD / HTML 目标已有命令全部属于 FR-24 P0 | P0 既有 / P1 其他新命令 | CLI bundle 与资源定位 |
| FR-19 | AI Markdown 与目标 v0.12.600 的完整功能对等，MD-01～MD-12 全部验收 | P0 | 模块、宿主、AI/资源/导出/headless |
| FR-20 | AI HTML 与目标 v0.12.600 的完整功能对等，HTML-01～HTML-12 全部验收 | P0 | 模块、预览权限、AI/导出/headless |
| FR-21 | `.md` 直接文件编辑与“导入为笔记”分开，HTML 编辑与旧 HtmlViewer/系统打开共存 | P0 | 文件路由、类型元数据、打开偏好迁移 |
| FR-22 | 两模块新建/首存/另存/重命名后，按文件多会话、项目历史、资源及知识库通知保持一致 | P0 | ProjectStore、路径键、保存事件 |
| FR-23 | HTML 预览保留目标脚本交互，文档不能取得 Friday 宿主、密钥或任意文件权限 | P0 | 预览隔离、协议/导航/资源策略 |
| FR-24 | 两模块各自 headless runtime/worker/导出命令从候选包实际可用 | P0 | headless 注册、worker、CLI/skills、包资源 |
| FR-25 | 对等项逐一有目标证据、依赖条件、Friday 实现和最终候选证据；缺失阻断 | P0 | MD / HTML 稳定 ID 台账、同条件对照 |
| FR-26 | 保存/另存/导出/打印/关闭菜单和快捷键按活动六类型分发，演示/独立窗口与文档owner一致 | P0 | 两模块原Shell菜单责任迁移、活动目标与caller绑定 |

### 4.1 六模块和功能对等的共同合同

对等基准是固定 `v0.12.600`，不是滚动 main，也不是只比较模块名称。下列 MD / HTML 稳定 ID 同时用于分析报告、实施任务和验收记录；每项拆成“目标源码/参考行为、适用条件、Friday 入口与桥接、候选结果、证据路径、责任人”。一项包含多个命令时须逐条勾验，不能只测其中一个后整行通过。源码证据只能证明目标范围，不能当 Friday 运行证据。

1. **接入方式可适配、任务能力不缩减。** 使用 Friday 导航、Tab、品牌和统一模型配置；保留目标实际支持的编辑器、AI 工具、流式事件、取消、交互回合、预览、导出和自动化行为。目标未提供的能力不凭想象承诺。
2. **外部依赖按同等前提验收。** 需要搜索/图像/媒体服务时允许等价 provider，不强制 Genspark 账号；应在同平台配好有效配置，实测工具调用与结果。AI 不要求逐字相同，工具行为、资产生成、流式/取消、交互和错误恢复需等价。目前 `office-ai-bridge.js` 的搜索空数组、fetch-image 空值、图片生成/媒体分析 unsupported 不能成为最终实现；错误恢复通过不能替代正常能力通过，disabled 也不算交付。
3. **文件不等于笔记导入。** Office 首页及“用 AI Markdown 编辑”直接读写原文件；“导入为笔记”为独立显式动作，不能按同名覆盖已有笔记。HTML 增加显式 AI 编辑动作，原 HtmlViewer 和系统打开继续可用。保留用户 system 偏好，旧 internal 偏好迁移需清楚、可恢复。未经目标确认的 `.mdx` 不自动当普通 Markdown 支持。
4. **全链类型一致。** router、tabSession、OfficeWorkspace、fileMeta、host 注册/扩展名、createView/save/close/queryDirty 全部扩展为六类；未知类型报错，不能落默认 PDF。刷新、恢复上次会话、布局切换、同名异目录文件都保留正确类型。
5. **历史与资源一致。** 两模块接 Friday 按文件多会话、标题/活跃会话及目标项目/资源语义；新建首存、另存、重命名、路径规范化、外部变化、关闭恢复不串数据，保存继续触发知识库刷新。
6. **预览有权限边界。** HTML 脚本/交互可用不等于拥有 Node/Electron、Friday preload、模型密钥或任意文件权限；网络、文件资源、链接/导航、弹窗策略须显式设计并核验，保留目标用户功能。
7. **安装版和 headless 同等必需。** 两模块各自 runtime、worker、IPC、导出/CLI、资源和许可证从正式包运行；仅开发预览可用或仅 UI 可用不通过。完整功能对等缺项必须阻断，不能以“下一版再补”关闭缺陷。
8. **菜单存在必须有正确动作。** 两模块main不自带完整应用菜单，上游Shell承担save/saveAs/export/print/close和活动detached目标。Friday菜单、Ribbon动作和快捷键须按活动六类型分发，同一操作固定文档/owner并在异步后复核。菜单可见但仍仅分发原四类，或演示/独立窗口操作写到后台另一文件，均不通过。

### 4.2 AI Markdown 全功能对照与专项验收（全部 P0、待执行）

支持范围以目标真实文件检测为准：`.md` / `.markdown` 为 Markdown；目标另支持 `.txt` / `.json` 的独立 CodeMirror 源码模式，该模式没有块模型且 `runExport` 返回 false，不能宣称拥有完整块编辑/AI 导出。当前 Friday 分组出现 `.mdx` 不证明目标支持 MDX。下表的能力与依赖来自固定目标源码，详细文件/符号证据见分析报告。

| ID | 目标功能与接入要求 | 必须执行的验收及证据 |
| --- | --- | --- |
| MD-01 | Markdown 文件新建/打开、保存/另存、dirty/标题、关闭确认、原文件直接编辑；`.txt/.json` 按目标独立源码模式处理 | Office 首页与显式编辑进入正确类型；中文空格路径、首存取消、另存、写失败、关闭三分支、重开正文正确；不自动导入/覆盖笔记；区分源码模式受限行为 |
| MD-02 | 富编辑/Markdown 源码双向同步、undo/redo、find/replace、theme/zoom、字词统计、Ribbon 折叠、拼写检查；SourcePane 保持 live 块视图挂载，区别于 txt/json 分支 | 冻结菜单/toolbar/上下文命令逐项操作，视图切换不丢结构/光标/dirty；与目标参考结果核对，不以一个文本框替代完整编辑 |
| MD-03 | 标题1–6/正文/quote/code、bold/italic/strike/highlight/inline-code/link、bullet/ordered/task、table/TableMenu/slash、hr、YAML frontmatter、footnotes、KaTeX、Mermaid/WaveDrom、block drag/keymap/IDs/link | 全语法代表样本逐命令编辑并保存重开，源文本与渲染对照；raw HTML 未编辑源码保留与 AI 禁止写 raw HTML 分开验证，不冒称完整富 HTML 编辑 |
| MD-04 | 大纲、Wiki 链接 alias/embed、标题/块 fragment、补全、创建缺失 note、backlinks/tags/graph；`openSourcePath` 依赖 `home:open-path` | 多文档项目按全部入口导航/创建/回链，fragment 定位与嵌入正确，缺失目标可恢复；同名异目录不跳错/覆盖，路由真正接通而非菜单存在 |
| MD-05 | 本地选择/粘贴图片、saveImage/readImage/另存图片/查看器；SaveAs 资源复制重写/资产清理；md-asset 限文档目录或配置 vault 的 realpath 范围并防 symlink 逃逸；S3兼容/S.MS/GitHub 图床 | 插入/查看/另存/跨目录 SaveAs/重开图片正确；图床正常上传可用，配置/上传失败保留 local assets fallback；越界/符号链接拒绝且不破坏合法资源 |
| MD-06 | 选区范围 AI、编辑队列、`apply_ops`、stale guard、脱敏、工具变更撤销 | 有/无选区分别运行完整工具流程；旧版本操作拒绝或重试；工具变更可撤销且不串文档；stream/tool 状态与异常、stop 后可继续 |
| MD-07 | 整文档 stream writer、取消后的 keep/discard，思维导图卡片方向及插入可编辑 Mermaid | 长文逐段流式，stop 后分别 keep/discard 对照内容/dirty；思维导图方向切换与插入后继续编辑/保存重开；不是只展示聊天文字 |
| MD-08 | 8个本地具名工具get_document_context/read_blocks/apply_ops/write_document/image_search/insert_image/generate_image/read_frontmatter，加共享MIND_MAP_TOOL（generate_mindmap）组成AGENT_TOOLS共9；AiPanel组合createMarkdownSkill与createSearchSkill的web_search共10，generate_image不可用时每请求动态过滤为9；insert_image内部经markdownApi.fetchImage调用ai:fetch-image，fetch_image不是独立工具；图片要求文档先保存 | 正常配置全部实际工具与服务调用返回并用于文档；分别核对Agent tool、skill和IPC，按imageGenerationAvailable(settings)条件比对工具数及UI；未保存引导首存，取消无半成品；搜索method:error有明确错误，不伪装空结果；断网/无服务可恢复，不能用宿主空实现判通过 |
| MD-09 | Agent 模型设置、skills 列表/text/管理、token、retry/stop/队列及 `projectApi.resolveChat/appendChat/loadChat/rebindChat`；目标公共 handler 由 Shell/Docs 注册，需要 Friday 等价接通 | 统一 Friday 模型配置运行；全部面板操作可用，两文件多会话/标题/活跃会话隔离；首存/另存/rebind、项目重开与旧数据迁移正确，不引入第二套配置 |
| MD-10 | GUI 导出 `pdf/docx/docs/png`，docs 为 DOCX 缓存并打开 Docs，PNG 为 prepare/write/finish 多页图片工作流；应用 headless 仅 md/markdown→PDF；CLI convert 支持 Markdown→DOCX/HTML/PDF，前二者走 Node、PDF 走应用链 | 各 GUI 格式读取当前快照并可打开；docs 真转入 Friday Docs，多页 PNG 完整/清理；包内分别执行 Node/应用命令，校验 argv、JSON及退出码；不把 GUI docx/png 冒充应用 headless 支持 |
| MD-11 | 独立 print request/iframe；目标 printDoc 明确等待图片decode、afterprint（含取消）后finally移除iframe，未确认该段显式等待fonts.ready；保留目标布局/分页/参数 | 含长表与图片样本实际打印/虚拟打印 PDF，内容不空白，字体/分页及表格对照目标；取消/失败释放iframe/任务/临时资源，不把拟加字体等待当现状 |
| MD-12 | Ctrl/Cmd+S、Shift+S、P、F、E；替换为Windows/Linux Ctrl+H、macOS Control+H；缩放/滚轮，30秒及blur autosave，外部变更/保存冲突与BOM/EOL保护；i18n/主题/包资源与生命周期 | 真键盘逐项触发，macOS替换不得误用系统Hide的Cmd+H，中英/深浅色无key泄露；clean且未saving时外部变化自动reload并ack，dirty/saving时提示changed；未决保存报conflict，reload或overwriteNow由用户选；keepMine仅ack清notice并允许后续覆盖，overwriteNow立即保存，autosave不得代选；保存中新编辑仍dirty、BOM/EOL保留；移目录/20次开关无持续残留 |

上述 12 项是对照分组，不是允许只测 12 个点击。W01 要从目标菜单、命令、IPC、Agent tools、快捷键和导出入口冻结 **100% 映射清单**；任何未映射入口保留为阻塞项。`.txt/.json` 无完整块 AI/导出的目标限制要如实呈现，不借此限制正常 Markdown；MD-10 的 headless 确切命令/格式以目标注册表记录，不能将 CLI restricted fragment 导入冒充本模块完整转换。

G0 为实施方案第9节的“开始融合”闸门：计划输出固定目标能力台账、未映射阻塞清单与Git/资源/数据参考快照。台账每个子项含唯一ID、MD/HTML父ID、目标文件/符号、依赖条件、Friday入口/handler、拟验收与责任人。当前12项是静态研究分组，不能冒称已完成该运行基线。

MD-12 保存并发要覆盖目标精确合同：`doSave` 在 await 前捕获 doc/frontmatter，成功后仅两者仍为保存快照时清dirty，否则 renderer 向主进程重申dirty；源码模式比较 `sourceText` 保存快照。外部变化以 dirty或saving 为待决依据，因此保存期间的外部改动也提示changed。须用“保存中继续输入”和“保存中磁盘改写”两组操作验证，不能只测静止文档保存成功。

### 4.3 AI HTML 全功能对照与专项验收（全部 P0、待执行）

HTML 必须同时支持 `.html` 与 `.htm` 的源码编辑和保存，不以旧 HtmlViewer 或静态网页预览替代。GUI 导出 `DOCX / PDF / 单文件 HTML`，另有系统打印；单文件 HTML 只内联可读取本地图片并报告 skipped，不宣称所有远程资源都离线打包。以下稳定 ID 与分析报告一致，按完整目标能力验收。

| ID | 目标功能与接入要求 | 必须执行的验收及证据 |
| --- | --- | --- |
| HTML-01 | `.html/.htm` 新建/打开/源码编辑/save/saveAs/dirty关闭确认、rename路径同步与AI命名；已命名文件30秒及blur autosave，未命名先首存；clean外部变化自动重载，dirty冲突由用户处理 | 两扩展名逐步操作；首存/另存取消、写失败、三分支关闭、rename后历史/资源、autoSave及磁盘变化均与目标一致；不影响旧HtmlViewer/system偏好 |
| HTML-02 | CodeMirror 为 source-of-truth，preview/split/source；源码cursor↔静态元素/breadcrumb、find/replace、envelope保留 | 三视图切换、源码编辑/选中预览元素双向定位；搜索替换和原文档外壳保存重开正确，不以DOM快照覆盖真实源码 |
| HTML-03 | desktop/tablet/mobile，缩放50–200%步长10、Ctrl ±/0/pinch，脚本运行；动态无sid节点不能按静态源元素直接编辑，脚本改映射节点有dirty提示 | 各设备/缩放/键盘与脚本交互实际运行；静态与动态节点选择/编辑限制正确，不将动态DOM误写入源码 |
| HTML-04 | inline文本、选中、拖动重排/resize、上移下移/duplicate/delete；插入heading/paragraph/list/button/image/table/section/divider，blank-only skeleton，table picker 8×10 | 全命令逐项操作并保存重开，undo/redo和源码变化一致；空白/非空白文档模板边界及表格最大选择正确 |
| HTML-05 | 粗斜/字号/文本色/背景/对齐；宽高/比例锁/opacity/radius/padding/alt/object-fit/custom CSS；本地/URL图片、replace/crop/cutout/镜像/90°旋转/align；实时poke可revert，save/export前flush | 属性、图片和CSS逐项可见、源码一致；尚未提交poke时保存/导出读到最新值，revert不残留；图片资源失败不损文档 |
| HTML-06 | AI局部 `get_outline/read_source/apply_ops`；9种ops：str_replace/replace_element/set_inner_html/set_text/insert_html/remove/move/set_attr/set_style；batch全成全败，manual-version/staleness guard，附件异步展开后重验，选中Ask AI/edit queue | 每种op成功和失败对照；批量错误不半写，编辑过程中旧工具操作被拒；选区与队列准确、stream/stop后可继续，不串文档 |
| HTML-07 | ask_clarification→plan_page（可编辑brief/style tiles确认）→page writer流式draft；new/redesign/restyle/extract；restyle保结构改变量；write_document内容优先单栏；截断草稿确认、继续/取消 | 完整交互回合和各intent实际改文档；用户能改计划再确认；长流/截断/取消/继续有正确内容和dirty，不以聊天文本代替页面结果 |
| HTML-08 | 10工具：get_outline/read_source/apply_ops/ask_clarification/plan_page/write_document/search_images/generate_image/web_search/read_attachment；intent skill仅context无工具；文本附件24000字符分页、图像多模态、drag/paste/attachment://、单消息用户skills、usage/stream cancel/语言 | 全部工具正常配置实测；长文本分页和附件引用不漏页，图像/拖拽粘贴正确；skills list/text/管理入口可用，stop/错误/重试恢复；不能沿用Friday空搜索/图片实现 |
| HTML-09 | project:*聊天持久化/首次保存重绑；AI工具修改前最多20个内存快照；content/attr/script字符串脱敏标记，AI projection `{{label}}` 和guard拒碰原值，文件与正常渲染保原值 | 多会话/重绑/关闭恢复不串数据；20快照上限及回退正确，关闭后不冒称持久版本库；脱敏投影不泄原值、不改文件原值，不宣称加密；versionRef仅staleness generation |
| HTML-10 | 演示tab去chrome/fullscreen/新演示tab、Esc回编辑、live未保存预览；host setBleed/hostWindow/openTab及owner生命周期 | 三种演示入口和Esc、切tab/关闭owner可重复；未保存内容可见，编辑器恢复正确，无孤立窗口或Friday布局污染 |
| HTML-11 | GUI DOCX/PDF/single-file HTML及系统print；DOCX以hidden真实网页html2docx→OOXML，PDF A4背景打印；单文件HTML仅可读本地图内联并报告skipped；headless/CLI仅HTML→PDF/DOCX | 各输出实际打开核对；已打开目标dirty保护、取消不截断，skipped透明；系统print与PDF分别检查动态内容（print允JS、PDF禁JS，不能承诺同输出）；候选包执行两个headless格式 |
| HTML-12 | app.ready前集中注册html-preview/html-asset协议；资产仅已打开文档目录且realpath防越界；SaveAs跨目录搬迁重写、失败rollback、pending清理/manifest；预览iframe允许scripts/forms/popups/modals，无allow-same-origin且允许网络；i18n/主题/偏好/包资源/快捷键 | 合法交互/资源可用、越界不可达；SaveAs成功与失败均验证资源和回滚；导航/弹窗/网络按策略实测，不声称任意HTML绝对安全；中英/主题及模块快捷键全量映射，移目录/20次生命周期/包内资源通过 |

目标 HTML 主进程配置并不代替共享合同：还需 Friday 处理 `project:*`、`home:open-path`、`ai:skills-list/skill-text/open-skills-settings`、`ai:suggest-file-name` 以及主题/语言/autosave/panel prefs。`configureHtmlRuntime` 配置 preload/renderer/openGeneratedPath 之后仍要逐入口注册。快捷键必须从目标实际 keymap/Shell 入口冻结核验，不能只保留 Ctrl+S/P 或自称“常用键兼容”。

### 4.4 服务、预览与自动化的验收口径

HTML preload 调用 `ai:web-search`、`ai:image-search`、`html:fetch-image`、`html:ai-generate-image`；目标 HTML 主进程的图片生成读取 `ai-settings.json` 和 `documentMediaRoots`，Friday 必须接统一 settings/provider 与正确资源根。Markdown `generate_image` 也经过模块自有主进程通道和本地 `ai-settings`，不能只替换公共桥；其 web search 消费 `method/results`，必须保持返回形状及 `method:error` 反馈，Friday 空数组可能同时违反合同。Markdown 与 HTML 共享可用服务适配，但各模块入口和工具结果要分别验证。能力受目标条件控制时在相同配置下比较；无 API Key 时的预期提示不能作为有配置能力成功的证据。

拟在主进程复用目标搜索/媒体实现并增加已解析设置/配置读取注入，Friday SQLite继续作为唯一密钥持久化源，不为原settingsPath helper另存明文ai-settings.json。renderer只取必要脱敏设置与能力标志；文字LLM、搜索provider和图像provider分别判定。webSearch合同为`{results:[{title,url,snippet}],answer?,method,error?}`；imageSearch为`{images:[{title,imageUrl,sourceUrl,source,width?,height?}],method,error?}`；生成图片工具为`{url?,error?}`。正常非空、真实零结果、method:error、资产写入正确文档和取消分别验，不统一将图片结果改为results。本段为拟实施与验收要求，当前没有代码改动或通过证据。

对 HTML 预览分别记录脚本交互、iframe/sandbox、来源与协议、相对资源、网络请求、链接/外部导航、弹窗和退出清理，验证其不能访问 Friday 的 Node/Electron、preload、模型密钥或任意文件写。目标具有的页面交互须保留；出现上游安全问题应修边界后验证等价功能，不能通过禁用全部脚本缩小范围。

GUI 导出与 headless 是独立链，分别留产物和退出码。目标 `HEADLESS_TARGETS` 为 Markdown→PDF、HTML→PDF/DOCX，输入扩展名分别 md/markdown、html/htm。上游应用协议为 `<app binary> --headless-export <input> --to <format> --out <path> [--json]`：例如 `--headless-export input.md --to pdf --out out.pdf --json`，或 `--headless-export page.html --to docx --out out.docx --json`。Friday 须扩展既有 argv/headless 路由，保留应用退出码0/1/2/3；应用JSON成功为`{status,summary,output_path}`、失败为`{status,summary,error}`，不能因vendor存在函数就判通过。

上游CLI能力基准还包括 `genoffice convert notes.md --to docx|html|pdf --out ...`，其中 Markdown→DOCX/HTML 走 `NODE_ROUTES`，PDF走 `APP_ROUTES`；HTML→DOCX/PDF走应用链，例如 `genoffice convert page.html --to docx --out out.docx`、`genoffice convert page.html --to pdf --out out.pdf`（需要覆盖时用 `--force`），以及 `create --type pdf --from page.html --out out.pdf`。这些是目标能力与路由参考，**Friday以现有 `happyfriday-office` / `office_*` 接口落地，不另承诺独立 `genoffice` launcher**。HTML→DOCX 的网页 `html2docx` 与 `create --type docx --from restricted-fragment.html` 不是同一路，不能互相替代。没有 HTML→HTML headless 或独立 HTML read/apply CLI，不凭空承诺；GUI Markdown DOCX/PNG 也不等同应用 headless 格式。

Friday 已有 `happyfriday-office.cjs` 的构建、stage、extraResources入包和 `office-agent.js` 调用机制；本次是在已有链上扩展，不从零造CLI。当前 `office-headless.js` 明确拒MD/HTML、renderer分支仅四类，`office-files.js` 类型检测也仅四类，需更新argv/检测/格式/runtime/worker、agent能力及随包skills。已有bundle内嵌 `VERSION="0.10.0"` 只代表CLI模块版本，不能等同GenOffice产品tag或安装版证明。验收入口、最终命令和二进制路径应在台账登记为真实Friday接口。

外层CLI与应用协议分别验schema：CLI退出码为0/1/2/3/4，4用于app unavailable/crashed；成功JSON另含command/detail/warnings，失败为`{status,command,code,error,message,suggestion?,detail?}`，其中error为稳定reason。应用链wrapper在收到ok envelope且输出文件存在时，即使child非0或退出阶段超时被终止仍认成功；未产物的timeout按conversion=3，缺app/崩溃按app=4。用产物、envelope和进程状态共同核验，不能将应用0–3合同套到CLI，亦不能只看child exit code误报失败。此为目标合同与拟迁移验收，尚未在Friday实施。

### 4.5 对等台账模板与逐条判定

下表为未来每个能力子项的登记模板，当前没有填写运行通过记录。一个父ID可有多行，例如 MD-10 下GUI PDF、GUI DOCX、docs打开、PNG、应用headless PDF和CLI Node路由必须分别登记，不得以任意一个结果替代其余结果。

| 字段 | 记录内容与判定要求 |
| --- | --- |
| 身份 | 唯一子项ID（如MD-10.GUI-PDF）、父ID、优先级P0、模块、责任人；ID固定，不因未完成而删行 |
| 目标证据 | 固定tag/完整commit、目标源码文件/符号或菜单/keymap/IPC/tool、参考平台与操作；静态证据和参考运行分别标记 |
| 用户任务/入口 | 原始意图、目标入口，Friday对应菜单/快捷键/CLI或office_*入口，适用视图与active owner |
| 条件/配置 | 样本ID与哈希、服务配置ID、模型能力、网络/账号/图床/vault/字体等前提；不写密钥 |
| Friday接入 | renderer/preload/main/shared handler、资源/协议、数据键、最终CLI路由；入口存在但未有handler列“未映射” |
| 操作与结果 | 前置状态、逐步操作、预期可观察结果与不可接受结果；成功、取消、失败/权限不足按需要分别建子项 |
| 候选与证据 | 根/vendor完整SHA、包SHA、系统/运行时、实际入口/命令、退出码、脱敏日志/截图、输出文件SHA与结构/打开结果 |
| 数据与身份前后 | 下节要求的源/目标文件、文档/资源/笔记/项目/会话身份、dirty与磁盘快照；说明合法变化及禁止变化 |
| 状态/缺口 | 未映射 / 待实施 / 条件阻塞 / 待验收 / 通过 / 失败；附缺口、复现、修复任务与复验版本。当前所有专项运行项为待实施/待验收 |
| 判定 | 负责人和复核人、日期；“通过”须最终候选实际结果。上游无该能力才能注明“不适用”，必须有源码依据，不能用Friday未实现或服务缺配置作为不适用理由 |

示范登记只给结构：`MD-10.GUI-PDF｜P0｜目标commit+导出符号｜Friday菜单→对应IPC｜样本/配置ID｜输入/输出身份｜实际产物及证据｜待实施`。其中不得预填“通过”、假路径或假命令。覆盖率以冻结的目标子项为分母，100%映射和100% P0验收分别计算；有条件阻塞/待验收不是通过。失败重测保留旧证据，不覆盖历史记录。

### 4.6 源、目标文件与数据身份判定

| 身份对象 | 必须记录与判定 |
| --- | --- |
| 源文件与内存快照 | 原始路径、规范路径键/realpath及允许根、类型/扩展名、源哈希、当前文档session/entry、dirty、保存开始的内容版本；区分磁盘源与未保存内容，正常已确认保存可合法改变源哈希 |
| 输出目标 | 目标路径/规范路径、是否与源等价、是否已有文件/在别的Tab打开/dirty、写前哈希、用户替换或关闭选择；导出禁止误覆盖源，另存按显式确认和目标合同；取消/失败不得截断既有目标 |
| owner与活动目标 | 发起Tab/窗口、编辑WebContents、caller与对应文档ID；菜单按活动类型定位，异步中切Tab不得重新绑定新文档；owner关闭/替换后的迟到结果不写盘 |
| 文件移动与首存 | 未命名临时ID→首次路径、rename、SaveAs、原路径继续存在与否；记录目标参考语义和Friday迁移决策，避免仅按basename识别文档，原始文件与另存副本不能误合并 |
| 笔记与原文件 | SQLite note ID/知识库文档ID和Office文件路径分开；同名笔记、不同目录同名文件分别保留。直接编辑不调用隐式同名导入，导入动作需明确目标和覆盖选择 |
| 项目与AI会话 | ProjectStore路径键/project ID、chat IDs、activeChatId、标题、首次保存rebind关系和迁移前后键；按参考合同记录rename/另存/移动的归属，不能丢历史或串到另一文件 |
| 资产与预览来源 | doc/vault/project/media根、图片真实路径及引用、asset manifest/pending、预览URL/protocol来源；SaveAs重写和失败rollback可核验，清理不能删除仍被别的文档使用的资产 |
| 回退数据 | 旧版/新版schema、写前副本位置、不可逆变化与恢复范围；恢复不覆盖新产生的原文件/笔记/会话/素材，旧版不支持的新模块另保留读取路径 |

每个操作明确允许改变哪些身份：普通编辑不换文档身份，首次保存要完成临时到正式绑定，另存/rename按冻结合同迁移，不由模糊“同文件”表述代替。Windows路径大小写、中文空格、相对路径、同源别名/符号链接与多目录同名样本用于验证身份规则；源保护比较未编辑输入或已确认保存快照，不能要求合法保存后仍与保存前哈希相同。

### 4.7 AI与外部服务配置判定

| 配置项 | 参考条件及通过要求 |
| --- | --- |
| 统一模型/provider | 记录脱敏配置ID、provider/model、endpoint类别、工具/多模态/流式能力与选择来源；两模块正常通过Friday统一配置，无第二套失效ai-settings。密钥仅记录是否配置，不写值/可还原片段 |
| 搜索/图片/媒体服务 | 按实际Agent tool、skill、IPC分别列web/image search、图片抓取/生成和模块使用的媒体能力，以及服务/账号/权限/配额条件；webSearch返回results，imageSearch返回images，均保留method/error合同；有效配置实际调用并进入文档，不以空数组/null/unsupported代替 |
| 图床/vault/资源根 | S3兼容/S.MS/GitHub等目标配置、允许目录、上传/下载/本地fallback分别验证；成功产物可读、失败保留合法本地资产，不把失败fallback当正常上传成功 |
| 同等对照 | 上游与Friday使用同平台、同输入、同类别有效服务条件；AI文字/布局无需逐字逐像素相同，工具步骤、交互确认、资产、可编辑结果、stream/取消/错误恢复需达到同一任务能力 |
| 缺条件与错误 | 缺账号/断网/配额耗尽的提示与恢复单独验证，可登记“条件阻塞”；不得据此判正常能力通过或删掉P0。服务恢复后重跑正常路径与下一次任务 |
| 证据与隐私 | 记录请求关联ID/工具名/阶段/结果摘要、资产和输出哈希，不落API Key、密码或无关正文；实际服务费用/账号前提记录为实施依赖，不能伪造外部调用 |

若参考环境本身失败，先记录条件与已知上游问题并补合适配置，不能从共同失败推出Friday功能对等。能否完成指定任务由上述台账逐子项判定，不以“使用同一SDK”或“没有抛异常”作为成功标准。

## 5. PDF 转 Word 的用户流程和反馈

1. 用户在有效 PDF 中选择“转换为 Word”；所有 PDF 转换格式共享从对话框前到收尾的 inFlight 或串行队列，切换文档/格式不能绕过，PDFium 调用串行。
2. 若有未保存修改，先经用户确认完成正式保存；保存确认取消则整个转换结束，源及 dirty 保留，不能拿旧版本继续转换。
3. 用户选择 DOCX 目标；取消不新增/替换输出、不额外修改源。若第 2 步已确认并完成源保存，保留该已保存状态；不能承诺撤销用户已确认的保存。
4. 处理密码及本地解析，显示进度；扫描页可走 OCR。对密码不 trim，空白可能是有效密码。
5. 结果完整且目标允许替换后再写入；成功通过 Friday 打开 DOCX，原 PDF 保留。
6. 若转换成功但打开失败，说明“文件已保存到…，打开失败”，不能误报没有生成。
7. 失败、取消、关闭/切换后清任务状态。无法取消的底层阶段应说明仍在处理，不能显示已取消却随后偷偷落盘。

密码实现建议优先复用官方 `convertWithPasswordRetry` / `convertPdfFileToDocxLocalWithPrompt` 并提供 Friday prompt callback，保持现有 `convertOffice(format)` 契约：仅 password-required 询问重试，unsupported/corrupt 直接分类反馈，可能再次要求密码。原 Shell 密码框还依赖专用 preload/HTML，不能直接裸搬。若改用 renderer 内存传递已验证密码，须绑定文件会话、处理另存/切换/取消并清引用；它减少询问但增加串用风险。W02 明确选型并覆盖同一用例，不同时维护两套状态。

结果按真实字段 `docx/pages/warnings/pageResults/scannedDocument` 判断。逐页 `status` 是 `ok`、`degraded`、`scanned`、`ocr`：OCR 是成功但需校对；degraded/scanned 是图像回退，应说明范围，不能叫作可编辑文字转换成功，也不虚构统计字段。

| 场景 | 中文反馈目标（具体用词可在实施时微调） | 英文对应目标 |
| --- | --- | --- |
| 正常取消 | 不显示失败；回到可操作状态 | Return to idle without an error |
| 密码错误 | “密码不正确，请重试。” | “Incorrect password. Try again.” |
| 不支持加密/损坏 | 说明文件无法解析及原因类别，不声称用户输错密码 | Unsupported encryption / damaged PDF |
| OCR 不可用 | “部分扫描页未完成文字识别”，列受影响页和下一步 | Some scanned pages could not be recognized |
| 资源缺失 | “转换组件不可用”，提示重新安装/报告问题 | Conversion component is unavailable |
| 写入失败/被占用 | 说明无法写入目标，可换位置；原目标保留 | Could not write the destination file |
| 任务失败 | 可重试的原因类别，界面不继续显示成功/忙碌 | Conversion failed; actionable reason |
| 已保存但打不开 | 显示实际保存位置，区分转换与打开状态 | Saved to …, but could not open |

所有用户文案走现有 i18n（至少中英），不直接展示堆栈，不记录密码。错误处理不应强迫上传文件或走云端转换。

## 6. 样本和证据约定

以下是待准备样本，不表示它们已全部存在或执行。每个样本记录来源、SHA256、页数/表数/对象数、预期正文和结构；复杂格式用人工核对项，不以二进制完全一致代替保真评估。

| 样本组 | 最小内容 |
| --- | --- |
| DOCX-A/B | 简单中英文本；多页页眉页脚+表格+图片+公式+分页/节 |
| XLSX-A/B/C | 多表/公式/中文；外链源工作簿；含 Queries & Connections 的代表样本 |
| PPTX-A/B | 两页、文本/图片/形状/备注；窄窗口长表格菜单 |
| PDF-T/S/M | 普通文本+图片；纯扫描；混合文本/OCR/坏页代表样本 |
| PDF-F | 可填写表单；填入明确标记值并保持编辑卡片未点 Done |
| PDF-P | 密码保护（含仅四个空格的有效密码）、错误密码、证书加密、损坏样本 |
| PATH | 中文+空格+长文件名，文件名大小写/路径等价情况 |
| DATA-OLD | 旧项目、多文件、多会话/标题/活跃会话、最近文件，全部使用副本 |
| LEGACY | doc/dot/hwp/hwpx 各至少一份能由参考应用核对内容的样本 |
| MD-A/B | 全部目标块/行内语法、源码/视图切换、长表、公式/图表等实际支持语法；中文/空格路径、BOM/EOL、`.md/.markdown`，另有 `.txt/.json` 受限源码模式对照 |
| MD-LINK | 多目录同名文件、Wiki alias/embed、标题/块 fragment、缺失 note、backlinks/tags/graph、项目图片与相对资源，另有同名 SQLite 笔记隔离样本 |
| MD-AI | 有/无选区、过期 apply_ops、长文 stream keep/discard、可编辑 Mermaid；正常搜索/图片服务及无服务/断网对照 |
| HTML-A/B | `.html/.htm`，中文源码、CSS/脚本/响应式布局、图片/字体、本地/相对/远程混合资源，含故意失败的资源 |
| HTML-AI | 完整源码/增量操作、clarification、页面计划、长文生成、搜索/图片/附件工具与取消/错误；正常 provider 与受限前提对照 |
| HTML-BOUNDARY | 合法交互页及尝试访问宿主/模型密钥/本地任意写、外链/弹窗/导航的隔离样本；只在专用副本环境运行 |
| NEW-EXPORT | 两模块全部目标 GUI 导出、打印分页、多页图片、同名目标/占用/取消、包内 headless 输入输出；包含必要字体和资源 |

可复用仓库 `fixtures/generated/kitchen-sink.docx` 和现有密码测试 fixture，但最终以实际存在路径和许可核实为准。验收记录包含候选根/vendor 提交、系统/运行时、命令/退出码/日志、产物路径及 SHA256、截图或结构检查；不将旧日志当新候选证据。

## 7. PDF 专项验收矩阵（全部待执行）

| 用例 | 输入与操作 | 预期 | 证据 |
| --- | --- | --- | --- |
| PDF-01 P0 | 无未保存修改的 PDF-T，在真实 Friday 菜单选 Word、选新目标 | 产生非空 DOCX，正文关键句正确，Friday Docs 可打开、编辑再保存重开；原 PDF 哈希不变 | IPC/保存记录、document.xml、实际打开截图、源哈希 |
| PDF-02 P0 | 含中文正文，源/目标位于中文空格目录 | 正文可读，无 WASM argv/路径加载错误 | CJK 目录日志、XML、截图 |
| PDF-03 P0 | 旋转/批注产生 dirty，另用 PDF-F 填表但不点 Done 后转换 | 先完成已确认的源保存；融合目标以 `flushAll=true` 写入未 Done 的字段，产物可核对最新值，失败不转旧内容 | dirty/flushAll 协议、已保存快照、产物对照 |
| PDF-04 P0 | 分别在源保存确认时取消，以及确认完成源保存后在输出保存框取消 | 两分支均不新增/替换输出、已有目标不变、状态释放；前者源及 dirty 不变，后者保留已保存状态且无额外源修改 | 前后目录、源保存前/后快照与哈希、dirty 状态 |
| PDF-05 P0 | 目标已有文件或正在 Friday 打开；拒绝替换/关闭 | 取消不覆盖；确认后完整替换；目标占用失败有提示 | 目标哈希、打开状态、失败路径 |
| PDF-06 P0 | 目标源路径/同源别名，或异常目标目录 | 禁止源覆盖，写失败不截断原目标 | 源/目标哈希、错误类别 |
| PDF-07 P0 | 正确密码、错误后重试、四空格密码、取消密码 | 正确可转，错误可重试，空格不 trim，取消无输出；不落密码 | 无敏感值的状态记录、产物内容 |
| PDF-08 P0 | 证书加密/损坏 PDF | 正确分类，明确失败，无假成功/半成品，下一次普通转换可用 | 错误码类别、目录检查、恢复操作 |
| PDF-09 P0 | PDF-S / PDF-M，有 OCR 与无 OCR 两种资源环境 | OCR 成功页有可编辑文本；失败/跳过页被说明，不能静默空白 | pageResults/scannedDocument、XML、逐页核对 |
| PDF-10 P0 | 对话框/flush/转换中重复点击、切换文件/转换格式、关闭或替换源/宿主 | 所有 PDF 格式共享全流程锁或队列，PDFium 不并发；固定源 entry/path 并在 await 后复核；不串文档、不重复写、不由失效 caller 写盘，释放 busy；不能因 destroyed flush 返回 true 而继续 | 任务/视图生命周期、跨格式并发记录、输出数量 |
| PDF-11 P0 | bundle/WASM/OCR 缺失，转换抛错，写入拒绝 | 有中英文提示，进度清理，既有目标保留；修复环境后可重试 | 故障注入、目标哈希、重试记录 |
| PDF-12 P0 | 候选包移到中文空格目录，断网，无 vendor 目录 | 普通 PDF 本地转换成功；OCR 按已打包能力运行，不偷偷依赖源码 | 包 SHA、资源定位、离线产物和打开 |

另须在长扫描件转换时测量窗口和事件循环响应：async 外壳不代表内部提取或 `spawnSync` OCR 不阻塞。若发现主进程持续冻结，需隔离转换执行再验收进度/取消，不以最终生成文件代替响应性通过。

转换保真不定义为“任意 PDF 100% 恢复 Word 原始结构”。样本要核对阅读顺序、关键文本、图片、页数与表格；复杂分栏/数学公式/扫描识别误差记录限制，不能只靠文件头判通过。

## 8. 升级整体验收矩阵（全部待执行）

| 编号 | 输入/操作 | 预期与判定 | 主要证据 |
| --- | --- | --- | --- |
| INT-01 P0 | 最终融合提交与根 gitlink | 包含目标标签及 Friday 定制历史，源码/资源版本对应 | 两层 Git、manifest |
| INT-02 P0 | 完整 Office + 主前端构建、Node 测试 | 无本次新增失败；原失败逐项说明；无旧产物冒充 | 命令、退出码、日志 |
| INT-03 P0 | 六编辑器逐个新建/打开、切换 Tab、改布局、恢复上次会话 | 宿主正常，视图不叠加、无缺 handler，MD/HTML 类型不误落 PDF | 真宿主截图/事件、类型注册对照 |
| INT-04 P0 | 六类样本编辑、保存/另存、关闭重开 | 正文/表/公式/备注/页/源码状态正确，dirty 清理合理；新模块资源和历史跟随明确 | 内容检查、重开截图、路径与资源 |
| INT-05 P0 | dirty 文件保存/不保存/取消关闭 | 三分支正确；取消不丢数据、不关闭错文件 | 生命周期日志 |
| INT-06 P0 | DOCX-B 页眉页脚、分节、图片表格 | Friday 定制保留，保存重开不新增明显布局错误 | 前后截图与结构检查 |
| INT-07 P0 | 只读/加密、跨文档撤销、菜单键盘 | 只读禁写、撤销不跨文件、Esc/Home/End 适用 | 真输入/菜单状态 |
| INT-08 P0 | XLSX-A 多表公式/CSV/XLSM 代表文件 | 数据/公式保存正确，现有兼容范围不退化；不承诺执行宏 | 工作簿解析/重开 |
| INT-09 P0 | PPTX 编辑/撤销/重做、讲义/备注导出 | dirty 与历史一致，备注/图片可读 | 对象/备注/XML/截图 |
| INT-10 P0 | PDF 全文选区、复制、搜索、OCR 旋转、长文滚动 | 未挂载页文本可用，选区无串页，虚拟渲染保留 | 原探针和实际复制 |
| INT-11 P0 | 六类至少两文件 AI，文件内多会话和标题，首存/另存/重命名、关闭重开 | 恢复正确会话，互不混用；MD/HTML 项目及 rebind 语义正确 | 脱敏 Store/目标项目数据对照 |
| INT-12 P0 | 六类 AI 流式、取消、超时/模型错误；MD/HTML 实际工具与交互回合 | 仍经 Friday 配置，取消释放，错误明确；正常条件搜索/图片等实际工作，不被空实现截断；无密钥泄露 | 桥接/事件/日志与工具产物检查 |
| INT-13 P0 | 含未保存编辑的普通导出，取消/失败、源覆盖；PDF 转换依 PDF-03/04 分支验证 | 用最新快照，源保护、目标保护；普通导出不清 dirty，PDF 转换以用户确认保存后的快照核对源保护 | 源/目标哈希、保存快照、内容 |
| INT-14 P0 | 六类 Windows 目标打印能力、取消，虚拟打印 PDF | 输出可见，目标参数/分页有效，fonts/images 就绪，焦点/退出正常，无残留 helper/临时窗口 | 实际 PDF、截图/进程/临时资产 |
| INT-15 P0 | 已入库 Office 修改保存 | 索引刷新，读取新内容，无循环或重复任务 | 保存/索引事件和检索 |
| INT-16 P0 | 旧数据副本升级、首次写入、旧版回退 | 文件/索引/多会话可读，迁移可恢复，新文件保留 | 迁移差异、恢复演练 |
| INT-17 P0 | 六编辑器各 20 次开关，含MD/HTML预览、导出、打印、AI取消 | WebContents 回到预期基线，无持续实例/任务/iframe/worker/临时文件残留 | lifecycle 记录、内存趋势、资源清理 |
| INT-18 P0 | 同机同文件交替至少 5 轮、长 PDF 滚动 | 拟定非回归阈值在测试前锁定，重大退化有定位；不复用旧80%结论 | 时延/内存/帧数据 |
| INT-19 P0 | 候选解包、移目录、离线启动六编辑器/CLI及双headless；联网配置另测AI外部能力 | WASM/OCR/sidecar/模块依赖/CLI/skills/notices 完整，本地能力无源码 fallback；不把联网AI误称离线能力 | 资源清单、SHA、UI与双headless命令产物 |
| INT-20 P0 | Windows 隔离安装/升级/回退/卸载重装 | 可启动、既有数据安全，回退成套有效 | 安装日志和数据对照 |
| INT-21 P1 条件 | LEGACY 四种导入 | 生成 DOCX 副本可读，原件不变；失败明确 | 转换内容、原件哈希 |
| INT-22 P1 条件 | 页边框/水印/绘制保存重开 | 新能力可见且格式往返可用 | OOXML/截图 |
| INT-23 P1 条件 | 外链实时值、Queries & Connections、CLI links | 接入命令实际执行，源不可用不损坏工作簿，有状态 | 源/目标值、命令日志 |
| INT-24 P0/P1 | 760–900px、中英、深浅色、长菜单 | 保留交互无越界/文字缺失，异步语言无旧包覆盖 | 真鼠标键盘、截图 |
| INT-25 P0 | MD-01～MD-12 与固定目标同条件逐项对照 | 全部子命令有映射/结果，无未实现工具；目标限制如实保留，功能不缩水 | 完整对照台账、最终候选产物 |
| INT-26 P0 | HTML 专项全部 ID 与固定目标同条件逐项对照 | 源码/预览/Agent/导出/自动化完整，不用 HtmlViewer 或 restricted fragment 路径代替 | 完整对照台账、最终候选产物 |
| INT-27 P0 | 原笔记导入、Markdown Office 直接编辑、HTML旧查看/AI编辑、system/internal旧偏好迁移 | 文件不自动导入笔记、不按同名覆盖；原system选择保持，偏好迁移可理解可恢复 | 路由/偏好前后记录、原件/笔记快照 |
| INT-28 P0 | 未知编辑器类型、六类会话恢复/深链接/Tab历史、源关闭后迟到事件 | 未知类型可见报错、不落默认PDF；不串类型/文档，不由失效caller写入 | 类型与生命周期事件、错误截图 |
| INT-29 P0 | HTML合法脚本交互及预览越权样本 | 目标交互正常；Node/Electron/preload/模型密钥/任意文件写不可达，导航与资源策略符合设计 | 隔离配置、实际行为与权限探针 |
| INT-30 P0 | 两模块GUI导出/打印与包内headless分别操作；缺worker/协议/资源故障注入 | 两链各自成功、有内容；缺失可见失败，无源码fallback，取消/异常完整清理 | 命令/退出码、产物、包资源清单 |
| INT-31 P0 | 六类型逐一从菜单及快捷键保存/另存/导出/打印/关闭；激活演示或独立窗口、对话框期间切Tab/关闭owner并注入迟到请求 | 命令与enabled状态按真实活动类型/文档/owner分发；不继续只支持四类，不误写新激活或后台文档；await后失效caller/owner停止，快捷键与菜单共用合同 | 六类型入口台账、目标/owner/caller日志、切换前后文件与dirty、实际产物 |

所有 P0 必须有最终候选证据。可复用旧探针，但旧基线测试结果不能替代新结果；测试宿主通过也不能替代安装包运行。

## 9. 非功能要求与兼容约束

- **本地转换：**PDF 正常解析/本地 OCR 不要求网络；AI 和用户主动外部数据更新按各自功能使用网络，不能把 Office 所有功能笼统宣称完全离线。
- **性能：**建议相对当前有效开发基线的关键中位数退化 >20% 阻断排查，在 W01 固定阈值和样本；不是本次已测结论。历史“首开达到基线80%”仍是独立未完成目标。
- **路径：**运行时从当前安装资源定位，支持中文/空格目录；输出权限和文件占用失败不能丢源/目标。
- **国际化：**新增用户可见提示至少中英，回退策略使用现有 i18n；不出现 key、原始堆栈。
- **可恢复：**保存/导出失败不破坏已有完整文件；新 Store 不兼容旧版时有写前副本和恢复步骤。
- **可追溯：**正式构建建议生成 manifest，包含 Friday/vendor SHA、上游 tag/commit、工具链、构建时间、native 架构、锁文件与资源哈希；源提交、依赖、生成物、包和验证一一对应。本次不实现 manifest，也不把 Electron 版本差等同兼容已证实或必然不兼容。
- **隐私与协议：**沿用 Friday 主进程模型配置和受限 preload，密码/API Key 不落日志；不引入第二套独立 Shell 状态。
- **功能对等：**MD / HTML 不能以共用组件编译通过、菜单可见、聊天有回复或无服务时错误提示作为完成；正常条件的编辑/工具/交互、所有目标导出和包内自动化均有实际结果。服务适配允许更换实现，不允许空返回截断。

## 10. 风险、依赖和技术决策

| 风险 | 产品影响 | 处理/决策点 |
| --- | --- | --- |
| 273 共同路径，静态预演 128 冲突路径 | 定制被覆盖、无文本冲突仍可能不兼容 | W03 对最终基线复核和分工后重估；逐功能审阅 |
| 上游 Store 缺 Friday 多会话字段 | 历史丢失/串台 | 语义合并，旧数据副本迁移+回退为 P0 |
| 目标无 Friday 专用 IPC/配置 | 菜单存在但点击无效 | renderer/preload/main 三层对照，含 PDF conversion |
| 打印双实现 | 参数/焦点/退出回归 | 先保留 Friday 已有链，对比上游新链后整合；不是“上游删除Friday helper” |
| Electron 42/43 依赖差 | 运行 API/原生兼容 | 先在42实测；需升级则另评全部主应用 |
| 资源 fallback | 开发通过、安装失败 | 无源码依赖、移目录/离线/包内运行 P0 |
| 扫描/复杂 PDF | 空白或不可编辑 DOCX | 逐页状态与样本内容验收，明确降级 |
| 新格式入口依赖 Shell | 发布说明与实际可用不符 | P1 条件能力，没有接通不承诺 |
| Markdown/HTML 多处类型仅四类 | 首页可点击但路由、会话或宿主误走PDF | 全链六类型注册、未知类型报错及恢复回归为P0 |
| Markdown 打开沿用自动笔记导入 | 同名笔记被更新，原文件未直接编辑 | Office显式文件编辑与导入笔记分离，偏好迁移/同名隔离验收 |
| 新模块AI工具被Friday空实现截断 | 看似可聊但不能搜索/用图/完成目标任务 | 正常配置各工具实测；等效服务适配纳入P0，不当降级完成 |
| HTML脚本预览权限未隔离 | 文档取得主应用/密钥或文件权限 | 保留目标交互并验证sandbox/协议/导航/资源边界，不裸载入宿主页 |
| 两模块headless/导出漏接 | UI可用但CLI或安装版失败 | 双runtime/worker/导出链和GUI分别从候选包验证 |
| 既有性能/打印/安装未完成项 | 老问题被掩盖 | 沿用旧验收状态并补测，不改写历史结论 |

## 11. 当前交付与未来完成定义

本次交付为三份可审阅文档：版本差异与证据、实施方案/WBS、产品需求与验收矩阵。静态研究不需要运行构建或用测试结果伪装实现；当前代码修复、实际合并、候选包均未完成。

未来实施完成必须同时具备：目标融合提交、根 gitlink、六模块完整生成物/许可证、全部 P0 逐项证据、MD / HTML 目标全功能台账及同条件对照、双 headless 与服务前提、其他 P1 兑现或延期清单、数据回退记录、Windows 候选包与 SHA256、未覆盖平台/样本。任何 MD / HTML 对等缺项均阻断，不得列入普通延期清单后宣称六模块完成。源码通过、开发运行通过、安装版通过分开记录。未完成安装验证只能称开发候选，不能称正式交付。

可参考旧 [首开验收](./Office-startup-acceptance-2026-10-24.md) 和 [菜单/导出/选区验收](./Office-menu-export-selection-acceptance-2026-10-24.md) 复用样本和探针；其中未通过的首开80%、部分系统打印、最终安装版覆盖，不能被本次文档标成已完成。
