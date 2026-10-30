# Happy Friday Lite 3.0.6.02-preview.21 交付记录

日期：2026-10-30
技术版本：`3.0.6-preview.21`
发布标签：`3.0.6.02-preview.21`

## 本轮已完成

- 主对话、Office Docs/Sheets/Slides/PDF、笔记、知识库普通/Agent、日程和 Friday Dock 均使用独立会话范围，支持历史列表、选择、恢复、新建和续聊。
- Office 项目存储支持同一文件多条 AI 会话，文件切换和保存/重命名不会把历史串到其他文件。
- Office AI 通过 Electron `net.fetch` 使用 Friday 的 DeepSeek 配置；配置错误不再显示成网络错误，SSE 断流、取消、429/5xx、鉴权和传输错误有分类和安全重试边界。
- Dock 有输入框和独立历史，支持标题栏/触发器拖动、位置约束和 Office overlay 移动；设置支持隐藏/显示、形象、分身模式和 Agent 偏好，并明确 AI Core 自动调度回退状态。
- Typewriter 图片统一走受限 `friday-asset://` 资源协议，编辑/预览/普通笔记/重开一致；长文输入和舞台重绘解耦，真实 Electron 输入事件 P95 为 5.5ms。
- Obsidian 宿主补齐常用公开 API；固定 10 个社区插件启停/重启兼容探针全部通过。
- PRD、技术设计、下一轮迭代方案和兼容矩阵已同步 Preview.21 实际实现。

## 验证记录

- `node --test scripts/tests/*.test.mjs`：288/288 通过。
- `node --test scripts/*.test.cjs`：20/20 通过。
- `npm run office:build`：通过，Docs/Sheets/Slides/PDF 资源已重新生成。
- Office ProjectStore：65/65；UI：9/9；Docs/Sheets/Slides/PDF typecheck 全部通过。
- `npx electron scripts/probe-obsidian-runtime.mjs`：通过。
- `npx electron scripts/probe-plugin-runtime.mjs`：通过。
- `npx electron scripts/probe-obsidian-compatibility.mjs`（使用已登录 GitHub API）：10/10 通过。
- `npx electron scripts/probe-typewriter-workspace.mjs`：通过；无运行时错误，图片/预览/路由返回/草稿恢复均通过。
- `scripts/probe-office-ai-stream.mjs`：真实 Office SSE 与错误分类通过。
- `node scripts/verify-packaged-native-modules.mjs --appDir release/win-unpacked`：通过，Harness、Node addon 和 3 个 Windows PE helper 均可加载。
- `node scripts/probe-packaged-workspace.mjs 6`：通过；安装包真实输入、字体、终端、命令面板、Office 原生视图、插件宿主和社区插件共 13 项检查全部通过。

## 最终交付记录（打包后填写）

- 安装包：`release/Happy-Friday-Lite-3.0.6.02-preview.21-win-x64-setup.exe`
- SHA256：`4A3DF4C29C3763FC233A99832473E40924B1E359B2087CECD1EA785AA5CE27B4`。
- GitHub Release：`https://github.com/yingchao4399/happy-friday-lite/releases/tag/3.0.6.02-preview.21`。
- 直接下载地址：`https://github.com/yingchao4399/happy-friday-lite/releases/download/3.0.6.02-preview.21/Happy-Friday-Lite-3.0.6.02-preview.21-win-x64-setup.exe`。
- 安装包大小：268,755,226 bytes。

未配置代码签名，安装器可能显示 Windows 未签名提示；文件内容以 SHA256 和 Release 资产校验为准。
