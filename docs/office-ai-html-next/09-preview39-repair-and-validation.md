# preview.39 Office AI 修复与验证记录

日期：2026-11-07。展示版本：`3.0.7.01-preview.39`；技术版本：`3.0.11-preview.39`。

本篇记录 preview.38 三张用户截图所涉及问题的实际修复。第 08 篇保留为修复前的根因研究快照；原总体升级方案、PDF 专项三份文档和 AI HTML 原规划继续保留。本轮不表示所有 Office 编辑器已升级至官方新版本，也不表示完整上游功能对等已验收。

## 1. 当前交付状态

代码修复、主应用编译、专项验证、Office 全量资源重建和 Windows x64 安装包构建均已完成。包内 Office 资源、原生模块及 Electron 启动冒烟通过；preview.39 尚未发布到 GitHub，也未执行安装/升级实机验收。下表按证据区分阶段，不把安装包生成等同于公开发布或用户环境验收。

| 阶段 | 当前结果 | 证据 |
| --- | --- | --- |
| 共享 AI 流式协议与错误恢复修复 | 已实现并通过回归 | `scripts/tests/office-ai-stream.test.mjs`、`office-transport-protocol.test.mjs`、`office-ai-service-contract.test.mjs` |
| Friday 品牌与 HTML 多会话历史 | 已实现，最终打包模块验证通过 | `artifacts/office-html-runtime-packaged-preview39.json`；11 个步骤全部通过，覆盖 Friday 标题/图标、历史入口、新建会话、旧消息恢复、保存、导出及 PDF 并存 |
| 提示词身份、生图设置指引与三类会话时序修复 | 已实现，最终专项 38/38 通过 | product/history/store/boundary 四组测试 |
| 全仓测试 | 本轮 623/623 通过，0 跳过；随后新增的历史边界另经专项验证 | `artifacts/preview39-tests.log` |
| 打包与原生模块相关测试 | 22/22 通过 | `artifacts/preview39-cjs-tests.log` |
| 主应用前端构建 | 通过 | `artifacts/preview39-app-build.log` |
| CLI Word 读取构建错误 | 已修复，真实 CJS 回归 1/1；功能命令 8/8 | `artifacts/cli-audit-preview39/after-fix-report.json` |
| 完整 Office 资源重建 | 已完成；renderer、CLI、native 均 fresh，2507 项资源校验通过 | `resources/office/integration-manifest.json`；`npm run office:verify` |
| Windows x64 安装包 | 已生成，约 271 MB；包内 Office、原生模块和 Electron 启动冒烟通过 | `release/Happy-Friday-Lite-3.0.7.01-preview.39-win-x64-setup.exe`；`release/preview.39-build-info.txt` |
| PDF → Word 最终打包链路 | 已通过隔离的打包模块验收 | `artifacts/office-pdf-ai-delivery-packaged-preview39.json`；create_document、convert_document、PDF 菜单共享转换服务、Friday 助手注册四条路径均生成并验证 DOCX；源 PDF 摘要保持不变 |
| 安装器签名 | 未签名；构建环境没有配置代码签名证书 | electron-builder 明确跳过签名 |
| 安装/升级实机验收 | 尚未执行 | 启动冒烟基于 `release/win-unpacked`，不等于在用户环境安装或升级 |
| GitHub 发布 | 未发布，未推送 preview.39 标签 | 当前已有 preview.38 发布不能代表 preview.39 修复已发布 |

## 2. 用户现象及根因

### 2.1 AI HTML 仍显示 Genspark

HTML 使用独立固定的官方源码树，原有四编辑器则使用 Friday 的既有分支。新增 HTML 时，构建适配遗漏了 Friday 的标题、图标和历史增强，造成同一产品里两套身份。这是 preview.38 的真实集成缺陷，不能归因于用户没安装好。

当前构建适配已精确替换 Ribbon、面板标题、折叠入口及图标，并补齐四处系统提示中的产品身份。生图不可用时改为引导用户前往 Friday 设置 → AI 工具 → 生图、媒体与搜索，避免错误要求 Genspark 登录。

`genspark` provider ID、`X-Genspark-Token-Pass`、`genoffice:brief` 文档元数据及真实提供商名称保持协议含义。不能全局删除所有 Genspark/GenOffice 字符串：这会破坏上游兼容，且不能证明界面修好。验证重点是实际用户入口、渲染图标、托管模型列表和真实 prompt builders。

### 2.2 其他 Office 已输出内容却报“未知错误”

宿主发送正常 `usage` 事件，旧 transport 把未识别事件当作错误，提前终止订阅。修复后四编辑器只把显式错误当失败，正常用量和新增元数据不会覆盖成功终态。取消后立即释放订阅；迟到 token 不再进入界面。

API 模式下的认证错误应引导 Friday 模型设置；不能因上游登录状态为空而要求“登录 Friday”。真正的上游认证错误才使用相应上游恢复动作。回归覆盖显式错误、正常正文、工具调用、用量、取消和错误恢复，且执行真实 AgentLoop/transport 路径。

### 2.3 AI HTML 工具参数反复不可用

原工具流合并逻辑对正常增量作重叠去重，会吞掉重复字符、数字或 JSON 分隔符；合法值也可能被静默改写，例如 `11` 变成 `1`。修复采用明确的增量合同逐片拼接；累计快照只在模型配置显式声明时启用，工具名与参数分别处理。

