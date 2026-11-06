# Friday AI HTML 实施记录与验收账本

日期：2026-11-06。状态：实施中，完整 AI HTML 对等尚未完成。本文记录前三份方案的实际落实，不改变 HTML-01 至 HTML-12 的全部 P0 范围，也不以构建原型替代产品验收。

## 1. 目标和完成条件

交付与固定 GenOffice 目标版本对等的 AI HTML 应用：文件与标签生命周期、源码和可视编辑、预览及演示、AI 规划与结构化操作、模型/搜索/图片/附件、历史、保存、导出、打印和目标支持的 CLI/headless。所有适用子项必须在最终候选包中逐项验收，并完成预览隔离、多文档权限、冲突和取消、安装升级回滚。

当前源代码接入、单元测试、独立编译、真实 Electron 运行、真实模型流程、完整对等和发布是分开的证据层。原 PDF 专项的 preview.36 包不包含本次 HTML 接入，不能沿用其通过记录作为 HTML 的交付依据。

## 2. 本轮来源和架构决定

HTML 实施目标固定为官方 `v0.12.852`，commit `4b55db9ed1994575a695160ffc6cfd0bfc866211`。独立来源锁为 `office-html-upstream.lock.json`，用途明确为 `html-only`。这不声称它始终是最新版本，也不表示现有四类编辑器已经升级。

当前四类编辑器继续从 `vendor/happyoffice` 构建，HEAD 为 `8ed0c8d099c3c3d87b1a998d9189da3d120ff820`，保留 Friday 现有修改与 PDF 修复。HTML 及其完整依赖来自单独的 `vendor/genoffice-html` 固定官方树，并使用单独的依赖安装。该目录是由同步命令获取的构建输入；最终重建需要源码锁、同步脚本和可获取的固定官方提交，不能只依赖某台机器上的研究仓库。

选择独立构建的实际原因是候选 `electron-utils` 删除了旧版四编辑器仍引用的多项打印接口，直接替换会破坏现有构建；`project-store` 也存在 Friday 私有历史会话接口差异。静态盘点显示 HTML 的保守 workspace 闭包为 HTML 加十四个共享包，还跨应用引用 Docs 的 icons；仅复制 HTML 目录或八个直接依赖不能保证完整性。

同步操作只创建不存在的目录，或复用经校验的同提交干净源码。不同提交、错误 origin、dirty 源码及异常目录均拒绝，不 reset 或覆盖已有用户修改。失败 stage 保留以供诊断，不自动作为成功源码。锁与 HEAD、官方 origin、依赖锁 hash、源码 dirty 和实际树身份分别检查。

## 3. 已接入的构建与准入合同

新增 HTML main entry，直接重导出 `html-main`，不执行上游独立应用启动入口。语言与 headless 状态从同一依赖图额外导出，供宿主显式注入，避免各 bundle 的内部状态互不相通。

`node scripts/sync-office-html-upstream.mjs` 获取固定源码；`npm run office:build -- --experimental-html` 才增加 HTML main/preload/renderer 及对应来源。默认构建仍是四类编辑器。HTML 的附件解析和资源也从独立官方树打包，不能悄悄使用旧 vendor 的 parser。

HTML registry 保持 `enabled:false`，标记 `experimental:true`；默认 `.html/.htm` 文件关联不变。实验 manifest 项必须带 `releaseState:experimental`，包含真实 required exports，并拥有独立的 `sources.html` 身份。产物清单不能自行批准应用启用；宿主只有在显式实验开关和真实合同验证通过后才加载。完整资源校验覆盖实验资源，正式 clean release 门禁拒绝未完成验收的实验应用。

宿主开关为 `FRIDAY_OFFICE_EXPERIMENTAL_HTML=1`。能力查询根据实际加载状态返回可用性；前端按可用性显示内部入口。缺包、混版、缺 hook、开关未开或校验失败都必须保持不可用。实验代码路径还需实际 Electron 联调，不能把接口设计当作已经通过的用户流程。

## 4. T00–T10 当前实施状态

| 任务 | 当前状态 | 已有事实 | 尚未关闭的退出条件 |
|---|---|---|---|
| T00 来源、功能矩阵与差异 | 部分完成 | HTML 固定来源锁、官方 clean checkout、依赖闭包和共享接口差异盘点 | 全部功能/工具/语言子项清单、许可、受控差异与最终评审归档 |
| T01 依赖和工具链 PoC | 进行中 | 当前旧 vendor HTML 独立编译通过；该结果不属于固定官方目标 | 官方目标独立依赖、编译、Electron 42 启动和旧四类编辑器回归 |
| T02 main/preload/renderer 与 manifest | 部分完成 | entry、实验构建、来源身份和合同验证代码已接入，准入负向测试已有通过记录 | 固定官方树生成完整 fresh 资源、真实 main 导入与缺失/混版失败报告 |
| T03 宿主、协议、路由与标签 | 代码已接入，待真实运行 | 能力门控、显式 HTML 打开、保存/关闭确认、Tab/演示生命周期已写入；宿主与前端各八项专项通过 | 多窗口新建/打开/保存/关闭取消、单一协议注册和旧功能实际回归 |
| T04 文档身份、revision 与原子操作 | 未关闭 | 方案已定义 | HTML 实际源状态、并发手改、冲突、整批原子、取消及恢复报告 |
| T05 AI transport 与完整工具 | 未关闭 | 既有 Friday 模型桥可作为适配起点 | 固定目标工具、澄清、队列、流式 writer、真实模型及错误/Stop 全流程 |
| T06 搜索、媒体、图片及附件 | 未关闭 | 已识别 placeholder 和配置体系不一致 | 实服务和授权接入，零结果与失败区分，真实图片/附件写入，不使用假成功 |
| T07 资源、预览、演示、导出与 CLI | 未关闭 | 已识别共享协议和 inspector 信任问题 | 完整资源生命周期、脚本/编辑隔离攻击 PoC、正常可视编辑、PDF/DOCX/HTML/打印/CLI 回读 |
| T08 Friday 主助手操作 | 未关闭 | PDF/DOCX 的操作服务可作为公共基础 | HTML 专用操作、可信文档与版本、审批、任务、真实主助手完整流程 |
| T09 安全、性能、回归与安装 | 未关闭 | 测试范围已定义 | 最终候选上的完整矩阵、源 hash、资源/网络越权负向、大文档、升级/回滚 |
| T10 批准公开启用和发布 | 未关闭 | 默认入口继续受控 | 全部 P0 关闭、可重建提交和来源、最终包验收与发布归档 |

