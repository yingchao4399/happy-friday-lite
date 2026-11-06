# AI HTML preview.38 进度与下一版门槛

记录日期：2026-11-07。本文是 preview.38 的新增进度记录，不覆盖或改写前三份总体方案、PRD、技术拆解，也不替代 preview.37 交付记录。它回答三个问题：本轮到底改了什么、当前源码启动和打包启动如何判定 HTML 可用、下一版安装包在构建和发布前还必须补齐什么。

## 1. 本轮目标

preview.38 的直接目标是让已经接入的 AI HTML 在 preview 构建中具有一致的可见能力：从源码启动和打包启动都能通过同一个宿主能力查询看到 HTML，并允许用户显式新建、打开 `.html`/`.htm` 文件。这个目标只涉及预览版入口策略和能力状态的一致性，不等同于宣称 HTML 已经完成 GenOffice 全功能对等，也不等同于宣称四类既有 Office 编辑器已经升级到 GenOffice 最新版。

本轮的版本识别依据是仓库当前 `package.json`：应用版本为 `3.0.10-preview.38`，Windows 安装包命名和 `releaseVersion` 同步到 `preview.38`。HTML 上游来源、独立构建和 Friday 宿主适配沿用前一轮已经固定的来源锁；本轮没有把上游版本号改写成“最新”，也没有以版本号替代来源 commit、依赖锁和资源 digest 的验证。

## 2. 已完成的源码改动

### 2.1 Preview 启动策略

`enablePackagedPreviewHtml` 现在根据 `-preview.N` 版本标记自动开启 HTML 实验环境变量。该判断同时覆盖源码启动和打包启动，因此 preview.38 在两条启动路径上使用同一策略。稳定版本没有 preview 标记时不会自动开启；显式设置 `FRIDAY_OFFICE_EXPERIMENTAL_HTML=0` 可以关闭，便于诊断、回归和稳定版行为验证。

### 2.2 注册表和构建准入

HTML 注册表仍保留 `enabled: false`，避免把 HTML 误计入稳定版四类编辑器；新增 `previewEnabled: true` 作为 preview 构建准入标记。只有显式 HTML 构建参数、实验属性和 preview 标记同时满足时，HTML 才会加入构建编辑器集合。`.html`/`.htm` 扩展名和原有路由合同没有改成稳定版默认文件关联。

### 2.3 宿主能力结果

当 preview 环境、HTML bundle 资源、模块导出和宿主合同均通过时，能力查询返回：

```json
{"id":"html","enabled":true,"available":true,"reasonCode":null}
```

当开关关闭、资源缺失、资源 digest 不匹配或必需 hook 缺失时，`enabled`/`available` 不会伪造为可用，宿主仍返回明确的 `reasonCode`，并拒绝新建或打开。这样前端按钮状态、IPC 能力和实际模块加载使用同一结果来源。

### 2.4 用户操作边界

显式打开 HTML 支持大小写扩展名，已打开的同一路径继续复用现有编辑视图。保存、关闭确认、关闭取消、演示视图登记、文档身份和顶层导航隔离逻辑沿用已有 HTML 宿主合同。preview.38 只改变“preview 是否自动开放”的入口判定，没有绕过资源校验、调用者校验或文档身份校验。

## 3. 当前验证结果

截至本文记录时，已完成以下定向验证：

| 验证项 | 当前结果 | 证据范围 |
| --- | --- | --- |
| HTML host 定向测试 | 10/10 通过 | 覆盖 preview.38 源码/打包启动策略、稳定版关闭、显式 opt-out、能力查询、资源和 hook 失败关闭、保存关闭生命周期、导航隔离、大小写扩展名及文档身份 |
| HTML frontend 合同测试 | 8/8 通过 | 覆盖路由、能力刷新、显式打开、关闭确认、会话恢复、IPC 调用者以及中英文文案解析 |
| HTML adapter / AI services 专项 | 17/17 通过 | adapter 12 项、ai-services 5 项，覆盖真实参数、owner、取消与错误合同；远程请求成功仍需真实 API 验收 |
| HTML 文档、资源和搜索专项 | 19/19 通过 | media-analysis 6 项、local-search 5 项、project-boundary 2 项、document-bridge 4 项、artifact 2 项 |
| HTML upstream 来源专项 | 24/24 通过 | 覆盖固定来源、同步、dirty 拒绝及来源身份，不证明编辑器运行 |
| bundle 合同测试 | 20/20 通过 | 覆盖实验准入、来源身份、manifest、缺资源/缺 hook、dirty/cached build 和失败回滚 |
| integration gate 测试 | 7/7 通过 | 覆盖 Office 集成门禁和构建/来源合同 |
| 前端/Office 实际构建 | 待构建后填入 | 需要重新生成 HTML 资源、执行 `vite build` 和打包前 Office 门禁，不能用单元测试代替 |
| Windows 安装包 | 待构建后填入 | 需要 `npm run electron:build:win` 完整执行并记录安装包路径、大小、SHA-256 和打包资源报告 |

