# Friday Office AI 业务能力与 PDF 转 Word 根因研究报告

研究日期：2026 年 11 月 5 日。文档版本：1.0。状态：研究结论与实施前方案；后续 preview.35 候选的实际实现、包内核验和未关闭门禁以第 05 份实施账本为准。

本报告回答三个问题：为什么菜单里有 PDF 转 Word，AI 却不能执行；为什么已经建设 AI Core 仍然存在功能限制；怎样使后续新增功能不再依赖逐个按钮修补。结论是：Friday 已统一了一部分模型调用和工具治理，但 Office 编辑器工具、Friday 宿主回调和文件交付仍是分离的能力链路。本次需要建立业务操作共用的契约和执行机制，以 PDF 转 Word 完成第一条端到端闭环。

配套文档为《Friday Office AI 业务能力与 PDF 转 Word 产品需求 PRD》和《Friday Office AI 业务能力架构方案与技术拆解》。本报告负责事实、证据、原因和取舍；PRD 负责用户体验和发布合同；技术拆解负责接口、模块、任务和测试。三份文档均为新建，原总体升级文档与旧版 PDF 修复文档保留。

## 1 结论与研究时点的交付状态

本节的阶段状态按研究时点（2026 年 11 月 5 日）记录。后续代码、测试、安装器与未关闭验收以第 05 份实施账本为准；本研究的根因和方案结论不因候选包生成而改变。

### 1.1 已有运行证据的直接根因

在隔离的 Electron 环境只打开 PDF，通过真实 PDF renderer、preload 和 Friday 主进程调用创建 DOCX，得到与用户描述一致的错误：

~~~json
{
  "ok": false,
  "error": "pdf: document creation is unavailable in this host"
}
~~~

PDF 主进程要求宿主注入 createDocument；Friday 的 configurePdfRuntime 没有提供该回调。因此这条创建路径必然失败。此错误不是模型主观拒绝，也不是操作系统普遍不支持 DOCX。模型收到真实失败结果后，将宿主缺少实现概括为“当前环境不支持创建文档”。

这条实验验证的是“从 PDF 编辑器创建一份新的 Word 文档”失败，不能直接等同于“原 PDF 转换算法失败”。两个动作必须分别验证。原 PDF 的转换需要调用本地 PDF→DOCX 流水线，不能让模型重新撰写全文后把结果当作转换文件。

### 1.2 导致同类故障反复发生的结构性原因

存在能力声明与实现分散、模型 transport 与业务操作不同源、宿主可选回调缺乏完整性检查、成功返回早于真实文件交付等问题。单独加一个回调可以消除当前错误字符串，但不能保证冷启动、保存失败、取消、切换文档和打开失败等情形正确，更不能保证其他按钮将来可被 AI 调用。

应按“转换、创建、读取、编辑、保存、导出”等业务操作建设能力层，而不是把所有按钮机械包装成 AI 工具。按钮和 AI 成为同一业务能力的调用入口；文档内的细粒度编辑继续通过编辑器适配器执行。

### 1.3 本次完成与未完成

| 项目 | 本次研究状态 | 可以据此宣称什么 |
|---|---|---|
| 用户原样错误复现 | 已获得真实 Electron 失败证据 | 确认宿主创建能力漏接 |
| 按钮与 AI 入口差异 | 已完成源码链路核对 | 确认两条入口未共享完整能力合同 |
| 保存与打开完成语义 | 已完成源码审查 | 存在假成功风险，需要专项回归 |
| PDF 转换质量 | 已定位本地转换与 OCR 路径 | 尚未证明所有类型 PDF 转换质量合格 |
| 统一业务能力层 | 本文提出实施设计 | 尚未写入产品代码 |
| 新安装包 | 研究阶段未生成；当前 preview.35 候选及包内校验见第 05 份实施账本 | 不能把研究报告本身当作安装态验收 |
| GitHub 发布 | 本轮未执行 | 不能声称已上传或可自动更新 |

## 2 研究对象与证据边界

### 2.1 当前源码基线

