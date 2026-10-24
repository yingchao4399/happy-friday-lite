# Office 文件命令、导出与选区验收

## 本次续做增量（2026-10-24）

- Word 正文菜单补齐全选、查找、撤销/重做，所有写入菜单按实际只读状态禁用并说明原因；支持原子菜单的方向键、Home/End 和 Esc。真实鼠标右键、系统复制、历史往返、查找、只读保护、760px 深色布局与源文件保护通过，日志 docs-context-menu-probe.log；菜单/打印范围专项 24/24。文件菜单在压缩构建后回归通过，日志 office-file-menu-minified-regression.log。
- Slides 原菜单补齐画布/对象全选、查找/替换与历史命令，按历史栈禁用。长表格菜单限制在视口内并能滚动，键盘不向底层画布泄漏。真实 PPTX 三对象复制/粘贴、六对象全选、撤销/重做、查找、窄窗口深色长菜单、实际滚轮/End/Esc 和源 SHA256 通过，日志 slides-context-probe.log，截图 slides-context-menu-dark.png。
- 该 Slides 探针发现粘贴后对象存在但主进程 dirty=false：共用 sessionTxn 更新归档/重解析后没有保留会话未保存标记。现统一在成功事务后设置 metaDirty，由历史快照恢复；探针确认粘贴 dirty=true、撤销 false、重做 true。失败/未应用事务不设置。尚不把本项等同于安装版关闭/崩溃恢复完整验收。
- Slides TypeScript 和 49 项菜单/键盘/历史/保存序列测试通过；编辑器构建及 Office stage 成功。主应用 Node 回归 105/105，主前端构建通过（55.00 秒）。日志 slides-context-typecheck.log、slides-context-tests.log、slides-context-build.log、office-build-slides-context.log、node-regression-slides-context.log、frontend-build-slides-context.log。
- Excel 直接扩展 Univer 原菜单与原命令，不另建网格菜单。真实工作簿的单元格右键、整表范围、编辑/撤销/重做、原查找面板/Esc、行列头菜单共用命令唯一且保留原插入操作、中英文切换、900px 深色菜单边界和源 SHA256 已通过，日志 sheets-context-probe.log，截图 sheets-context-menu-narrow-dark.png。TypeScript、编辑器构建与 Office stage 均通过；菜单/快捷键/历史/语言专项 53/53，日志 sheets-context-tests.log。最终安装版仍待验收。
- 截图发现语言切换后外层工具栏已英文、原 Univer 菜单仍中文：旧语言应用只在初始化执行，且英文回退直接返回。已将原网格接入语言 effect，英文及没有原生语言包的语言回到启动英文包；异步请求标记与 AbortSignal 防止旧包覆盖或关闭后访问销毁的运行时。真实菜单同时检查原 Copy/Cut/Paste 与新增英文命令，3 项针对性语言测试覆盖回退、竞争与取消。
- 最新两编辑器构建及 stage 后主应用 Node 回归仍为 105/105，日志 node-regression-office-context.log；上述前端构建 55.00 秒记录仍适用主 Vue 构建。
- Word renderer 使用 esbuild 压缩，入口约 6.63MB 降至 3.92MB。隔离三次中位数比较：安装基线总耗时 2850ms，开发版 2091ms（73.4%）；但 Ribbon 641/695ms（92.2%）、可输入 1215/1253ms（97.0%），单项 80% 门禁仍未达到。日志 office-startup-minified-comparison.log。曾尝试 AI 面板 lazy 拆分，收益不明确，已撤销该试验；不将该拆分计为交付功能。
- 首开探针新增可选 --profile，保存真实渲染进程 CPU profile 并汇总热点；本轮采样退出 0，初始化/关闭不遗留 target-closed 的未处理拒绝。最新样本 updateStateInner 自耗采样约 21.7%，主要调用链来自 EditorContent.componentDidMount → init → createNodeViews → setProps → updateStateInner；解析约 101ms、安装正文约 72ms。此为带采样开销的定位证据，不当作性能门禁结果。日志 office-startup-cpu-profile.log，原始 office-startup-preview-cpu.json。首次可编辑 80% 门禁继续未完成。

