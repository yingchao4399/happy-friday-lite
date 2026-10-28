# Happy Friday Lite：打字机、笔记双链、命令与插件生态方案

研究日期：2026-10-27。当前应用基线：3.0.6-preview.12。文档状态：研究及待实施方案；本文不表示功能已经实现，也不对应新的安装包。

## 1. 目标与设计决策

本轮建设五部分：

1. 保留原版 Nocturne 外壳和二级菜单，完善纸张、墨色、字体、机头、音效和纸夹联动。
2. 笔记建立可靠的有向链接索引，分别呈现出链、反向链接、未解析链接。
3. 全应用提供命令面板按钮和搜索浮窗，命令按功能和来源归类。
4. 设置增加快捷键页面，让按钮、面板和快捷键执行同一条命令。
5. 设置增加插件管理和市场，逐步建立 Friday 原生插件与 Obsidian 插件的宿主能力。

关键决策：

- 打字机继续采用“原版外壳 + 笔记/终端内容插件”；字体颜色是工作区显示偏好，不把整篇笔记写成带颜色的 HTML。
- 文档身份统一使用原有 noteId；打字机、笔记编辑器、链接面板和插件通过同一文档服务访问它。
- 命令注册中心先建设，快捷键和插件命令以它为基础。
- Obsidian 社区目录接入与插件运行兼容分别验收。插件包无需改源码即可运行是兼容目标；支持范围按具体 API 和插件版本逐步扩大。
- 现有笔记以富文本 HTML 为主，打字机是 Markdown 视图，不能把 HTML、Markdown 和任意 Obsidian 插件之间的转换假定为无损。
- 保留现有 Electron 进程隔离和 Agent 审批边界；新增插件能力通过专门宿主接入。

## 2. 本轮研究确认的现状

### 2.1 打字机

已检查 TerminalSurface.tsx、NoteSurface.tsx、TypewriterStage.vue，以及原版 settings.ts、papers.ts、theme-css.ts、stage-controller.ts、font-picker.tsx 和官方架构文档。

| 发现 | 代码依据 | 影响及结论 |
| --- | --- | --- |
| 正文与部分提示使用不同颜色源 | TerminalSurface、NoteSurface 使用 activePaper().ink；theme-css 的 --tn-ink/--tn-ink-muted 来自主题 palette；终端状态使用 --tn-ink-muted | 房间主题与纸张可独立切换，提示色可能不适合纸面；需要区分纸面与外壳文字色 |
| 原作已有最低对比度设置，当前终端适配没有使用完整配置 | apply-config.ts 的 extraTerminalOptions 提供 minimumContrastRatio；TerminalSurface 当前未应用它 | 应接回已有能力，并验证透明背景下的实际效果，不能只改 CSS |
| 字体列表并非都能直接使用 | FONTS 只有 IBM Plex Mono、Courier Prime 标记 bundled，其余主要为 if installed | 需本地字体资源目录、下载状态和加载确认；不能把名称存在等同于字体可用 |
| 切换字体没有完整的重新测量流程 | TerminalSurface 字体 effect 修改 options；fit 主要由容器 ResizeObserver 触发 | 字体加载完成不一定触发容器 resize，可能使行列、光标和机头不同步 |
| 原版压印与可读性也读取纸张墨色 | stage-controller 的 inkStyle、ambientFloor 读取 paper.ink | 新颜色必须同时进入正文、压印、光标和光照可读性计算 |
| 打字机快捷键分散在视图里 | TypewriterStage 注册独立 keydown | 需要迁入统一命令系统，避免重复处理 |

这些是静态代码确认的缺口；“所有终端浅色文字都由同一个原因造成”尚未通过逐项运行复现证明。PowerShell 的 ANSI/真彩色输出、透明画布和灯光混合仍需分别测量。

原版固定提交仍为 e19d64ef42b9241b462439e22d7b905b266633e1。原版使用框架配置链应用字体和纸色；Friday 自己构建 xterm 后，需要补齐对应链路。

### 2.2 笔记链接

当前 note-link-upsert 会把 A→B 和 B→A 都写入 resource_links，relation 为 note-bidirectional；note-links-list 读取两端关系，NoteEditor 再去重后显示为反向链接。

因此它目前更像“双向关联”，不能准确表达“谁引用了谁”。插入引用时会写关系，但更新笔记正文的主路径没有统一解析并替换该笔记的出链；删链接、粘贴链接、打字机编辑和第三方修改可能与关系表不一致。

现有资源关系表还用于其他业务，不能直接把全部 resource_links 改成笔记链接或删除。

### 2.3 全局操作

当前存在 TabBar、打字机、设置弹窗、剪贴板等不同快捷键处理，未发现统一的全应用命令面板及可编辑的快捷键注册中心。

Office 使用 Electron WebContentsView。它的键盘事件不冒泡到 Vue 主页面，原生视图也可能遮住 Vue 弹窗。因此“在 App.vue 加一个弹窗和 keydown”不能覆盖整个应用。

### 2.4 Obsidian

项目已有 Obsidian Markdown 解析、知识库/WebDAV 同步和预览，属于数据接入；没有 Obsidian Plugin、Vault、Workspace、MetadataCache、Editor 的完整运行实现。