| 对象 | 当前核对值 | 说明 |
|---|---|---|
| 主仓库 HEAD | 631f535d53c0812bed29bfcf5c679a4485123e9d | 本轮研究的固定源码基线 |
| package.json version | 3.0.7 | 技术版本 |
| package.json releaseVersion | 3.0.7.01-preview.34 | 本研究固定源码快照的发布展示元数据；当前候选已推进到 preview.35，不能用本行证明用户已安装任何版本 |
| vendor gitlink 与 HEAD | 8ed0c8d099c3c3d87b1a998d9189da3d120ff820 | 当前嵌入的 GenOffice 定制源码 |
| vendor git describe | v0.10.639-27-g8ed0c8d0 | 不能简称为原封不动的 v0.10.639 |
| 历史总体融合目标 | v0.12.600 | 保留为原总体项目固定目标 |
| 本次补充核验的官方 Latest | v0.12.852，2026-11-05 发布 | 下一次完整升级的评估候选，尚未合并或验收 |
| 官方候选 tag 引用 SHA | 4b55db9ed1994575a695160ffc6cfd0bfc866211 | git ls-remote 官方仓库 v0.12.852 的返回值 |

vendor/package.json 的 0.1.0 是工作区包版本，不能用来认定 Friday Office 基于哪个上游发行版本。目录名、分支名也不能替代源码 SHA 和构建清单。

2026 年 11 月 5 日本轮早期请求 GitHub REST latest 接口遇到限流；后续通过官方网页 releases/latest 成功补充核验，跳转到 v0.12.852，页面标记 Latest，发布时间为 2026-11-05 07:44。页面未明确该时间的时区，因此不擅自换算。随后以 git ls-remote 核对该官方 tag 引用 SHA。v0.12.600 已不是本次查询时的最新发行，但仍是原总体文档的历史固定目标，原文不覆盖。v0.12.852 是下一次升级评估候选，不等于本次已完成源码差异审计、融合、构建或安装验收。

本次修复研究仍以本地固定 SHA 为准，不把全量升级作为 PDF 修复的前置条件。原总体报告中关于上游差异的统计属于当时固定目标的研究，不能沿用为 v0.12.852 的差异结果。官方版本会继续变化，真正启动升级时应重新查询，再冻结目标 tag/SHA，不能长期跟踪一个漂移的 latest 链接。

### 2.2 证据等级

| 等级 | 含义 | 本报告如何使用 |
|---|---|---|
| R | 真实运行结果 | 支持“已复现”结论 |
| S | 固定源码审查 | 支持“存在该分支或接口缺口”，不代表所有运行场景实测 |
| P | 设计提案 | 待实现，不能作为现有能力宣传 |
| U | 未验证 | 必须进入实验或验收计划 |

### 2.3 可追溯证据目录

以下路径相对本仓库根目录，行号仅用于固定基线定位。实施后应同时保留符号名和 SHA，避免只靠漂移的行号。

| 编号 | 证据与定位 | 等级 | 支持结论 |
|---|---|---|---|
| E01 | scripts/probe-office-pdf-ai-delivery.mjs | R | 从 PDF 冷启动，经真实 preload 调用创建文档 |
| E02 | artifacts/office-pdf-ai-delivery-report.json | R | 返回宿主 document creation unavailable 原样错误 |
| E03 | src-electron/office/office-host.js，configureRuntimes，约 172 行 | S | PDF Runtime 配置缺少 createDocument |
| E04 | vendor/happyoffice/apps/pdf/src/main/pdf-main.ts，RuntimePaths 与 createDocument handler，约 477、924 行 | S | 创建依赖宿主回调，缺失时返回原样错误 |
| E05 | vendor/happyoffice/apps/pdf/src/renderer/ai/tools.ts，AGENT_TOOLS、create_document，约 1141、3586 行 | S | 存在创建工具，未定义转换当前 PDF 的专用工具 |
| E06 | vendor/happyoffice/apps/pdf/src/renderer/App.tsx，convertTo，约 5932 行 | S | 按钮走 convertOffice，未检查结构化失败 |
| E07 | vendor/happyoffice/apps/pdf/src/preload/index.ts，convertOffice | S | 按钮经 pdf:convert-office 调用宿主 |
| E08 | src-electron/office/office-host.js，registerEditorIpc，约 195 行 | S | Friday 该转换入口仅接受 docx |
| E09 | 同文件，exportPdfToDocx，约 705 行 | S | 已有 flush、保存对话框、本地转换、写入与打开流程 |
| E10 | vendor/happyoffice/apps/shell/src/main/index.ts，configurePdfRuntime 与 exportPdfAsDocxLocal 等 | S | 上游 Shell 注入创建回调，并有 Word、Excel、PPT 转换分支 |
| E11 | vendor/happyoffice/apps/docs/src/main/docs-main.ts，createAiDocument，约 4274 行 | S | DOCX 创建排队后立即返回 ok，未等待保存结果 |
| E12 | vendor/happyoffice/apps/docs/src/renderer/file-actions.ts，applyAiDocContent，约 858 行 | S | 忽略 save 返回的布尔值，空解析也可能保存空文档 |
| E13 | vendor/happyoffice/apps/docs/src/renderer/App.tsx，启动内容消费，约 1935 行 | S | AI 内容依赖无打开路径的新标签启动条件 |
| E14 | src-electron/office/office-ai-bridge.js，文件说明与 registerOfficeAiBridge | S | 统一模型流式 transport，工具仍在 vendor renderer 执行 |
| E15 | src-electron/office/office-agent.js，office_create、office_export | S | 主助手另有 CLI 工具路线与审批逻辑 |
| E16 | src-electron/agent/tools/registry.js，executeCapability | S | 已有 schema、scope、审批上下文与审计包装 |
| E17 | src-electron/office/file-commands.js，registerOfficeFileCommands | S | 已有快照导出、任务取消与结构化结果，可复用 |
| E18 | vendor/happyoffice/apps/shell/src/main/pdf2docx-local.ts、packages/pdf2docx | S | 本地 PDFium、系统 OCR 与图片降级路线 |
| E19 | vendor/happyoffice/packages/cli/src/commands/convert.ts，NODE_ROUTES、APP_ROUTES | S | 转换是定向路线矩阵，不是任意格式两两互转 |
| E20 | src-electron/ai-core/facade.js、contracts.js、task-runtime.js | S | Core 已有合同与运行时接入点，不应再建竞争性总线 |

