# 交付门禁审计

日期：2026-10-24。版本：3.0.6-preview.2。实施基线为已安装、包含先前 AI Core 扩展的 3.0.6 独立副本。

当前未达到整轮完成条件，没有最终更新包或 GitHub 发布。本报告核对已有证据和交付脚本，不替代实际安装版验收。

## 本次确认的进展

| 项目 | 已确认的证据 | 仍须完成 |
| --- | --- | --- |
| 真实用户数据副本 | 430,559,232 字节数据库、16 张原表/4,043 行保持；8 张新增表升级、保留新数据的回滚、安装 3.0.6 模块重开、幂等重升级、正式快照恢复全部通过；原源文件/配置/会话哈希保持 | 安装器替换、完整资源业务目录恢复、升级/回退/卸载/重装 |
| 最近删除与模块排序 | 正式 Vue/preload/IPC 混合恢复、冲突、缺失目标、替代位置、导出、永久删除审计；稳定 ID、重载/语言、键盘、DragEvent；Office 显隐持久化修复 | 原生目录选择器、鼠标/触控板拖放及最终安装版 |
| 剪贴板文件/媒体 AI | DOCX 与未转写 WAV 经实际 Windows SAPI 和现有真实模型 2 次请求，保存笔记并保留来源；UI/IPC、独立转写设置、取消/隐私竞争保护；58 项兼容回归和后续 8 项专项通过 | 常用真实录音/编码、可配置模型服务、最终安装版完整系统场景 |
| 系统打印 | Word 与 Excel 真实 Microsoft Print to PDF 输出、解码/内容、源文件和 dirty 保护已有日志 | Slides 方向修复后的真实重验、PDF 输出及取消退出；以根代理最新记录为准 |
| Office 性能 | 首次引擎按需加载、空编辑器预挂载、单次撤销栈重置、样式库布局改进已完成回归 | 最新报告中 Ribbon/实际输入仍超过基线 80%；总启动耗时改善不能替代此门禁 |

详细证据分别见 Data-trash-module-order-acceptance-2026-10-24.md、Clipboard-media-ai-acceptance-2026-10-24.md、Office-startup-acceptance-2026-10-24.md 和 Office-menu-export-selection-acceptance-2026-10-24.md。

## 本次修复的交付脚本缺口

1. `.gitignore` 的全局 `*.md` 规则忽略 Office、DSH、背诵和剪贴板媒体验收报告；新增明确例外，防止发布源码漏掉证据。
2. `scripts/afterpack.cjs` 原先会删除 Electron 的 `LICENSES.chromium.html`。删除逻辑已移除，Windows/Linux 缺少该文件时拒绝生成许可证完成报告。
3. 应用自身 `LICENSE` 明确进入构建白名单；最终 resources 写入 `LICENSE-Friday.txt`。
4. afterPack 使用当前 vendor 的官方生成器，聚合 Office、字体、Unicode、Rust sidecar notices，再合并实际收集的应用 npm 依赖。前端另按 src 导入和依赖闭包补入 Vue、TipTap 等虽声明为 devDependencies、但已打入界面的组件，排除未被引用的构建工具。源包只在名称和版本一致时用于补齐被白名单排除的 `LICENSE.md`；产物中的文本优先。
5. 缺少许可证文本不会静默省略：`resources/third-party-notices-audit.json` 保存名称、版本和声明，发布前必须审查。这些元数据不含用户数据或路径。

新增 `scripts/third-party-notices.test.cjs` 的六项检查与旧 afterPack 六项共 **12/12 通过**，日志 `app-data/diagnostics/delivery-notices-tests.log`。覆盖 Chromium 原字节保留、许可证/NOTICE/字体/本机文本实际写入、错误源版本拒绝补齐、缺失记录、目录链接不遍历、Vue 单文件组件导入及其依赖闭包、只有 NOTICE 时仍报告缺少许可证。首次运行仅清理钩子的 root 参数遗漏而失败，补齐边界后完整通过；没有把失败记录当作通过。

官方生成器已实际运行：568 个 npm 包、144 个 Rust crate，约 1.4MB 输出。它报告 18 个未发布许可证文件的包，以及源扫描误识别的 `list`、`bold`；必须核对实际入包内容和相应归属。当前不把许可证门禁记为完成，尚未执行本次新 hook 的完整 Windows afterPack。

新聚合器另在真实源码上执行前端与 Office 范围的开发运行，识别 228 个前端依赖，保留实际 Electron notices。输出位于 `app-data/diagnostics/notices-development/`，汇总见 `delivery-notices-development.log`。前端范围的缺失文本为 `@napi-rs/canvas-win32-x64-msvc@1.0.0`、`@somecat/epub-reader@0.1.11`、`@vue/devtools-api@6.6.4`。这次未构造最终收集的主进程 node_modules，不能表述为最终包全部依赖审计通过。

## 仍缺的交付证据

- Windows 原生依赖的最终产物验证：现有 `verify-packaged-native-modules.mjs` 固定 Linux 目录与 ELF 检查，Windows 构建命令只在打包前执行开发树 `verify:dsh`，不能替代最终目录/安装目录的 ESM 依赖、MCP 插件和最小任务。
- 剪贴板真实手机 LAN/多网卡/防火墙、系统应用互拷/敏感确认、钉窗原生拖动和实际录屏自动收录。
- Office 剩余全部命令、复杂文件、真实打印、触控板、最终安装版首开 80% 指标及完整 UI/UX 动效核对。
- 真实口音/噪声/常用音频编码、学习分析和出题质量，及配置模型的服务兼容性。
- 安装、升级、回退、卸载、重装、桌面图标启动与数据保留；DSH 在实际安装版完成最小任务。
- 最终产物敏感数据扫描、完整 notices 核对、SHA256、版本说明、已知限制和全部完成/未完成清单；随后才发布用户授权目标。

本报告不提供估算百分比。任务以逐项证据和明确剩余项管理，不提前宣称整轮完成。
