# GenOffice v0.12.600 升级分析报告

日期：2026-11-04；AI Markdown / AI HTML 全功能对等范围补充：2026-11-05

研究对象：Happy Friday Lite Office 源码、Friday 宿主及构建链

状态：升级前静态研究与合并预演；本轮仅形成文档，未实施升级或 PDF 修复

配套文件：[融合升级方案](./GenOffice-v0.12.600-融合升级方案.md)、[融合升级 PRD](./GenOffice-v0.12.600-融合升级PRD.md)

## 1. 决策摘要

Friday 当前固定的 Office 源码是 `8ed0c8d099c3c3d87b1a998d9189da3d120ff820`，`git describe` 为 `v0.10.639-27-g8ed0c8d0`。更准确的说法是：Friday 从 `v0.10.639` 之后的上游提交 `316ded6f0a39235fec8d21c068d8a0766ee6172b` 分出，在其上叠加 14 个定制提交；不能把描述中的 27 全部称为 Friday 补丁。

GenOffice `v0.12.600` 可以作为下一版融合目标，但当前不存在已验证的直接兼容结论。上游相对共同祖先前进 920 个提交、改动 4,617 个唯一路径；Friday 定制改动 349 个路径，双方共同修改 273 个路径。2026-11-04 使用 Git 三方合并引擎静态预演得到 **128 个冲突路径：127 个 content、1 个 add/add**。此外还有不产生文本冲突的宿主接口、数据语义、资源位置和运行时差异。

建议保留 Friday 当前分支与定制历史，三方合入固定标签，再按模块适配宿主、构建及数据行为。直接把 gitlink 改为上游标签会丢失 Friday 的多会话 AI 历史、文件桥、品牌、打印及部分性能和交互定制，不适合作为实施方式。合并完成也不能代替构建、安装包和用户数据回归。

PDF 转 Word 的高可信静态主因已定位：PDF 界面调用的 `pdf:convert-office` 由官方完整 Shell 注册，而 Friday 使用独立 Office 宿主，没有接入该转换处理器和转换 bundle；界面又吞掉异常。上游已有可复用的本地 PDF→DOCX 管线，拟由 Friday 适配后独立打包。**本轮尚未修复，未完成真实转换复现、DOCX 生成或安装版验收。**

用户已明确下一版必须增加 **AI Markdown、AI HTML**，且功能与固定开源目标 `v0.12.600` 对等。因此目标范围由当前四类扩为 Docs、Sheets、Slides、PDF、Markdown、HTML 六类；两新模块全部功能是本版 P0 交付合同，不接受仅接入文本编辑与聊天的缩减方案。两者目前虽然存在于 vendor，但 Friday 尚未接通产品入口、六类构建、宿主与完整工具链。本报告第 8.6～8.9 节给出可追踪的完整功能分组和接入缺口，配套 PRD 使用同一组 `MD-01～MD-12` / `HTML-01～HTML-12` 编号。

## 2. 研究口径与证据边界

本报告把证据分成四类：

| 证据类别 | 本轮得到的内容 | 可以证明 / 不能证明 |
| --- | --- | --- |
| 源码与 Git 历史 | 根仓库 gitlink、vendor HEAD、共同祖先、目标标签、三方差异 | 能精确证明当前 checkout 固定的源码基线；不能独自证明用户正在运行的已安装程序版本 |
| 静态调用链 | Friday build/host/preload、上游 Shell/converter、ProjectStore | 能定位遗漏和设计差异；不能替代窗口、文件和打印的真实运行 |
| 官方发行资料 | 官方 `releases.atom` 及标签源码 | 能说明官方声明和目标实现；上游质量陈述不能当作 Friday 验收结果 |
| 历史验收材料 | 2026-10-24 首开、菜单/导出/选择验收记录 | 能提供既有案例和未完成项；不能当作本次升级已通过 |

`resources/office` 当前有 554 个受 Git 跟踪的路径，但未发现可关联全部 bundle 的 build/version manifest（已有 NOTICE 等文件）。因此不能由 vendor 的 `git describe` 直接推出这些生成物逐一与该 SHA 同步，更不能推出安装包与源码完全一致。下一版应生成包含 Friday SHA、vendor SHA、目标标签、工具链版本和资源摘要的构建清单；本轮不改代码。

本次合并预演只向 Git 对象库写入结果对象，并保存临时日志；没有执行 `git merge`、改写 index 或修改工作树。统计包含测试、fixture、文档、国际化资源，均为端点差异的唯一路径数，不是业务源码数量、改动行数或工作量估算。

## 3. 精确版本与时间

| 项目 | 核实结果 |
| --- | --- |
| Friday checkout 分支 / 提交 | `codex/friday-3.0.7-preview.28` / `dd4afd4` |
| Friday README / 构建 releaseVersion | `3.0.7.01-preview.33`；目录名 `Friday-3.0.6-preview.1-source` 和分支名不作为发布版本依据 |
| 根仓库 Office gitlink | `160000 commit 8ed0c8d099c3c3d87b1a998d9189da3d120ff820 vendor/happyoffice` |
| 子模块声明来源 | `.gitmodules` 指向 `yingchao4399/happyoffice.git`，`branch=main`、`update=none`；不是直接跟踪官方 genspark 仓库 |
| 当前 vendor describe | `v0.10.639-27-g8ed0c8d0` |
| 与目标的共同祖先 | `316ded6f0a39235fec8d21c068d8a0766ee6172b`，describe 为 `v0.10.639-13-g316ded6f` |
| 共同祖先提交时间 | `2026-09-18 12:44:23 +0530` |
| Friday 相对共同祖先 | 14 个提交；27 的历史距离由共同上游 13 个加 Friday 定制 14 个构成 |
| 目标标签 / SHA | `v0.12.600` / `1a0fcec971c714d11777cbd5c68da1c933572d14` |
| 目标提交时间 / 标题 | `2026-11-03T00:19:48+08:00` / `Sync snapshot (2026-11-02) (#2437)` |
| 官方发行 feed | 2026-11-04 检查时第一条为 `GenOffice v0.12.600`；updated=`2026-11-02T16:20:13Z`，即北京时间 11 月 3 日 00:20:13 |
| 许可 | 当前及目标为 Apache-2.0；目标 NOTICE 及第三方声明仍需随产品保留 |

提交时间、发行 feed 更新时间和本次研究日期是三种不同时间，不能混为“发布日期”。本轮 GitHub REST 请求遇到限流，采用官方 Atom feed 核实发行正文及时间；没有把未经核实的网页 Latest 标记作为证据。本研究固定用户指定的 `v0.12.600`，不跟随可移动的 main，也不由 feed 排序断言其在任意后续时点仍是全局最新版本。