- PDF 全文选择已完成：使用全文索引建立 anchor/focus、字符项和文本快照，跳过删除/空白页，按当前页面顺序，包含未挂载页；OCR 更新会刷新快照，切换文档或页面顺序时清除旧请求。只高亮已挂载文本层，保持虚拟渲染。
- 右键全文全选和 Ctrl+A、系统复制/Ctrl+C、TXT 导出、AI 引用读取同一快照；滚动卸载原页后保持，Esc 或新建鼠标选区可清除。真实 Electron 12 页末页未挂载、全文复制/TXT/AI、精确鼠标拖选、搜索、批注撤销、源保护、加密只读和窄窗口回归已通过。日志 pdf-select-all-after.log；修改前失败证据 pdf-select-all-before.log。
- 新增三项全文单测覆盖 220 页末页、页面重排/删除/空白、OCR 更新及空文档，连同既有 control/选区专项合计 9/9；本轮主应用 Node 回归仍为 105/105。全文选择的精确批注按钮禁用并说明应选择页内具体范围，不将全文批注算为已支持。
- Word 已从真实文件菜单、原打印预览和 Windows Microsoft Print to PDF 生成单页文件，进程退出 0。实际页面解码、截图与 OCR 识别测试标记通过，正文、表格、图片、公式可见；源 SHA256 和 dirty 不变。日志 office-print-output-docs.log，截图 office-system-printed-docs.png。系统虚拟打印机可能输出栅格页面，探针已支持 OCR 校验，不以缺少文本层误判空白。
- Excel/Slides 的 Windows 打印辅助窗口改为父窗口的模态子窗口；表格实测 modal=true、父编辑器 isEnabled=false。但自动化工具向系统保存框输入时仍会激活最外层窗口，焦点恢复和输出尚未验收通过。Word 输出通过；其余三类输出、PDF 取消后的正常退出仍待完成。不声称纸质打印机或最终安装版打印已验收。
- 较早的前端构建 38.30 秒、Office 全量及打印 main 构建也已成功；日志 frontend-build-select-all.log、office-build-select-all.log、office-build-print-modal.log。下方早期记录保留对应范围，本节为最新状态。

日期：2026-10-24。版本：3.0.6-preview.2 开发副本。基线仍为用户已安装、包含 AI Core 扩展的 3.0.6；没有覆盖安装目录，没有交付安装包。

## 已实现

- Word、Excel、Slides、PDF 使用共享文件菜单、选项和受限 preload/IPC，沿用上游 Office 的菜单、弹窗及主题变量。
- 导出先取得当前编辑快照，后台 worker 转换，最后以同盘临时文件替换目标。拒绝覆盖当前源文件；取消、失败不改变已有导出目标；导出不清除编辑器未保存状态。
- Word DOCX/TXT/MD；Excel 全部工作表 XLSX/TXT/MD；Slides PPTX 和包含原渲染图片、备注的 DOCX 讲义。原有 PDF/打印路径继续由真实编辑器处理。
- 系统 Microsoft Office 提供 DOC/XPS、Excel PDF/XPS、Slides PDF/XPS/MP4/动态 GIF，以及 PPT、POT、POTX、PPS、PPSX、ODP 类型转换。缺少转换器、系统 Office 占用、源文件覆盖等情况有具体提示。
- 取消命令仅作用于发起文档。先发取消信号，再结束转换链；登记本次 PowerShell/Office 的 PID 和启动时间，只清理相符实例。已有系统 Office 进程时拒绝启动该类型转换。
- PDF 未修改保存禁用并说明原因；另存调用真实编辑器，旋转修改可进入副本，原文件和未保存状态保留。
- 修复 Slides 打包时 React 重复实例导致 hooks 崩溃；四个编辑器构建均去重 React。只构建界面时保留已构建的 Windows XLSX sidecar。
- PDF 选择定位新增最小文本项、字符和页内偏移；双击/三击/Shift 扩选不再被轻微抖动阈值清除。批注只读取被选字符的 Range，避免段落或页容器混入；只测量选中页，移除整页矩形的两两包含比较。
- OCR 文本随后续页面旋转，保持原字符位置及字高；识别结果显示误差提示。
- 构建加入 Windows OCR 引擎；CJS 资源位置由运行时 `__filename` 计算，支持迁移安装目录。OCR 改为异步子进程，视图销毁可取消；无引擎或识别失败显示原因与下一步。

## 已有证据

