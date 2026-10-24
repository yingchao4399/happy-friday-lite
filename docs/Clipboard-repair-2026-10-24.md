# 3.0.6-preview.3 剪贴板修复验收

## 根因与修复

preview.2 的 `startClipboardCapture` 主动清空原生适配器，外部系统采集关闭。因此 Windows 中的复制/剪切不会进入历史；文件条目也无法重新写回 CF_HDROP。应用内复制/剪切还缺少 preload 通知，普通笔记正文缺少原生编辑菜单。

preview.3 恢复 Windows `WM_CLIPBOARDUPDATE` 监听，空闲时不轮询图片。文字、HTML、文件路径在同一次原生锁内读取，文件复制使用 CF_HDROP；剪贴板短暂占用时重试。内部键盘、编辑菜单和原生通知共用内容去重，历史写回以系统序号抑制循环，敏感内容继续加密、遮罩和排除搜索。监听初始化失败会在页面和设置中说明原因，并降级收录文本和图片。

托盘、全局快捷键、录屏自动收录、屏幕钉窗、网络二维码分享仍保持后移，不因保存设置而被意外启动。此次完成的是基础跨应用剪贴板及笔记正文编辑菜单修复。

## 验证结果

- Node 自动测试 109/109；根目录与 DSH 锁恢复测试 23/23；前端生产构建通过。
- `probe-clipboard-electron.mjs`：真实 Windows 原生通知、来源进程、文本/富文本/图片、多文件/文件夹、文件和路径分开复制、追加混合内容、代码编辑、常用语、标签/分类、搜索、排序、暂停/恢复、敏感加密/遮罩、去重及最近删除通过。
- `probe-edit-clipboard.mjs`：sandbox 开启的真实 Electron 窗口中，键盘复制、键盘剪切、正文右键菜单、菜单复制进入历史通过。
- `probe-clipboard-system-roundtrip.mjs --app-root=release/preview3/win-unpacked/resources/app`：加载最终包中真实 main.js、生产 Vue 页面、preload 和依赖，在独立 Electron 进程中执行真实 Ctrl+C/Ctrl+X，Friday 列表自动刷新；点击历史复制后，独立进程实际粘贴逐字一致。页面重载历史保留，没有自身复制循环。
- 同一最终包探针进入原版 NoteEditor，右键正文弹出编辑菜单，菜单复制进入历史，并在独立进程实际粘贴成功。
- 最终包原生审计通过，DSH Harness 依赖导入、node-addon-require-builtin 和三个 Windows PE helper 均通过。
- 按需加载 Agent/DSH 后的实际 preload/IPC 验收通过，231 项工具可列举，Harness 空闲状态及配置保存正常。

测试仅使用临时数据库、合成笔记和独立 profile。涉及系统剪贴板的探针保存并恢复原有文本、HTML、图片及文件格式，不改动用户原数据和已安装程序。

## 运行内存复核

最终打包目录、完整主进程及生产首页、四个应用进程，启用原生剪贴板监听：空闲私有物理内存 116.9–118.3MB；私有提交 244.5–246.0MB；所有进程工作集相加 323.2–324.5MB（含共享页重复计算）。没有强制 GC 或裁剪工作集。这是一轮隔离实测，不能把私有物理内存与私有提交混为同一个 200MB 指标。

日志位于 `app-data/diagnostics/performance/`，包括 `clipboard-native-restored.log`、`clipboard-system-roundtrip-packaged.log`、`packaged-native-clipboard-restored.log` 和 `idle-packaged-clipboard.json`。

## 交付范围

最终打包目录的上述功能验收已通过。当前用户安装目录仍为 preview.2，尚未被自动替换；安装后的用户环境验证、完整升级/回退及原迭代其余验收不能据此宣称完成。安装器及校验文件放在 `release/preview3/`。