官方来源：[仓库](https://github.com/genspark-ai/genoffice)、[目标发行](https://github.com/genspark-ai/genoffice/releases/tag/v0.12.600)、[发行 feed](https://github.com/genspark-ai/genoffice/releases.atom)、[固定目标源码](https://github.com/genspark-ai/genoffice/tree/1a0fcec971c714d11777cbd5c68da1c933572d14)。

## 4. 变更规模与实际冲突

以下三列均以共同祖先为基线；“交集”指双方改动同一路径，不能直接称为冲突。

| 模块 | Friday 改动路径 | 上游改动路径 | 交集路径 |
| --- | ---: | ---: | ---: |
| 全仓库 | 349 | 4,617 | 273 |
| `apps/docs` | 110 | 976 | 89 |
| `packages/docx-engine` | 7 | 599 | 7 |
| `apps/sheets` | 68 | 477 | 56 |
| `packages/xlsx-gateway` | 0 | 97 | 0 |
| `apps/slides` | 91 | 341 | 83 |
| `packages/pptx-engine` | 0 | 104 | 0 |
| `apps/pdf` | 33 | 147 | 16 |
| `apps/shell` | 1 | 624 | 1 |
| `packages/electron-utils` | 13 | 48 | 4 |
| `packages/project-store` | 5 | 16 | 5 |
| `packages/agent-core` | 2 | 31 | 2 |
| `packages/ai-provider` | 1 | 65 | 1 |
| `packages/ui` | 9 | 67 | 2 |
| `packages/cli` | 0 | 125 | 0 |
| `packages/file-parse` | 0 | 20 | 0 |

实际预演命令为 `git -C vendor/happyoffice merge-tree --write-tree --messages --name-only HEAD v0.12.600`，Git 版本 `2.55.0.windows.3`，退出码 1，预演结果树为 `54d63eed43ab42007c607aa917e9c342c6c1bcf2`。退出码 1 在本次表示存在冲突，不是工作区已经进入合并状态。

| 冲突模块 | 路径数 | 主要区域 |
| --- | ---: | --- |
| Docs | 39 | 主进程、preload、App、AI、页眉页脚、Ribbon、分页、打印、多语言、IPC |
| Sheets | 33 | 主进程、preload、App/ExcelShell、打印、保存、AI、多语言、IPC |
| Slides | 32 | 主进程、App、AI、Ribbon、打印、菜单、键盘、多语言 |
| PDF | 10 | 主进程、App、AI、OCR 层、批注、样式、IPC、OCR 测试 |
| DOCX engine | 4 | parse-props、parse、patch、Vitest 配置 |
| electron-utils | 2 | package exports / 依赖、renderer scheme 测试 |
| 其他各 1 | 8 | HTML AI、Markdown AI、Shell builder、agent-core、ai-provider、html2docx、project-store、lockfile |
| 合计 | 128 | 127 个 content；唯一 add/add 为 Sheets `PrintDialog.tsx` |

完整路径列于附录。该数值只描述当前两端提交、当前 Git 合并策略下的文本/结构冲突：零冲突文件仍可能有行为冲突；解决 128 个标记也不代表升级完成。特别是 ProjectStore 数据语义、Friday 宿主缺失的 Shell 能力和 Electron/资源路径，需要独立核对。

复核规模的命令（PowerShell，在主仓库目录运行）：

```powershell
$base = '316ded6f0a39235fec8d21c068d8a0766ee6172b'
$fr = @(git -C vendor/happyoffice diff --name-only $base HEAD)
$up = @(git -C vendor/happyoffice diff --name-only $base v0.12.600)
git -C vendor/happyoffice rev-list --count "$base..HEAD"
git -C vendor/happyoffice rev-list --count "$base..v0.12.600"
$fr.Count
$up.Count
@($fr | Where-Object { $up -contains $_ }).Count
```

## 5. Friday 的实际集成架构

Friday 没有运行官方完整 GenOffice Shell。它通过 `src-electron/office/office-host.js` 创建和登记编辑器视图，并由 `office-ai-bridge.js` 接入 Friday AI。`scripts/build-office.mjs` 从 vendor 构建四类编辑器 renderer/preload，再将 `scripts/office/entries/*.ts` 引入的主进程能力打成 CJS；Electron 作为 external，由 Friday 根应用提供。

根 `package.json` 将 `resources/office` 复制为安装资源 `office`，同时将 `resources/office/wasm` 复制到资源根的 `wasm`。这意味着“上游 Shell 支持某能力”与“Friday 已接入该能力”之间，还有入口、IPC、转换器 bundle、资源复制、宿主回调五个环节。PDF 转 Word 正是这一边界遗漏的实例。

| 集成点 | 当前事实 / 目标差异 | 融合要求 |
| --- | --- | --- |
| Docs runtime | 目标配置仅有 preloadPath/rendererUrl/rendererFile；Friday 的 openGeneratedPath 是定制 | 保留或显式适配生成文档打开回调；JS 接受额外字段不等于目标代码使用该字段 |
| Docs main exports | 目标仍导出 configureDocsRuntime/createDocsView/registerDocsIpc/registerAiIpc/registerProjectIpc 及保存关闭 hooks | 核对导出合同、注册顺序和窗口生命周期后复用 |
| Sheets runtime | 目标保留 sidecarPath/openGeneratedPath，新增 createDocument 宿主回调 | Friday 应提供相应回调，并验证 sidecar 和新建文档路径 |
| Slides runtime | 位于 `apps/slides/src/main/session-state.ts`；字段为 rendererDevUrl/rendererFilePath，保留 openGeneratedPath | 不可复制 Docs 的字段名假设；逐模块建适配清单 |
| PDF runtime | 目标含 openGeneratedPath/createDocument，但无 Friday 新增 registerPdfProjectIpc | 不能用 optional chaining 静默跳过项目历史注册；应明确保留或迁移其行为 |
| 文件桥 | office-file-bridge、四类 preload 的 installOfficeFileBridge、window.fridayOffice、文件菜单是 Friday 定制 | 保留受限 IPC 和来源校验，不扩大为任意文件/任意主进程调用 |
| AI IPC | Friday 在编辑器懒加载注册后再次覆盖 ai:* | 验证注册时序、stream/cancel、数据结构和销毁；仅编译成功不足以证明采用 Friday provider |
| 入口支持格式 | Friday 当前扩展名映射/打开框以 docx/xlsx/xlsm/csv/pptx/pdf 为主；Markdown 内置打开仍走旧笔记导入，HTML 有旧 HtmlViewer | 上游新增旧格式以及本版新增 Markdown/HTML 均需补 Friday 路由、打开框、新建卡片和生命周期；不能把旧笔记/查看器当作新完整编辑器 |

独立 Shell 的更新器、窗口管理、Markdown/HTML 产品入口、Linux 模板等能力不会因 vendor 升级自动进入 Friday。Markdown/HTML 必须按本版六模块目标补齐，独立 Shell 的其他产品功能则仍按明确范围评估。上游 `main-proxy.ts` 处理 HTTP 代理，也不能作为 Friday `office-file-bridge.ts` 的替代品。

## 6. 必须保留的 14 个 Friday 定制提交

保留目标是用户可见行为与数据合同，不是机械保留每一行旧代码。对已被上游等价解决的部分可以采用目标实现，但需有对应验收证据。

| 提交 | 内容 | 主要保留/复核点 |
| --- | --- | --- |
| `8ed0c8d0` | stabilize office ai history and ipc loading | 懒加载后的 Friday AI 桥、历史恢复和注册时序 |
| `3b79ee4e` | complete scoped AI history across Office editors | 四编辑器按文件隔离、会话列表与切换 |
| `38d51481` | scoped AI history and title continuity | 文件与聊天标题连续性、未保存文档身份 |
| `c7d4d904` | docs header footer editing on every page | 多页中的页眉页脚编辑命中、状态和渲染 |
| `24eeda50` | 页眉页脚双击编辑和上下文选项卡 | 双击区域与上下文 Ribbon 的交互 |
| `2302b2e1` | 页眉页脚 Ribbon 多语言键 | 与上游语言资源逐键融合，避免缺键和退回错误文案 |
| `e081010b` | Word 页眉页脚上下文 Ribbon | 上下文命令与当前编辑区一致 |
| `9d93f467` | Office 首开与 PDF 长文档性能 | 首开调度、全文选择、虚拟化、长文档回归 |
| `be23df51` | Office 统一交互与打印预览 | 文件菜单、选区、打印、取消和窗口焦点 |
| `d9b77caf` | Slides harfbuzzjs 通过 Node 解析 | 不重新引入硬编码 node_modules 路径 |
| `8d8157a1` | 流式内容测量性能 | 分页/流式生成场景的测量频率与最终版式 |
| `55fa3bed` | 收起 AI rail 与 Friday 图标 | Friday 编辑器的侧栏、收起状态和图标行为 |
| `a223a658` | Genspark 品牌替换为 Friday | UI 品牌和产品入口；法律声明单独保留 |
| `66496ab8` | lockfile 增加 Vitest | 依据合并后的 workspace 重新核验依赖，不照搬旧 lockfile |

HTML、Markdown 的 AI Panel 也出现在真实冲突中，即便当前 Friday 主要暴露四类编辑器，也不能在全量 vendor 合并时忽视这些路径。

## 7. v0.12.600 的可获得能力及 Friday 适用条件

本表中的“官方声明”来自该版本发行正文；“源码变化”包含从共同祖先跨越多个版本的累计变化，不应全部归为 0.12.600 单次新增。

| 模块 | 官方声明 / 目标实现 | 对 Friday 的价值与适用条件 |
| --- | --- | --- |
| Docs 旧格式 | `.doc/.dot` 转成 DOCX 副本；`.hwp/.hwpx` 转成 DOCX，声明覆盖正文、样式、表格、列表、图片、文本框、脚注、批注、页眉页脚及多节等 | 扩展导入能力，但必须补 Friday 入口、转换资源、失败提示，验证原件保持和新副本路径 |
| Docs 编辑 | Page Border、Insert Watermark、Draw 笔库 | 与 Friday 页眉页脚/Ribbon 定制合并，验证可见、编辑、保存、重开、导出一致 |
| Docs 保真 | CJK 字体 family；DOCX→PDF SECTIONPAGES、TOC leaders、Type3 CJK；页眉图片移动缩放；批注图片、自定义属性、content control、metadata scrub；默认目录不可用时另存修复 | 引擎和分页累计变化较大，应以中文、多节、页眉图片和复杂表格样本做视觉/内容对比 |
| Sheets | 外部工作簿实时值；CLI/MCP sheet links；Queries & Connections；宽 Ribbon 横滚；部分字符字体；显示公式状态 | 依赖主进程、sidecar、preload 和 UI 整体接通；“列举查询/连接”不代表实现完整 Power Query 或任意数据库执行 |
| Slides | 小屏上下文菜单、flyout 就地滚动；setText 保持段落 | 与 Friday 菜单、键盘、打印和 AI 定制同区冲突，需验证小窗口、缩放和文字格式 |
| PDF | 扫描 PDF OCR 后不空白；单个坏页不使整篇空白；重开保留 bytes | 应改善 OCR/重开稳定性，但不能推出 Friday 转 Word 已自动修好 |
| Markdown / HTML | Markdown 打印表格按行分、思维导图方向；目标源码包含两完整编辑器及 Agent、媒体、导出和 headless 能力 | 下一版明确必交付，当前尚未接入；按第 8.6～8.9 节与 PRD 全量对等清单验收，不能只挑本次发行正文提到的功能 |
| App / Shell | 静默下载、退出安装、导入偏好、macOS CUPS、KDE 模板 | 需区分 Friday 自有更新和宿主；不能整体照搬上游 Shell 以解决单一编辑器问题 |
| file-parse / MCP | XLSX text/date/shared formulas、DOCX numbering；fill_template/read_docx_properties | 属于候选可复用能力；只有 Friday Agent 已暴露并验证的工具才能进入用户能力清单 |

上游“100 文档对比更接近 Word”等表述属于其发行说明中的质量陈述，本项目没有重跑该样本集，不能作为 Friday 的量化验收结论。Docs 的 Draw 指 Word 绘制页签，不等于 Friday 独立绘图模块的实现或迁移。

目标新增/变化的 workspace 包包括 `doc2docx`、`hwp2docx`、`odf2ooxml`、`zip-gate`。`hwp2docx` 使用 `@rhwp/core@0.8.7`，其文档描述 HWP→rhwp→HWPX→DOCX 的转换链；Friday 的 CJS bundling、资源定位及潜在 top-level await 兼容仍待构建验证。`zip-gate` 针对解压膨胀等边界的约束，不应为使旧样本通过而随意绕过。

## 8. 逐模块融合影响

### 8.1 Docs 与 DOCX 引擎

Docs 有 39 个预演冲突，DOCX 引擎 4 个。上游不仅新增 Ribbon 项目，还修改解析、补丁写回、分页、页眉页脚和字体；Friday 的多页页眉页脚和流式测量也落在这些区域。应把“解析后的模型→编辑→分页→保存→重新打开→PDF/打印”作为同一条验收链，不能只验按钮能点。

代表性目标实现可查 `PageBorderDialog.tsx`、`InkOverlay.tsx`、`MultipageGrid.tsx`、`HeaderFooterArea.tsx`。`docs-main.ts` 导入 `convertLegacyDocToDocx`、`convertHwpToDocx`、`convertOdtToDocx` 并写出 DOCX 副本。Friday 宿主必须继续处理生成路径，避免转换已成功而新文档无法打开。

页眉页脚应覆盖首页不同、奇偶页不同、多节、跨页点击/双击、图片拖动缩放和上下文命令。文件菜单、语言资源与打印层也在冲突中，需要与文档引擎一起验收。

### 8.2 Sheets 与 XLSX gateway

Sheets 有 33 个预演冲突，唯一 add/add 是 `apps/sheets/src/renderer/PrintDialog.tsx`：双方分别新增了同一路径，必须比较其交互、props、打印设置和宿主调用合同后整合。单纯保留某一文件会遗漏另一方功能。

目标 `sheets-main.ts`、preload、App、ExcelShell 中有 `readWorkbookQueries` 相关链路，sidecar client 含 `updateExternalLinks`/`readExternalLinks`。这说明相关能力跨越主进程、preload、renderer、sidecar；只引入 UI 或只升级 gateway 均不足以完成集成。外部工作簿路径变更、缺失和取消访问也应有清晰结果。

### 8.3 Slides 与 PPTX 引擎

Slides 有 32 个预演冲突，涉及主进程、AI、Ribbon、菜单、打印、键盘和 20 种语言资源。PPTX 引擎虽无 Friday 改动交集，上游仍改动 104 个路径，输出、字体和打包仍需回归。保留 Friday 对 harfbuzzjs 的 Node 解析方式，并分别检查 dev 与安装包的字体/wasm 位置。

### 8.4 PDF

PDF 有 10 个预演冲突，重点是 `pdf-main.ts`、`generated-output.ts`、`App.tsx`、OCR 层、批注和共享 IPC。上游 OCR、加解密、签名、读写等累计变化需与 Friday 长文档虚拟化、全文选择及 OCR 几何修正共同融合；不能以单个 OCR 修复覆盖整个 renderer。

PDF→Office 转换另有 Shell 接入缺口，详见第 11 节。PDF 编辑器正常 OCR 与 Shell 转换器的扫描页 OCR 是不同资源查找链，必须分别验证。

### 8.5 AI 与项目数据：最高优先级语义冲突

目标 `packages/project-store/src/store.ts/types.ts` 没有 Friday 新增的 `chatIdsByPath`、`activeChatIdByPath`、`chatMetaById`，也没有 `listChatsForFile`、`createChatForFile`、`selectChatForFile`、`updateChatForFile`、`resolveChatForUnsaved` 及对应多会话 rename/另存/move 行为。整文件接受上游会丢失 Friday 的多会话合同，即使 JSON 能加载也可能导致旧会话不可见。

目标同时引入 `canonicalPathKey`（realpath/NFC、路径别名）、合法 ID 检查、读取/消息字段/pending 上限、聊天尾部读取、seq 合并和删除项目移回 default 等改进。正确融合应让规范化和安全约束覆盖 Friday 的所有映射，同时让项目移动/删除移动全部 session，而非只处理默认聊天。

相关数据位于 userData 下的 `projects/index.json`、各 `project.json` 和 chats JSONL。应使用数据副本验证旧数据加载、同文件多会话、路径别名、未保存→保存、另存为、rename/move/delete 和重启恢复。回滚需包含迁移前数据快照；只回退 exe 或 vendor SHA 不足以还原已写入的数据。

### 8.6 两新增模块的对等范围与判定方法

对等参照是固定 SHA `1a0fcec971c714d11777cbd5c68da1c933572d14` 中的开源 Markdown、HTML 应用，包含编辑器、Agent 工具、文件与资产、快捷键、导出/打印，以及其相关的 headless 工作流；不是 Genspark 商业网站未开源的能力。Friday 可使用自己的首页、Tab、品牌、统一模型设置与项目会话 UI，但每项操作的功能、结果格式和可观察阶段必须等效。原模块有菜单而 Friday 隐藏/禁用、返回空数组或只有聊天回复，都不能作为对等。

下列 `MD-*` / `HTML-*` 为稳定的验收分组，细目已经按目标源码展开，而不是把完整性全部推迟到实施阶段。G0 仍需把分组继续展开成逐项菜单、toolbar、上下文动作、IPC、Agent tool、shortcut、export 清单，保存固定参考行为、Friday 实现、依赖条件、候选包证据与责任人；要求 100% 映射，无遗漏项。静态存在不等于运行通过；未知项必须调查或保留阻断，不能从清单移除。配置相关能力应在同平台、有效服务/模型配置下对照；AI 文本不要求逐字相同，但工具必须实际执行、输出结构和资产有效，stream/stop/error/恢复阶段等效。

### 8.7 AI Markdown：完整功能、宿主工作与验收

目标 `apps/markdown` 是具有 main、preload、React renderer、TipTap 块模型、CodeMirror 源码分支和 AgentLoop 的完整应用，并非给旧笔记加一个 Markdown 预览器。`package.json` 还依赖 KaTeX、Mermaid、WaveDrom、pdfjs-dist、docx-engine、ai-search、project-store 等；必须让构建和资源同时覆盖，不能只把 `App.tsx` 嵌入 Friday。

下表证据路径均相对于目标 `apps/markdown/src/`；主进程简称 `main/markdown-main.ts`，UI 简称 `renderer/App.tsx`。这些是静态定位，不是本轮通过记录。

| ID | v0.12.600 已有功能与证据 | Friday 必须接入的工作 | 专项验收内容（全部 P0、待执行） |
| --- | --- | --- | --- |
| MD-01 文件与身份 | 新建、打开、保存/另存、dirty、标题/路径同步、关闭保存/丢弃/取消、内容推导默认名与 AI 命名；主进程 `setMarkdownFileSavedHook:448`、`markdownIsDirty:478`、`requestMarkdownClose:505`、`requestMarkdownSave:562`；源码模式见 UI `textMode/isSourceMode` | 新增 Office 卡片与 `.md/.markdown` 文件直编；保存回调更新 Friday 标题、最近文件、项目及会话身份；完整 close/save handshake。目标 `.txt/.json` 为独立源码编辑，不可冒充 Markdown 块文档 | 中文/空格路径，首存/另存取消、写失败、保存中继续编辑、dirty 关闭三分支；同名不同目录保持不同文件身份，不自动导入/覆盖旧笔记 |
| MD-02 视图与编辑 | TipTap 块编辑和 Markdown `SourcePane` 双向同步，切换保留 live 文档；undo/redo、查找/替换、拼写检查、Markdown theme、缩放、字/词统计、Ribbon 折叠；UI、`components/Ribbon.tsx`、`components/SourcePane.tsx` | 保留完整 Ribbon/选择状态/上下文编辑，不以普通 textarea 替代块模型；同步主题、语言、拼写和面板配置；区分 `.md` 源码视图与 `.txt/.json` 的 `PlainTextEditor` | 两视图反复编辑/切换后正文、结构、dirty 一致，撤销重做作用于正确表面；find/replace、主题/缩放/统计等逐命令可用 |
| MD-03 语法与结构 | 标题 1–6、正文、quote/code、bold/italic/strike/highlight/inline code/link、bullet/ordered/task lists、表格及 TableMenu、slash、hr、YAML frontmatter、footnotes、KaTeX、Mermaid/WaveDrom、块拖动/键盘及 block ID/link；`renderer/editor/extensions.ts`、Ribbon、`markdown/docText.ts` | 保留解析/序列化/源码拼接及专用渲染资源；不把颜色/字体字号/下划线/对齐等非目标 GFM 能力臆加为 Markdown 功能，也不以 raw HTML 伪造 | 每种结构创建、编辑、复制、保存、重开、导出；数学/图形/表格/脚注复杂样本与参考结果对照；未编辑源码保留与 AI 写入规则分别验证 |
| MD-04 导航与 Wiki | 大纲、Wiki link/alias/embed、标题/块 fragment、补全、缺失目标创建、backlinks、tags、graph；`editor/wiki*`、`main/wiki-*`、`components/GraphView.tsx`、preload `openSourcePath` | 把 `home:open-path` 映射为 Friday 文件直编/激活已有 Tab；保留 fragment remember/take、vault 索引和创建不覆盖合同；不经按标题查旧笔记的路径 | 多文档导航、嵌入、回链、标签、图谱；同名异目录、缺失目标、标题/块跳转、未保存目标、vault 内相对路径均准确 |
| MD-05 本地图片与资源 | 本地选图/粘贴、save/read/view/saveAs 图片、图片查看器、SaveAs 资产复制/引用重写、关闭未提交资源清理；图床 `s3/smms/github`，失败回退 local assets；主进程 `registerImageProtocol:762`、`main/image-host.ts`、`main/asset-lifecycle.ts`、shared IPC | 注册 `md-asset` 协议并保留已授权文档目录/配置 vault 的 realpath 范围和防 symlink 逃逸；接好图床配置存储及上传；打包公式/图形/图片导出资源 | 首存、另存到其他目录、重开、移动关联资源及取消/失败/关闭清理；无图床/错误配置保留本地图片；范围外请求被拒，合法图片仍可编辑/导出 |
| MD-06 AI 编辑 | `get_document_context/read_blocks/apply_ops/read_frontmatter`、选择范围、选区问答与编辑队列、stale model guard、AI 高亮和变更撤销、脱敏投影；`renderer/ai/tools.ts`、`markdown-skill.ts`、`edit-queue.ts` | 保留完整 Agent 工具 schema/执行/快照合同及选区冻结；适配 Friday 模型 transport 和取消；脱敏保持目标保护语义 | 有/无选区、多片段排队、批量 ops/失败、手改后旧索引拒绝、撤销恢复、stop 后不晚写入、不串文档；脱敏原值仍在本地文件且不进入对应 AI 投影 |
| MD-07 长文与思维导图 | `write_document` 独立流式 writer，取消后 partial keep/discard；思维导图卡片、方向选择、插入为可编辑 Mermaid，`mdnav://block/N` 文档引用；`ai/doc-writer.ts`、`MindMapCard.tsx`、`AiPanel.tsx` | 同时接通普通 Agent 和 writer 的模型/stream/cancel；保留卡片动作、部分草稿决策、插入和文档定位，不能只渲染回复文本 | 长文逐步进入文档，停止后 keep/discard 分别核对内容/dirty；思维导图改方向、插入后编辑保存重开；新聊天/关闭时 writer 不复活旧草稿 |
| MD-08 搜索与生成图片 | `web_search`、`image_search`、下载后 `insert_image`、`generate_image`；`ai/search-skill.ts`、`tools.ts`，主进程 `aiGenerateImage:1051` 调 `generateImageTool`；生成能力按 `imageGenerationAvailable(settings)` 控制，插图需先保存文档 | 实现真实搜索/下载/生成路由，适配目标结果结构；统一 Friday provider 与模块读取的图片生成配置，不能只接 `ai:stream` | 有效配置下真正搜索、下载/生成并写入文档；未保存引导首存，取消/网络失败不留半成品；`method:error` 不伪装为零结果；无图像 provider 按目标规则显隐/反馈 |
| MD-09 Agent 面板与历史 | 模型选择/设置、skills list/text/管理与单消息附加、usage、消息队列、retry/stop、历史持久化及首次保存 rebind；`ai/AiPanel.tsx` 的 AgentLoop 和 `projectApi.resolveChat/appendChat/loadChat/rebindChat`；preload 明确 `project:*` 由 Shell/Docs 集中注册 | 补公共 handler、设置页和项目桥，保留 Friday 同文件多会话/标题连续性扩展；懒加载注册顺序正确；无额外孤立的 provider/历史存储 | 两文档与未保存文档间隔离，首存/rebind、另存、重命名、项目重开、重启恢复；skills/模型/usage/队列/错误与取消实际可用；旧四类 AI 数据不回归 |
| MD-10 导出与自动化 | GUI `pdf/docx/docs/png`，其中 `docs` 是 DOCX 临时缓存并打开 Docs；PNG 经 `prepareImageExport/writeExportImage/finishImageExport` 多页流程；主进程 `1177/1222/1260/1291/1302`，`exportMarkdownPdfHeadless:1399` | 保留 DOCX 打开 hook、转换缓存/TTL 清理、PDF 回调、多页图片会话和错误/取消；接 Friday headless argv 与 renderer，准确区分 CLI Node 转换与 app renderer | GUI 四种动作实际输出并打开；表格/图片/数学/图形与多页对照；取消/失败清理。headless 仅 `.md/.markdown→PDF`，CLI wrapper 的 MD→DOCX/HTML/PDF 路线另逐项验证 |
| MD-11 打印 | 菜单 `sendMarkdownPrintRequest:474`，UI `printDoc` 构造 print HTML/iframe、图片 decode、等待 afterprint 后清理；`.txt/.json` 按 plain text `<pre>` 打印；`renderer/export/printHtml.ts` | Friday 菜单与 Ctrl/Cmd+P 都指向目标工作流；与系统打印/焦点/退出保持一致，不把 PDF 导出当成系统打印验收 | 长表按行分页、代码/公式/图形/图片、选打印机与取消、重复打印、关闭后退出；真实打印与 PDF 输出分别留证据 |
| MD-12 快捷键、保存与外部变更 | Ctrl/Cmd+S、Shift+S、P/F/E、±/0 与滚轮缩放；替换键 Windows/Linux 为 Ctrl+H，macOS 为 Control+H（Cmd+H 属于系统 Hide）；已命名文档 30s/blur autosave；磁盘 watcher、clean 自动 reload、dirty/saving 显示 changed，再到 conflict；UI 保存及 `onFileChangedOnDisk` | 将 Friday 全局快捷键/失焦事件、app autosave 偏好和菜单正确路由到活跃 Tab；保留 watcher ack、BOM/EOL 及保存中新增编辑的 dirty 合同 | 外部 clean 修改自动刷新；dirty/saving 时 reload/keepMine/overwrite 按状态操作；未决冲突不被 autosave 代选；keepMine 允许后续覆盖而非立即写，overwrite 才立即保存；原始 BOM/行尾与 source mode 不被 Markdown 序列化改写 |

完整工具注册表应按实际组合冻结，不能只列 MD-06 的局部编辑工具。目标 `renderer/ai/tools.ts:133–265` 的 `AGENT_TOOLS` 包含 8 个本地具名定义：`get_document_context`、`read_blocks`、`apply_ops`、`write_document`、`image_search`、`insert_image`、`generate_image`、`read_frontmatter`，以及从 `packages/agent-core/src/mind-map.ts:97` 引入的 `MIND_MAP_TOOL`，实际工具名为 `generate_mindmap`，因此数组共 9 个。`AiPanel.tsx:417–429` 再通过 `composeSkills('markdown+search', …)` 组合 `createMarkdownSkill` 与提供 `web_search` 的 `createSearchSkill`，正常共 10 个工具；思维导图不是由 AgentLoop 自动注入，也不是第三个独立 skill。`markdown-skill.ts:102–105` 的动态 getter 在每次模型请求前读取能力条件，`imageGenerationAvailable(settings, gskLoggedIn)` 为 false 时隐藏 `generate_image` 并调整系统提示，此时共 9 个；单消息附加 skills 是额外上下文，不能替代上述内置工具。不存在名为 `fetch_image` 的 Agent tool：`insert_image` 内部执行下载，再经 `window.markdownApi.fetchImage(url)`、preload `index.ts:165` 调 `AI_CHANNELS.fetchImage`（`ai:fetch-image`）；验收须分别核对工具 schema、执行与底层 IPC。

目标 `RuntimePaths` / `configureMarkdownRuntime` 约 396/408，`createMarkdownView` 约 1442 会在内部注册 Markdown IPC，且创建视图使用 `rendererUrl(runtime.rendererUrl, 'markdown')`。Friday 应构建并导入 `markdown-main.ts`，注册 `markdown` renderer 协议；不能仅传入 `rendererFile` 就假定路径生效，也不能导入会直接启动 standalone 的 `main/index.ts`。`startMarkdownStandalone` 的 app-ready、协议和窗口逻辑只是参考，不能与 Friday 自有 app 生命周期重复运行。`app:*` 主题/语言/文档主题/autosave/AI 面板设置、`ai:suggest-file-name`、skills 和公共 project handlers 都属于接入清单。

格式边界：完整块编辑/AI 参照 `.md/.markdown`；目标 `.txt/.json` 保存独立文本及 BOM/EOL，`runExport` 对 source mode 显式返回 false，不能承诺它们具有同样块工具/导航/富导出。`.mdx` 未在目标输入合同中列出，不能据“类似 Markdown”自动扩展。AI 规则不支持用 raw HTML 创建任意字体/颜色/布局；源文件中未编辑部分的保留是另一个序列化问题，必须单独检查，不能把“不写 raw HTML”误解成允许丢弃原文件内容。

目标已有 `ai-doc-writer/ai-tools`、math/footnotes/wavedrom、mindmap、redaction、source/text-mode/roundtrip、wiki resolve/create/embed/fragment/index/tags、asset/conversion lifecycle、docx/pdf/png export/print-html 及 browser 样例，可作为复用起点。本轮未运行这些测试；也不能用单元测试覆盖率替代 Friday 宿主、资源和安装版验证。

### 8.8 AI HTML：完整功能、宿主工作与验收

目标 `apps/html` 以完整 HTML source 为唯一真相，使用 CodeMirror、parse5、预览 iframe、元素 sid 映射及 AgentLoop。它可以生成/编辑单页落地页、报告、one-pager、海报、仪表盘、邀请等；不是只读 HtmlViewer，也不能用富文本笔记替代。下表证据路径相对于目标 `apps/html/src/`；主进程简称 `main/html-main.ts`，UI 简称 `renderer/App.tsx`。

| ID | v0.12.600 已有功能与证据 | Friday 必须接入的工作 | 专项验收内容（全部 P0、待执行） |
| --- | --- | --- | --- |
| HTML-01 文件与身份 | `.html/.htm` 可编辑，新建/open/save/saveAs、dirty close、rename 路径同步、AI 命名、已命名 30s/blur autosave、clean 磁盘变化自动 reload、dirty 冲突决策；主进程 `1043/1100/1174/1244/1434–1515`，UI `1267–1324/1449–1487` | 新增 AI HTML 卡片、文件编辑入口、保存/关闭 hooks、标题/最近文件/会话同步；保留与旧 HtmlViewer 查看行为的明确区别 | 中文/空格路径、两种扩展名、首存取消、另存/重命名、dirty 关闭、外部 clean/dirty 变化、保存失败与重开；不误导入笔记 |
| HTML-02 源码与预览 | preview/split/source 模式；CodeMirror source 唯一真相，cursor↔静态元素/breadcrumb 联动、find/replace、envelope 保留；UI `137/325/627/843/1343/1879`、`SourceEditor.tsx` | 保留源码/预览双向定位、元数据/envelope 与统一 source 修改管线，正确布局/主题/焦点；不可只展示 iframe | 三种模式来回编辑，结构/脚本/样式保持，源码选中和预览元素定位一致；find/replace 与 undo 作用于同一文档 |
| HTML-03 视口与预览交互 | desktop/tablet/mobile、50–200% 缩放/步长 10、Ctrl±/0/pinch；作者 JS 可运行；动态无 sid 节点与脚本改写节点有编辑边界/dirty 提示；UI `89–101/699–739/776–820/1916–1941` | 保留 iframe 行为和响应式尺寸、缩放/手势/命中计算；目标预览脚本合同和节点映射不能被泛化 viewer 替代 | 三视口/各缩放下命中与样式正确，合法交互页可运行；动态生成节点不得被错误映射为静态源码，失效映射有明确反馈 |
| HTML-04 可视编辑与插入 | inline text、拖动重排/resize、上下移动/duplicate/delete；heading/paragraph/list/button/image/table/section/divider，blank-only skeleton、8×10 table picker；UI `758/768/828/832/1689–1719/1821–1859`、Ribbon | 连接全部 toolbar/上下文命令与静态源节点操作，保留空白文档 skeleton 条件、键盘/选区和拖拽 | 每个插入/结构操作在源码中形成正确结果，可撤销，保存重开一致；复杂嵌套下移动、复制/删除不损坏页面 |
| HTML-05 样式与图片编辑 | bold/italic、font size/color/background/align、宽高/锁比/opacity/radius/padding/alt/object-fit/custom CSS；本地/URL 图、replace/crop/cutout/镜像/90° rotate/align；live style poke 在 save/export 前 flush、可 revert 未提交 poke；`StylePanel.tsx:29–373`、`FloatToolbar.tsx:83–288`、UI `1070–1102/1982` | 复用图片处理/资产服务，样式编辑写回 source，不只改 DOM；所有保存/导出入口等待样式提交 | 全部控件逐项与参考页对照；resize/裁剪/抠图/旋转后资产有效；取消样式预览、保存/导出前 flush、undo 和重开结果一致 |
| HTML-06 AI 局部编辑 | `get_outline/read_source/apply_ops`；ops 为 str_replace/replace_element/set_inner_html/set_text/insert_html/remove/move/set_attr/set_style；batch 全成全败，manual-version 变化拒旧操作，附件展开后重查；选中 Ask AI/edit queue；`ai/tools.ts:257–337/679/898–987`、UI `1744` | 保留 sid/source 快照、原子 ops、staleness、范围与队列合同，Friday transport 需真实传递工具/错误/取消 | 有选区/无选区、每类 op、原子失败回滚；异步附件或手改造成旧操作时拒绝/重试；停止后不再写入，用户可继续编辑 |
| HTML-07 AI 整页规划与写作 | ask_clarification→plan_page 的 brief/style tiles 编辑确认→writer 流式 draft；new/redesign/restyle/extract；restyle 保结构、改变量；write_document 内容优先 clean 单栏；partial 草稿确认/继续/取消；tools `339–404/1030–1130`、AiPanel `634–698/734–771` | 保留问答、方案/风格确认卡与各阶段状态、独立 writer 和取消/草稿决策，不能缩为一次聊天生成字符串 | 完整创建及 redesign/restyle/extract 流程，确认前后内容可控；流式/中断/继续/放弃/回滚核对 source/dirty；DOCX-friendly 是特定简报/布局选择而非任意网页保真保证 |
| HTML-08 附件、搜索、媒体和 skills | document/search/files/intent 四技能；10 工具为 get_outline/read_source/apply_ops/ask_clarification/plan_page/write_document/search_images/generate_image/web_search/read_attachment，intent 为 context 无工具；文本附件 24000 分页、图片多模态、拖放/粘贴、attachment://、skills list/text/单消息附加、usage/stream/cancel/语言；AiPanel `420–524/734–771/979–1030/1672` | 统一 Friday 模型、搜索、附件解析/图片生成与设置，保留 schema/分页/引用；本地媒体 handler 需配置适配，不只覆写共享 `ai:stream` | 每个工具有真实请求与资产/结果证据，附件分页和图片输入有效；有效/无效 provider、网络错误、取消、skills 管理等行为对照；不能以空结果或 unsupported 判为通过 |
| HTML-09 历史、撤销与隐私 | project:* 聊天持久化、首存 rebind；AI 修改前内存快照最多 20 个，可回滚；CodeMirror undo/redo 共用 source；content/attr/script 字符串脱敏→AI projection `{{label}}`，guard 拒改原值；AiPanel `187/332/605/884–960/1171/1475`、UI `238–240/1500–1551`、`redact.ts` | 项目与 Friday 多会话兼容；保留 source snapshot/rollback/undo、脱敏边界；不要将内存快照宣传为磁盘持久版本库，将脱敏宣传为加密 | 首存/另存/重命名/项目/重启的聊天恢复；快照 20 个边界与回滚后重新编辑；脱敏原内容仍正常渲染/保存，AI 投影与操作保护符合目标 |
| HTML-10 Present | Tab 去 chrome/fullscreen/新演示 Tab，Esc 回编辑，live unsaved preview；主进程 `926–939/1362–1414/createHtmlPresentView:1931`，UI `1120–1195`、Ribbon `82–105` | 提供 host setBleed/hostWindow/openTab/owner 生命周期，适配 Friday Tab 和全屏而非启动独立 Shell | 三种演示动作、未保存内容同步、Esc/关闭/主 Tab 销毁/多窗口焦点；不遗留演示窗口或失去编辑文档 |
| HTML-11 输出与自动化 | GUI DOCX/PDF/single-file HTML/系统打印；DOCX hidden html2docx→OOXML、已打开目标 dirty 保护；PDF A4 背景；single HTML 内联可读本地图且返回 skipped；主进程 `1690/1755/1790/1805/1960`；headless HTML/HTM→PDF/DOCX | 接完整菜单/IPC/导出 hook、转换资源、目标冲突保护与系统打印；接 Friday argv/CLI wrapper；保留 skipped 与布局限制 | 有图片/复杂 CSS/脚本/失败资源样本逐格式对照；DOCX 可打开且结构有效、打印取消/清理、headless JSON/exit/输出有效。无 HTML→HTML headless、无独立 HTML read/apply CLI，不能杜撰 |
| HTML-12 资产与隔离 | app-ready 前 privileged schemes；`html-preview/html-asset`，已打开文档目录/realpath 范围；跨目录 SaveAs 资产重写/rollback/pending cleanup/manifest；主进程 `1269–1298/1467–1512`、`main/asset-lifecycle.ts:383–405/1022/1117/1215/1230`；外层 WebContents sandbox/isolation、Node 禁用 | 注册协议和合法源授权，复用完整资产生命周期；保留 iframe 可脚本/表单/弹窗等目标行为，同时隔离 Friday preload/模型密钥/文件写入；与菜单/导航 guard 协同 | 合法本地资源/远程资源及失败反馈、首存/另存/取消/关闭清理；越界路径/符号链接被拒，作者 JS 不能访问宿主 bridge 或密钥；合法交互仍可运行 |

HTML 的 `configureHtmlRuntime` 约 836 与 `createHtmlView` 约 2004、`createHtmlPresentView` 约 1931 是宿主适配点。与 Markdown 一样，应 bundle 专用 main 模块而非导入 standalone 入口；目标 Shell 在 app-ready 前注册 privileged schemes 的时序也需要搬入 Friday。公共 `project:*`、`home:open-path`、skills、AI 命名、app 主题/语言/autosave/panel prefs 以及文件/打印/导出菜单必须有明确归属。

隔离和保真有实际边界：预览 iframe 允许 scripts/forms/popups/modals，不包含 allow-same-origin，但允许网络；这不构成“任意 HTML 绝对安全”的保证。动态无 sid 节点不能按静态元素直接编辑。系统 Print 允许 JS，Export-PDF 使用 `javascript:false`，不能预先承诺脚本动态生成的内容在二者中必然一致。single-file HTML 只内联可读本地图并报告 skipped，不是把任意网站的所有脚本、字体、CSS 和网络资源打成全离线包。DOCX-friendly 流程不能解释成任意 CSS 网页完美还原到 Word；这些目标原有限制须透明保留，同时在同条件下达到目标行为。

### 8.9 两模块的共享阻断、旧笔记边界与自动化合同

**共享 AI 桥目前存在确定的对等缺口。** Friday `src-electron/office/office-ai-bridge.js:342–353` 的 web-search/image-search 返回空数组，fetch-image 返回 null，generate-image/analyze-media 返回 unsupported；这不能支持 Markdown/HTML 的真实搜索与媒体工具。目标 HTML preload `index.ts:126–130` 调共享搜索及 html-owned fetch/generate 通道，`projectApi` 定义在 134、方法在 135–138；Markdown 则通过共享搜索/下载和 markdown-owned generate 通道。这里的 preload/IPC 方法与 Agent tool 是不同层次，不能将 `fetchImage` 直接命名为 `fetch_image` 工具。接入时需要完整的配置读取、能力声明、结果适配、资产写入、取消和错误合同；外部服务有效时目标可用的能力在 Friday 缺失，即阻断六模块交付。

服务结果也须逐类型适配。目标 `@genoffice/ai-search` 的 `webSearch` 返回 `{results:[{title,url,snippet}],answer?,method,error?}`，`imageSearch` 返回 `{images:[{title,imageUrl,sourceUrl,source,width?,height?}],method,error?}`，图片集合不是 `results`；真实零结果与 `method:'error'` 必须分开。`search-tools.ts:19/33/37` 经 `settingsPath→readAiSettingsFile→provider mapping` 取配置，`media-tools.ts:323` 的 `generateImageTool(settingsPath, op, {mediaRoots})` 返回 `{url?,error?}`；目标两模块主进程仍直接使用 `userData/ai-settings.json` 与 `documentMediaRoots`，只把文本 provider 接入 Friday 不会自动统一图片配置。Friday 应保留 SQLite 为模型密钥的唯一来源，拟通过注入已解析配置或配置 reader 适配这些服务，不另写明文 `ai-settings.json` 副本；具体签名与生命周期在实施时冻结，不能只调用原 helper 就宣称统一。验收分别覆盖正常结果、合法零结果、配置/网络错误、取消及实际资产落盘。

**磁盘 Markdown 与旧笔记必须分开身份与保存语义。** Friday `src/views/knowledge/composables/useFileSystem.js:172–177` 的当前 Markdown 内置打开路径调用 `openMarkdownAsNotePage`；`src/utils/markdownImport.js:23–35` 先把 Markdown 经 marked 变为 HTML，再按同标题查找既有未删除笔记并更新 SQLite，否则新建 note。两份不同目录、同名的 `.md` 若继续走这条路径，会被合到同标题旧笔记，不能作为新 Markdown 文件编辑器入口。旧 `NoteEditor.vue` 以 noteId/HTML 保存，已有音视频/附件/图表/样式；`note-projection.js` 的 Turndown 与保护 token 以及 `obsidian-shim.js` 的兼容层，也不等于新的 GenOffice 块编辑器。规划应让旧笔记继续使用原身份，`.md/.markdown` 文件通过明确的 Office 编辑动作直编；只在用户选择显式“导入为笔记/导出副本”时跨边界，不自动批量迁移或按同名覆盖。HTML 的旧查看器也应与“AI HTML 编辑”入口区分。

**CLI 已有构建机制，缺口在新类型与运行路由。** Friday 并非没有 CLI：`scripts/build-office.mjs:236–241` 构建 CLI，约 278–286 stage 为 `resources/office/cli/happyfriday-office.cjs`，根 `package.json:193–196` 随整个 office 目录复制，`src-electron/office/office-agent.js:47` 调用此产物。现存 CLI bundle 内部 `VERSION="0.10.0"` 是模块版本，不能当成产品 tag 或安装包版本。当前 `office-files.js` 扩展类型与 `office-headless.js:119–122` 的输入检查仍仅覆盖原四类；headless 约 141 也只安装四编辑器 renderer。因此应扩展现有 happyfriday-office/office_* 集成，补两类输入、资源与运行目标，不以已有 bundle 存在证明已完成，也不凭空承诺新增外部 launcher。

**两应用依赖宿主菜单和活跃目标选择。** 目标 Shell `index.ts:6189/6296` 明确两专用 main 不自建菜单，Shell 负责 save/saveAs/export/print/close，并处理当前活跃的 detached 编辑目标；约 7015 注册共享 project IPC。Friday 要将这些动作接入自己的窗口/Tab/菜单，避免多个窗口中命令发向旧 Tab。约 7242–7250 的 MCP openDocumentsControl 是 live document 的 read/save/discard 桥，不是独立 HTML read/apply CLI；若本版复用这条能力，也应映射 Friday 现有工具合同并验证未保存内容，不能混称为新 CLI 子命令。

**headless 与 CLI 必须分层验收。** 目标 `packages/electron-utils/src/headless-export.ts:28/79` 规定 Markdown 输入 `.md/.markdown` 仅输出 PDF，HTML 输入 `.html/.htm` 输出 PDF/DOCX；Shell `headless-export.ts` 负责路径/输入检查、禁止输出覆盖源路径、实际输出/mtime 检查以及结果。上游二进制合同如下，格式应分别代入，不把竖线当实际参数：

```text
<app binary> --headless-export notes.md --to pdf --out notes.pdf --json
<app binary> --headless-export page.html --to pdf --out page.pdf --json
<app binary> --headless-export page.html --to docx --out page.docx --json
```

目标 `packages/cli/src/commands/convert.ts` 则通过 `genoffice convert notes.md --to docx|html|pdf --out ...` 支持更多转换，其中 MD→DOCX/HTML 在 NODE_ROUTES，MD→PDF 在 APP_ROUTES；HTML/HTM→PDF/DOCX 依赖 app renderer。这里的 `genoffice` 是上游对照命令，Friday 落地应使用已有 happyfriday-office CLI/office_* 调用体系；文档中的 `docx|html|pdf` 表示三个可选值，不是 shell 命令原样。真实单格式上游示例为 `genoffice convert notes.md --to docx --out notes.docx`；已有输出默认拒绝，覆盖使用 `--force`。wrapper 通过 `GENOFFICE_APP_BIN` 定位具体二进制，不能默认外部 genoffice wrapper 启动的就是 Friday。CLI 的 MD→HTML 也不等于 Markdown GUI 新增 HTML 导出菜单。

应用 headless 与外层 CLI 的机器合同不同，必须分层记录及验收。`packages/electron-utils/src/headless-export.ts` 的应用退出码为 `0=success/1=badArgs/2=inputError/3=conversionFailure`；成功 JSON 为 `{status:'ok',summary,output_path}`，失败为 `{status:'error',summary,error}`，不含 CLI 的 `command/code` 字段。`packages/cli/src/result.ts` 的外层退出码则为 `0=ok/1=usage/2=file/3=conversion/4=app unavailable or crashed`；成功 JSON 含 `status/command/summary` 及可选 `output_path/warnings/detail`，失败为 `{status:'error',command,code,error,message,suggestion?,detail?}`，其中 `error` 是稳定 reason，`message` 才是给人看的描述。`formats/app-export.ts` 先检查应用 `ok` envelope 与输出文件存在：二者满足时，即使应用退出非 0 或在 Electron quit 阶段超时被终止，仍接受转换成功；未产出成品而超时为 CLI 3，应用缺失或无 envelope 崩溃为 4，其余子进程退出码 `1→CLI 3、2→2、3→3、其他→4`。Friday 需要适配自己的 argv、资源、无窗口运行与这两层结果，不能用一个 schema/退出码表混验。上述两类新增运行路径仍未接入/运行，必须在 dev 与最终安装包分别验证。

## 9. 打印：纠正“上游删除 Friday helper”的判断

三方历史核实表明，以下路径均是 Friday 相对共同祖先新增（A），并非共同上游既有文件被目标版本删除：`native/build-win.mjs`、`native/system-print.cs/.exe`、`src/system-print.ts`、`src/system-print-window.ts`、`src/print-job-settings.ts`、`src/office-file-bridge.ts`（均在 `packages/electron-utils` 下）。

直接比较 `HEAD` 与目标标签会显示这些路径从左端到右端为 D，但这只表示目标没有 Friday 定制，不能解释为上游主动删除。正常三方合并通常会保留本地单边新增文件。真正风险是直接 reset/tag 切换会丢失这些文件，或合并时 exports、主进程调用和 UI 使用了不一致的两套打印实现。

上游相对共同祖先新增 `print-job.ts`、`print-window.ts`、`print-cups.ts`。其 `printHtmlDocument` 写临时 HTML，等待 fonts/images 后调用 `webContents.print`；Windows 显示临时窗口，finally 清理窗口与目录；print-job 统一 printer/copies/duplex/outcome，macOS 静默打印走 CUPS。应比较并整合这些行为，不能只判断 helper 文件是否存在。

Friday `scripts/build-office.mjs` 仍引用 Windows helper 构建与生成物。实施时需决策保留兼容层还是统一到目标打印模型，并同步 build、exports、主进程、UI、打包审计和清理路径。不要为使构建通过而静默跳过打印能力。`main-proxy.ts` 是 HTTP 代理，不能替代本地文件桥。

## 10. 构建、资源与许可

| 项目 | 当前 / 目标 | 影响与验证要求 |
| --- | --- | --- |
| Friday 根 Electron | `^42.2.0` | 四编辑器实际运行于此宿主；本次不自动把根应用升级到 43 |
| vendor Electron | 当前 `^43.3.0`，目标 `^43.8.3` | workspace 开发依赖变更不代表 Friday 运行时同步变更；需在 Electron 42 下验证实际 API |
| Vite / Vitest | `^7.3.1→^7.3.7` / `^4.1.11→^4.1.12` | 合并 workspace 与 lockfile 后重建，不把编译器依赖更新等同于运行兼容 |
| CLI MCP SDK | `^1.30.0→^1.32.1` | Friday 工具封装、schema、调用与输出仍需核对 |
| 主进程 bundle | Friday CJS、Electron external | 逐项验证新 workspace、动态资源、模块导出、wasm 与原生辅助程序 |
| 生成物 | `resources/office`、根资源 `wasm` | 不手改生成物；用构建脚本重新生成并记录 manifest/资源摘要 |
| PDF converter OCR | Shell converter 现有候选为 resourcesPath/ocr 和源码相对路径；Friday stage 为 office/ocr | 拟新增独立转换 bundle 时补查找位置或复制策略；编辑器自己的 ocr.ts 已有 ../ocr 候选，不能混为同一缺陷 |
| 法律声明 | Apache-2.0，目标 NOTICE 更新，Shell dist 增加 notices 步骤 | UI 品牌替换应与 LICENSE/NOTICE/第三方归属分开处理，不删除法律声明 |

本轮没有恢复完整依赖、重建 Office、生成安装包或切换运行时。本轮尝试的两项 Shell 转换专项测试在进入断言前被 `@genoffice/pptx-engine/custgeom` workspace link 缺失阻断；这属于测试环境未就绪，不是转换算法失败，也不能称为测试通过。实施前先恢复 workspace 依赖/链接，再运行定向测试。

## 11. PDF 无法转 Word：静态根因与拟修复设计

### 11.1 现有链路与缺口

| 环节 | 已检查证据 | 结论 |
| --- | --- | --- |
| PDF UI | 当前 `apps/pdf/src/renderer/App.tsx` 约 5932–5941，`convertTo` 调 `window.pdfApi.convertOffice(format)`；catch 静默 | 用户可能只观察到点击无结果，无法区分 IPC 缺失与转换错误 |
| preload / contract | `apps/pdf/src/preload/index.ts` 约 41；shared/ipc.ts 的 `pdf:convert-office`，format 为 docx/xlsx/pptx，Promise<void> | renderer 已有意图通道，但并非转换器本身 |
| 当前源码基线的 Shell | 当前 HEAD 的 `apps/shell/src/main/index.ts` 约 4613–4619 注册 handler，校验 activePdfTab 后分派转换 | 转换入口属于官方 Shell 编排层，而非 PDF 主模块天然自带；此行号不是目标标签行号 |
| Friday host | 原 `src-electron/office/office-host.js` 约 196 仅接 registerPdfProjectIpc，没有该转换 handler | Friday 独立宿主遗漏了 Shell 对应编排能力 |
| Friday bundle | 原 `scripts/office/entries/pdf.ts` 仅导出 pdf-main 和 OCR；原 build 的 BUNDLE_ENTRIES 没有转换器 | 仅注册 IPC 仍不足以找到实际转换能力，需要独立 bundle 和资源接入 |

上述组合是高可信静态主因。xlsx/pptx 与 docx 共用入口，可能存在同类接入缺口；本轮未对三种格式分别运行验证，不应宣称已确认全部失败或全部修复。

### 11.2 推荐修复边界

优先复用 `apps/shell/src/main/pdf2docx-local.ts` 的 `convertPdfFileToDocxLocal`、`convertWithPasswordRetry` 和 `WithPrompt` 入口，把转换器作为独立构建产物引入 Friday，由 Friday 提供密码提示适配器。可继续保持 renderer 现有 `convertOffice(format)` 合同，减少无必要的密码状态和 IPC 变更。

当前源码基线的 Shell `index.ts` 约 4259–4386 已包含保存同步、目标路径对话框、密码重试、目标 dirty 处理、退化提示与打开 Docs 的编排，可作为行为参照；不应为了复用这些逻辑导入完整 Shell。目标 `v0.12.600` 的 Shell 在约 6462、6648、6759 均使用 `await flushPdfSave(tab.webContents, true)`，因此当前行为参照还必须结合目标的完整保存合同适配。上游 password-dialog 还依赖 Shell 特定 preload/HTML，不能只复制函数而遗漏其窗口资源和生命周期。

| 设计点 | 必须明确的行为 |
| --- | --- |
| 调用来源 | 只接受已登记 PDF 视图发起的转换；限制 format 白名单，禁止 renderer 指定任意源文件或命令 |
| 最新内容 | 当前 HEAD 的 pdf-main 约 783–800 为旧版 `flushPdfSave`；目标标签约 1072–1091 的签名是 `flushPdfSave(contents, flushAll=false)`。转换/导出应传 `true`，使尚未点击 Done 的表单卡片内容写盘，再等待 dirty 保存完成；目标仍有 120 秒超时。必须随宿主升级这一合同，不能只沿用旧调用 |
| 文件安全 | 转换器不以 DOCX 覆盖源 PDF；转换前保存 dirty 编辑应遵循明确的保存语义；目标已有未保存 Docs 时确认；取消/失败不破坏旧目标，不留下被误当成成功的半成品 |
| 并发与关闭 | 定义 busy、重复点击、文档切换/关闭和进程退出的状态；转换完只向仍有效的宿主回报 |
| 密码 | 与当前 PDF 路径绑定，切文档清理；密码不写日志；四个空格也是有效密码，不 trim；区分取消与错误密码 |
| 中文路径 | 保留 PDFium `thisProgram:'genoffice-pdf'` 对中文 argv 的修正，覆盖源/目标中文和空格路径 |
| 资源 | 独立 bundle 下重新定位 PDFium wasm、OCR 可执行程序/模型；覆盖 dev 和安装版，不能仅依赖源码相对路径 |
| 结果解释 | 使用实际 `pageResults[{page,status}]`、`scannedDocument`；status 包括 ok/ocr 等，不自造 scannedPages/ocrPages 字段 |
| 扫描页退化 | 图片 fallback 不等于可编辑 OCR 成功；输出可打开和正文可编辑分别验收，对退化明确提示 |
| 错误反馈 | UI 不再静默吞错；区分依赖缺失、密码、损坏 PDF、取消、超时和输出失败，按项目 i18n 规则实现 |
| 性能 | converter 虽声明 async，extract 管线包含同步工作，ocr-vision 使用 spawnSync、单页 timeout 30 秒；不能承诺天然非阻塞或把进度条等同于 UI 响应 |

### 11.3 修复实施前后需要的证据

已有 `apps/shell/tests/pdf-password-retry.test.ts` 和 `pdf2docx-local-argv.test.ts` 可复用，覆盖真实 WASM、四空格密码和中文 argv。但本轮专项测试未进入断言，应在依赖恢复后重跑，并补 Friday 宿主集成验证。

最小样本矩阵应包含可提取文字、中文/英文混排、多页表格、图片/扫描、混合扫描页、加密 PDF（正确/错误/空格密码）、损坏页、中文与空格路径、同名已有 DOCX、保存取消及转换中切换/关闭，并新增“修改 PDF 表单卡片但尚未点击 Done 即转换”的用例，确认 `flushAll=true` 使最新表单内容进入输出。对于结果应同时检查：DOCX 可解压/可打开、段落/表格有内容、扫描退化有提示、目标失败时可恢复，以及转换后由 Friday Docs 打开。源 PDF 的保护检查应以无编辑原件或已明确保存的最新快照为基准，确认转换阶段没有额外改写；不能把转换前按约定保存 dirty 内容误判为转换器破坏原件。

本轮结论限定为“调用链缺口及拟修复方案已明确”，不是“PDF→Word 已修好”。下一阶段先在当前稳定基线上独立完成这一修复与验收，再决定合入大版本的时间点，便于区分旧故障和升级回归。

## 12. 风险分级与升级路线比较

| 级别 | 风险 | 阻断原因 / 收敛证据 |
| --- | --- | --- |
| P0 | ProjectStore 多会话丢失或映射错误 | 用户历史资产；需旧数据副本、所有文件身份变换和回滚验证 |
| P0 | Friday 宿主遗漏/静默跳过接口 | 构建成功但转换、项目历史或生成文件打开失效；需逐入口合同和真实操作证据 |
| P0 | PDF→DOCX 仍无可用链路 | 当前明确用户故障；需独立修复和端到端样本通过 |
| P0 | 128 冲突机械选边造成能力丢失 | 需按功能核对，并清除冲突标记、构建及关键回归 |
| P0 | 生成物、安装资源、数据回滚不一致 | 需来源 manifest、安装包实测、迁移前数据快照与回退演练 |
| P0 | Electron 42 / CJS / 新 workspace 兼容 | 宿主兼容是运行门槛，需 dev 和安装版构建、资源定位与实际 API 验证；升级 Friday 根 Electron 本身仍另行决策，不是默认范围 |
| P0 | 既有打印因新旧路径混用而回归 | 需设置合同、焦点、取消、真实输出和退出清理验证 |
| P0 | 既有页眉页脚、分页、复杂 Office 保真下降 | 需保存/重开/导出和视觉样本对比 |
| P0 | 既有 AI stream/cancel 与懒加载时序回归 | 需四编辑器、文件隔离、重启恢复及取消测试 |
| P0 | 既有长文档/首开性能回退 | 需沿用可复核负载和采样口径，不能把历史未达标归为升级新回归 |
| P0 | AI Markdown / AI HTML 功能缩水或入口未完整接通 | 本版明确必交付；MD-01～MD-12、HTML-01～HTML-12 全量映射与同条件实测，不能只验编辑与聊天 |
| P0 | 搜索、图片、附件、Present、headless 只有 UI 或空 handler | 需真实工具/资源/协议/宿主与最终包证据；目标支持而 Friday 缺失即阻断 |
| P0 | 新 Markdown 继续按标题导入旧笔记、跨文档误写 | 磁盘路径与 noteId 分离；同名异目录、首存/另存/rename/会话身份必须验证 |
| P1 | 新增旧格式导入、边框/水印等能力未完整接通 | 新能力应单独验收；不以新增功能替代既有能力保留门槛 |

这里的级别用于下一版发布门槛，与配套 PRD 一致：既有能力/用户数据回归、PDF→Word 修复、用户指定的 AI Markdown/AI HTML 全功能对等均按 P0 阻断；仅其他明确列为条件接入的新增能力按 P1 分项收敛。原四类的保留验收与新两类专项验收共同构成六模块目标，不能将“新功能”一概降为 P1。历史材料已记录的未完成项应明确列为基线欠账。

| 路线 | 结果与成本 | 建议 |
| --- | --- | --- |
| 直接 reset / gitlink 指向目标 | 快速得到纯上游源码，但丢失 Friday 定制和接入合同 | 不采用 |
| 在 Friday 当前分支三方合入固定标签 | 保留祖先和补丁来源，128 个冲突需人工整合，之后继续维护集成层 | 主方案 |
| 仅挑少量上游修复 | 可缩小短期单故障范围，但无法等同于升级到 v0.12.600；跨包依赖仍需追踪 | 可用于 PDF 独立修复或明确小范围补丁 |
| 用上游完整 Shell 替换 Friday 宿主 | 改变 AI、项目、窗口、文件与更新架构，远超本次 Office 升级范围 | 不作为本轮方案 |

不应在尚未完成构建预演和样本验收时给出精确工期承诺。实施可按“冻结基线与数据副本→独立 PDF 修复→模块融合→构建/资源→数据与交互回归→安装版验收→可回滚发布”组织；各阶段的进入/退出条件见配套方案和 PRD。

## 13. 历史基线与本轮完成度

已检查的历史材料包括 [Office 首开验收](./Office-startup-acceptance-2026-10-24.md)、[菜单/导出/选择验收](./Office-menu-export-selection-acceptance-2026-10-24.md)，以及 Friday AI Core 的 Preview20 技术设计记录。

历史记录并非全部通过：首开 80% 单项门槛未达且存在系统负载波动；最终安装版生命周期和完整四编辑器验收未完；Word 的 Microsoft Print to PDF 真实输出有通过记录，但 Excel/Slides 焦点与输出、PDF 取消后退出等仍有待办。这些应继承为基线欠账，既不能充当已通过基线，也不能事后全部归为此次升级新缺陷。

| 本轮工作 | 状态 |
| --- | --- |
| 精确源码基线、目标标签、时间、许可 | 已核实 |
| 14 个定制提交、模块路径规模、共同改动交集 | 已核实 |
| 隔离三方合并预演及 128 路径清单 | 已完成；未将预演应用到工作区 |
| Friday 宿主 / 构建 / AI / Store / 打印 / 新格式边界 | 已完成静态分析 |
| AI Markdown / AI HTML 完整功能、服务与资源、旧笔记/文件身份、CLI/headless 边界 | 已按固定目标完成静态分组盘点；MD-01～MD-12 / HTML-01～HTML-12 均待接入与运行验收，不代表已交付 |
| PDF→Word 调用链与拟修复设计 | 已完成静态分析；尚未修复 |
| 两项 PDF 转换专项测试 | 依赖链接阻断，未进入断言；需恢复环境重跑 |
| 全量合并、解决冲突、重建资源、安装包 | 未实施 |
| 转换样本、UI、打印、数据迁移、性能、回滚运行验收 | 本轮未完成 |

## 14. 证据索引

路径行号以研究时对应提交为准；后续合并后应重新定位，不能把本表行号用于证明新版本行为。

| 研究点 | 主要证据路径 / 命令 |
| --- | --- |
| gitlink 与来源 | 根 `.gitmodules`；`git ls-tree HEAD vendor/happyoffice`；vendor `rev-parse`/`describe`/`merge-base`/`rev-list` |
| 三方差异和冲突 | `git diff --name-only <base> <head/tag>`；`git merge-tree --write-tree --messages --name-only HEAD v0.12.600` |
| Friday 构建资源 | `scripts/build-office.mjs`、`scripts/office/entries/*.ts`、根 `package.json` extraResources、`resources/office` |
| Friday 宿主与 AI | `src-electron/office/office-host.js`、`office-ai-bridge.js`、四编辑器 preload/IPC 与 runtime 配置 |
| 会话数据 | vendor `packages/project-store/src/store.ts`、`types.ts` 的三方差异；Friday AI Core 技术设计 |
| 新格式 / Docs | 目标 `apps/docs/src/main/docs-main.ts`；`packages/doc2docx`、`hwp2docx`、`odf2ooxml`、`zip-gate` |
| Sheets 外部链接 | 目标 `sheets-main.ts` / preload / App / ExcelShell / xlsx-sidecar-client |
| Markdown 完整功能 | 目标 `apps/markdown/src/main/markdown-main.ts`、preload、shared IPC、renderer App/Ribbon/SourcePane、editor extensions、ai tools/skill/AiPanel/doc-writer、Wiki/asset/image-host/export 模块及既有 tests |
| HTML 完整功能 | 目标 `apps/html/src/main/html-main.ts`、asset-lifecycle、preload/shared IPC、renderer App/SourceEditor/StylePanel/FloatToolbar/PreviewFrame、ai tools/AiPanel/search/files/intent skills/redact 及既有 tests |
| 新模块共享宿主/服务 | 目标两 preload 的 `app:*` / `project:*` / `home:open-path` / skills/naming；两主进程的 app-owned generate-image；Friday `office-ai-bridge.js:342–353` 空搜索/媒体实现 |
| Markdown 与旧笔记 | Friday `src/views/knowledge/composables/useFileSystem.js`、`src/utils/markdownImport.js`、`src/views/note/NoteEditor.vue`、`src-electron/plugins/note-projection.js`、`src/features/plugins/obsidian-shim.js` |
| CLI/headless 与协议 | 目标 `packages/electron-utils/src/headless-export.ts`、Shell `headless-export.ts/index.ts`、`packages/cli/src/commands/convert.ts` / `formats/app-export.ts`、Markdown/HTML renderer 与 asset 协议；Friday `scripts/build-office.mjs`、`office-agent.js`、`office-headless.js`、`office-files.js` 与 CLI 生成物 |
| 打印历史 | `git diff --name-status <base> HEAD -- packages/electron-utils` 与对应目标三方比较 |
| PDF 转换缺口 | 当前 PDF App/preload/shared IPC、原 Friday host/build；官方 Shell `index.ts` 与 `pdf2docx-local.ts` |
| PDF 资源 / 密码 | `pdf2docx-local.ts`、`wasm-path.ts`、`ocr-vision.ts`、PDF 自身 `ocr.ts`、两项 Shell 专项测试 |
| 许可与工具链 | 当前/目标 LICENSE、NOTICE、package.json、Shell builder 和 notices 生成步骤 |

## 附录：128 个实际冲突路径

以下清单从本轮 `merge-tree --name-only` 输出提取；唯一 add/add 为 Sheets PrintDialog，其余均为 content。该清单不是升级所需修改文件的全集。

```text
apps/docs/src/main/docs-main.ts
apps/docs/src/preload/index.ts
apps/docs/src/renderer/App.tsx
apps/docs/src/renderer/ai/AiPanel.tsx
apps/docs/src/renderer/components/ContextMenu.tsx
apps/docs/src/renderer/components/HeaderFooterArea.tsx
apps/docs/src/renderer/components/PaginationPreview.tsx
apps/docs/src/renderer/components/PrintDialog.tsx
apps/docs/src/renderer/components/Ribbon.tsx
apps/docs/src/renderer/editor/hf-dom.ts
apps/docs/src/renderer/editor/hf-text.ts
apps/docs/src/renderer/file-actions.ts
apps/docs/src/renderer/i18n/locale.tsx
apps/docs/src/renderer/i18n/ribbon/ar.ts
apps/docs/src/renderer/i18n/ribbon/cs.ts
apps/docs/src/renderer/i18n/ribbon/de.ts
apps/docs/src/renderer/i18n/ribbon/en.ts
apps/docs/src/renderer/i18n/ribbon/es.ts
apps/docs/src/renderer/i18n/ribbon/fr.ts
apps/docs/src/renderer/i18n/ribbon/he.ts
apps/docs/src/renderer/i18n/ribbon/hi.ts
apps/docs/src/renderer/i18n/ribbon/id.ts
apps/docs/src/renderer/i18n/ribbon/it.ts
apps/docs/src/renderer/i18n/ribbon/ja.ts
apps/docs/src/renderer/i18n/ribbon/ko.ts
apps/docs/src/renderer/i18n/ribbon/ms.ts
apps/docs/src/renderer/i18n/ribbon/nl.ts
apps/docs/src/renderer/i18n/ribbon/pl.ts
apps/docs/src/renderer/i18n/ribbon/pt.ts
apps/docs/src/renderer/i18n/ribbon/ru.ts
apps/docs/src/renderer/i18n/ribbon/th.ts
apps/docs/src/renderer/i18n/ribbon/zh-TW.ts
apps/docs/src/renderer/i18n/ribbon/zh.ts
apps/docs/src/renderer/index.html
apps/docs/src/renderer/main.tsx
apps/docs/src/renderer/pagination-lines.ts
apps/docs/src/renderer/pagination-measure.ts
apps/docs/src/renderer/styles.css
apps/docs/src/shared/ipc.ts
apps/html/src/renderer/ai/AiPanel.tsx
apps/markdown/src/renderer/ai/AiPanel.tsx
apps/pdf/src/main/generated-output.ts
apps/pdf/src/main/pdf-main.ts
apps/pdf/src/renderer/App.tsx
apps/pdf/src/renderer/ai/AiPanel.tsx
apps/pdf/src/renderer/annotations.ts
apps/pdf/src/renderer/i18n/strings.ts
apps/pdf/src/renderer/ocr-layer.tsx
apps/pdf/src/renderer/styles.css
apps/pdf/src/shared/ipc.ts
apps/pdf/tests/ocr-layer.test.ts
apps/sheets/package.json
apps/sheets/src/main/pdf-export.ts
apps/sheets/src/main/sheets-main.ts
apps/sheets/src/preload/index.ts
apps/sheets/src/renderer/App.tsx
apps/sheets/src/renderer/ExcelShell.tsx
apps/sheets/src/renderer/PrintDialog.tsx
apps/sheets/src/renderer/ai/AiChatPanel.tsx
apps/sheets/src/renderer/i18n/app/ar.ts
apps/sheets/src/renderer/i18n/app/cs.ts
apps/sheets/src/renderer/i18n/app/de.ts
apps/sheets/src/renderer/i18n/app/en.ts
apps/sheets/src/renderer/i18n/app/es.ts
apps/sheets/src/renderer/i18n/app/fr.ts
apps/sheets/src/renderer/i18n/app/he.ts
apps/sheets/src/renderer/i18n/app/hi.ts
apps/sheets/src/renderer/i18n/app/id.ts
apps/sheets/src/renderer/i18n/app/it.ts
apps/sheets/src/renderer/i18n/app/ja.ts
apps/sheets/src/renderer/i18n/app/ko.ts
apps/sheets/src/renderer/i18n/app/ms.ts
apps/sheets/src/renderer/i18n/app/nl.ts
apps/sheets/src/renderer/i18n/app/pl.ts
apps/sheets/src/renderer/i18n/app/pt.ts
apps/sheets/src/renderer/i18n/app/ru.ts
apps/sheets/src/renderer/i18n/app/th.ts
apps/sheets/src/renderer/i18n/app/zh-TW.ts
apps/sheets/src/renderer/i18n/app/zh.ts
apps/sheets/src/renderer/page-layout-actions.ts
apps/sheets/src/renderer/save-actions.ts
apps/sheets/src/renderer/univer-locales.ts
apps/sheets/src/shared/desktop-api.ts
apps/sheets/src/shared/ipc-channels.ts
apps/shell/electron-builder.cjs
apps/slides/src/main/slides-main.ts
apps/slides/src/renderer/App.tsx
apps/slides/src/renderer/ai/AiPanel.tsx
apps/slides/src/renderer/ai/slides-skill.ts
apps/slides/src/renderer/components/ContextMenu.tsx
apps/slides/src/renderer/components/PrintDialog.tsx
apps/slides/src/renderer/components/Ribbon.tsx
apps/slides/src/renderer/components/ribbon-shared.tsx
apps/slides/src/renderer/context-menu-items.ts
apps/slides/src/renderer/i18n/app/ar.ts
apps/slides/src/renderer/i18n/app/cs.ts
apps/slides/src/renderer/i18n/app/de.ts
apps/slides/src/renderer/i18n/app/en.ts
apps/slides/src/renderer/i18n/app/es.ts
apps/slides/src/renderer/i18n/app/fr.ts
apps/slides/src/renderer/i18n/app/he.ts
apps/slides/src/renderer/i18n/app/hi.ts
apps/slides/src/renderer/i18n/app/id.ts
apps/slides/src/renderer/i18n/app/it.ts
apps/slides/src/renderer/i18n/app/ja.ts
apps/slides/src/renderer/i18n/app/ko.ts
apps/slides/src/renderer/i18n/app/ms.ts
apps/slides/src/renderer/i18n/app/nl.ts
apps/slides/src/renderer/i18n/app/pl.ts
apps/slides/src/renderer/i18n/app/pt.ts
apps/slides/src/renderer/i18n/app/ru.ts
apps/slides/src/renderer/i18n/app/th.ts
apps/slides/src/renderer/i18n/app/zh-TW.ts
apps/slides/src/renderer/i18n/app/zh.ts
apps/slides/src/renderer/index.html
apps/slides/src/renderer/keyboard-actions.ts
apps/slides/src/renderer/styles.css
package-lock.json
packages/agent-core/src/electron-transport.ts
packages/ai-provider/src/types.ts
packages/docx-engine/src/parse-props.ts
packages/docx-engine/src/parse.ts
packages/docx-engine/src/patch.ts
packages/docx-engine/vitest.config.ts
packages/electron-utils/package.json
packages/electron-utils/tests/renderer-scheme.test.ts
packages/html2docx/src/convert.ts
packages/project-store/src/store.ts
```