## 3 用户感知与真实执行链路

### 3.1 点击 PDF 转 Word

~~~text
PDF 菜单
  → App.convertTo('docx')
  → window.pdfApi.convertOffice
  → preload invoke pdf:convert-office
  → Friday registerEditorIpc
  → exportPdfToDocx
  → flush 当前 PDF
  → 保存位置与密码交互
  → 本地 PDFium / pdf2docx / 可选 OCR
  → 校验并写入 DOCX
  → Friday 打开新文档
~~~

这条路线已经具备部分文件保护机制，所以有必要保留并抽取为共用执行器。它没有自动进入 PDF AI 工具目录，仅有菜单事件无法让模型知道如何执行。

### 3.2 在 PDF AI 面板要求生成 Word

~~~text
自然语言
  → Friday 模型桥接
  → vendor PDF AgentLoop
  → 模型选择 create_document
  → executePdfTool
  → PdfAiDeps.createDocument
  → window.pdfApi.createDocument
  → pdf:create-document
  → runtime.createDocument
  → Friday 未注入回调，返回失败
~~~

模型即使正确选择了 create_document，也无法越过最后的宿主实现缺口。重复请求、换模型或修改提示词不会补出主进程的业务函数。

### 3.3 在主助手要求导出 Office 文件

主助手的 office_create、office_export 经中央工具注册表、权限逻辑和内置 CLI 执行。CLI 自己有转换路线和部分 headless app 依赖。这与 PDF 面板依赖的 renderer 工具并非同一条业务执行链。

例如 CLI 有 pdf→xlsx 路线，只能证明其源码定义了该路由，不能证明 Friday 菜单宿主已经配置了对应入口、安装包已经包含其全部资源，或当前 PDF 中未保存的编辑已被同步。以后必须让入口按资源状态选择适配器，不能只因一个格式出现在 CLI 帮助文字中，就宣布所有入口都支持。

### 3.4 三类请求必须分开

| 用户说法 | 实际业务语义 | 正确执行方式 |
|---|---|---|
| 把这份 PDF 转成 Word | 以原 PDF 为输入的格式转换 | convert，优先复用本地转换器 |
| 把这份 PDF 的要点整理成 Word | 理解内容并生成新文档 | read → 模型整理 → create |
| 把转换后的 Word 再润色 | 对已生成资源继续编辑 | convert → verified artifact → edit |

“转换”不要求模型逐字重写源文档。对普通格式转换优先不调用模型，可减少成本、避免截断和内容臆造；扫描识别和版面恢复另有技术边界。

## 4 为什么有 AI Core 仍会受限

