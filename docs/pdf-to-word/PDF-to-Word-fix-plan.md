# PDF 转 Word 修复方案

日期：2026-11-05

关联文档：[故障研究报告](./PDF转Word-故障研究报告.md)、[修复 PRD](./PDF转Word-修复PRD.md)、[GenOffice 总体升级方案](./GenOffice-v0.12.600-融合升级方案.md)

## 1. 目标和交付边界

本方案针对 Friday 当前 PDF 文件无法转换为 Word 的单一故障，目标是在当前 Friday Office 基线上补齐一条稳定的本地 PDF→DOCX 链路。用户从 PDF 编辑器或文件菜单选择 Word 后，应能选择目标路径，完成转换，打开生成的 DOCX，并看到转换质量或退化页提示。

修复只覆盖 PDF→DOCX。PDF→XLSX、PDF→PPTX、系统打印、GenOffice 全量升级和新的 AI 编辑器不进入本次发布门槛。总体升级文档继续保留并负责后续版本规划，本方案作为其中一个可独立交付的 P0 补丁。

## 2. 推荐技术路线

采用现有上游本地实现的最小移植路线。Friday host 增加与 `PDF_CHANNELS.convertOffice` 对应的 `ipcMain.handle`，校验调用者是当前 PDF tab，再调用 `convertPdfFileToDocxLocalWithPrompt`。converter、PDFium WASM、OCR helper 通过现有 Office bundle 进入开发目录和安装资源目录。转换输出先写同盘临时文件，校验非空后原子替换目标，已有目标和源文件受到保护。

流程如下。

```text
PDF renderer
  -> pdfApi.convertOffice('docx')
  -> preload ipcRenderer.invoke('pdf:convert-office')
  -> Friday main handler 校验 sender 与活动 PDF
  -> flush 当前 PDF 修改并等待可持久化
  -> 目标选择与目标占用检查
  -> pdf2docx-local / PDFium / 可选 OCR
  -> 临时 DOCX + 非空/ZIP 结构检查
  -> 同盘原子替换
  -> Friday Docs 打开目标并展示退化提示
```

不把转换放入 renderer。PDFium 和 OCR 可能执行同步或长时间工作，主进程应通过既有 worker 或独立转换任务隔离，避免 renderer 失去响应。当前 `pdf2docx-local` 入口的内部阻塞行为需要先测量，若主进程事件循环在长扫描件上冻结，必须把 converter 放入 worker，再验收取消和清理。

## 3. 实施任务

| 任务 | 内容 | 主要文件 | 完成条件 |
| --- | --- | --- | --- |
| F01 基线与失败复现 | 固定根 SHA、vendor SHA、安装包版本，保存一个最小可失败 PDF 和脱敏日志 | 根 Git、`vendor/happyoffice`、`docs` | 能稳定记录入口、错误和无产物现象 |
| F02 IPC 接线 | 注册 `pdf:convert-office`，只接受当前 PDF tab 的 `docx`，拒绝未知格式和过期 sender | Friday office host、主进程 IPC | renderer 调用进入唯一 handler，未知格式有稳定错误 |
| F03 保存刷新 | 转换前请求 PDF renderer 保存 dirty 修改，等待持久化。销毁的 WebContents、超时和用户取消都中止转换 | PDF host adapter、`flushPdfSave` 调用处 | 转换输入与已确认保存快照一致，不读旧源 |
| F04 converter 接入 | 接入 `convertPdfFileToDocxLocalWithPrompt`，保留密码重试、空格密码和取消语义 | `pdf2docx-local` 及 Friday bundle | 普通、密码、错误密码和取消路径可区分 |
| F05 输出保护 | 目标路径不得等于源路径。目标已有文件先取得明确覆盖确认，临时文件与目标同盘，失败时保留旧目标 | Friday host / 文件服务 | 失败、取消和覆盖拒绝都不截断源或旧目标 |
| F06 结果反馈 | 按 `pageResults`、`scannedDocument` 分类说明可编辑文本、OCR 和整页图片退化 | i18n、host dialog/notice | 用户能知道成功、退化、密码失败、资源缺失和取消 |
| F07 资源 staging | 检查 PDFium WASM、OCR helper、相关 native 依赖进入 `resources/office` 或明确的 resources/ocr 目录 | `scripts/build-office.mjs`、electron-builder 配置 | 开发目录、打包目录和移动后的安装目录均能定位资源 |
| F08 任务生命周期 | 防止重复点击、tab 切换、关闭窗口和迟到回调写入错误目标。转换任务结束后清理 worker、临时文件和子进程 | host 状态管理、worker/cleanup | 20 次成功/取消循环无残留和串文档 |
| F09 回归验证 | 运行单测、宿主 probe、安装包样本和中文空格目录样本，保存产物与日志 | `vendor/happyoffice/apps/shell/tests`、Friday scripts | PRD 中全部 P0 用例有证据 |