| 检查 | 结果及范围 |
| --- | --- |
| 主应用 Node 回归 | 105/105，含目录链接清理、剪贴板、选区归一化、音频转写/校对/IPC 和选区 TXT 文件保护；开发环境 |
| 前端构建 | 成功，最新记录为 55.00 秒（frontend-build-slides-context.log）；不是安装性能结论 |
| 四编辑器 TypeScript | 四个均通过；新增异步 OCR/选区改动后的 PDF 再次通过 |
| `scripts/tests/office-export.test.mjs` | 4/4：文本/表格导出、源保护、失败取消、讲义图片/备注及 DOCX 解析 |
| `scripts/probe-office-file-menu.mjs` | 真实 Electron/preload/IPC：未保存 Word 内容导出、源哈希、dirty、取消、拒绝源覆盖、选项持久化、Esc；新增原生 Home/End/Esc、焦点恢复、窄窗口布局和浅深色检查通过 |
| `scripts/probe-office-secondary-menus.mjs` | 真实编辑器：Excel 日志及全部表保留；Slides 未保存备注、PPTX/讲义/模板转换及菜单取消视频；PDF 只读、另存和 90° 旋转副本；全部通过 |
| `scripts/probe-native-office-exports.mjs --types-only` | 六种新增类型实际生成并检查签名/内容类型；POTX/PPSX 保留两页与备注；ODP 含正文 |
| `scripts/probe-office-export-cancellation.mjs` | 在 native-starting、native-ready、native-converting 三阶段取消均通过；原目标不变，无 Office 进程残留 |
| PDF 针对性测试 | 47 项通过：字符范围/方向/几何、OCR 文本与旋转、接口；异步 OCR 和几何优化后的重跑也通过 |
| 真实鼠标/键盘 | 窄窗口鼠标可打开菜单，Esc 可关闭。发现测试宿主未随缩放更新嵌入区域，已补宿主布局；复选框被上游通用 modal 样式覆盖的问题通过局部优先级修复，最新真实鼠标检查通过 |

诊断日志、生成文件与截图位于 `app-data/diagnostics/`，包含 `office-file-menu-word.png`、`office-secondary-menus.log`、`office-export-cancellation.log`、`office-native-exports/` 等；均使用临时生成文件和隔离数据。

## 正在验收及未完成

- `scripts/probe-pdf-selection.mjs` 已通过：迁移中文目录后实际 OCR 成功，识别期间事件循环计时器继续触发 29 次；真实 PDF.js 跨段、跨页、双栏、表格、旋转文字、反向 anchor/focus、缩放和扫描 OCR 旋转全部通过。截图 `app-data/diagnostics/pdf-selection-ocr.png`。新增右键探针已验证普通文本真实鼠标拖选和系统复制；复杂多页场景的人工拖选仍需补充。
- 修正取消和所有权后，原生转换 8 格式和新增类型 6 格式统一复跑均通过（共 14 项）；MP4/GIF 实际生成，GIF 包含多帧。
- 键盘 Home/End/Esc 及焦点恢复、760px 窄窗口和浅深色截图已通过；真实鼠标字符拖选、系统剪贴板复制及更窄窗口仍需补充；开发探针不能代替最终安装版。
- 完整系统打印、复杂 Office 文件的格式兼容、所有开始/选项功能与上下文菜单仍需按原清单核对。
- Windows Word 连续 20 次打开、关闭已通过：每次 WebContents 回到初始 1 个；预热后工作集斜率 -1,269 KB/次，后五次平均比前五次少 15,870 KB。对应日志 `office-lifecycle-20.log`。其余三类开关和大型 PDF 10 秒滚动本轮结果见下；相比 3.0.6 的 80% 启动指标仍须验收。
- 背诵音频、迁移回滚、全模块 UI/UX、剪贴板最终系统场景及 Windows 安装升级/回退/卸载重装仍见总清单，不能提前打交付包。

## 最新界面证据

`office-options-word-narrow-dark.png`、`office-options-word-narrow-light.png` 为实际编辑器视口内的选项弹窗，已断言边界完全位于视口、复选框文字同排及控件尺寸。真实鼠标打开文件菜单/选项、Esc 关闭已检查；只有测试宿主使用独立窗口，当前正式安装程序未被关闭或替换。

系统 PowerPoint 导出的 MP4 和 GIF 已在真实 Electron 解码器中检查：MP4 为 1280×720、10.004667 秒，播放时间实际推进；GIF 为 853×480，解码成功，之前已确认多帧。日志 `office-export-playback.log`。Windows Word 关闭改为先结束当前 IPC/分离视图、再显式关闭 WebContents，并在保存确认后执行；其余平台保留原有关闭规避，未声称跨平台验收。

## PDF 正文菜单补齐及其余编辑器生命周期