定向测试证明的是 preview.38 入口策略和合同层行为；它不证明远程模型、搜索、图片/视频 provider、复杂外部资源、真实安装升级或所有 GenOffice 功能已完成。测试进程若因 Electron 子进程或资源句柄迟迟不退出，应单独记录为测试基础设施问题，不能直接把“有输出”当作完整通过。

## 4. 构建门槛

下一步生成 preview.38 安装包前，必须依次完成以下门槛，并保存可复核日志：

1. **来源门槛**：`office-upstream.lock.json`、`office-html-upstream.lock.json`、子仓库 commit、依赖 lock hash 和工作树状态一致；不能使用 dirty 或未记录的本地 HTML 源码。
2. **资源门槛**：重新执行 HTML 独立构建，校验 manifest、entry、required exports、hook、来源身份和 resource digest；默认稳定构建仍不能意外加载 HTML。
3. **应用门槛**：完成 `npm run build`，并通过主进程 import、DSH runtime、Office integration gate、打包 native modules 和 packaged office resource 校验。
4. **运行门槛**：启动打包的 `win-unpacked`，验证 preview.38 能力查询、HTML 新建/打开/保存/关闭、HTML/HTM 路由、四类既有编辑器回归及启动 smoke。
5. **产物门槛**：记录安装包和 unpacked 目录的路径、字节数、SHA-256、构建时间、版本、资源清单和失败时的候选目录；不能只报告“electron-builder 成功”。
6. **发布门槛**：只有上述证据齐全后才创建 GitHub tag/release。若真实模型或用户验收未完成，发布说明必须标成 preview，并明确未关闭范围。

首次 preview.38 构建在来源锁阶段退出，错误为 `OFFICE_VENDOR_HEAD_MISMATCH` 与 `OFFICE_PACKAGE_LOCK_DIGEST_MISMATCH`，尚未进入前端打包。原因是上一版提交修复后 vendor 已为 `e4160be053612108bfa041efd75402dc985f133a`，但来源锁仍记录旧 HEAD；本次升级版本号又改变主仓库 package-lock 摘要。已核对子仓库干净且已推送，同步来源锁 HEAD、describe 和主 package-lock 摘要后，门禁返回 `ok: true`。vendor package-lock 摘要经重算未变化，因此保留原值。该修正只记录实际来源，不把候选上游状态改为已批准或全量融合。

以下实际构建数据在构建完成前保持空缺：

| 字段 | 值 |
| --- | --- |
| preview.38 Windows 安装包 | 待构建后填入 |
| 安装包大小 | 待构建后填入 |
| 安装包 SHA-256 | 待构建后填入 |
| `win-unpacked` HTML 资源报告 | 待构建后填入 |
| 完整 Office 集成门禁 | 待构建后填入 |
| Electron 启动 smoke | 待构建后填入 |
| GitHub tag/release URL | 待发布后填入 |

## 5. 尚未完成的功能和风险

1. HTML 的真实自然语言 AI 流程、流式 writer、版本冲突、Stop/并发和错误恢复仍需在最终候选包上验证。
2. 搜索、生图、图片分析、视频分析和附件能力沿用 Friday 设置中的统一 AI 工具配置，并在用户填写 API 后验证真实请求、取消、限流、失败和零结果；本轮没有用 mock 成功替代远程验收。视频分析与固定 GenOffice 目录对齐，不代表已经提供视频生成。
3. 编辑模式的主动脚本隔离、演示模式脚本交互、复杂外部资源、字体、图片和大文件性能仍需要真实 Chromium/Electron 样本验收。
4. AI Markdown 和 Docs/Sheets/Slides/PDF 的整体 GenOffice 版本融合尚未由本轮入口策略关闭；后续必须基于现有总体文档维护功能矩阵、来源锁和可重建证据。
5. 安装、升级、卸载、回滚、数据保留、未签名提示和不同用户目录迁移尚未完成正式验收。

## 6. 下一版执行顺序

专项测试已取得完整结果。接下来执行 preview.38 的 Office 资源构建和前端构建；构建成功后运行打包版启动与 HTML 生命周期探针，随后做既有四类编辑器回归。只有在安装包 hash、资源报告、smoke 和 GitHub 发布元数据齐全后，才把 preview.38 写成“已交付”。任何一项失败都保留失败日志和候选产物，回到对应门槛修复，不通过删测试或降低能力合同。

## 7. 相关文档

- [总体融合研究与实施方案](01-integration-plan.md)
- [产品需求 PRD](02-prd.md)
- [技术对接与拆解](03-technical-integration.md)
- [实施与验收记录](04-implementation-and-validation.md)
- [AI 服务合同审计](05-ai-service-contract-audit.md)
- [preview.37 进度与交付结果](06-preview37-progress-2026-11-07.md)