真实本地 HTTP/SSE → Electron AI bridge 探针验证了重复文字/数字、Unicode、嵌套 JSON、交错工具、正常 usage、401、422、截断与中断。本地确定性验证不等于对所有远端模型提供商逐一认证。

## 3. HTML 历史实现与数据保留

HTML 复用其他 Office 的 `AiHistoryButton` 和共享项目聊天存储，具备文档作用域内的新建、列表、选择、改名、置顶、归档和回收站操作。新聊天创建新持久化 ID；切换聊天从存储恢复内容和模型上下文，不能只清空界面数组。

宿主核对当前 HTML 视图、文档路径和已授权会话，阻止跨文档伪造 ID。未命名文档使用隔离的临时作用域；首次保存迁移完整会话组，另存复制会话组并保留源记录。保存到已有历史的目标时保留目标原记录，避免覆盖。写入失败有明确提示和重试，不伪装成保存成功。

本轮进一步修复三处实际复现的时序缺陷：

1. 写入队列刚完成、锁尚未释放时新增消息，原实现可能提前返回成功却留在内存。现在追加调用会等待其消息真正写入后再完成。
2. 消息已经持久写入期间，同一视图恰好首次保存或另存，原宿主可能拒绝已落盘回执，重试导致重复。现在只对同一视图 entry 的已授权追加接受路径变化；替换视图、跨会话访问和旧路径读取仍被拒绝。
3. 初始化 resolve/load 尚未结束就首次保存，原会话管理器会永久保留未保存路径，重试无法恢复。现在记录最新宿主路径，放弃过期作用域后重新解析；未就绪时继续禁止发送，旧加载结果不能覆盖新文档。

测试包括消息延迟、失败重试、不同文档、未保存文档隔离、首次保存、重命名、另存、已有目标历史、元数据、切换/删除当前聊天以及初始化的 resolve/load 两阶段。真实 renderer 探针又验证了历史按钮、弹层、新建独立会话和切回旧消息。

## 4. 构建链路及附带发现

源码修复通过构建适配进入 renderer/preload/main bundle；修改源码不会更新已经发布或安装的 preview.38。必须统一重建五个编辑器，核对源码身份、来源锁、资源摘要与展示版本，再生成安装器。

第一次完整构建遇到 CLI 依赖目录清理 `EPERM`。独立 CLI 构建与依赖收集均未再现。运行记录中曾有两个全量 Office 构建进程并行，存在清理竞争的可能，但未取得足以认定根因的确定性证据，因此没有推测性修改 `collect-deps.mjs`。最终构建由主线程串行执行。

CLI 深入验收另发现可稳定复现的错误：独立 esbuild 不处理 Word 语言包中的 Vite `import.meta.glob`，导致 DOCX 新建成功但 read/check 失败。修复在 CLI 构建阶段生成等价的延迟 import 映射，保留全部语言；源码合同变化时明确失败。

CLI 验证先使用真实 CJS 读取测试复现红灯，再修复并转绿。八条真实命令覆盖 Word 新建、读取、检查、编辑、再次读取、导出 Markdown、PDF 转 Word及读取转换正文。依赖闭包审计确认原缓存与原新编 CLI 完全一致、1951 个文件没有缺失，说明该错误来自构建语义而非缓存缺件。

## 5. 最终安装包门槛

最终 Office 全量重建已成功，manifest 的 renderer、CLI、native 均为 fresh；集成校验报告 `ok: true`、无 issues。此前 `--skip-cli` 组合仅供诊断，最终包使用的是完整 CLI 构建。

Windows x64 安装包已生成，SHA-256 为 `8A81EF8842C6C99002BCE7B58DAA6D1AC5F18C7B01368BCF8EBFB01AF9CC64D7`。针对本次 `win-unpacked` 运行的包内 Office 资源清单、原生模块及 Electron 主窗口/preload 启动冒烟均通过，release metadata 和 checksum 已写入。之后又直接针对最终打包模块运行 HTML 和 PDF 两项端到端探针：HTML 的 11 个检查通过，覆盖 Friday 品牌、会话历史、保存/导出及 PDF 引擎并存；PDF 探针确认 `create_document`、`convert_document`、PDF 编辑器菜单 → 共享转换服务、Friday 助手注册四条路径都能生成可读、结构有效的 DOCX，菜单转换返回的源 PDF revision/SHA 与输入一致。报告分别为 `artifacts/office-html-runtime-packaged-preview39.json` 和 `artifacts/office-pdf-ai-delivery-packaged-preview39.json`。这些是隔离 Electron 宿主对本地打包模块的验证，不代替用户环境安装/升级验收。安装包尚未签名，也尚未上传 GitHub。包存在、模块探针、安装升级和公开发布是不同事实。

生图、视频与搜索使用用户 API 的远端最终验收，按照用户此前决定在安装包交付后由用户填写配置并测试；文档必须保留这一边界，不把未配置提供商写成已实测通过。本轮也不宣称所有 GenOffice 新功能已全面融合。

## 6. 与后续上游更新的关系

HTML 继续固定官方 `v0.12.852` / `4b55db9ed1994575a695160ffc6cfd0bfc866211`，官方树不直接修改。产品身份、历史及宿主能力在 Friday 的明确适配层完成；精确锚点变化会阻止构建，提示重新审计。

旧四编辑器继续使用 Friday 的 `vendor/happyoffice` 分支。本轮协议、历史存储和 CLI 修复属于应登记和回放的私有差异，后续升级需通过三方审计与合同测试迁移；不能仅复制新 renderer 或覆盖整个 vendor。原总体研究与升级合同继续作为后续规划依据。