- 新增正文菜单复用原 `thumb-menu` / `file-menu`，使用原版浮层关闭规则。接上复制、全文全选、页内全选、搜索、AI 引用、高亮/下划线/删除线、精确选区 TXT 导出、来源页定位、旋转及撤销重做。全文全选的实现及证据见下。
- TXT 通过正式 preload/IPC 保存，取消不写，临时文件原子替换，禁止源文件及硬链接别名覆盖；独立文件测试通过。菜单、选区/批注专项本轮 38/38，通过 PDF 类型检查与完整 Office 构建。
- `probe-pdf-context-menu.mjs` 已整体通过：真实鼠标拖选精确得到 `selected words`，系统复制、搜索、TXT 导出/取消、批注及撤销、AI 引用、源哈希保护、真实加密 PDF 的只读过滤、760×700 菜单边界和 Esc。重复从旧选区内部拖动会触发 Chromium 文字拖放，测试改为先点空白取消旧选择；未以 DOM 选择替代拖选。加密文档跳过不能解密的 pdf-lib 自定义表单读取，消除正常只读打开时的辅助 IPC 异常，重建后探针重新通过。
- Excel 连续打开/关闭 20 次通过，每次 WebContents 回到初始 1 个；预热后斜率 -893 KB/次，末五次均值比最初五次少 13,318 KB。Slides 同样通过，斜率 +973 KB/次、均值差 +4,699 KB；PDF 同样通过，斜率 -694 KB/次、均值差 -6,778 KB。对应 `office-lifecycle-{sheets,slides,pdf}-20.log`。这验证 Windows 开发运行的释放与预热内存走势，不能替代安装版和任意大型文件的长期使用。
- `probe-pdf-scroll.mjs` 使用 220 页、23,909,749 字节生成图文 PDF，连续滚轮 10,005.9ms，实际移动 13,816px，收集 1,593 帧；帧间隔 P95 6.3ms，最大 30.9ms，无 >100ms 停顿，同时最多四个页面 canvas。日志 `pdf-large-scroll.log`、截图 `pdf-large-scroll.png`；该文件下开发环境滚动门禁通过，启动 80% 指标与安装版仍未验证。
- 最新正文菜单截图 `pdf-document-menu.png`、`pdf-document-menu-readonly-narrow.png`，实际使用原 PDF 菜单主题变量和焦点样式，无越界；全类型右键命令清单和完整打印仍未完成。

官方上游组件测试在本轮通过：Docs context menu/print-range/print-zoom 共 21 项，Sheets context submenu/print options/settings 共 51 项（含 native:test 187 项和 release sidecar 构建），Slides context menu/print-html 共 16 项。最新 Office 构建重新编译并 stage 了 xlsx sidecar、四个 renderer/preload 和四个 main bundle；构建日志 `office-build-final.log`。构建后真实 `probe-office-secondary-menus.mjs`、`probe-pdf-context-menu.mjs` 和 `probe-pdf-scroll.mjs` 仍全部通过。

## 启动对比与加载流程改造

`scripts/probe-office-startup.mjs` 在 Electron 42.2.0 下，交替启动三次已安装源码和三次开发源码，使用同一 DOCX、独立数据库/配置及实际文字输入，校验安装基线 102 个文件在每次执行后哈希不变。原安装程序没有被启动或覆盖；基线只读取安装资源。该比较不等同于用户实际安装后从桌面图标启动。

改造前结果在 `office-startup-comparison.log`：主进程初始化中位数预览 1,200ms、3.0.6 为 1,116ms；从打开请求到输入成功为 1,210ms / 1,135ms，总耗时 2,933ms / 2,681ms，未达标。

已将一次导入四个主进程 bundle 改成启动加载 docs（共享最近文件/偏好），其他类型首次打开时加载。同类型使用共用 Promise，成功后缓存模块；按类型配置、注册 IPC 和保存钩子，恢复 Friday 偏好处理器，Slides 加载后再接放映全屏包装。

改造后 `office-startup-lazy-comparison.log`：预览初始化中位数 378ms，基线 1,089ms（34.7%）；本探针总耗时 2,040ms / 2,646ms（77.1%）。但单独打开请求到 Ribbon 为 695ms / 643ms，输入成功为 1,234ms / 1,143ms；这部分仍未达到 80% 目标，不能把总耗时改进当作整个性能要求通过。

改造后的完整 Node 回归 105/105；`probe-office-secondary-menus.mjs` 重新通过：初始只有 docs，并发首开 Excel 只创建一个视图，随后依次加载 Slides/PDF，验证当前内容导出、取消视频、模板转换、PDF 只读保存及旋转副本。最后回到预先打开并修改的 Word，未保存内容仍在、TXT 正常导出、源文件哈希不变。`probe-pdf-context-menu.mjs` 也在新加载流程下完整通过，包括加密只读和窄窗口边界。
