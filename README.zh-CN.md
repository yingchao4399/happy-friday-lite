# Happy Friday Lite

## 3.0.6.02-preview.20 AI Core 任务控制与全局助手

- 技术版本：`3.0.6-preview.20`；发布标签：`3.0.6.02-preview.20`。
- 增加 AI Core 任务的检查点暂停、继续和取消控制，笔记写入 Word 流程复用原有 Friday 确认弹窗。
- 增加根级 Friday 全局助手 Dock，跨路由查看 AI Core 任务，并复用同一个任务运行时处理审批、暂停、继续和取消。
- 下方保留 Preview.19 安装包和校验链接作为历史发布证据。已通过 `npm run electron:build:win` 生成本地未签名 Preview.20 x64 安装包；校验和与构建元数据位于 `release/SHA256SUMS-preview.20.txt` 和 `release/preview.20-build-info.txt`，尚未上传或签名。
- 设计文档：[迭代方案](docs/ai-core-next-iteration-plan.md)、[Preview.20 PRD](docs/Friday-AI-Core-Global-Assistant-Preview20-PRD.md) 与 [技术设计](docs/Friday-AI-Core-Global-Assistant-Preview20-Technical-Design.md)。

## 3.0.6.02-preview.19 AI Core 运行时与对话连续性

- 补齐 AI Core 任务运行时：真实就绪检查、能力计划、审批、取消、回读验证、幂等和安全撤销。
- Office AI 推理统一经过敏感能力入口，并保留请求/线程上下文、流式回调和取消信号。
- Friday 各 AI 对话及 Docs、Sheets、Slides、PDF、Markdown、HTML 面板新增各自的历史入口；历史记录从项目存储读取并可恢复。
- AI 创建的 Office 文件按生成标题或正文内容自动命名，覆盖 Docs、Sheets、Slides、PDF、Markdown、HTML。
- 增加笔记到 Word 的可验证任务流程，包含来源关联、回读验证与带条件撤销。
- 技术版本为 `3.0.6-preview.19`，发布标签为 `3.0.6.02-preview.19`。

## 3.0.6.01-preview.18 AI Core 首版基础

- 新增 Friday AI Core v1 合同：actor、space、session、thread、task、request、resource 和 capability。
- 新增结构化 plan/execute 入口基础，计划与 Runtime 解耦，任务状态禁止跳过验证直接完成。
- 新增可重复的 DeepSeek 连通性检查脚本：`node scripts/check-deepseek-connection.mjs`。
- 发布标签使用 `3.0.6.01-preview.18`，不占用官方 `3.0.7` 版本线。npm/Electron 内部使用合法技术版本 `3.0.6-preview.18`，Windows 安装包保留要求的发布标签。

## Preview 17：终端颜色、设置入口与引用导航修复

修正 xterm 亮色映射与透明背景的对比度计算，恢复终端墨色和字体设置；统一命令面板、插件和快捷键页面的 Settings 字体与布局，新增三个正式设置入口，移除侧栏重复按钮。Office 命令接入真实菜单通道；笔记首页、独立编辑页和打字机支持引用导航，双链面板提供使用说明。

根因、实际验证及限制见 [Preview 17 修复报告](docs/typewriter/07-preview17-root-cause-report.md)。

