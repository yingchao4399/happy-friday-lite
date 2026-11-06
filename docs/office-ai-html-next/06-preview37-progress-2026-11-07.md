# AI HTML preview.37 迭代进度与交付门槛

记录日期：2026-11-07。状态：preview.37 已完成构建、打包版转换验收并发布 GitHub 预发行版。本文新增记录，不修改前三份需求/方案，也不替代原有 Office 总体和 PDF 专项文档。

## 1. 本次交付目标

本版只融合 AI HTML 及必要的 Friday 宿主、模型服务、构建、权限和运行时适配，生成 Windows 安装包，完成相应验收后上传授权 GitHub fork。AI Markdown 和现有四编辑器的整体 GenOffice 升级不属于本版新增范围。

HTML 来源继续固定为 GenOffice **v0.12.852**，完整提交为 `4b55db9ed1994575a695160ffc6cfd0bfc866211`。这不是“始终最新”的声明。Docs、Sheets、Slides、PDF 仍从原 `vendor/happyoffice` 构建，保留之前的 PDF 修复。

## 2. 已实施的源码工作

| 范围 | 本轮改动 | 当前证据边界 |
| --- | --- | --- |
| 构建与来源 | HTML 使用独立固定源码、独立依赖、main/preload/renderer；Friday 适配在宿主及构建插件中维护，保留上游树干净 | preview.37 完整 Office 资源重建、来源锁、打包资源校验均通过；HTML 固定 GenOffice v0.12.852，Docs/Sheets/Slides/PDF 仍使用 vendor/happyoffice |
| 模型与工具 | 使用 Friday 推理入口，保留 HTML renderer 的实际工具循环；公开能力不回传密钥，不伪造 Genspark 登录 | 合同、取消与权限专项测试；真实 HTML 模型流程仍待执行 |
| 搜索/图片 | 接入同一固定上游的搜索和 BYOK 图片实现；增加主进程 SQLite 服务配置、主窗口配置入口、owner 绑定图片引用 | 配置脱敏、提供商参数、图片 owner、取消测试通过；远端成功不由 mock 证明 |
| 文档操作 | 主助手新增 HTML 创建、分页读取、精确版本修改和原生导出；操作经工具注册表、审批及任务账本 | 原子 HTML 文件交付、主 frame 响应、取消及版本/身份测试；实际主助手自然语言验收仍待执行 |
| 文档身份 | 路由 viewId 与每次打开产生的不可复用文档身份分开；旧身份不能因为路由重用而操作新文档 | 宿主定向测试通过 |
| Stop/并发 | 附件展开、图片及 writer 保留原调用信号和执行代次，迟到结果不得覆盖新一轮；主进程服务可按原 sender 取消 | 新增取消测试通过，真实慢网络/模型取消仍需运行 |
| 历史 | 复用现有历史服务，HTML 的 project/chat 由当前文档解析后授权；拒绝其他路径、跨 frame 和关闭后的迟到解析 | 同名不同目录、越权会话及关闭/换文档定向测试通过 |
| 输出与 CLI | 接通 HTML/HTM 的 PDF、DOCX headless 分支；GUI 导出增加目标快照及临时写入，失败不退回截断旧目标 | 打包版实际验证 HTML/HTM → PDF/DOCX 四种组合 4/4 通过，DOCX 回读标题和图片，源文件未变化 |
| 安全预览 | 编辑模式生成不运行作者脚本的派生预览，只允许运行受控 inspector；演示保留原作者脚本，但拒收编辑消息 | 真实 Chromium 隔离 PoC 通过；完整 App/安装版仍需复测 |
| 资源 | 预览 URL 和资源基址加入文档独立授权引用，资源按对应文档目录解析；附件读取绑定选择后的授权 | 打包版 Office 资源 2506 项、resource digest 和来源锁已核对；安全 PoC 通过，复杂外部资源和长时间网络场景仍需用户验收 |

### 编辑和演示模式的明确差异

原上游把作者脚本与 inspector 放在同一 iframe，仅检查 `event.source` 和版本不能证明编辑消息来自可信 inspector。本版没有改写用户保存的 HTML；在编辑预览中隔离主动内容，在演示中保留脚本交互。界面有中英文提示。静态编辑、交互、模式切换、源文件保存及导出必须分别验收，不能把“脚本被拦截”单独当作功能对等证明。

## 3. 已取得的测试结果

