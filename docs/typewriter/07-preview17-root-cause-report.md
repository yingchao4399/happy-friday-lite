# Preview 17：用户反馈问题的根因与验收报告

版本：`3.0.6-preview.17`。平台：Windows x64 / Electron 42.2.0。

本轮针对 Preview 16 实际使用中暴露的问题修复。之前的构建和功能探针未覆盖设置入口的可见性、笔记首页事件接线和终端真实渲染颜色，不能据此认定用户体验已经通过。本轮增加对应的实际交互和像素回归。

## 1. 终端为什么一直发黄、墨色为什么与笔记不同

### 根因一：亮色字段属于两套 API

Nocturne/Hyper 的调色板使用 `lightYellow`、`lightMagenta` 等字段，xterm 使用 `brightYellow`、`brightMagenta`。原适配直接展开原作 ANSI 对象，没有转换亮色字段。xterm 因而使用自身的默认亮黄色，而不是原作适配纸张的颜色。

现在通过 `terminal-theme.js` 显式转换全部 16 个 ANSI 槽位。普通文本前景继续使用共享墨色，保留 shell 主动输出的 ANSI 语义颜色，不修改 PTY 数据。

### 根因二：透明背景隐藏了错误的黑色 RGB

原适配给终端设置 `#00000000`。视觉上透明，xterm 的最低对比度算法却以其中的黑色 RGB 计算，忽略后方实际可见的浅色纸张。深色墨水被提亮，在浅纸上变灰、变淡；高亮黄色也没有按浅纸获得正确调整。

现在终端背景使用纸张实际 RGB，透明度仍为零，例如 `rgba(241, 233, 214, 0)`。这让终端保留纸张纹理，同时以正确背景计算对比度。构造和设置热更新共用同一转换函数；配置桥同步保留自动对比度/精确 ANSI 策略，不再覆盖用户选择。

### 实际 Canvas 渲染对比

脚本 `scripts/probe-terminal-colors.mjs` 加载真实 xterm CanvasAddon，在相同浅纸上比较旧配置与新配置，采样文字像素；同时验证夜间纸张和透明空白区域。

| 文字类型 | 旧版主要 RGB | 修复后主要 RGB | 浅纸对比度变化 |
| --- | --- | --- | --- |
| 普通正文 | 132,125,120 | 42,32,25 | 约 3.35 → 13.17 |
| ANSI 亮黄 | 252,233,79 | 133,100,23 | 约 1.03 → 4.53 |
| ANSI 亮品红 | 173,127,168 | 140,74,126 | 恢复原作对应槽位 |
| 显式真彩黄色 | 255,255,0 | 108,108,0 | 自动模式下约 4.59 |

PowerShell/PSReadLine 的语法高亮仍可能有黄色。这表示终端程序指定了颜色。普通文字跟随 Studio 墨色；需要保留程序原始颜色时可关闭自动对比度。最低对比度设置现已接回 Studio，范围 1–21。

## 2. 字体切换与原作 Studio

终端实时更新字体、字号、共享墨色和对比度，不重建 xterm 或 PTY。验证四款本地字体 JetBrains Mono、Fira Code、Sarasa Mono SC、Courier Prime 及字号 20：检查实际 `fontFamily`、字符单元尺寸、中文输出保留和 PTY ID 不变。

Studio 的原生蓝色 checkbox 换回 Nocturne 自身的黄铜 Switch。墨色预览改成原作深色面板文字、色样和颜色值，移除突兀的白底预览；最低对比度使用原作 Slider。保留机器、纸张、声音、回形针和原作二级菜单结构。

此处的字体热切换测试不等于对所有字体、所有主题组合重新逐项验收；系统实际音频输出和硬件 GPU 的全部组合也未据此认定通过。

## 3. 设置入口、字体与命令面板

原来的入口是无样式的链接，布局又依赖其他设置页面懒加载的 CSS；源码存在路由不代表用户能看见正式入口。现在在通用设置顶部增加三行正式设置项：快捷键、插件管理、插件市场，含说明和箭头。

新增共享设置样式，统一既有 Settings 的 UI 字体、720px 内容宽度、24px 标题、正文、灰色分组和控件。删除插件/快捷键页面泄漏到其他模块的未隔离样式。命令面板使用同一 UI 字体，分类/元信息保持一致层次。

删除 Sidebar 底部重复命令按钮，保留左上角 TabBar 按钮及快捷键。可用命令在搜索结果中优先显示。

## 4. Office 命令不是前端占位按钮

命令注册中心增加新建 Word/表格/演示、打开文件，以及当前文档对应的保存、另存为、撤销、重做、打印和适用导出命令。

执行链：命令面板 → preload 白名单 → 主进程专属 IPC → 当前可见 Office 视图 → 原有菜单通道。Word、表格、演示分别使用上游实际的 `menu:command`、`menu:action`、`slides:menu`；主进程检查调用者、当前视图和按编辑器类型限定的命令白名单。

实际运行验证包含新建 Word、插入测试正文、通过命令面板撤销/重做、打开真实打印预览并检查“打印设置”。没有向物理打印机发送任务，也没有将未逐项执行的全部导出对话框声明为通过。