官方 API 仓库是类型和契约，并非可直接嵌入的完整 Obsidian 应用运行时。官方插件通常通过 require('obsidian') 使用宿主 API，还可能依赖 DOM 扩展、CodeMirror、Node/Electron、私有接口和其他插件。

本轮已读取官方 API 定义、README、示例插件源码与 manifest，并读取社区插件目录。社区目录是发现入口，不提供对 Friday 的兼容承诺。

## 3. 打字机细节与字体颜色

### 3.1 保留原版体验

继续直接维护原版 React NocturneShell、Studio、Press、Archive、灯绳、回形针和 Three.js 机器，避免再用一套近似界面覆盖原版。

细节校准清单：

- 底部机身在普通模式可见；明确区分 Focus、Effects 和原版 Auto Quality 的效果，不让用户误以为机器消失。
- 字体变更、纸张切换、窗口缩放、DPI 变化后，校准字符列、纸面原点、光标、压印、选区与机头位置。
- 回车保留原版回弹与纸张进给；方向键、Tab、退格、中文输入法分别触发对应反馈。
- 回形针滚动条保留四种金属样式，覆盖短文变长文、末尾输入、拖动、缩放、插件切换和到达边界的情况。
- 灯光最亮和最暗时纸张纤维、压纹与文字仍能辨认；不通过铺不透明白底修复终端文字。
- 切换颜色和字体不重建输入控件或 PTY，不清空内容、撤销栈、选区和滚动位置。
- 全局命令浮窗出现时暂停击键声音/机头输入反馈；关闭后恢复原来的编辑焦点。

Studio 在原版 Typography 分组内增加“墨色”和“字体管理”入口，保留原有控件外观及布局风格。

### 3.2 统一颜色计算

增加 resolveInk(settings, activePaper) 和 resolveTypography(settings, fontRegistry)，作为两个内容插件及舞台的共同配置源。

颜色至少分成：

| 用途 | 来源 |
| --- | --- |
| 纸面正文、终端默认前景 | 有效墨色 |
| 纸面状态、占位提示 | 根据有效墨色和纸色生成，独立检查对比度 |
| 压印与墨迹效果 | 同一有效墨色及原版压印参数 |
| 光标、选区 | 与墨色协调，并保证当前纸色下可辨认 |
| Studio、Archive 等外壳菜单 | 原版面板色系，独立于纸面色系 |
| ANSI 语义颜色 | 当前纸张对应的可读调色板 |

建议设置结构：

```js
typography: {
  // 保留现有 font/fontSize/fontWeight 等字段
  inkMode: 'paper',        // paper / preset / custom
  inkPreset: 'carbon',
  inkColor: '#2A2019',
  contrastPolicy: 'auto'   // auto / exact
}
```

- 默认跟随纸张，保持原作外观。
- 预设：碳黑、深棕、蓝黑、藏蓝、酒红、墨绿；深纸张提供对应的浅色墨。
- 自定义 HEX、最近使用颜色、恢复默认、实时预览。
- auto 模式把过低对比的颜色调整到可读范围，同时显示所选色与实际应用色；exact 模式保留用户选色并标注低对比，不悄悄改色。
- 灯光可读性计算也使用有效墨色，避免正文改色后光照保护仍按旧墨色计算。
- 普通正文和状态文字以静态纸色下至少 4.5:1 为基线，正文默认争取 7:1；还要对渲染后的光照结果做截图校验。

这项功能首先是工作区显示设置。编辑后笔记内容与 Markdown 导出不因为选择红墨水就附加颜色标签。Press/PNG 可以选择“继承当前墨色”，并把渲染用的颜色和字体标识写入 Archive 快照样式。

### 3.3 终端启动界面专项

1. 在 xterm.open 和 PTY 启动输出之前，应用已解析的字体、前景、透明背景、光标及 ANSI 调色板。
2. 纸面上的“启动中/启动失败/已退出/重新启动”等统一使用纸面提示色，不借用房间主题文字色。
3. 接入原作 minimumContrast 设置，测试 CanvasRenderer 在透明背景下采用的背景色；不能假设它会自动识别底层纸纹的有效颜色。
4. 检查 PowerShell 启动画面、PSReadLine 路径/参数、Git、Node、Python 的默认色、16 色、256 色及真彩色。
5. 保留错误、目录、提示符的语义差别；默认前景统一不意味着把所有 ANSI 颜色强制变成同一个颜色。
6. 低对比 ANSI 调色板先在渲染配置层修正。真彩色和显式背景作为独立场景处理，必要时提供可选的高可读呈现模式；不通过替换 PTY 字节流改变命令内容。

验收不能只看空终端：启动输出、正在输入的命令、历史输出和程序主动设置的颜色都要覆盖。

## 4. 字体资源与真实可用性

### 4.1 字体范围

将列表分成“随应用内置”“已下载”“本机字体”“可下载”，每项显示状态、示例、支持字重、中文覆盖和终端适用性。