## 4. 接口与状态合同

### 4.1 请求

`format` 只允许 `docx`。handler 从活动 PDF tab 读取源路径，不接受 renderer 自行传入任意源路径。请求必须包含 sender、tabId、源路径和任务标识。源路径在异步等待前后都要复核，源文件变更或 tab 已关闭时中止并提示重试。

### 4.2 保存状态

状态顺序为 `idle → flushing → choosing-target → converting → validating-output → opening-docx → complete`。任何阶段都可以进入 `cancelled` 或 `failed`。保存刷新失败不能继续转换。目标选择取消不会改变源文件状态。转换开始后关闭 tab 或窗口应取消任务并清理资源。

当前上游 `flushPdfSave(contents)` 只有一个参数，表示请求 renderer 将已知 dirty 编辑写入源文件。目标 `v0.12.600` 研究中出现过更强的 `flushAll` 语义，本小版本不能直接假设当前 Friday 已支持。若 PDF 表单或注释存在“编辑后尚未 Done”的内存状态，应先通过专项探针确定是否需要增加显式 `flushAll` 参数，再把结论写入代码和测试。

### 4.3 结果

converter 返回 `docx`、`pageResults` 和 `scannedDocument`。成功条件包含 DOCX 文件存在、大小大于零、ZIP 可读取、`word/document.xml` 存在和正文至少有一个有效段落或明确的图片退化页。`scannedDocument` 和页面退化状态只影响提示，不应伪造为完全可编辑。

## 5. 资源和打包方案

`resources/office/wasm/pdfium.wasm`、PDF converter bundle、OCR helper 和它们的许可证必须在 staging 时列入 manifest。Windows helper 的实际目录需与 `pdf2docx-local.ts` 的 `process.resourcesPath/ocr/win-ocr.exe` 查找规则一致。构建脚本必须在文件缺失时失败或输出阻断，而不是继续生成看似完整的包。

候选包验证需要先把安装目录移动到含中文和空格的路径，再在无 vendor、无源代码和断网条件下执行。记录 Friday SHA、vendor SHA、目标 tag、构建时间、资源哈希、系统版本、Node/Electron 版本和输出 DOCX SHA256。

## 6. 取消、并发和文件保护

同一活动 PDF 只允许一个 DOCX 转换任务。重复点击返回 busy 提示。任务固定源 `entryId` 与源路径，等待 converter 返回后复核 tab、源路径和目标路径。目标与源同路径直接拒绝。目标已存在时采用确认后原子替换，拒绝覆盖不会删除旧文件。转换失败、密码取消、保存框取消和输出验证失败都删除临时文件。

若 converter 使用外部 OCR 进程，取消必须先通知 converter，再清理属于该任务的进程。不能通过杀掉所有同名进程实现清理。窗口关闭时等待有界时间后记录未能清理的任务，并阻止其继续写盘。

## 7. 验证顺序与闸门

G0 固定失败样本、版本和资源快照。G1 证明 IPC handler、保存刷新和普通文字 PDF 可生成 DOCX。G2 覆盖密码、扫描、中文路径、目标保护、取消、重复点击和关闭窗口。G3 在移目录的 Windows 安装包中重复关键用例，所有 P0 通过后才可交付。

验证不得只检查文件头。DOCX 需要解压检查 XML，使用文档库读取段落、表格和图片数量，并在 Friday Docs 中打开后截图或读取结构。复杂分栏、公式和 OCR 误差应记录限制，不能把“文件可打开”单独当作保真通过。

## 8. 工作量与交付物