AI Core 的存在不代表每个业务能力已经接入。当前 facade 源码明确说明其负责合同、能力投影和计划，通过 executor 绑定现有 Runtime；Office bridge 则主要统一模型请求和工具流。这些是有效基础，但不能替代业务实现和宿主协议。

完整能力至少包含六个部分：

1. 能力描述：参数、适用文档、输出类型、风险、可用条件。
2. 资源上下文：哪份文档、哪个编辑器实例、哪次修订、哪些路径已授权。
3. 策略执行：当前主体能否调用、是否需要审批、是否允许覆盖或上传。
4. 业务实现：转换器、编辑器命令、序列化器、CLI 或本地 helper。
5. 生命周期：准备、执行、取消、失败、提交、关闭与恢复。
6. 交付证据：文件实际存在、内容可读取、来源匹配、打开状态明确。

如果只统一第一部分或模型 transport，后面任意一个缺口都能导致用户看到限制。系统性方案需要以这六部分作为接入定义，而不是继续增加“你可以调用某工具”的提示词。

## 5 根因分层与缺陷清单

### 5.1 第一层是创建回调漏接

PDF Runtime 将跨应用创建作为可选函数。独立 PDF、上游 Shell 和 Friday 三种宿主的配置不同。Friday 接管了窗口、模型和路由，却没有补齐所有被编辑器工具依赖的回调，也没有在启动时检测“工具对外声明支持，但宿主缺实现”。

若只把上游 createAiDocument 直接传入，仍有两个问题：PDF 冷启动没有加载 Docs；Docs 未设置 Friday 标签页 hook 时会回退到独立窗口。需要把依赖加载、标签页托管和保存确认作为同一操作协调。

### 5.2 第二层是缺少转换语义

PDF AI 工具有 create_document，但没有“转换当前 PDF”工具。不能仅靠更改工具说明让模型把创建当转换。应提供有明确输入资源和目标格式的文档转换能力，再由 PDF 面板生成符合上下文的工具投影。

工具按业务族划分即可，不需要每个按钮一个工具。也不能反向走向允许任意 IPC 名称和任意参数的万能工具，那会失去 schema、权限和可测试边界。

### 5.3 第三层是能力目录漂移

create_document 工具 schema 声明 pdf、docx、md、html，PDF 主进程 parser 只接受前三种。转换菜单展示三种输出，Friday handler 只接 docx。这些静态差异足以说明可用性目前并非单一事实源。

能力目录必须描述“该宿主当前可执行的操作”，同时保留禁用原因。模型 schema、菜单状态、诊断页和测试应从同一声明推导。每次实际执行仍要重新校验，不能把先前查询结果当永久授权。

### 5.4 第四层是结果完成语义缺失

上游 DOCX createAiDocument 返回成功的时间点是排队创建标签页，晚于该返回值的 HTML 导入、DOCX 序列化和磁盘保存仍可能失败。renderer 又忽略保存布尔结果，造成宿主无法据此判断真实交付。

正确完成条件需要由保存流水线确认，主进程独立校验文件，再返回可追踪 artifact。打开失败应与生成失败区分；文件已提交时，不能要求用户重新转换而覆盖已有结果。

### 5.5 第五层是生命周期和文件保护不完整

在当前 exportPdfToDocx 中，targetPath 定义于 try 内，finally 的备份恢复路径却引用它，错误恢复分支存在作用域风险。该风险来自源码审查，本轮未注入备份恢复故障实测。应在统一 artifact writer 中解决，不能仅移动变量后继续复制整段写盘代码。

另有打开新文档后未检查 success 字段、PDF 按钮不检查 ok 字段、全局 busy 锁限制粒度过粗等问题。它们不能由模型工具解析修复，应在任务协调和结果合同中处理。

### 5.6 优先级与处理位置

| 问题 | 影响 | 优先级 | 正确处理层 |
|---|---|---|---|
| createDocument 漏注入 | 当前创建 DOCX 必失败 | P0 | 宿主能力适配 |
| 无 PDF 转换工具投影 | AI 不能调用现有转换路线 | P0 | 能力目录与工具投影 |
| 保存前返回成功 | 用户得到假成功 | P0 | 任务与 artifact 完成语义 |
| 菜单和 schema 漂移 | 支持声明误导 | P0 | 目录完整性与契约测试 |
| 备份恢复作用域 | 写失败后恢复风险 | P0 | 共用文件提交模块 |
| 源文档切换及修订竞态 | 转错文档或丢未保存编辑 | P0 | 资源快照与并发控制 |
| OCR/helper 缺失 | 扫描 PDF 可编辑性退化 | P0 识别与告知 | 运行时探测与质量元数据 |
| CLI 描述过宽 | 模型误选不支持路线 | P1，触及 PDF 路线需 P0 校正 | 目录与 legacy 兼容适配 |
| 六应用全部能力迁移 | 长期一致性 | 后续分阶段 | 产品能力治理 |