| 字体 | 建议用途 | 交付方式 |
| --- | --- | --- |
| IBM Plex Mono、Courier Prime | 原作默认及打字机风格 | 保留内置，补齐实际提供的字重 |
| JetBrains Mono、Fira Code | 编码、终端 | 首轮随包内置或随版本准备完整本地字体包 |
| Sarasa Mono SC | 中文与英文混排、终端双宽字符 | 至少内置一种完整中文等宽方案；具体字体版本验证后冻结 |
| Cascadia Code/Mono、Source Code Pro | 终端与代码 | 可下载扩展包 |
| LXGW WenKai Mono | 中文笔记打字 | 可下载；准确选择等宽发行文件并验证中文双宽表现 |
| Monaspace、Commit Mono、Recursive Mono 等现有选项 | 扩展选择 | 提供下载包后才标记可用，未准备好时显示明确状态 |
| Nerd Font 变体 | 特定终端图标需求 | 按需下载，保留已内置 Symbols Nerd Font 兜底 |
| 用户导入 TTF/OTF/WOFF2 | 个人字体 | 仅加入应用字体目录，不要求管理员权限或系统安装 |

不把字体文件的连字能力等同于当前 xterm 渲染器已经支持连字。首轮优先维持字符网格准确；连字作为经验证的独立开关。

### 4.2 本地资源交付

- 内置字体加入构建资源和显式打包清单；全部用户可见默认字体在断网安装后仍可使用。
- 扩展字体下载到 userData/fonts/<fontId>/<version>/，记录来源、版本、SHA-256、family、字重、字形范围和许可证。
- 已列为“可下载”的推荐字体使用固定发行版本；核验后原子落盘，失败可重试，已下载版本可以离线复用。
- 通过应用资源协议和 FontFace 加载应用私有字体，不依赖网页 CDN，也不修改系统字体目录。
- 只有字体解析和代表字形加载成功，才切换为“可用”。document.fonts.check 单独使用不足以证明实际命中了所选 family，需要结合已加载 FontFace、资源记录及测试测量。
- 下载中继续用当前字体；失败保留用户输入和现有字体，显示可重试状态。
- 删除当前字体前先切到可靠默认字体；当前文档、Canvas 和 Press 持有的 FontFace 释放后再清理文件。
- 支持可选“下载所有推荐字体”，同时显示总大小；字体大小由固定版本资源实际计算，不在本方案中虚报安装包增量。
- 普通中文字体不能只打一个常用字子集就称作完整可用；分包方案须保证离线字形覆盖。

本轮检查了 JetBrains Mono、Fira Code、Cascadia、Sarasa、LXGW 的官方许可文件。具体发行文件、Nerd Fonts 合成内容及版本仍要逐包记录许可证，不能把所有字体一概标注成同一种许可。Microsoft/SF 等系统商业字体不擅自打包。

### 4.3 切换流程

```text
选择字体
→ 检查本地资源 / 下载
→ 加载目标 family、字重及中英文字形
→ 原子应用 Typography
→ xterm 重测字符并 Fit，向 PTY Resize
→ 笔记 mirror 重测，刷新光标和选区
→ 重设机头网格、压印及纸夹位置
→ 更新 Press 预览
```

保存现有终端缓冲、笔记文本、撤销、选区与焦点；不同字体下的段落换行变化属于正常排版变化。字体缺失时 Archive 必须明确显示替代字体，不能声称历史图片能完全按原字体重现。

## 5. 笔记双链：方向、索引与界面

### 5.1 用户行为

右侧增加“链接”面板，在出链、反向链接、未解析链接之间切换：

- 出链：当前笔记真实引用的目标，显示次数、引用片段和位置。
- 反向链接：其他笔记指向当前笔记，按来源笔记分组，可展开多个引用位置。
- 未解析：目标不存在或重名不明确，提供选择目标、创建目标、修复链接。
- 未链接提及：作为后续独立选项，以当前标题/别名搜文本，明确区别于已建立链接。

点击引用片段打开对应 noteId 并定位，支持当前标签/新标签。打字机也可以使用同一链接面板，内容仍显示在原版纸面中。