## 5. 仍须解决的跨模块问题

1. HTML bundle 与旧四编辑器各自打包共享模块，语言与 headless 状态必须显式注入；全局 renderer 协议和特权 scheme 只能由 Friday 统一登记。
2. HTML 私有 IPC 可由其 view 初始化，但 `ai:*`、`app:*`、`project:*` 必须服从同一宿主身份与配置合同。新增 skills、命名、文件打开等通道要逐项接入并验证 sender，不能让未绑定的调用在运行时失败。
3. 上游图片生成实现仍存在读取自身 `ai-settings.json` 的路径。需以 runtime provider hook 或受控 adapter 接入 Friday 配置，避免出现文本模型可用而图片服务读取另一套设置。
4. inspector 与用户脚本在同一 iframe 内，`event.source`、schema 或页面可见 token 不能证明编辑消息来自可信 inspector。完整可视编辑需要独立的可信写入边界与攻击验证；这一问题未解决前不能公开宣称对等完成。
5. 关闭 HTML 标签必须保留 Save/Discard/Cancel 语义；取消、保存失败或宿主返回未知状态时前端保留标签。实验入口不能沿用先自动保存再无条件移除 Tab 的逻辑。

## 6. 证据与下一步

现阶段取得的源码与合同基础属于实施进展，不能关闭完整产品验收。后续报告应固定 Friday commit、两份上游来源、锁 hash、manifest、安装包 hash、命令、样本、平台和真实执行范围。

本轮已得到的具体证据：

| 命令/检查 | 实测结果 | 范围限制 |
|---|---|---|
| `node --test scripts/tests/office-html-upstream.test.mjs` | 24/24 通过 | 真实 Git 获取与只读复用、来源锁、错误 origin/SHA/dirty 拒绝、失败 stage 保留与并发同步；不证明编辑器运行 |
| `node --test scripts/tests/office-html-frontend.test.mjs` | 8/8 通过，修改的八个 Vue SFC 独立编译通过；前端 build 退出 0，4500 模块，9 分 58 秒 | 构建过程中又补充了演示和临时标题处理，现有 dist 未含这两项；源码已冻结，最终打包前仍须重新构建 |
| `node --test scripts/tests/office-html-host.test.mjs` | 最终 8/8 通过，语法和 diff 检查通过，源码已冻结 | 使用真实 host 配合 Electron 依赖 mock；不能代替真实 Electron |
| bundle/integration/package 三份合同测试 | 最新组合 28/28 通过 | 覆盖实验准入、来源身份、源变化、缺资源/缺 hook 和独立 HTML 包内锁校验，不代表应用已启动 |
| 原有及新增脚本全量执行 | 本轮一次运行 487 项，485 通过、2 失败；两个失败原测试独立复测 2/2 通过 | 原失败为 Electron 子进程 20 秒超时与 Typewriter 防抖计时断言；保留原全量失败事实，未改测试阈值，不能将该次运行写成全绿 |
| 固定官方目标首次 workspace 安装和编译 | 安装退出 0，但 HTML 编译因缺 `docx` 包失败 | 证实相对源码依赖不被单独 workspace 安装补齐；构建脚本已改完整锁定依赖安装，当前重装与后续编译尚待终态 |
| `node --check scripts/probe-office-html-runtime.mjs` | 语法检查通过 | 新增真实 Electron 基础探针，等待包含固定官方 HTML 的实际 bundle；尚未运行通过 |

第一轮旧 vendor 的 HTML 独立编译成功属于兼容性起点，不能作为本轮官方 `.852` 构建成功的证据。主仓库、旧 vendor 与新 HTML 源码的组合身份仍需由最终构建生成，再以独立官方树的 main/preload/renderer 进行真实加载。

AI 服务逐通道静态审计另见 [第 05 篇：AI 服务合同审计](05-ai-service-contract-audit.md)。其中列出的搜索结构、图片配置、缺失 IPC、会话与资产问题尚未按审计方案实现和运行关闭。

下一步依次完成官方 HTML 独立构建和 Electron 宿主启动、文档/标签生命周期、完整 AI 与服务合同、预览/资源安全、对等质量和安装交付。存在失败时保留原失败报告，复测独立登记；不得以删除失败样本或降低 HTML-01 至 HTML-12 范围取得通过。
