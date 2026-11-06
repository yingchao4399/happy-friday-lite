# AI HTML preview.37 迭代进度与交付门槛

记录日期：2026-11-07。状态：研发与验收中，尚未形成可交付的 preview.37 安装包。本文新增记录，不修改前三份需求/方案，也不替代原有 Office 总体和 PDF 专项文档。

## 1. 本次交付目标

本版只融合 AI HTML 及必要的 Friday 宿主、模型服务、构建、权限和运行时适配，生成 Windows 安装包，完成相应验收后上传授权 GitHub fork。AI Markdown 和现有四编辑器的整体 GenOffice 升级不属于本版新增范围。

HTML 来源继续固定为 GenOffice **v0.12.852**，完整提交为 `4b55db9ed1994575a695160ffc6cfd0bfc866211`。这不是“始终最新”的声明。Docs、Sheets、Slides、PDF 仍从原 `vendor/happyoffice` 构建，保留之前的 PDF 修复。

## 2. 已实施的源码工作

| 范围 | 本轮改动 | 当前证据边界 |
| --- | --- | --- |
| 构建与来源 | HTML 使用独立固定源码、独立依赖、main/preload/renderer；Friday 适配在宿主及构建插件中维护，保留上游树干净 | 独立 HTML 编译曾通过；最新完整 Office 资源重建进行中 |
| 模型与工具 | 使用 Friday 推理入口，保留 HTML renderer 的实际工具循环；公开能力不回传密钥，不伪造 Genspark 登录 | 合同、取消与权限专项测试；真实 HTML 模型流程仍待执行 |
| 搜索/图片 | 接入同一固定上游的搜索和 BYOK 图片实现；增加主进程 SQLite 服务配置、主窗口配置入口、owner 绑定图片引用 | 配置脱敏、提供商参数、图片 owner、取消测试通过；远端成功不由 mock 证明 |
| 文档操作 | 主助手新增 HTML 创建、分页读取、精确版本修改和原生导出；操作经工具注册表、审批及任务账本 | 原子 HTML 文件交付、主 frame 响应、取消及版本/身份测试；实际主助手自然语言验收仍待执行 |
| 文档身份 | 路由 viewId 与每次打开产生的不可复用文档身份分开；旧身份不能因为路由重用而操作新文档 | 宿主定向测试通过 |
| Stop/并发 | 附件展开、图片及 writer 保留原调用信号和执行代次，迟到结果不得覆盖新一轮；主进程服务可按原 sender 取消 | 新增取消测试通过，真实慢网络/模型取消仍需运行 |
| 历史 | 复用现有历史服务，HTML 的 project/chat 由当前文档解析后授权；拒绝其他路径、跨 frame 和关闭后的迟到解析 | 同名不同目录、越权会话及关闭/换文档定向测试通过 |
| 输出与 CLI | 接通 HTML/HTM 的 PDF、DOCX headless 分支；GUI 导出增加目标快照及临时写入，失败不退回截断旧目标 | 源码和适配编译检查；实际四种 headless 组合、完整导出与安装版待验收 |
| 安全预览 | 编辑模式生成不运行作者脚本的派生预览，只允许运行受控 inspector；演示保留原作者脚本，但拒收编辑消息 | 真实 Chromium 隔离 PoC 通过；完整 App/安装版仍需复测 |
| 资源 | 预览 URL 和资源基址加入文档独立授权引用，资源按对应文档目录解析；附件读取绑定选择后的授权 | 最新主 bundle 尚待实际加载与跨 view 攻击验证，不将代码存在当作安全验收完成 |

### 编辑和演示模式的明确差异

原上游把作者脚本与 inspector 放在同一 iframe，仅检查 `event.source` 和版本不能证明编辑消息来自可信 inspector。本版没有改写用户保存的 HTML；在编辑预览中隔离主动内容，在演示中保留脚本交互。界面有中英文提示。静态编辑、交互、模式切换、源文件保存及导出必须分别验收，不能把“脚本被拦截”单独当作功能对等证明。

## 3. 已取得的测试结果

| 执行范围 | 结果 | 如何理解 |
| --- | --- | --- |
| 一次全量脚本回归 | 561 项：558 通过、3 失败 | 保留原失败事实；日志 `artifacts/office-html-all-script-tests.log` |
| 原三项失败及相关回归定向复测 | 21/21 通过 | 修复 Windows 短路径别名处理和 preview.37 版本断言；既有 Electron 清理测试独立复测通过；不把原全量运行改写为全绿 |
| 最新 HTML/宿主/服务/身份/历史/注册表组合 | 41/41 通过 | 日志 `artifacts/office-html-current-tests.log`；属于单元和合同层，不证明远端模型或安装器 |
| 真实 Chromium 安全 PoC | 通过 | `artifacts/office-html-security-report.json`：作者脚本/事件/嵌套主动内容隔离，正常 inspector 选择返回，演示脚本运行且伪造编辑消息不被接纳 |
| 新增宿主、headless、探针及构建适配语法/diff | 通过 | 不代替完整构建、加载和文件回读 |

安全 PoC 的第一轮还发现了 Chromium 序列化隐藏 nonce 导致正常 inspector 不能启动的问题。已经修正可信脚本的序列化，随后真实浏览器复测通过。此前候选 Office 构建因此主动停止；该次中止不计为成功构建。

## 4. 当前正在执行

正在执行 `npm run office:build:preview-html`，日志为 `artifacts/office-html-full-build-r2.log`。构建输入在这轮重建期间冻结。完成后先检查实际 main 导出、manifest 与来源，再运行真实 HTML 宿主/导出和 headless 探针。旧 preview.36 包不能作为本轮 HTML 交付。

当前 GitHub 授权账号为 `yingchao4399`，已确认对 `yingchao4399/happy-friday-lite` 有推送权限；这只证明可以发布，不表示已经上传 preview.37。

## 5. 尚未关闭的交付条件

1. 最新完整 Office 构建成功；真实加载新增服务、预览协议及文档操作，保持四类原编辑器可用。
2. HTML-01～HTML-12 的最终候选验收：文件/模式/可视控件、AI 规划与 writer、历史、附件、资源、演示、导出、打印和 CLI。未运行的项继续记为待验收。
3. 实际文本模型工具循环、真实搜索和有效配置的图片生成。现有可确认模型为 DeepSeek 文字模型；图片服务配置尚需确定，不用本地模拟成功替代远端验收。
4. 跨文档资源/附件、伪造消息、迟到响应、外部变化、失败/取消、权限和性能测试；安全 PoC 不能关闭全部安全矩阵。
5. 可取得的 Friday/vendor 源码提交与来源锁、匹配 manifest、可重建证据和新旧功能回归。
6. Windows 安装包及 blockmap、SHA256、更新元数据；无源码安装态验证、旧版升级/数据保留和回滚检查。
7. GitHub 源码、Release 和安装包上传，核对远端资产及哈希，并提供实际下载链接。

上述项目完成之前，不宣称“全部融合完成”“安装包已生成”或“GitHub 已上传”。

## 6. 证据文件

- [最新 HTML 定向测试日志](../../artifacts/office-html-current-tests.log)
- [原全量回归日志](../../artifacts/office-html-all-script-tests.log)
- [三项失败的定向复测](../../artifacts/office-html-regression-rerun.log)
- [真实预览安全报告](../../artifacts/office-html-security-report.json)
- [当前完整 Office 构建日志](../../artifacts/office-html-full-build-r2.log)
- [原规划与验收入口](index.html)