## 6 实验与反证

### 6.1 已执行的最小复现实验

命令为 node scripts/probe-office-pdf-ai-delivery.mjs。脚本使用临时 userData 和数据库，创建简单 PDF，仅加载 PDF 编辑器，等待 preload 就绪后调用 createDocument。运行报告记录 checkedAt 为 2026-11-05T14:27:12.085Z，换算北京时间为 2026 年 11 月 5 日 22:27:12。

断言 result.ok 为 true，实际为 false，退出码为 1。这是预期的缺陷红测试，不应作为修复通过记录。脚本目前只证明创建路径断裂；未来必须追加内容、输出文件、源 PDF 和窗口归属断言，不能将其简单变绿当成全部验收。

### 6.2 可证伪假设及结论

| 假设 | 预测 | 本轮证据 | 结论 |
|---|---|---|---|
| 模型不支持创建工具 | 未到主进程，或不能得到宿主原样错误 | 直接穿过 preload 返回宿主错误 | 不是此错误的必要原因 |
| PDF 宿主缺少创建回调 | 合法请求进入 handler 后返回 unavailable | E02、E03、E04 一致 | 已确认 |
| 补回调就能完整交付 | 任意冷启动都得到已保存 DOCX | E11、E12 显示保存未被等待 | 不足以证明完整修复 |
| 按钮已支持所以 AI 自然支持 | 工具目录包含同一转换执行能力 | E05 与 E06 是不同调用链 | 已否定 |
| 只要升级 GenOffice 即可 | Friday 宿主无需适配即可获全部能力 | 两种 Shell 注入和生命周期明显不同 | 无证据支持 |

### 6.3 实施前后必须追加的实验

| 实验 | 要验证的问题 | 通过条件 |
|---|---|---|
| PDF 按钮与 AI 对照 | 是否共享业务操作 | 同一样本命中相同 operation 与 converter；不要求 DOCX 二进制完全相同 |
| PDF-only 冷启动 | 跨编辑器依赖是否正确加载 | 无独立 GenOffice 窗口，结果进入 Friday 标签 |
| 保存写失败 | 是否仍提前报成功 | 返回失败，旧目标文件保持或可恢复 |
| 创建导入失败 | 是否产生空白假交付 | 无可解析节点时不发布 artifact |
| 取消与重复调用 | 是否产生重复副作用 | 一次实际提交；取消前无最终文件 |
| 提交后打开失败 | 是否保留可用结果 | artifact 可定位，提示已生成但打开失败 |
| 扫描页且无 OCR | 能否识别质量退化 | 明确图片页与非完整可编辑状态 |
| 打包运行 | 是否存在开发机依赖 | 无源码目录的安装环境同样通过 |

## 7 如何避免逐按钮补丁

### 7.1 操作族与入口的关系

一百个按钮未必需要一百个工具。保存、另存、快捷键保存和 AI 保存都可以映射到同一个 save 操作；转 Word、转 Excel 和转 PPT 是 convert 的不同受支持路线。真正的业务语义不同，则仍需不同能力或不同 adapter，不能承诺所有需求都由一个万能函数自动完成。

建议先形成 read、edit、create、convert、save、export、navigate 七个操作族。read/edit 的编辑器内部实现可以保留，跨应用创建、转换和持久化先统一。操作名稳定，输入输出与 side effects 显式声明，模型只得到当前上下文可用的有限投影。

### 7.2 新功能接入的标准动作

以后增加一个新的转换目标，流程应为：实现格式 adapter → 注册路由与运行时条件 → 补上契约和样本测试 → 自动进入菜单与 AI 格式枚举 → 通过发布能力门禁。模型不需要新增一段专用提示词，按钮也不需要复制文件保存流程。

但新格式转换算法、复杂排版修复、特定编辑器命令仍然需要业务开发。这套架构解决的是接入重复和执行不一致，不会让不存在的转换算法凭空出现。

