# PDF 转 Word 故障研究报告

日期：2026-11-05

研究对象：Happy Friday Lite 当前 Office 宿主及其 `vendor/happyoffice` PDF 转换能力

状态：修复前研究。本文是 PDF 小版本的独立研究报告，与 `GenOffice-v0.12.600-升级分析报告.md` 等总体升级文档并列，后者继续作为长期升级依据。本轮没有修改业务代码，没有执行合并和发布。

## 1. 问题定义

用户在 Friday PDF 编辑器中选择“转换为 Word”后，期望得到一个可打开的 DOCX 文件。当前现象被描述为“PDF 无法转 Word”。在没有新的安装包复现日志前，不能把所有失败归为单一原因，因此本报告把故障拆成入口、保存、转换、资源、输出和打开六个阶段。

本小版本只处理 PDF→DOCX 的完整用户链路。PDF→XLSX、PDF→PPTX、PDF 打印、GenOffice 全量升级和其他编辑器升级不作为本次修复的交付条件。现有总体文档中的 PDF 研究、版本基线和 128 个合并冲突记录继续保留，本文只引用与本故障直接相关的证据。

## 2. 研究基线与证据等级

| 项目 | 结果 | 证据等级 |
| --- | --- | --- |
| 根仓库 | `dd4afd4a5eb2d66972e554c683968c8c3fafbd2b` | 已核实 Git |
| Friday Office vendor | `8ed0c8d099c3c3d87b1a998d9189da3d120ff820` | 已核实 Git |
| PDF 目标链 | 上游 shell 的本地 `pdf2docx` 管线已存在 | 源码静态证据 |
| Friday 宿主处理器 | `src-electron/office/office-host.js` 目前只对 PDF 调用 `b.pdf.flushPdfSave(wc)`，没有看到 PDF→DOCX 转换处理器 | 源码静态证据 |
| 资源打包 | `build-office.mjs` 复制 PDFium WASM，Windows 构建 OCR helper | 源码静态证据 |
| 安装版 DOCX | 尚未取得本次修复后的真实 DOCX 和安装包运行证据 | 未验证 |

“源码中存在转换函数”只能证明候选实现存在，不能证明 Friday 自己的 renderer、preload、宿主、打包资源和安装包已经连通。本文将静态已证实内容与待运行内容分开记录。

## 3. 当前链路重建

### 3.1 PDF 编辑器内部入口

PDF renderer 的 `vendor/happyoffice/apps/pdf/src/renderer/App.tsx:5931-5943` 定义 `convertTo(format)`，它调用 `window.pdfApi.convertOffice(format)`。PDF preload 的 `vendor/happyoffice/apps/pdf/src/preload/index.ts:41` 将调用转发为 `ipcRenderer.invoke(PDF_CHANNELS.convertOffice, format)`。共享通道在 `vendor/happyoffice/apps/pdf/src/shared/ipc.ts` 中命名为 `pdf:convert-office`。

renderer 捕获异常后只显示通用失败提示。独立 PDF 模式没有 shell 转换流程，因此不能用 standalone renderer 的“没有异常”作为转换成功证据。

### 3.2 上游 shell 的可复用转换实现

`vendor/happyoffice/apps/shell/src/main/index.ts:4259-4609` 的 `exportPdfAsDocxLocal` 承担完整流程。它先锁定 `exportingPdfDocx`，调用 `flushPdfSave(tab.webContents)`，弹出 DOCX 目标选择框，处理已打开的目标文档，再调用 `convertPdfFileToDocxLocalWithPrompt`。结果写入目标后，根据 `pageResults` 与 `scannedDocument` 给出 OCR 或图片退化提示，最后清理密码对话框和进度条。

`vendor/happyoffice/apps/shell/src/main/index.ts:4613-4619` 注册 `PDF_CHANNELS.convertOffice`。它验证调用者是当前 PDF tab，再把 `docx` 分派到 `exportPdfAsDocxLocal`。这说明上游链路具备 Friday 目前缺少的 host handler 逻辑。Friday 不能只复制 renderer 按钮，必须接入等价的主进程处理器和权限校验。

### 3.3 转换器和密码状态机