| 执行范围 | 结果 | 如何理解 |
| --- | --- | --- |
| 一次全量脚本回归 | 561 项：558 通过、3 失败 | 保留原失败事实；日志 `artifacts/office-html-all-script-tests.log` |
| 原三项失败及相关回归定向复测 | 21/21 通过 | 修复 Windows 短路径别名处理和 preview.37 版本断言；既有 Electron 清理测试独立复测通过；不把原全量运行改写为全绿 |
| 最新 HTML/宿主/服务/身份/历史/注册表组合 | 41/41 通过 | 日志 `artifacts/office-html-current-tests.log`；属于单元和合同层，不证明远端模型或安装器 |
| 真实 Chromium 安全 PoC | 通过 | `artifacts/office-html-security-report.json`：作者脚本/事件/嵌套主动内容隔离，正常 inspector 选择返回，演示脚本运行且伪造编辑消息不被接纳 |
| 新增宿主、headless、探针及构建适配语法/diff | 通过 | 已由完整构建、打包资源门禁和最终打包版探针补齐 |

安全 PoC 的第一轮还发现了 Chromium 序列化隐藏 nonce 导致正常 inspector 不能启动的问题。已经修正可信脚本的序列化，随后真实浏览器复测通过。此前候选 Office 构建因此主动停止；该次中止不计为成功构建。

## 4. 已完成的 preview.37 交付

已完成 `npm run electron:build:win`，构建链包含 Office build、Office verify、DSH、主进程 import graph、Vite、electron-builder、打包资源和启动 smoke。最终安装包：`release/Happy-Friday-Lite-3.0.7.01-preview.37-win-x64-setup.exe`，269,984,906 bytes，SHA-256 为 `28E71D7C04D307EA8B794330A3B7C7A18AD7D7CE8D52EF45F608748183A5AD3C`。

打包版 `release/win-unpacked/Happy Friday Lite.exe` 已通过 `probe-office-html-headless.mjs`：HTML/HTM 到 PDF/DOCX 四种组合全部成功；DOCX 回读 marker 和 `word/media/` 图片，输入源 hash 保持不变。`verify-packaged-office.mjs`、`verify-packaged-native-modules.mjs`、`smoke-electron-startup.mjs` 均通过。

源码已推送到 `yingchao4399/happy-friday-lite` 的 `codex/friday-3.0.7-preview.28`，子仓库修复已推送到 `yingchao4399/happyoffice` 的 `codex/hf-perf-preview.27`。GitHub 预发行版已发布：<https://github.com/yingchao4399/happy-friday-lite/releases/tag/3.0.7.01-preview.37>。

## 5. 尚未关闭的边界

1. 真实用户安装、升级、卸载、回滚和数据保留尚未在隔离用户环境完成；安装包未签名。
2. HTML-01～HTML-12 中的自然语言 AI 规划、真实远端搜索/图片/视频 provider、长耗时取消和复杂多文档资源场景需要用户填写 API 后验收。
3. 本版只融合 AI HTML；AI Markdown 和 Docs/Sheets/Slides/PDF 的整体 GenOffice v0.12.852 对等升级仍按总体方案后续推进。
4. PDF→Excel/PPT 本版没有新增转换引擎；本版修复的是 PDF→Word，以及 HTML/HTM→PDF/DOCX 路径。
5. 复杂页面视觉保真、真实扫描件 OCR、任意外部字体和大文件性能仍需专项样本验收；当前证据证明可交付和可回读，不宣称所有版式完全一致。

上述边界不影响 preview.37 安装包和源码已经生成并上传，但不能把本版描述成全部 Office 已完成 GenOffice 最新版融合。

## 6. 证据文件

- [最新 HTML 定向测试日志](../../artifacts/office-html-current-tests.log)
- [原全量回归日志](../../artifacts/office-html-all-script-tests.log)
- [三项失败的定向复测](../../artifacts/office-html-regression-rerun.log)
- [真实预览安全报告](../../artifacts/office-html-security-report.json)
- [当前完整 Office 构建日志](../../artifacts/office-html-full-build-r2.log)
- [最终打包版 HTML/HTM headless 报告](../../artifacts/office-html-headless-report.json)
- [最终打包版 HTML runtime 报告](../../artifacts/office-html-runtime-report.json)
- [preview.37 构建信息](../../release/preview.37-build-info.txt)
- [原规划与验收入口](index.html)