## 5. 笔记引用为什么不能点

发现四条独立断路：

1. 主笔记页 `NoteList.vue` 未处理编辑器发出的 `open-note`，也没有挂载双链面板。只有独立编辑页存在部分处理。
2. `friday://notes/…` 内链被当成普通外链处理，编辑器协议配置不完整。
3. 引用卡片缺少点击和键盘行为；完整 WikiLink 没有可点击装饰。
4. 跨 Vue/React 的标题定位依赖固定延迟，编辑器尚未挂载时事件会丢失。

打包回归进一步发现：后台 KeepAlive 笔记编辑器可能与打字机显示同一 noteId，提前消费其定位请求。现在定位请求带有目标编辑器标识；后台笔记页不能取走打字机请求。回归实际检查主笔记页的标题选区和打字机光标的 Markdown 标题位置。此外兼容 Turndown 转义后的 WikiLink 方括号，确保加载已有笔记后仍能 Ctrl/Cmd+点击。

现在主笔记页、独立笔记页和打字机共用目标解析规则，支持稳定 noteId、标题、标题锚点和别名。标题重名、目标删除或缺失时不随意跳转，交给未解析面板处理。原始 WikiLink 排除代码块、行内代码和已有链接标记。定位请求在目标编辑器挂载后消费，不依赖猜测延时。

主笔记页新增链接按钮和出链/反链面板。引用卡片支持点击与 Enter/Space；富文本内链和完整 WikiLink 支持点击；打字机保持纯文本输入，使用 Ctrl/Cmd+点击。

### 双链怎么用

在笔记 A 中输入 `[[笔记 B 的标题]]`，保存后 A 的出链出现 B，B 的反向链接出现 A。只写一次即可，不需要在 B 中再写 A。可使用 `[[笔记 B#章节标题|显示别名]]`。主笔记页顶部链接按钮打开面板；面板自带展开的使用说明。未解析目标使用单独的创建按钮，避免把失效链接当成可跳转目标。

## 6. 构建稳定性

Windows 构建时曾无法截断被映射的生成文件，报 `user-mapped section open`。主进程/插件宿主先在内存生成：相同内容不写磁盘，变化内容经同目录临时文件完整写入后替换。失败仍会停止构建，不跳过生成步骤。没有终止用户正在运行的安装版程序。

## 7. 验证与交付记录

- `node --test 'scripts/tests/*.test.mjs'`：239 通过，0 失败。
- `node --test 'scripts/*.test.cjs'`：20 通过，0 失败。
- 生产前端构建通过；仅有大 chunk 提示。
- 真实 Canvas 颜色回归通过，报告 `artifacts/typewriter/terminal-colors-report.json`。
- Windows 打包应用交互验收、快捷键验收及原生模块审计见本报告末尾交付记录。

验证使用临时隔离数据目录，不在用户笔记库中写测试内容。截图和 JSON 报告保存在 `artifacts/typewriter/`。macOS/Linux 未运行验收。Obsidian 社区目录和发行包可下载不代表所有插件/API 完全兼容，沿用按插件版本标注兼容范围的约定。

截图：[设置入口](../../artifacts/typewriter/preview17-settings.png)、[命令面板](../../artifacts/typewriter/preview17-palette.png)、[插件管理](../../artifacts/typewriter/preview17-plugins.png)、[插件市场](../../artifacts/typewriter/preview17-plugin-market.png)、[快捷键](../../artifacts/typewriter/preview17-shortcuts.png)、[终端及原作机身](../../artifacts/typewriter/preview17-terminal.png)、[Office 打印预览](../../artifacts/typewriter/preview17-office-print.png)、[笔记双链](../../artifacts/typewriter/preview17-note-links.png)。

### 最终交付记录

- `preview17-packaged-report.json`：`ok: true`，四组实际应用交互全部通过，未捕获未处理的前端错误。涵盖正式设置入口和字体规格、Office 原生菜单、真实 PTY 与字体热切换、主笔记页和打字机引用导航。
- `packaged-shortcuts-report.json`：`ok: true`，录制与主进程持久化、清除与默认键恢复、保留键/冲突提示、真实 JSON 文件导入导出四组通过。
- `preview17-native.log`：打包 Harness 导入、原生绑定加载及三个 Windows PE helper 审计通过。
- Windows 可执行文件 `FileVersion`：`3.0.6-preview.17`；打包内 `package.json` 版本相同。Windows 数字 `ProductVersion` 字段为 `3.0.6.0`，预发布标识以 FileVersion 和应用语义版本为准。
- 本轮命令：`node scripts/probe-preview17-regressions.mjs`、`node scripts/probe-packaged-shortcuts.mjs`、`node scripts/verify-packaged-native-modules.mjs x64 --appDir release/win-unpacked`。
- 安装包目标：`release/Happy Friday Lite-3.0.6-preview.17-win-x64-setup.exe`，交付摘要以 `release/SHA256SUMS-preview.17.txt` 与 `artifacts/typewriter/delivery-manifest.json` 为准。