`vendor/happyoffice/apps/shell/src/main/pdf2docx-local.ts:53-95` 延迟加载 PDFium WASM，读取源 PDF，按条件提供 OCR 引擎，并调用 `convertPdfToDocx`。`convertWithPasswordRetry` 位于同文件 `107-121`，只有收到 `PdfLoadError` 且错误码为 `password-required` 时才再次询问密码。密码原样传递，不做 trim。用户取消密码输入时返回 `null`。

转换结果包含 `docx`、`pageResults`、`scannedDocument` 等字段。页面状态必须按实际返回值解释。`status: ocr` 表示完成 OCR 后的可编辑文本，其他退化状态可能代表整页图片或跳过，不能把所有非 `ok` 页统称为 OCR 成功。

### 3.4 Friday 当前宿主缺口

Friday `src-electron/office/office-host.js:1086-1091` 的 PDF 保存分支只调用 `b.pdf.flushPdfSave(wc)` 并等待文件落盘。这是关闭或保存合同，不是转换合同。当前未发现它注册 `pdf:convert-office` 的等价 host 处理器，也未发现 Friday 自有 host 调用 `convertPdfFileToDocxLocalWithPrompt` 的证据。若 renderer 通过独立 PDF bundle 调用该通道，调用会落到没有 handler 的边界，或者被 Friday 的通道过滤器丢弃。

这比 PDFium 算法本身更接近“入口有按钮但无法生成 Word”的首要静态根因。仍需在真实 Friday 开发版和安装版通过 IPC 日志确认最终错误形状。

### 3.5 资源链

`scripts/build-office.mjs:289-301` 把 PDFium WASM复制到 `resources/office/wasm/pdfium.wasm`。`scripts/build-office.mjs:352-359` 在 Windows 生成 OCR helper 和系统打印 helper。转换器 `pdf2docx-local.ts:35-49` 在安装版优先寻找 `process.resourcesPath/ocr/win-ocr.exe`，开发版才回退到 vendor 相对目录。

因此需要同时验证开发目录、打包目录和移动后的中文空格路径。开发目录能够找到 vendor 文件，不能证明安装包已经包含 PDFium WASM、OCR helper 及其依赖。当前 resources 目录缺少一份把 PDF converter、WASM、OCR helper 和 vendor SHA 绑定的专门清单。

## 4. 故障假设与验证顺序

| 优先级 | 假设 | 可观察预测 | 验证方式 |
| --- | --- | --- | --- |
| H1 | Friday 没有注册 `pdf:convert-office` 或没有把 `docx` 分派到本地 converter | renderer 有调用但主进程无对应处理日志，退出无 DOCX | host IPC 日志和最小真实操作 |
| H2 | PDFium WASM 或 OCR helper 没有进入最终资源目录 | 开发版可能成功，移到安装目录后出现资源缺失 | 解包清单、资源路径日志、安装版样本 |
| H3 | 转换前的 dirty PDF 未完成保存 | 修改后转换得到旧内容或表单字段缺失 | 修改文本/旋转/表单后检查源快照和 DOCX 内容 |
| H4 | 密码、损坏 PDF 或 OCR 退化被错误处理 | 密码重试失败、取消产生半成品或扫描文档被误报成功 | 密码、证书加密、损坏、扫描样本矩阵 |
| H5 | 输出目标保护和转换任务生命周期不完整 | 覆盖已有文件、切换 tab 后写错目标、关闭后残留进程 | 目标占用、重复点击、切换和取消注入 |

H1 和 H2 是本小版本的先验 P0。只有实际复现后才能决定 H3～H5 是同一补丁还是后续缺陷。

## 5. 与 `v0.12.600` 的关系

`v0.12.600` 的目标源码可以作为转换器和测试 fixture 的参考来源，但 PDF 修复不需要等待全量 GenOffice 合并。当前最小路线是在 Friday 现有 vendor 基线上接通已有的本地 PDFium 与 `@genoffice/pdf2docx` 管线，补齐 Friday host、资源 staging、错误反馈和回归测试。若目标提交中的 PDF converter API 与当前 vendor 不一致，必须把差异记录为依赖变更，不在本小版本里隐式升级整个 Office。

## 6. 当前结论和未决事实

已经确认的事实是 Friday PDF renderer 暴露 `pdf:convert-office`，上游 shell 已有本地 DOCX 转换实现，Friday 自有 host 目前可见的是 PDF 保存刷新逻辑，构建脚本会处理 PDFium 和 Windows OCR 资源。