Windows x64 安装包：[3.0.6.02-preview.19](https://github.com/yingchao4399/happy-friday-lite/releases/download/3.0.6.02-preview.19/Happy-Friday-Lite-3.0.6.02-preview.19-win-x64-setup.exe)；SHA256：[Preview.19 校验文件](https://github.com/yingchao4399/happy-friday-lite/releases/download/3.0.6.02-preview.19/SHA256SUMS-preview.19.txt)。Electron 内部使用合法技术版本 `3.0.6-preview.19`。

## Preview 16：命令、插件与 Obsidian 兼容工作区

本轮按四批迭代，Windows x64 安装包依次为 `3.0.6-preview.13`、`.14`、`.15`、`.16`。最新包包含前面各批变更，原有 Office 改动保留。

- **Preview 13**：Nocturne 统一墨色、本地字体（包括更纱等宽中文）、有向出链/反向链接、WikiLink、同 noteId 的 revision 保存检查。
- **Preview 14**：常驻命令按钮、分类搜索浮窗、中英文和拼音搜索、最近命令；快捷键录制、冲突处理、导入导出。命令面板 `Ctrl+Shift+P`，Press `Ctrl+Alt+P`。Office 原生视图支持浮层与焦点恢复。
- **Preview 15**：插件管理、分类市场、本地 ZIP、独立 sandbox 宿主、启停/配置/卸载和更新回滚。真实写作示例接入笔记；智能体工具保留审批，Office 插件使用实际宿主接口。
- **Preview 16**：官方 Obsidian 社区目录及发行包下载、官方示例原包运行、受控 Vault/MetadataCache/Workspace/Editor 子集，以及可选 CodeMirror 6 Markdown 编辑窗口。未支持的 Node/私有接口明确报错，兼容状态按版本记录。

使用兼容编辑器：安装并启用 Obsidian 插件 → 打开笔记或打字机中的笔记 → 命令面板搜索“Markdown 兼容编辑器”。它与笔记使用同一 ID；表格、图表、媒体和格式节点以保护标记保留。删除保护标记会拒绝保存，并保留恢复草稿。

当前验证了官方示例 `1.0.0` 的生命周期、命令、弹窗和设置，以及社区 **Sort and Permute Lines 0.9.0** 在 CM6 模式下的字母排序。社区目录可下载不等于全部插件/API 已兼容；原版打字机仍使用自己的输入与拟真层。macOS/Linux 尚未运行验收。

详细范围和测试结果见 [四批迭代交付报告](docs/typewriter/06-preview13-16-delivery.md)。

## Preview 13：打字机字体、墨色与笔记双链

新增统一纸面墨色、本地 JetBrains Mono/Fira Code/更纱等宽中文字体、应用内字体导入和下载、有向出链/反向链接、WikiLink 补全，以及笔记保存版本检查。继续复用 Nocturne 原版外壳与拟真反馈。

[English](README.md)

一个基于 Electron + Vue 3 的桌面端个人知识智能助手。集成 AI Agent、RAG 知识检索、富文本笔记、日程日历于一体，所有数据本地存储，隐私优先。

## 3.0.6-preview.12 原版 Typewriter Nocturne 外壳适配

- 新增 `/typewriter`，固定复用官方提交 `e19d64ef42b9241b462439e22d7b905b266633e1` 的 3D 机身、纸张材质、灯光、声音、墨迹、游标、Press、Archive、Studio 和回形针滚动条。
- 笔记和终端是两个独立内容插件：笔记按同一 ID 自动保存回笔记模块，终端使用真实 PowerShell/Bash/Zsh PTY。
- 支持中英文设置、Markdown/代码导入笔记、Archive PNG 导出、终端退出重启，以及保存失败时的本地草稿恢复。

## 3.0.6-preview.11 页眉页脚与笔记图片交互修复

- 页眉页脚在每张纸的独立坐标层编辑，双击上下页边距区域进入，点击 Ribbon 或菜单保持编辑，双击正文或关闭按钮退出。
- 页脚距底支持完整小数输入；分节文档的位置设置始终作用于当前编辑页所在的节，首页及奇偶页分别保存。
- 页眉、页脚、页码、日期、时间、字段、横线及导航提供对应菜单；横线支持颜色、粗细和文字间距。
- 页眉和页脚菜单各提供 8 个预览模板（空白、三栏、标题、横线、色带、标题日期、页码、总页数）；页码提供顶端、底端、当前位置及普通/总页数/短横线/强调数字样式。
- 日期时间支持 8 种格式、语言选择及 Word 可更新域；文档信息可插入作者、文件名、路径、标题、主题、关键词及备注。未设置的属性可填写显示内容。
- 可保存、恢复或删除本机页眉页脚模板；存储不可用时提示失败。模板替换/删除清理原部件中的图片表格；普通文字编辑继续保留它们。日期、文件名等域在保存重开后保留域指令。
- 保留手动缩放比例，自动适应宽度和整页模式继续随窗口调整。
- 笔记图片使用独立 NodeView，可在正文内选中后拖动四角手柄缩放，尺寸保存后保留，双击打开图片编辑器。
- 图表改用按需加载的 Apache ECharts：横向条形、柱状、折线、面积、饼、真实 X/Y 散点、直方、累计瀑布、漏斗、雷达、组合、分组柱、箱线、小提琴、误差线、茎叶和三线表均按各自语义绘制；编辑器复用 Friday 弹窗与按钮，保留系列、X、样本和误差数据，支持实时预览、校验、对齐、图例、坐标轴、拖动缩放及保存重开。
- 视频和音频 NodeView 提供正文内控件、弹窗预览、打开原文件和打开所在位置；路径对 Windows/UNC、空格、特殊字符可往返，失败会显示原因。
- 本轮开发验收：`docs-header-footer.json`、`note-image-resize.json`、`note-chart.json`、`note-media.json`；全量脚本测试 138/138 通过，前端构建和 Office 类型检查通过。

## 3.0.6-preview.10 笔记资源、图表与逐页页眉页脚增强

- 页眉和页脚改为逐页可命中的编辑区：所有页（包括中间页）双击后进入编辑，显示对应“页眉/页脚”标识和虚线边界，并自动切换官方“页眉和页脚”选项卡；移除了悬浮时误显示的“首页不同”提示。
- 笔记图片支持在正文内直接拖动右下角调整大小，默认保持比例，Shift 可自由调整；保留自适应页面、原始尺寸和完整图片编辑器。
- 图表编辑改为数据表优先，可直接增删行、修改标签/数值/误差、切换坐标轴和数据标签显示，并支持拖动右下角调整图表尺寸。
- 笔记附件预览入口统一：PDF、Markdown、文本和数据库文件使用预览窗口，Word、Excel、PPT 交给内置 Office 编辑器打开阅读，所有媒体和附件仍可打开原文件及所在位置。

## 3.0.6-preview.9 笔记资源编辑增强

- 笔记中的图片支持独立预览编辑：缩放、拖动查看、裁剪、旋转、画笔、马赛克、文本框和尺寸调整，修改后以受控资源保存。
- 视频、音频和附件支持统一预览、打开文件和打开所在位置；附件点击不再只触发浏览器下载。
- 笔记插入图表节点，支持条形图、柱状图、折线图、面积图、饼图、散点图、直方图、瀑布图、漏斗图、雷达图、组合图和三线表，并可双击调整类型、颜色、尺寸和数据。
- 笔记引用建立双向链接并显示反向链接入口，链接关系写入现有资源链接表，可由 AI 读取笔记中的结构化资源节点。

## 3.0.6-preview.8 官方融合与笔记/页眉页脚增强

- 完整融合官方 3.0.6 的 Tab 会话隔离、流式输出隔离、非受控输入、流式渲染、侧边栏性能、Office bundle 和 HarfBuzz 修复。
- 笔记插入菜单新增本地图片、视频、音频、文件附件、笔记和知识库内容；支持拖拽、剪贴板粘贴及链接点击打开。
- Word 双击页眉或页脚可进入编辑，并提供页码、日期、时间、文件名、横线、首页不同、奇偶页不同和距离调整。

## 3.0.6-preview.7 性能修复

- 数据库改用 Electron 内置的磁盘 SQLite，移除 WASM 整库常驻与反复全量导出。兼容旧 SQLite 文件，备份改为在线一致快照。
- 能力审计先生成有界摘要再序列化，界面调用不记录正文，历史超大审计记录限制读取大小；真实工具结果和权限检查保留。
- 剪贴板恢复 Windows 原生跨应用复制/剪切监听，支持文字、富文本、图片和文件；应用内复制/剪切与原生监听共用去重。只写入变化条目，为未自行处理的编辑区域补齐系统右键菜单。监听失败会显示原因并降级采集文本和图片。
- 隐藏 Office 视图恢复 Chromium 后台限流；已有空数据库会停止初始化并显示恢复提示。
- Office 附件解析移到共用的按需加载模块，普通 Word/Excel/PPT 首开不再同步加载旧 Office 字符映射和 PDF 附件引擎。Word AI 面板异步装载，布局宽度、会话和草稿保持原有行为。
- 整套应用进程内存对照方法、结果及验收范围见[性能报告](docs/Memory-performance-2026-10-24.md)。

## ✨ 核心功能

### 📑 Office

- 内置 Office 办公套件：AI 文档、AI 表格、AI 演示、AI PDF
- 富文本文档编辑：标题、列表、链接、表格、图片、公式等
- Friday 侧边栏辅助写作：润色、翻译、扩写，一键生成幻灯片
- 支持新建文件或打开本地 `.docx` / `.xlsx` / `.csv` / `.pptx` / `.pdf` 文件
- 最近文件列表，支持按类型（文档 / 表格 / 演示 / PDF）筛选

### 🤖 Friday 智能助手

- 基于 [DeepAgent SDK](https://github.com/frost-beta/deepagents) + LangChain 构建的智能体
- 内置 12+ 工具：知识库检索、笔记/日程操作、文件读写、Shell 执行、Python REPL、HTTP 请求、网页抓取、JSON 处理、计算器等
- 支持 Human-in-the-Loop（HITL）：敏感操作需用户确认
- 支持 SKILL 技能系统：从 `SKILL/` 目录加载 Markdown 技能描述
- 支持子 Agent（subagents）与跨会话记忆（SQLite + InMemoryStore）

### 📚 知识库

- 个人知识库 / 本地知识库 / Agent 知识库三类
- RAG 全流程：文档加载 -> 分块（父子分块策略）-> 向量化 -> 向量检索
- 基于 [Zvec](https://github.com/zvec/zvec) 向量数据库，多知识库向量统一存储、按 `kb_type` 区分
- 文件监听 + 定时增量索引，支持手动触发更新
- 支持多格式文档：PDF、Word、Excel、Markdown、HTML、EPUB、纯文本

### 📝 笔记

- 基于 [TipTap](https://tiptap.dev/) 的富文本编辑器
- 支持代码块（语法高亮）、表格、任务列表、图片、链接等
- AI FIM（Fill-in-the-Middle）补全
- 版本历史与差异对比

### ✏️ 绘图

- 内置多类型图形库：通用图形、线条、思维导图、流程图、ER 图、UML 图、系统架构图、时序图、时间线、数据流图等
- 思维导图、流程图等模板一键插入，支持画布分类管理、搜索与导入
- 样式自定义（填充、文字、线宽、字体），连线支持正交、折线、曲线等路由方式
- 支持图形动画效果：脉冲、呼吸、弹跳、流动
- 导出 PNG / SVG / JSON，支持生成只读分享链接

### 📅 日程

- 自研日历组件，支持月 / 周 / 年 / 列表多视图切换
- 农历显示支持
- Friday 助手可自然语言创建/修改日程

### 🎨 其他特性

- 主题：浅色 / 深色 / 跟随系统
- 国际化：简体中文 / English
- 数据自动备份
- 多标签页界面

## 🖼️ 截图

### Friday 智能助手

![Friday 智能助手首页](docs/resource/PixPin_2026-08-15_16-51-10.png)

![Friday 对话与代码执行](docs/resource/PixPin_2026-09-22_23-43-29.png)


### Office

![Office 首页（AI 文档 / 表格 / 演示 / PDF 入口）](docs/resource/PixPin_2026-09-22_23-11-03.png)

![AI 文档编辑](docs/resource/PixPin_2026-09-22_23-13-35.png)

![AI 演示编辑](docs/resource/PixPin_2026-09-22_23-14-07.png)

![AI 表格编辑](docs/resource/PixPin_2026-09-22_23-15-21.png)


### 知识库

![知识库文件卡片](docs/resource/4.png)

### 笔记

![笔记富文本编辑](docs/resource/PixPin_2026-09-22_23-45-35.png)

### 绘图

![绘图画布](docs/resource/PixPin_2026-09-13_20-39-53.png)

### 日程

![日程日历](docs/resource/5.png)

### 自动化任务

![自动化任务](docs/resource/6.png)

### DeepSeek Harness

![DeepSeek Harness](docs/resource/7.png)

### 设置

![设置与功能介绍](docs/resource/8.png)

## 🚀 快速开始

### 环境要求

- Node.js >= 20（推荐 22）
- npm >= 10
- macOS / Windows / Linux

### 安装依赖

```bash
npm install --legacy-peer-deps
```

### 开发模式运行

```bash
# 仅前端
npm run dev

# Electron + 前端（自动启动 Electron）
npm run electron:dev
```

### 构建发布包

```bash
# 构建当前平台安装包
npm run electron:build

# 构建 arm64
npm run electron:build:arm64
```

构建产物输出至 `release/` 目录。

> 说明：请在「设置 -> 通用 -> Python 环境」中配置 Python 环境：
> 1. 点击「自动检测」自动发现系统已安装的 Python；或手动选择 Python 可执行文件路径；
> 2. 缺失的依赖库可由 AI 助手通过对话自动安装（基于 `python/requirements.txt`，通过 pip/pip3 安装）。

## 📦 下载安装

前往 [Releases](../../releases) 页面下载对应平台的安装包：

| 平台 | 产物 |
| --- | --- |
| macOS (Apple Silicon) | `*-mac-arm64.dmg` |
| Windows | `*-win-x64-setup.exe` |
| Linux | `*-linux-*.AppImage` |

## 🛠️ 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面框架 | Electron 42 |
| 前端框架 | Vue 3 + Vite 6 |
| 状态管理 | Pinia |
| 路由 | Vue Router |
| 国际化 | Vue I18n |
| 富文本编辑 | TipTap |
| 日历 | 自研 Vue 日历组件 |
| AI Agent | DeepAgents + LangChain |
| 向量数据库 | Zvec |
| 本地数据库 | SQLite (sql.js) |
| Python 运行时 | 内置便携版 Python（用于 Agent 的 python_repl 工具） |

## 📂 项目结构

```text
happy-friday-lite/
├── main.js                  # Electron 主进程入口
├── preload.cjs              # 预加载脚本
├── src/                     # Vue 前端源码
│   ├── components/          # 通用组件（chat / layout）
│   ├── views/               # 页面视图
│   │   ├── friday/          # Friday 助手
│   │   ├── office/          # Office 办公套件（文档 / 表格 / 演示 / PDF）
│   │   ├── knowledge/       # 知识库
│   │   ├── note/            # 笔记
│   │   ├── drawing/         # 绘图
│   │   ├── schedule/        # 日程
│   │   ├── history/         # 历史版本
│   │   └── settings/        # 设置
│   ├── store/               # Pinia 状态模块
│   ├── i18n/                # 国际化资源
│   └── router/              # 路由配置
├── src-electron/            # Electron 后端
│   ├── agent/               # Agent 核心（工具/技能/子Agent/权限/记忆）
│   ├── rag/                 # RAG 流程（加载/分块/向量化/检索）
│   ├── db.js                # SQLite 数据库
│   ├── llm.js               # LLM 适配
│   └── python-env.js        # Python 运行时环境
├── python/                  # Python 运行时下载脚本
├── scripts/                 # 构建辅助脚本
└── .github/workflows/       # CI 构建工作流
```

## 🔧 配置 AI 模型

首次使用需在「设置 -> 模型配置」中填入 API Base URL（如 `https://api.openai.com/v1`）、API Key 和模型名称。

支持任何兼容 OpenAI 接口的大模型服务（OpenAI / DeepSeek / 通义千问 / 智谱 / Kimi / 豆包等）。

## 🤝 参与贡献

欢迎提交 Issue 和 Pull Request。请确保项目可正常构建运行、遵循现有代码风格，并在新增功能时同步更新相关文档。

## 📄 开源协议

本项目采用 [PolyForm Noncommercial License 1.0.0](./LICENSE) 开源协议。

- ✅ 允许：个人使用、学习研究、修改代码、分发源码
- ❌ 禁止：任何形式的商业使用
- ⚠️ 要求：使用或分发时必须保留原作者署名与版权声明

详情请阅读 [LICENSE](./LICENSE) 文件。

## 🙏 致谢

- [Electron](https://www.electronjs.org/)
- [Vue.js](https://vuejs.org/)
- [LangChain](https://github.com/langchain-ai/langchain)
- [DeepAgents](https://github.com/frost-beta/deepagents)
- [TipTap](https://tiptap.dev/)
- [Zvec](https://github.com/zvec/zvec)

## 📧 联系方式


## 3.0.6-preview.2 剪贴板能力

新增托盘和轻量浮窗，Ctrl+Shift+V 可从外部应用唤起。多选支持全选当前筛选结果、Shift 连选、输入框外 Ctrl+A 和顺序粘贴；队列锁定目标，成功才推进，失败暂停并保留位置，提供暂停/恢复/跳过/取消。默认关闭退出，后台驻留需开启且托盘实际可用；可选队列快捷键默认未启用。独立测试运行目录已完成实际外部粘贴和两条顺序发送核验，尚未替代最终安装版验收。

保存笔记保留富文本结构、多张图片和来源，原版笔记编辑器允许受管 PNG 图片，编辑与追加可保存新快照。现有 DeepSeek 配置已在临时数据上通过真实文字和多图 OCR 归档验证；密钥不写入报告。普通文件正文现接入 RAG 解析器，已完成转写的音视频可分析；完整文件/媒体验收和未转写音视频的主动转写仍待完成。完整进度见 `docs/Friday-preview-delivery-status.md`。

富文本正文中的图片接入与位图、图片文件相同的预览和编辑器；内嵌图片本地显示，网页/文件引用点击后载入。编辑保留周围正文，二维码分享包含实际图片。取消正文编辑会还原已保存文字和图片。预览缩放以鼠标位置为中心，拖动有边界，窄窗口弹窗底部按钮自动换行。`scripts/probe-clipboard-media-ui.mjs` 使用临时 Electron 数据，验证真实 Canvas 像素、画笔/撤销重做/文字/马赛克/裁切/旋转、原图保留、富文本图片预览编辑分享、代码及链接编辑、WAV/WebM 实际播放与跳转。此为开发验证，不替代安装版验收。

新增多选：条目勾选、Shift 连选、全选/取消全选当前筛选结果、输入框外 Ctrl/Cmd+A，以及 Escape 退出。可批量收藏、追加标签与设置分类、合并复制（保留原条目）、确认后删除到最近删除。整批先校验条目有效性和标签上限，避免部分修改；敏感条目禁止合并和分类标签操作。工具栏已检查 1280、640、420 像素宽度。

文件与文件夹二维码分享在 worker 中生成含中文路径的 ZIP，支持选择网卡地址、主动停止分享和十分钟过期。上限为 100 个所选文件/文件夹、20,000 项归档内容、256 MiB；链接、源文件缺失和超限会明确报错。真实手机与局域网访问仍待验收。用户设置的录屏目录缺失或不可读时显示处理提示；实际录屏结束采集及播放仍待验收。

Windows 采集在同一次原生剪贴板锁内读取文字、HTML 和文件路径，并对短暂占用重试；文件复制最多等待 100ms 获取锁，超时报告失败。`scripts/probe-clipboard-electron.mjs` 使用并恢复实际系统剪贴板，覆盖混合格式复制、敏感条目批量保护及自身写入去重。

常用语管理修复了响应式标签数组导致的 Electron IPC 保存失败。新建后自动进入常用语列表并清除阻挡结果的筛选；分类和标签提供可见的新建入口，管理弹窗的创建表单固定在底部。剪贴板设置中的录屏目录数组同样按普通数组传输。开发验收命令：先运行 `npm run dev`，再运行 `node_modules/.bin/electron.cmd scripts/probe-clipboard-creation-ui.mjs`；它使用临时数据库和隐藏测试窗口，覆盖真实 preload/IPC、新建与编辑、重名提示、重载持久化和窄窗口按钮可见性。该测试不替代安装版鼠标验收。

剪贴板页面支持图片缩略图和放大预览、文件与文件路径分开复制、右键菜单、分类、标签、收藏、置顶、常用语和最近删除。剪贴板设置可控制采集开关、图片、敏感内容保留时间、容量、全局快捷键和清理。可选启用 AI 对非敏感内容进行重要性判断，达到阈值后自动保存到笔记；AI 默认关闭，敏感内容不会进入搜索或模型。

列表工具栏继续直接显示新建常用语、分类和标签入口。分类、标签和日期筛选按需展开，折叠后保留可单独移除的条件摘要；多选批量命令另行展开，给内容列表保留首屏空间。沿用 Friday 控件、主题与切换动效，开发验收覆盖 420/640/1280px、浅深色、英文文案、选择状态及既有创建/批量/二维码流程。最终安装版窗口验收仍待完成，详见 `docs/Clipboard-density-acceptance-2026-10-24.md`。

文件条目右键现可直接调用已有文档解析器进行 AI 归档。音视频缺少有效转写时会先自动转写，再判断是否保存笔记；默认使用 Windows 本机语音，剪贴板设置提供独立的转写引擎选项，并排除 DeepSeek 等已知仅支持聊天的模型。未知隐私级别的转写只留内存，隐私变化、编辑、过期及取消会阻止旧结果继续归档。真实模型和界面开发证据见 `docs/Clipboard-media-ai-acceptance-2026-10-24.md`；最终安装版系统验收仍待完成。

屏幕钉窗重复打开时会同步缩略/展开内容，菜单随条目状态更新，图片编辑后的旧缩略图响应不会覆盖新图。已经钉到屏幕的窗口隐藏无动作的重复钉窗命令。独立窗口开发探针已覆盖菜单、图片预览、备注刷新、工作区边界和窗口释放；Windows 可见置顶与物理拖动仍需单独系统验收，详见 `docs/Clipboard-pins-acceptance-2026-10-24.md`。

## 3.0.6 预览版开发中

Windows 打包保留 Electron 的 Chromium notices，重新生成 Office、字体和本机组件的上游许可证，并按实际收集的应用依赖聚合文本。机器可读审计会列明未发布许可证正文的包，发布前仍需逐项核对；应用自身许可证已明确加入白名单。此项打包修复不表示安装器与交付门禁已经通过。

Windows 目录清理改用公共不跟随链接接口，避免 Electron 42.2.0 在递归清理 DSH profile 时穿透 junction 并删除运行依赖。同类修复覆盖备份恢复、最近删除、技能、RAG 和分享归档清理。连续真实 DSH 启停及 DeepSeek 对话后校验 7,103 个依赖文件哈希均未变化；真实 Electron 备份恢复与永久删除验证了外部链接目标保留。开发回归通过不代表最终安装版交付，根因与证据见 `docs/DSH-runtime-root-cause-2026-10-24.md`。

笔记右键“添加到知识库”复用原版目录弹窗；主进程核实笔记与目标路径、拒绝同名冲突并记录引用关系。知识库中的笔记引用可打开原笔记。笔记侧栏支持长按多选、全选、批量置顶/移动/加入知识库/确认删除，已通过隔离 Electron 界面探针。全应用实际横向溢出的内容区域（含笔记表格和代码块）可用普通鼠标滚轮横向移动；安装版交互验收仍待完成。

知识库侧栏可新建、重命名、调整分类顺序，并把分类删除到最近删除、恢复原名称。知识库可以跨分类移动，文件保持完整；非法名称和同名冲突会被拒绝。交互复用原版弹窗与右键菜单，创建、重命名、移动、删除和恢复已通过隔离 Electron 的真实 preload/IPC 探针，安装版验收仍待完成。

DSH 入口检查现按包声明的 `bin.dsh` 定位 CLI，内置 MCP 客户端携带 Friday 本地授权头。使用隔离模型配置的真实 Electron 探针已同步 29 个工具，正常选择工作区、发送提示并收到持久化的 DeepSeek 回答；最终安装版验收仍待完成。

最近删除统一保存笔记（含知识库引用）、知识库文件/文件夹和剪贴板记录，支持批量恢复、选择其他恢复位置、导出笔记/资源副本，以及确认后永久删除；永久删除审计不含正文。过期的敏感剪贴板内容不能恢复。此预览版仍在开发，安装流程、系统集成与完整迭代门禁尚未全部验收。

模块设置使用稳定 ID 保存顺序，支持拖拽、键盘按钮和恢复默认。Office 显隐现在可以在重载后保留，已显示数量按实际支持的模块统计。隔离的真实 preload/IPC 已验证设置与最近删除恢复流程；已安装 3.0.6 数据库的独立副本完成升级、旧版重开与再次升级，原表内容和模型配置均保留。安装升级、回退等流程仍待最终安装版验收。

如有问题或建议，欢迎通过 [Issues](../../issues) 反馈或者邮箱（chenjie.plus@qq.com）联系我。

## Office 预览：共享文件命令与源文件保护

Word 正文右键菜单补上全选、查找、撤销/重做，继续使用原版菜单组件与主题。只读时统一禁用剪切/粘贴、格式、批注、域更新、编号和浮动对象写入命令，并显示只读原因；复制、全选和查找仍可使用。菜单支持方向键、Home/End 和 Esc 返回编辑器。Windows 系统打印的 Word 输出已有开发验收，其余打印及最终安装版仍在交付清单。

Slides 沿用原右键菜单补上画布/对象全选、查找/替换、撤销/重做，并按实际历史状态禁用命令。表格长菜单可以滚动，方向键、Home/End 和 Esc 可导航，菜单按键不会误删或移动底层对象。修复共用事务更新归档后丢失未保存状态的问题，粘贴及撤销/重做会同步维护关闭提醒和恢复副本所需的状态。最终安装版验收仍待完成。

Excel 在 Univer 原单元格、行头和列头菜单中增加整表全选、查找及撤销/重做，复用原选择模型、命令和历史服务。真实工作簿的单元格全选、编辑撤销/重做、查找面板、行列头原插入命令保留、语言切换和窄窗口深色布局已有开发验收。原网格与工具栏同步切换语言，过期或取消的语言包请求不覆盖最新语言。最终安装版验收继续记录在交付清单。

PDF 正文右键菜单已接上选中文字复制、搜索、AI 引用、高亮/下划线/删除线、选区 TXT 导出、来源定位/旋转及撤销重做，复用原 PDF 菜单样式和关闭行为；加密只读文档禁用修改并说明原因。全文全选使用文档索引，覆盖未挂载页面，支持 Ctrl+A/Ctrl+C、全文 TXT 和 AI 引用；只高亮可见文本，保留虚拟渲染。TXT 导出保护源文件及硬链接别名。最终安装版验收仍在待办清单。

Office 启动保留文档引擎来提供最近文件等公共能力，其他引擎按需加载，同类型并发请求共用一次加载。隔离启动对比显示主进程初始化和总启动耗时下降，但初始化后打开普通文档仍未达到提速 20% 的目标，性能门禁保持未完成。

Word 先挂载空编辑器、并行准备源字节，换文档只更新一次视图来清空撤销栈，并减少原样式库反复布局。启动期间源文件变化会重新读取，密码和恢复确认沿用原流程。真实复制、撤销、只读及完整样式卡片已通过开发验收；具体耗时证据和未完成的性能门禁见 docs/Office-startup-acceptance-2026-10-24.md。

四类编辑器的文件菜单和选项沿用原 Office 菜单、弹窗样式及主题变量。Word 从当前编辑内容导出 DOCX/TXT/Markdown；Excel 从当前编辑日志导出 XLSX/TXT/Markdown，不提交源文件；Slides 支持 PPTX 和保留页面图片、讲稿备注的 Word 讲义。系统 Microsoft Office 承接 DOC/XPS、表格 PDF/XPS、幻灯片 PDF/XPS/视频/动态 GIF，以及 PPT/POT/POTX/PPS/PPSX/ODP 类型转换。转换器缺失或占用时提供具体能力错误；取消和失败不破坏已有目标文件与源文档。

PDF 选区新增页码、最小文本项和字符位置，批注几何只读取选中的文本片段；修复双击/Shift 扩选及 OCR 旋转定位。Windows OCR 引擎由 Friday 构建流程编译并带入资源，bundle 按实际运行目录定位资源，识别采用异步调用。开发验收及尚未完成的安装、打印、性能门禁见 `docs/Office-menu-export-selection-acceptance-2026-10-24.md` 和 `docs/Friday-preview-delivery-status.md`，当前尚非已交付安装包。

## 背诵预览：本机转写与人工校对

音频导入、受管播放、Windows 本机转写、时间戳/置信度、参考文本对齐、复习计划及三种题型已接通。可以逐段校对并保留原始识别、时间和模型置信度；重试转写时取消不会清空此前有效结果。题目可以回跳音频来源，重开后保留记录。DeepSeek 等仅支持聊天的模型不会被当成音频模型。本机识别存在误差，需要核对；无参考文本时不虚构准确率和背诵遍数。开发证据和剩余安装门禁见 `docs/Recitation-acceptance-2026-10-24.md`。
# Typewriter 独立拟真工作区

Happy Friday Lite 现在包含独立的 `/typewriter` 打字机工作区。它复用了 Typewriter Nocturne 的纸张、灯光、3D 打字机、声音和终端表层，并通过 Friday 的 Electron IPC 运行本地 PowerShell/Bash 等真实 Shell。工作区支持中英文设置、Markdown/代码入口、Press 和 Archive；它与 Friday 的 AI、RAG 和笔记业务保持独立。