### 7.3 不能把所有按钮一律暴露

只读查看、纯 UI 布局、需要真实选区的编辑、会覆盖原件的操作、外部上传和批量删除，风险与前置条件不同。能力目录应记录支持、暂不可用和不对 AI 暴露三种原因，而非只做“已接或未接”二元列表。AI 可通过高层业务命令完成需求，不要求它模仿所有界面点击。

### 7.4 工具数量与上下文成本

不应把所有编辑器的所有工具塞进每轮模型请求。先按工作区、资源类型、授权和意图投影，再提供稳定的少量操作族；必要时分两步发现能力和调用操作。投影不能省略所需参数或把不支持格式留给模型猜。

## 8 方案比较与建议

| 方案 | 工作量特征 | 短期收益 | 长期问题 | 判断 |
|---|---|---|---|---|
| A 只补 createDocument 回调 | 小 | 当前错误可能消失 | 转换语义、提前成功、能力漂移未解决 | 不作为交付方案 |
| B 每个按钮增加一个工具 | 随入口数增长 | 局部快速可用 | 多份校验、权限与结果，持续补丁 | 不推荐 |
| C 允许模型任意 IPC 或执行脚本 | 表面接入少 | 可绕过部分工具缺口 | 缺少可控边界、回归和审计，错误范围大 | 不推荐 |
| D 全应用一次性重写 | 高且难估算 | 理论统一 | 长期不能发布，编辑器回归与上游冲突大 | 不作为当前小版前置 |
| E 复用 Core 加 Office 能力层并逐类迁移 | 中等，先完成垂直闭环 | 当次修复沉淀共用基础 | 过渡期需要明确兼容与遗留清单 | 推荐 |

推荐 E。新层应是现有 Core 注册与任务执行的 Office 领域实现，不是再造第二套全局注册表。按钮适配器与 AI 工具适配器在入口不同，进入领域操作后使用相同校验、资源快照、转换器、提交与回读。

不要求把字体加粗、段落选择等所有编辑操作先搬到主进程；这会增加编辑器往返和状态同步风险。局部编辑器命令仍在 renderer 内执行，由主进程验证资源身份并通过受控 adapter 调度。

## 9 PDF 转换本身的技术边界

### 9.1 数字文本 PDF

目标是保留阅读顺序、段落和基本表格，使正文可编辑。PDF 的显示布局不等于 Word 的流式结构，不能承诺像素级还原且所有元素同时可编辑。验收需分别量化文本正确性、结构和版面，不能以截图相似度替代文本可编辑性。

### 9.2 扫描与混合 PDF

当前本地流水线可选用系统 OCR。helper 缺失时，扫描页可能退化为整页图片。产生合法 DOCX 不等于完成了可编辑文字识别。新结果应明确 editable、mixed、imageOnly 等质量状态及受影响页码；是否引入额外 OCR 引擎应单独评估体积、许可证、语言包和离线性，不能无告知上传云端。

### 9.3 密码与权限

密码错误可请求重试，用户取消应结束任务。不得将密码写入会话、日志、CLI 命令行或文档元数据。加密只读、复制限制和源文件保护需要明确政策：允许哪些有授权的导出，哪些应拒绝。不能用 AI 绕过原有保护。

### 9.4 大文件和 UI 响应

当前转换实现从主进程调用本地转换器。应测量 CPU、内存与事件循环延迟，判断是否移入受控 worker 或 utility process。同步计算不能因外层使用 async 就被视为后台线程。取消也必须被转换器实际响应，只有隐藏进度条不算取消。

## 10 能力覆盖盘点与后续迁移

此表是已核对链路的样本盘点，不是全应用按钮数量统计。全量盘点作为技术方案 W01 交付，必须从源码枚举入口并分类。