在已有 converter 和 build 脚本可复用的前提下，窄范围预计 5–10 人日，其中复现与接线 1–2、宿主与保存合同 1–2、资源和输出保护 1–2、回归与安装包验证 2–4。若发现 converter 必须改为独立 worker、或当前 vendor 缺少可用依赖，应重新估算，不把风险隐藏在原区间内。

交付物包括代码补丁、必要测试、资源 manifest、失败与通过日志、至少四类 DOCX 样本、安装包验证记录和回滚说明。当前阶段只交付本方案及配套研究报告、PRD，代码修复和验证仍待实施。

## 9. 建议修改面和责任边界

| 区域 | 预计修改 | 责任 |
| --- | --- | --- |
| Friday 主进程 | 注册转换 handler、sender 校验、活动 entry 固定、目标保护、进度和错误映射 | Office 宿主 |
| Friday preload 或 adapter | 仅在当前 bridge 缺少转换调用时补充受限转发，不暴露任意路径执行 | Office bridge |
| vendor shell converter | 优先复用现有 `pdf2docx-local.ts`，只有编译或接口差异时做最小补丁 | vendor 集成 |
| 构建脚本 | staging PDFium、OCR helper、converter 依赖和 manifest | 构建维护 |
| i18n | 新增错误、退化、密码、busy、取消和资源缺失文案 | 产品前端 |
| 测试 | 单元状态机、IPC sender、资源清单、真实宿主和安装包样本 | 测试与集成 |

禁止把转换器复制到 `resources/office` 后直接手改生成物。源码改变应落到 vendor 或 Friday 源码，再由 `npm run office:build` 生成资源。`resources/office` 只用于验证 staging 结果。

## 10. 错误码和可观测性

建议使用稳定错误码，用户看到 i18n 文案，日志看到脱敏 detail。

| 错误码 | 触发 | 用户动作 |
| --- | --- | --- |
| `PDF_DOCX_BUSY` | 当前 PDF 已有转换任务 | 等待当前任务结束 |
| `PDF_DOCX_SAVE_REQUIRED` | dirty 保存未完成 | 保存后重试 |
| `PDF_DOCX_SOURCE_CHANGED` | 等待期间源 entry 变化 | 回到原 PDF 重试 |
| `PDF_DOCX_RESOURCE_MISSING` | WASM/OCR/bundle 不存在 | 修复安装或重试普通 PDF |
| `PDF_DOCX_PASSWORD_REQUIRED` | 需要密码 | 输入密码 |
| `PDF_DOCX_PASSWORD_REJECTED` | 密码不正确 | 重试或取消 |
| `PDF_DOCX_OUTPUT_INVALID` | 临时 DOCX 结构无效 | 保留旧目标并重试 |
| `PDF_DOCX_CANCELLED` | 用户取消或窗口关闭 | 无需恢复源文件 |
| `PDF_DOCX_FAILED` | 未分类转换失败 | 查看脱敏日志 |

日志阶段使用 `request`, `flush`, `target`, `convert`, `validate`, `commit`, `cleanup`。每条记录携带 runId、entryId 和阶段耗时，不能携带密码和完整路径中的敏感片段。进度条在成功、失败和取消的 finally 路径中都恢复为无进度状态。

## 11. 回滚与兼容策略

修复补丁只新增 PDF→DOCX 行为，不修改旧 PDF 保存、另存、打印和其他转换的已有合同。若新 handler 在候选包中失败，回滚对象必须同时包含 Friday 主应用、vendor bundle 和 `resources/office`，不能只回退一个 JS 文件。

发布前保存用户数据目录和当前 PDF 文件副本。转换本身不写回源 PDF，只有用户确认的 dirty 保存会改变源文件。目标写入失败时保留旧目标和临时诊断信息的摘要，不将临时文件留在用户目录。回滚验证至少重新打开原 PDF、读取原 PDF SHA、打开既有 DOCX 和执行一次取消流程。

## 12. 实施顺序

先建立 AC-01 的红灯复现和 handler 诊断日志，再接线并验证普通文字 PDF。随后加入目标保护和保存刷新，接着验证密码与 OCR。资源 staging 和安装包验证必须在开发版通过后进行，不能把开发版成功直接发布。最后执行 20 次生命周期循环和回滚演练。每个阶段记录实际修改文件和未决问题，完成条件未满足时不进入下一阶段。
