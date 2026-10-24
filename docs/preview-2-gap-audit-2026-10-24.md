# 3.0.6-preview.2 计划对照与交付门禁审计

日期：2026-10-24（Asia/Shanghai）
基线：已安装、包含先前 AI Core 扩展的 3.0.6，开发副本 `Friday-3.0.6-preview.1-source`。
候选包：`release/Happy-Friday-Lite-3.0.6-preview.2-win-x64-setup.exe`
SHA256：`23570D494CE8ADB41F98661F5043E33071FD77B2E795EBEDDB341AD7EC2686B1`

## 已完成并有当前证据

- 前端生产构建通过，版本为 `3.0.6-preview.2`。
- DSH 依赖动态导入检查通过；打包目录含 dsh、typebox、llm-pi、MCP 入口。
- Office 原生 Windows 打印 helper 已进入 `resources/office/native`；候选包中含 `system-print.exe`、`xlsx-sidecar.exe`、`win-ocr.exe`。
- Word/Excel/Slides 打印参数面板已接入；原生打印桥实测生成横向 PDF，纸张宽度大于高度，正文 OCR 通过。
- PDF 打印新增真实 PDF.js 预览、页面范围、缩放、份数、颜色、逐份、单双面参数，类型检查通过。
- 应用内剪贴板历史、媒体/图片/代码预览、搜索/标签/分类/备注/收藏/排序/敏感保护保留；本轮外部系统监听、托盘、全局快捷键、录屏自动收录、屏幕钉窗、二维码/LAN 分享已关闭并隐藏主要入口。
- 21 项 Office/剪贴板回归测试通过，主前端构建通过。
- 候选 `win-unpacked/Happy Friday Lite.exe` 使用独立 user-data 目录存活 9 秒启动检查通过；未触碰当前已安装实例。
- GitHub fork 发布分支：`https://github.com/yingchao4399/happy-friday-lite/tree/codex/friday-3.0.6-preview.2`；Release：`https://github.com/yingchao4399/happy-friday-lite/releases/tag/v3.0.6-preview.2`。

## 仍未达到整轮计划完成条件

1. Office 四类最终安装版的鼠标、键盘、触控板、右键、保存/另存为/打印/导出完整验收。
2. PDF、Slides 打印真实安装版输出与取消/失败状态；候选版启动由于已有安装版单实例占用，隔离启动尚未完成。
3. Office Shell 首开/首次可输入性能 80% 目标仍未达成；大型文件、连续打开关闭 20 次和最终安装版指标未完成。
4. 选项卡滚轮、全应用横向滚轮、官方 UI/UX 动效需要最终安装版逐模块对照。
5. DSH 安装图标启动、最小任务、升级后重启；真实用户数据升级/回退/卸载/重装。
6. 背诵音频真实口音/噪声/常用编码、配置模型服务质量和安装版端到端验收。
7. 完整 notices 仍有 25 个组件需要人工核对；安装器未签名。
8. GitHub 源码提交、子模块可重建、发布和下载链接核验尚未完成。

## 本轮明确后移

跨应用系统剪贴板监听、托盘浮窗、全局快捷粘贴、手机 LAN/二维码分享、屏幕任意位置钉窗和录屏自动收录。AI Native 高级员工自主调度继续只保留接口，不在本轮伪装成已完成。

## 结论

该文件和安装器是可用于下一步安装验证的候选交付物，不代表原始计划的所有门禁均已通过。当前不应把上述未完成项写成“已完成”。