| 操作 | 按钮侧 | Office 内 AI | 主助手 | 本轮策略 |
|---|---|---|---|---|
| PDF→DOCX | 已接专有流程，结果处理不足 | 无转换专用工具 | CLI 有路线，需上下文适配 | P0 同源闭环 |
| PDF→XLSX | 菜单可见，Friday handler 拒绝 | 无该工具 | CLI 定义路线，未做安装验证 | 本版不开放，显示真实原因 |
| PDF→PPTX | 同上 | 无该工具 | CLI 定义路线，未做安装验证 | 本版不开放，列后续迁移 |
| 根据内容创建 DOCX | 有新建入口，语义不同 | PDF 回调缺失 | CLI create 路线 | P0 修复已宣称支持的创建合同 |
| PDF AI 创建 HTML | schema 有，parser 拒绝 | 声明与执行矛盾 | 另有路线 | P0 去除当前虚假声明；完整接入归总体项目 |
| 保存与快照导出 | 已有 file-commands | 各编辑器工具不同 | CLI 写锁约束 | 复用基础，不扩成全格式重写 |
| 文档细粒度编辑 | 各自 renderer | 有编辑器工具 | CLI 编辑拒写正在打开文件 | 保留语义与并发边界 |
| Markdown 与 HTML 完整应用 | 原总体项目要求 | vendor 存在不等于 Friday 已接通 | 未完成整体对等验收 | 保留原需求，独立阶段执行 |

禁用 Excel/PPT 不是取消用户后续需求，而是小版不再宣传不存在的宿主能力。原总体文档中 Markdown/HTML 与固定 GenOffice 目标对等的范围保持原合同，不在本次专项中暗中缩减。

## 11 实施原则与发布判断

本次小版本应交付统一文档能力合同、PDF→DOCX 同源入口、创建 DOCX 真实交付、动态能力投影、错误与取消闭环及安装验证。没有这些，仅消除错误字符串不算完成。

后续按操作族迁移其余转换和创建，再推进编辑器命令覆盖。每次迁移必须产出能力矩阵变化和对应测试，旧兼容入口转发到新执行器，不保留两套并行文件写入。兼容期结束后删除旧逻辑，以免“统一层”只成为额外包装。

建议以门禁代替单纯日程：G1 证据与合同一致；G2 单一路径和冷启动通过；G3 失败/取消/竞态通过；G4 内容与质量样本通过；G5 安装产物通过。只有 G1 至 G5 均有证据才能说明问题已在该候选版本解决。

## 12 未决问题与研究补充

1. 用户正在运行的安装版本、Office 资源摘要、模型配置与当前源码是否一致，尚未取证。需在安装版诊断信息中核对，不能由目录名推断。
2. 目前 probe 为合成文本 PDF；用户原文件的结构、加密、扫描页和字体问题尚未重放。不能把接入修复等同于对任意 PDF 的质量承诺。
3. OCR helper 的开发、构建和安装路径是否一致，需要安装验证。候选源码路径不能直接当成打包后可用路径。
4. 首期持久化任务记录应复用现有数据库事实源；现有 TaskRuntime 状态是否足够承载长文件操作，需要设计验证，不能再建第三套任务库。
5. 主助手对离线文件与 Office 对已打开文件的权限策略不同，需要明确资源授权来源，再实施入口收敛。
6. worker 对 PDFium、OCR 子进程、打包资源和取消的影响，应以原型实验决策。没有测量前不承诺“完全不会卡顿”。

这些事项在技术拆解中有对应任务与验收，并不阻止先确定能力合同和研究方案。

## 13 研究资料与复核方法

主要资料为本报告 E01 至 E20 的固定本地源码与运行报告。原三份总体文档固定目标为 genspark-ai/genoffice 的 v0.12.600。补充官方发布信息来自 `https://github.com/genspark-ai/genoffice/releases/latest`，2026-11-05 查询跳转到 `https://github.com/genspark-ai/genoffice/releases/tag/v0.12.852`；并使用 `git ls-remote https://github.com/genspark-ai/genoffice.git refs/tags/v0.12.852` 核对引用。发布页属于外部一手元数据，不是 Friday 安装版运行证据。查询摘要保存在 `artifacts/office-ai-capability-docs/upstream-release-observation.json`。

复核顺序：核对主仓库与 vendor SHA → 运行最小 probe → 在 configureRuntimes 与 PDF create handler 对照宿主回调 → 分别追踪 convertOffice 和 create_document → 审查 Docs 保存完成时序 → 对照 registry、Office CLI 和 file-commands。后续实施须以本报告红测试和 PRD 验收矩阵补齐正向、负向及安装版证据。

本报告的最终判断：需要修复的是一套能力接入与交付机制，而不只是一个按钮对应的函数。PDF 转 Word 是首个验证场景；是否从根上改善，应由后续新增转换路线能否通过注册、适配与标准测试自动进入各入口来检验。

## 14 后续持续跟进 GenOffice 的研究与约束