仍需运行确认的事实包括 Friday 当前安装包是否注册了该通道、实际错误消息、PDFium WASM 是否存在于安装包、OCR helper 是否可执行、目标文件是否会被覆盖、转换取消后是否残留进程，以及含未保存编辑的 PDF 是否按预期进入 DOCX。

本报告不把旧的“PDF→Word 已通过”记录当作本次修复证据。下一阶段必须从最小失败样本开始，保存命令、版本、日志、产物 SHA256 和 DOCX 内容检查结果。

## 8. 诊断记录格式

每次复现都应记录以下字段。日志中不写入 PDF 密码、完整 PDF 内容或 API key。

| 字段 | 内容 |
| --- | --- |
| runId | 随机任务标识，不能使用源文件名作为唯一标识 |
| 根与 vendor | 根 HEAD、vendor HEAD、资源 manifest SHA |
| 运行形态 | 开发目录、解包目录或正式安装包 |
| 系统 | Windows 版本、架构、Electron 版本 |
| 输入 | PDF 文件大小、页数、是否加密、是否有 dirty 编辑。记录 SHA256，不复制正文 |
| 操作 | 入口位置、是否改动后保存、目标路径、是否覆盖确认 |
| 过程 | IPC handler、flush、converter、密码、OCR、输出验证各阶段状态 |
| 结果 | 稳定错误码、退出阶段、产物大小、DOCX SHA256、pageResults 摘要 |
| 清理 | 临时目录、worker、OCR 子进程、进度条和 PDF tab 是否恢复 |

诊断应先使用一个单页文字 PDF建立秒级失败信号，再增加中文路径、密码和扫描内容。若最小样本未能触发用户描述的失败，不能用复杂样本的布局问题代替入口故障。

## 9. 风险分级

| 风险 | 级别 | 处理要求 |
| --- | --- | --- |
| `pdf:convert-office` 没有 Friday host handler | P0 | 在任何 UI 或格式优化前修复并用真实 sender 验证 |
| 资源缺失导致开发版成功、安装版失败 | P0 | 构建时阻断或生成明确的 manifest 缺项 |
| dirty 内容没有进入转换输入 | P0 | 保存快照和 DOCX 内容必须可对照 |
| 目标替换截断旧文件 | P0 | 临时文件、验证和原子替换必须完整 |
| 取消后 OCR 或 converter 进程残留 | P0 | 任务级归属、清理和 20 次循环证据 |
| 扫描页只生成图片 | P1 | 允许产品退化，但页码和可编辑范围必须告知用户 |
| 复杂分栏或公式布局偏差 | P1 | 记录样本限制，不把任意 PDF 保真承诺写入产品文案 |
| standalone PDF 与 Friday shell 行为不同 | P1 | 两种入口分别验收，不能互相替代 |

## 10. 研究结束条件

研究阶段在以下条件满足后结束，进入修复实施。至少一个失败样本能够稳定复现。根因属于 H1～H5 中的一个或多个。拟修改文件、资源目录、错误码和测试入口已经列出。开发版和安装版的验证命令可执行。若只能证明静态缺口而没有运行复现，应在实施任务中保留“首个任务建立红灯复现”并继续标记为未完成。

## 7. 证据索引

| 证据 | 路径 |
| --- | --- |
| Friday PDF host | `src-electron/office/office-host.js:1086-1091` |
| 上游 PDF handler | `vendor/happyoffice/apps/shell/src/main/index.ts:4613-4619` |
| 上游 DOCX流程 | `vendor/happyoffice/apps/shell/src/main/index.ts:4259-4609` |
| 转换器 | `vendor/happyoffice/apps/shell/src/main/pdf2docx-local.ts:1-138` |
| renderer调用 | `vendor/happyoffice/apps/pdf/src/renderer/App.tsx:5931-5943` |
| preload调用 | `vendor/happyoffice/apps/pdf/src/preload/index.ts:41` |
| PDFium与OCR staging | `scripts/build-office.mjs:289-301,352-359` |
| 现有专项测试 | `vendor/happyoffice/apps/shell/tests/pdf2docx-local-argv.test.ts`、`pdf-password-retry.test.ts` |