提供 [[ 输入补全、别名、标题锚点和块引用的逐步支持：

```text
[[笔记标题]]
[[笔记标题|显示文字]]
[[笔记标题#小节]]
[[笔记标题#^block-id]]
[显示文字](friday://notes/<noteId>)
```

第一轮优先实现笔记级链接和标题锚点。块链接必须先建立稳定 blockId 及两个编辑器的定位能力；在此之前按笔记级跳转并明确提示，不假装已经支持精准块跳转。

### 5.2 正确的数据模型

正文里的 A→B 只存有向引用；B 的反向链接由查询 source→B 得出。只有 B 正文也引用 A，才同时存在 B→A。

建议增加独立 note_link_occurrences 表，避免与 Agent 的通用资源关联混用：

```text
id, sourceNoteId, targetNoteId(nullable), rawTarget,
kind, alias, heading, blockId,
sourceLocator, snippet, sourceRevision, resolverVersion
```

- 每个引用位置一条记录，多次引用可分组但不丢位置。
- sourceLocator 是带版本的结构化定位信息：Markdown offset/行列或富文本节点路径；两种偏移不可直接通用。
- 为 sourceNoteId、targetNoteId、未解析目标建立索引。
- 现有 resource_links 的人工/Agent 关联保留，必要时放入“相关笔记”区域，避免被误称为反向链接。

### 5.3 统一写入与索引

建立 NoteDocumentService，笔记编辑器、打字机和插件的写入都进入它：

1. 按文档格式解析正文真实链接，忽略代码块、行内代码、注释中的伪链接。
2. 以 noteId 为稳定身份；标题/路径用于解析和显示，重名时让用户选择。
3. 在数据库事务中保存该版本正文并替换它的派生出链，提交后按现有约定 saveDb。
4. 若复杂内容解析在后台完成，带 sourceRevision 校验，防止旧任务覆盖新版本索引；UI 显示更新状态。
5. 推送 note-changed/link-index-changed，使其他视图增量刷新；不依赖“插入链接时”单一事件。
6. 提供可取消的全量重建与重建版本标记；大库分页，避免每个反链单独一次 IPC 查询。

HTML 应使用结构化解析器或编辑器文档树，Markdown 使用语法树；现有 Obsidian 正则解析仅可复用基础数据，不直接承担所有复杂语法定位。

### 5.4 迁移与特殊情况

- 原先 A↔B 的记录不能推断真实方向。迁移时从正文重建，证据缺失的旧关系保留为旧关联，不自动伪造成双向正文引用。
- 重命名用 noteId 保持已有链接，标题型 WikiLink 维护解析缓存；自动改写正文必须给出预览和撤销。
- 删除/回收站隐藏正常目标，保留可恢复的引用状态；恢复后重新解析。
- 标题别名、重名、移动笔记本、跨知识库、同笔记锚点分别规定解析规则。
- 同一笔记多视图编辑增加 revision 和冲突检测；不能用“最后一次保存直接覆盖”处理新插件带来的并行写入。
- 富文本表格、图表和附件沿用已有保护，链接解析和 Markdown 转换不重写无关节点。

## 6. 全应用命令面板

### 6.1 入口与交互

参考用户截图的居中搜索浮窗、命令列表、右侧快捷键和底部键盘提示，按 Friday 现有视觉体系实现。

- 侧栏底部、设置按钮上方增加常驻“命令面板”按钮，侧栏收起仍显示图标。
- 顶部应用区域保留一个紧凑按钮，避免无侧栏状态失去入口。
- 点击弹出浮窗，顶部搜索，左侧类别筛选，列表显示“模块：动作”、来源和快捷键。
- 空搜索显示常用、最近使用和当前上下文命令；输入后按匹配程度展示，不让类别分组遮盖最相关结果。
- 支持中文、英文、别名、拼音/首字母和模糊检索；语言切换后即时更新。
- ↑↓、Enter、Esc，清晰的无结果和禁用原因，完整键盘访问。
- 面板打开前记录文档、选区、焦点；编辑命令执行时先恢复目标编辑上下文。
- 长命令显示执行状态和失败原因；执行中防重复。删除、覆盖、执行 Shell 等动作沿用原有确认机制。
- 用户笔记中的字符串不会自动变成“可执行命令”。

命令分类建议：导航与工作区、笔记与链接、打字机、终端、Office、智能体、知识库与检索、剪贴板、日程与自动化、绘图与视图、插件、设置与帮助。插件可增加子类，但不能任意污染顶级分类。

### 6.2 命令契约

```js
registerCommand({
  id: 'notes.links.showBacklinks',
  titleKey: 'commands.notes.showBacklinks',
  category: 'notes.links',
  source: 'builtin',
  keywords: ['反链', 'backlinks'],
  contexts: ['note', 'typewriter.note'],
  defaultBindings: [],
  enabled: context => Boolean(context.noteId),
  run: context => context.noteLinks.open('incoming')
})
```

注册返回 dispose，命令 ID 稳定且带命名空间。内置按钮、右键菜单、命令面板、快捷键均调用 executeCommand(id, context)，不各自维护一份业务逻辑。

命令与 Agent 工具分开注册：命令不是自动可调用的模型工具；只有明确设计为 Agent 工具的能力才进入现有工具注册表并保留审批。

### 6.3 Office 与跨视图处理

- 由主窗口、Office 和插件宿主的 before-input-event 共同接入统一的快捷键解析；每个输入事件只有一个执行方。
- 最小全局入口快捷键在原生视图层截获，其他编辑快捷键优先留给当前文档。
- 主窗口 OverlayCoordinator 管理浮窗的可见性。面板打开前保存活动 Office viewId 和焦点，临时 setVisible(false)，显示 Vue 面板；关闭后恢复同一视图，不销毁、不重载、不丢文档。
- 当前 hideView 会移除 view 的注册关系，不可直接当作临时遮罩函数复用，应新增 suspend/resume 能力。
- Office 命令优先复用宿主已有命令接口；需要修改 Office 内部功能时走 vendor/happyoffice 源码及重新构建流程。
- 放映/HTML 全屏单独验收；嵌套浮窗使用计数/栈，防止关闭一层就错误恢复 Office 覆盖另一层。

## 7. 全应用快捷键设置

新增 /settings/shortcuts。提供分类、搜索、来源筛选、仅看冲突、录制按键、清除、添加第二绑定、恢复单项/全部默认、导入导出 JSON。

### 7.1 规则

- “全应用可用”指应用窗口内各模块均可用；“系统全局快捷键”是应用未聚焦也能触发，单独分组，默认只为少量适用命令提供。
- 统一 Mod 映射 Windows/Linux Ctrl、macOS Cmd；保存逻辑键或物理键策略和平台信息。
- 默认命令面板采用 Mod+Shift+P；现有打字机 Press 也占用此组合，需迁移为 Mod+Alt+P，并提供一次迁移提示和设置入口。
- Office 的 Mod+P 继续用于文档打印，避免为了模仿截图改变成熟编辑习惯。
- Mod+, 打开设置，Mod+S 按当前文档执行保存；Tab 切换、打字机快捷键和剪贴板设置逐步收归同一注册表。
- 终端默认保留 Ctrl+C、Ctrl+V、Ctrl+R、Tab、方向键等输入约定；只有用户明确配置的应用入口键在终端前截获。
- composition、isComposing、Dead key、AltGr、录制中、模态框、按键重复均有明确规则，不能把中文候选确认误当快捷键。
- 多段快捷键先作为架构支持，首轮可只交付单段；如后续开放，应显示待续提示并设置取消/超时。

### 7.2 冲突与保存

绑定由 commandId、组合键、scope/when、来源和平台共同定义。

同键但互斥上下文可以共存；能同时生效的绑定应显示冲突，让用户替换、取消或重新限定范围。优先级建议为录制/弹窗 → 当前编辑器 → 当前模块 → 应用，但应用入口键作为明确保留例外。插件不能静默覆盖用户配置。

系统级绑定注册失败应保留旧绑定并显示原因。修改内置剪贴板快捷键时与其现有配置双向迁移，避免两套系统同时注册。

导出不包含机器路径和密钥；插件被禁用后保留用户绑定记录但不执行，重新启用后恢复。配置带 schemaVersion，升级不覆盖用户改键。

## 8. 插件管理与市场产品结构

新增设置页：

```text
/settings/shortcuts
/settings/plugins
/settings/plugin-market
/settings/plugins/:pluginId
```

插件管理包含已安装、已启用、可更新、异常和恢复模式；详情提供版本、来源、兼容范围、权限/访问范围、设置、命令、快捷键和最近错误。

按用户要求提供分类：

1. 智能体插件。
2. 笔记插件。
3. Office 插件。
4. Obsidian 及三方插件。
5. 其他插件。

内部把“功能分类”和“来源/运行时”分开存储。例如一个 Obsidian 日历插件可以拥有笔记/日程标签，并在 Obsidian 来源筛选下出现；不因来源类别丢失功能归属。

市场提供 Friday、Obsidian 社区、手动来源三个入口，支持搜索、分类、详情、版本、安装、更新、禁用、卸载和本地插件目录/ZIP 导入。

Obsidian 社区插件保持原作者、仓库、插件 ID 和原始版本，不冒充 Friday 官方审核。筛选可区分“已验证兼容、部分兼容、待验证、不支持”，默认优先展示已验证内容。

### 8.1 安装和升级

- 安装只下载并校验，启用后才运行；本地 ZIP 不执行 npm install 或包内脚本。
- 优先使用插件仓库固定 release/tag，记录实际文件哈希和来源。自行计算哈希只能保证后续完整性；无上游签名时不能声称已验证作者身份。
- 处理 manifest.json、main.js、styles.css、versions.json；检查 minAppVersion、宿主 API 能力和资源是否齐全。
- 原子替换，保留上一可用版本和插件配置快照；更新失败可回滚代码，涉及数据迁移时单独说明数据能否回退。
- 插件停用调用卸载并清理命令、事件、定时器、样式、视图与服务；不能只隐藏卡片。
- 卸载时可选择保留插件数据，插件配置按用户数据目录和 workspace 隔离。
- 网络失败保留缓存目录和已安装插件；兼容状态与插件版本、Friday 版本、运行平台、编辑模式一起记录。

### 8.2 三类既有能力的接入

- 智能体插件通过现有工具注册表和审批链接入；Skills、MCP、运行时工具分别标明，不混成同一种安装包，也不把普通 UI 插件自动暴露为 Agent 工具。
- 笔记插件通过 NoteDocumentService、链接索引、编辑上下文和命令服务接入。
- Office 插件优先承载宿主命令、导入导出和侧面板；若编辑器本身没有公开扩展接口，不承诺任意第三方插件能直接改变其文档内核。

## 9. Friday 原生插件基础

建议单独定义 friday-plugin.json，不修改 Obsidian 原始 manifest：

```json
{
  "schemaVersion": 1,
  "id": "example.note-helper",
  "name": "Note Helper",
  "version": "1.0.0",
  "engine": "friday",
  "apiVersion": "1",
  "categories": ["notes"],
  "entry": "main.js",
  "contributes": {"commands": [], "settings": []},
  "capabilities": ["notes.read", "notes.write"]
}
```

宿主 API 首轮提供命令、插件配置、通知、模态框、笔记读取/更新、编辑选区和受控面板。扩展能力包括文件、网络、Agent 工具、Office 宿主操作，并与已有授权模型对接。

UI 命令注册返回可释放句柄；插件配置独立存储。插件抛错不应让主界面白屏，连续启动失败进入禁用恢复界面。CPU 死循环需要独立进程或 WebContents 终止能力，普通 Promise 超时不能解决。

原生插件采用新 API；Obsidian 插件走兼容层，各自使用稳定版本号，避免原生能力被 Obsidian 的历史包袱限制。

## 10. Obsidian 插件兼容设计

### 10.1 能力分级

| 级别 | API/依赖 | 交付目标 |
| --- | --- | --- |
| A | Plugin 生命周期、loadData/saveData、Notice、Modal、基础 Setting、addCommand | 优先实现，验证简单命令/设置插件无需修改原包 |
| B | Vault、TFile/TFolder、MetadataCache、Workspace 常用事件、Editor 基础读写 | 第二批，支持文件与文本处理、模板等经验证插件 |
| C | Markdown 后处理、自定义视图、CodeMirror 6 扩展 | 专门 Markdown 编辑模式及宿主完成后逐插件验证 |
| D | Node fs、child_process、Electron、私有对象、内部 DOM、其他插件 API | 单独适配或暂不支持，不能安装即承诺正常运行 |

Dataview、Templater、Tasks、Calendar、Advanced Tables、Excalidraw、Obsidian Git 可作为后续代表性调研样本；本轮未逐个运行这些插件，不能把表中的能力分级解释为它们已兼容。

一个插件可能跨多个级别，甚至按配置启用不同依赖。静态扫描只能提示风险，最终以具体版本运行结果和用例为准。

### 10.2 宿主与 API shim

设计独立 ObsidianCompatHost，为原始 CommonJS 插件提供 require('obsidian') 和已支持的宿主契约。

优先采用隔离的插件工作区 WebContents，保持 nodeIntegration=false、contextIsolation=true、sandbox=true，独立会话和 origin。插件只能访问本工作区公开桥接口；不把现有宽泛的 electronAPI.invoke 直接交给插件。

插件 UI 在兼容宿主里运行，继承常用主题变量和可公开实现的 DOM 辅助方法，不向 Friday 主 DOM 注入全局样式。弹窗、面板与主应用通过 OverlayCoordinator/布局桥对接。

首个技术验证必须覆盖：

1. 官方示例插件原包能加载并执行命令、打开 Modal、保存设置、停用后清理事件。
2. CommonJS 加载、导出对象、插件专属样式和公开 DOM helpers 的行为一致。
3. 同步 Editor/MetadataCache API 在宿主中读取的是本地同步镜像；不能把要求同步返回的 API 直接换成 Promise。
4. 用户在主笔记/打字机操作时，文档快照和选区版本可在插件执行前冻结；插件写入通过带 baseRevision 的事务确认，冲突时不覆盖新文本。
5. 需要 CM6 的编辑器与插件在同一兼容宿主及同一套模块实例中运行，处理 @codemirror/* 的实例身份，避免扩展对象来自重复库导致加载失败。
6. 未支持的方法明确抛出带能力 ID 的错误，不用空函数伪造成功，也不靠伪报 app 版本骗过插件。

Node/Electron 插件不能通过“给主渲染器打开 Node integration”解决。确需原生能力的插件先评估专门的受控后端适配；直接 require('fs') 的同步语义与隔离 IPC 也不是天然等价，需要明确的兼容实现和测试。此类能力作为后续独立工作包。

### 10.3 文档存储兼容

Obsidian 的 Vault 是路径化 Markdown 文件，而 Friday 的笔记是有 noteId 的数据库富文本。提供两个明确场景：

**Friday 笔记工作区**：默认使用原有 noteId 和数据库。向兼容插件暴露稳定的 Markdown 投影路径、附件和元数据；路径到 noteId 的映射由文档服务维护，重命名不能变成复制笔记。

**本地 Markdown 仓库**：用户主动选择文件夹，.md 文件是该工作区正文的事实来源。Friday 维护路径/文件身份映射和链接索引；若接入笔记列表，记录来源引用，不制造两份独立可编辑正文。

第一场景先支持能安全往返的 Markdown 内容。现有复杂富文本的媒体、图表、Office 对象采用保护节点/只读能力；插件请求整篇纯 Markdown 覆盖时先检测损失，不能静默丢数据。Vault 的底层 fs 绕过写入不会在首轮开放给数据库投影。

第二场景不要与 WebDAV 下载缓存混用。同步、文件 watcher、插件和编辑器的写入统一进入每文件串行队列及版本检测，处理重命名、外部修改、循环事件和冲突副本。

### 10.4 编辑器兼容

- 现有富文本笔记继续使用 Tiptap，提供基本选区、插入和替换适配。
- 原版打字机笔记继续使用透明文本输入和原版反馈，提供基础 Editor 方法。
- 对依赖 CodeMirror 6 的插件增加可选“Markdown 编辑模式”，以同一 noteId/文档身份访问内容，记录模式切换能力限制。
- CodeMirror 扩展不能直接插入 Tiptap 或 textarea。首轮不让这类插件改写打字机的纸面结构；可用的全局命令/文件服务仍可单独启用。
- 若后续把 CM6 接到打字机纸面，另做精确网格、IME、选区、机械反馈与透明渲染的验证，不能为了插件兼容破坏已修复的拟真体验。

### 10.5 兼容标识

市场兼容记录应包含：pluginId、pluginVersion、fridayVersion、compatApiVersion、平台、工作区类型、编辑模式、通过的功能及已知限制。

minAppVersion 是插件声明所需的 Obsidian 版本，不能直接与 Friday 的 3.0.6 版本字符串比较。需要对应的 API 能力映射表；不支持的需求保持禁用并展示原因。

社区插件目录是发现服务；实际插件从原仓库发行包获取。各插件按自己的许可证处理，本方案不包含复制 Obsidian 闭源应用实现，也不把官方示例插件许可等同于整套应用许可。

## 11. 建议目录与接入点

以下均为拟新增或拟改造结构，不表示已经创建：

```text
src/features/commands/
  registry.js / execute.js / context.js / search.js / builtin/
src/features/shortcuts/
  keymap.js / resolver.js / recorder.js / conflicts.js
src/features/notes/
  document-service.js / link-model.js / editor-adapters/
src/features/fonts/
  catalog.js / loader.js
src/features/plugins/
  client.js / contributions.js / compatibility.js
src/components/commands/CommandPalette.vue
src/views/settings/SettingsShortcuts.vue
src/views/settings/SettingsPlugins.vue
src/views/settings/SettingsPluginMarket.vue
src/store/modules/commands.js / shortcuts.js / plugins.js

src-electron/fonts/
  catalog.js / downloads.js / ipc.js
src-electron/notes/
  document-service.js / link-parser.js / link-index.js / ipc.js
src-electron/plugins/
  manager.js / installer.js / catalog.js / ipc.js / host/
src-electron/obsidian-compat/
  host.js / loader.js / api/ / vault-adapters/
src-electron/shortcuts/
  application.js / system.js
resources/fonts/
resources/plugin-host/
```

现有 src-electron/obsidian 继续承担同步/预览职责，与运行时兼容宿主命名区分。现有 Typewriter 的 plugins 是内容模块，不等于新市场里的外部扩展包；通过适配层相连，避免直接把 PTY 和 NoteSurface 当成第三方插件执行。

新增 IPC 必须同步主进程、preload 与 service 三层，核验调用来源、文档/工作区身份与参数。插件宿主使用独立白名单桥，不复用主应用通用 invoke。

所有用户界面补充中英文 key；命令内部 ID、字体 ID、插件 ID 不随语言变化。插件自己的文案按插件能力显示，不能承诺宿主可以自动翻译任意第三方插件界面。

## 12. 实施顺序与阶段交付

| 阶段 | 内容 | 可审查交付 | 依赖 |
| --- | --- | --- | --- |
| P0 | 对比原版、复现终端颜色、输入/保存与场景快照 | 问题清单、基准图、固定版本资源清单 | 当前 preview.12 |
| P1 | 统一墨色、字体本地资源和字体切换、拟真细节 | 可离线使用字体的打字机修订版；不包含插件兼容承诺 | P0 |
| P2 | NoteDocumentService、revision、真实出链/反链、迁移 | 两编辑入口共享链接索引与稳定保存 | P0；为插件奠基 |
| P3 | 命令中心、全局按钮、Office 浮层与键盘桥 | 各模块可搜索执行的命令面板 | 独立开始；接 P2 命令 |
| P4 | 快捷键设置、冲突处理、旧绑定迁移 | 应用内统一键位及已有系统快捷键整合 | P3 |
| P5 | 原生插件宿主、管理页、市场目录和安装回滚 | 至少一个真实原生示例插件完整生命周期 | P2/P3/P4 |
| P6a | Obsidian API 宿主技术验证 | 原版官方示例插件与少量简单插件无修改运行证据 | 可提前验证；正式交付依赖 P5 |
| P6b | Vault/Editor/MetadataCache、Markdown 模式 | 已验证插件清单，明确工作区及编辑器范围 | P2/P6a |
| P7 | 高需求插件逐个适配、特殊 Node/Office 能力 | 按插件版本交付兼容结果，不以目录数量计完成度 | P6b |

推荐分批发布：第一批优先解决用户当前的打字机与双链问题；第二批交付命令、快捷键与原生插件；第三批交付 Obsidian 已验证兼容集及社区市场整合。

不要先承诺任意日期或“全部插件兼容”再压缩实现。P6a 的同步 API、CM6 与文档往返验证通过后，再估算 P6b/P7 的工作量；每批版本按当时最新发布顺序递增，文档阶段不预占安装包版本。

## 13. 测试与发布门槛

### 13.1 打字机

- 三主题×六纸张，普通/Focus/Effects Off，至少覆盖无灯、默认灯、最亮灯；分别检查正文、提示、选区、光标与纸纹。
- 完整字体文件可离线加载；切换、下载失败、重启、文件损坏、删除当前字体有可解释结果。
- 在中文、英文、混排、emoji、组合音标、代码与 Nerd 图标上检查字形及网格；125%/150%/200% DPI 和窄窗口检查坐标。
- 保存中文笔记、长文、外部修改、切换插件，检查相同 noteId 与内容完整性。
- 终端验证启动输出、ANSI/真彩色、密码无回显、resize、复制粘贴、真实中文输入法、声音和机头反馈。
- 纸夹真实鼠标拖动、上下边界和短文变长文；字体变更后拖动定位正确。
- Press/Archive 继承字体墨色、字体缺失回退和历史快照兼容。

### 13.2 双链与文档

- A 引 B 只形成 A 的出链及 B 的反链；反向正文未引用时不能伪造 B→A。
- 删除、粘贴、重复引用、撤销、改名、重名、回收站恢复、未解析目标转为已存在目标。
- HTML 与 Markdown 的代码伪链接排除、真实引用片段定位、保护节点不丢失。
- 迁移前备份、旧记录归类、失败回滚、全量重建结果一致。
- 并行写入、旧 revision、应用退出重启和插件写入冲突。
- 用 1 万篇合成笔记及大量引用测量分页查询和重建，不用全量 IPC 拉取再在前端过滤。

### 13.3 命令与快捷键

- 每个主要模块，包括真实 Office WebContentsView、终端和插件宿主，按钮与快捷键都可打开面板。
- Office 浮层不被遮挡；嵌套浮窗关闭后恢复原文档、焦点、选区及全屏状态。
- 命令分类、中文/英文搜索、禁用原因、插件命名空间、停用卸载清理。
- 录制、冲突、互斥上下文、导入导出、升级迁移；IME/AltGr/终端常用键不被误抢。
- 大量插件命令时输入不阻塞；目标为常见设备面板打开约 150ms 内，检索约 50ms 内，实际以测量报告为准。

### 13.4 插件

- 官方示例原包的命令、设置、Modal、事件、持久化、停用与重新启用。
- 每个已验证社区插件固定原包版本及哈希，记录支持平台、工作区、编辑模式和具体通过用例。
- 未支持 API 有明确错误，不白屏、不伪成功；插件死循环可终止，失败插件不阻断应用下次启动。
- 损坏 ZIP、路径越界、部分下载、缺文件、版本不匹配、断网和升级失败。
- 停用后命令、CSS、键位、计时器、窗口、事件与后端进程确实释放。
- 已有 Agent 审批、Office 导出、WebDAV 同步与笔记复杂内容回归。

### 13.5 安装包

运行构建和相关测试；新增字体/插件宿主资源加入打包白名单，检查许可证、原生模块及平台资源。

必须在实际打包后的 Windows 应用中打开打字机、输入中英文、试听声音、切换下载字体、启动真实 PTY、打开 Office 命令面板、启用和停用样例插件。仅验证安装包进程存活不能视为这些用例通过。

交付报告区分静态检查、自动化、人工运行和未覆盖平台。未经测试的 Obsidian 插件保持待验证状态。

## 14. 官方资料与证据范围

本轮直接读取：

- Typewriter Nocturne 固定源码与 [README](https://github.com/Chaosnap/Typewriter-Nocturne)、[ARCHITECTURE](https://github.com/Chaosnap/Typewriter-Nocturne/blob/e19d64ef42b9241b462439e22d7b905b266633e1/docs/ARCHITECTURE.md)。架构文档含历史调查，具体接口以固定源码为准。
- [Obsidian API README](https://github.com/obsidianmd/obsidian-api/blob/master/README.md)：插件格式、宿主模块及生命周期。
- [Obsidian API 定义](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts)：Command、Editor、Vault、MetadataCache、registerEditorExtension 等契约。
- [官方示例插件源码](https://github.com/obsidianmd/obsidian-sample-plugin/blob/master/src/main.ts)、[manifest](https://github.com/obsidianmd/obsidian-sample-plugin/blob/master/manifest.json) 和 LICENSE。
- [Obsidian 社区插件目录](https://github.com/obsidianmd/obsidian-releases/blob/master/community-plugins.json)。目录会变化，正式安装应固定插件发行版本。
- [JetBrains Mono OFL](https://github.com/JetBrains/JetBrainsMono/blob/master/OFL.txt)、[Fira Code LICENSE](https://github.com/tonsky/FiraCode/blob/master/LICENSE)、[Cascadia LICENSE](https://github.com/microsoft/cascadia-code/blob/main/LICENSE)、[Sarasa LICENSE](https://github.com/be5invis/Sarasa-Gothic/blob/master/LICENSE)、[LXGW WenKai OFL](https://github.com/lxgw/LxgwWenKai/blob/master/OFL.txt)。

Obsidian 在线契约本轮按研究日的 master 读取，实施时需冻结 API 版本并保存兼容测试基线。未对第三方插件逐个安装运行，未下载/安装新字体，未改应用业务代码；这些属于后续实施工作。