本节补充用户提出的维护目标：后续 Office 要持续把 GenOffice 的新部分融合进 Friday。因此本次架构不能只优化当前代码，还要降低上游合并、资源重建与新应用接入的成本。

### 14.1 本地来源关系核对

2026 年 11 月 5 日本地核对：主仓库 .gitmodules 指向 yingchao4399/happyoffice；vendor 的 fork remote 指向同一 fork，origin 指向 cheney-plus/happyoffice。这些远端配置不等于已经建立 genspark-ai/genoffice 官方版本到 Friday 的完整溯源，也不能由 remote 名称推断某分支就是最新官方代码。

当前 vendor SHA 与 describe 是已核对事实；官方目标与各 fork 的共同祖先、额外改动和许可证变化仍需在下一次上游升级前核验。升级应先固定官方 tag/SHA，再记录中间来源与 Friday 定制提交。不能直接拉取任一 origin/main 后就声称跟上了官方最新版。

### 14.2 本次修复如何避免增加升级负担

| 选择 | 维护影响 | 本次采用原则 |
|---|---|---|
| 在每个上游 App 中塞入 Friday 权限、任务与保存逻辑 | 新版反复冲突，难以判断哪些逻辑应保留 | 避免，宿主业务治理放主仓库 |
| 完全禁止修改 vendor | 当前可靠完成确认可能无法实现 | 不绝对追求零修改 |
| 少量通用 hooks/ack 留在 vendor，业务放宿主 adapter | 上游变化主要集中于接口适配 | 推荐 |
| 手改 resources/office | 源码不可复现，升级重建即丢失 | 禁止 |
| 上游新增工具自动对 AI 全开放 | 支持、权限与产物尚未验收 | 禁止，经过能力目录与发布门禁 |
| 每次固定版本、全量重建并跑旧能力回归 | 成本可见，结果可追溯 | 必须 |

通用接口修改应以小而独立的提交记录，注明依赖的 upstream API、专项测试与可删除条件。上游提供等价能力后，应删除自有重复实现，而不是永久叠加补丁。适合通用使用的 hook 可以向上游贡献，是否被接收不作为当前修复的前置。

### 14.3 新模块接入不等于新增格式枚举

本地 build-office.mjs 的 EDITORS 目前仅 docs、sheets、slides、pdf。这是构建与应用注册层面的边界。Markdown 与 HTML 若要与 GenOffice 保持完整功能一致，需要核对入口、生命周期、文件格式、编辑器、AI 工具、主题语言、资源、文件关联及安装行为。

未来应由受控 editor manifest 驱动构建和宿主 adapter 注册，减少四种编辑器散落硬编码。本版先确立扩展点与测试基础，不能以“AI 能生成 .md/.html 文件”替代两个完整应用对等验收。

### 14.4 建议升级流程

固定官方版本与来源 → 比较协议/IPC/内容节点/依赖/资源 → 清点 Friday 专有差异 → 更新薄 adapter → 干净重建 → 既有能力负向与正向回归 → 新模块对等验收 → 安装升级与回滚验证。

升级产物清单应绑定主仓库 SHA、vendor SHA、adapter/protocol 版本、资源摘要和安装包摘要。出现缺少必需 hook 或主/renderer 混版时，在 CI 或启动阶段发现，不等用户调用后才得到笼统的 host unavailable。

这套机制可以降低持续融合成本，但不承诺“以后上游更新一键自动无冲突”。大版本可能改变编辑器模型、转换算法和 native 依赖，仍需人工评估。技术拆解第 13 节与 PRD 的 UPD01–UPD12 给出具体落地合同。

### 14.5 v0.12.852 对当前问题的意义

官方 v0.12.852 发布说明列出 PDF 转 Word 支持重复页眉和连续页码、改进 DOCX 兼容性；同时提到 agent 工具权限处理及自定义 OpenAI 兼容模型的上下文窗口处理。这些是上游声明的改进，尚未在 Friday 中复现其效果，也不能据此断言 Friday 缺失的 createDocument 回调已经解决。

下一次升级研究应将这几项列入专项差异和样本回归：先定位对应提交及受影响的转换/工具接口，再以页眉、分页、脚注、复杂表格等 PDF 样本对比当前与候选实现。格式算法尽量接受经过验证的上游实现；Friday 仍负责接入、授权、资源身份与真实交付。不要在未比较候选实现前重复开发同类格式算法，也不要以升级算法替代宿主链路修复。
