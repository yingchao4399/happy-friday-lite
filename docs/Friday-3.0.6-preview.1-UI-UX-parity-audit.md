# Friday 3.0.6 Preview UI/UX 对照记录

日期：2026-10-23  
对照基线：`cheney-plus/happy-friday-lite` 官方 `master`，`54e89a647c9dafe94e8154bac39ba299a1fd1088`（当前开发副本的源码基线）；对照官方 `docs/resource/6.png`、`docs/resource/8.png` 与 `AutomationView.vue`、`HistoryList.vue`、`SettingsModules.vue`、`KnowledgeList.vue`。

## 组件体系结论

- Friday 主应用由 Vue 3 实现。`src/components/` 的共用范围是聊天、图标和布局，没有 Element Plus、Naive UI、Ant Design Vue 等通用控件库。
- 主应用页面普遍使用项目 CSS 主题变量、局部 Vue 组件与 lucide-vue-next 图标；按钮、下拉框、选项卡、提示、列表和弹窗交互分别在官方 Automation、History、Settings、Knowledge 页面内实现。它们大多是页面作用域内的实现，主应用没有一个可直接导入的通用控件包。
- `vendor/happyoffice/packages/ui` 是 HappyOffice 内部的 React 共享包，peer dependency 是 React 19，供 Office 编辑器用。将它直接挂到 Friday Vue 主界面会带来第二个 UI 运行时，且不符合上游用法；本轮从官方 Vue 页面复用布局、尺寸、样式与动效实现。

## 官方页面视觉证据

- 官方设置页：居中约 900px 内容区，标题独立置顶，分组标题使用浅灰次级文字；设置项组成连续的浅灰面板行，行间用细分隔线，选择项和分段按钮右对齐。
- 官方日程页：使用应用可用宽度铺开日历网格；工具栏横向排列，主操作为深色实心按钮，日期单元以细边框分隔，不套额外内容卡片。
- 官方知识库页：在主应用导航外再提供可折叠、可拖宽的资源侧栏，主内容区有自己的轻量工具栏；底部固定知识库对话输入区。文件网格、列表和会话输入有各自布局，不使用统一页面卡片壳。
- 官方 Office 首页：页面有 28px/36px 内边距，欢迎标题、横向文件类型入口、分段筛选和最近文件表格分区排列；表格承载主要内容，快速新建入口按文件类型区分。
- 对照截图中的 Cookie 偏好界面不属于 Friday 主应用界面，不作为本轮视觉规范来源。

以上确认：侧边栏和标签栏沿用应用既有组件；新增页面按同类官方页面选择各自结构（Automation、History、Knowledge、Office），不把所有页面统一成相同宽度、相同卡片和相同操作栏。

## 对照与修复

| 表面 | 官方实现 | 本轮一致性处理 |
| --- | --- | --- |
| 背诵分析 | Automation 标题栏、主按钮、列表行；History 空状态；Automation 选项卡、下拉框与状态反馈 | 页面骨架、按钮、Select、Tabs、Notice 与确认弹窗复用官方布局和反馈；音频列表改为紧凑行式列表；转写、分析、练习分标签呈现；时间戳仍可跳播；桌面 API 不可用时显示明确状态。 |
| 剪贴板 | History 的居中 720px 内容列、标题、搜索框、全宽滚动层、空状态和行项目；Automation 下拉菜单 | 页面根布局已改为对齐 History 的居中限宽列、标题/搜索区间距、全宽滚动层和空状态；搜索框参数沿用 History，类型筛选在同一搜索区；条目采用行式布局；复制、置顶和删除使用紧凑命令按钮；敏感内容使用 Automation 确认弹窗节奏；增加复制完成反馈。由于 History 样式为 scoped CSS，本页复制其关键布局参数，没有声称直接复用了原页面实例。 |
| 侧边栏 | 官方 Sidebar `menu-item` 尺寸、tooltip、主题、活跃态 | 继续复用同一 Sidebar；把新增模块放在原功能末尾，保留原有模块的默认导航顺序；设置页可调整顺序。 |
| 标签栏 | 官方 TabBar `tab-item`、图标映射、拖放、关闭和激活样式 | 新模块图标补齐到官方映射；新增滚轮切换和键盘路径时保留原 Tab 样式；滚轮拦截仅限标签区域。 |
| 模块排序 | 官方 Settings `behavior-panel`、`setting-row`、主题与动作按钮 | 排序控件纳入原设置分组和行样式；复用共用按钮；保留拖放，增加可访问的上下移动、忙碌禁用和重置反馈。 |
| 笔记置顶 | 官方 NoteList 紧凑双栏列表、hover action | 置顶按钮移入标题行，悬停/聚焦显示，避免浮动按钮与标题争抢版面；保留原列表 hover 与主题状态。 |
| PDF | Office PDF 自有 React UI 与文本层 | 改进字符选择/OCR，正文菜单复用原缩略图菜单样式、主题及浮层关闭组件；没有另画选择控件。 |

## 组件来源与动效

- `src/components/ui/FridayPage.vue` 对齐官方 `AutomationView.vue` 的 `page-header`、`heading-group`、`header-actions`、页面 padding 和 860/560px 断点；属于从官方样式提取出的新 Vue 包装组件，不是官方已有共享组件。
- `src/components/ui/FridayButton.vue` 对齐官方 `create-button` 的次要/主要按钮和按下反馈；属于新 Vue 包装组件。
- `src/components/ui/FridaySelect.vue` 对齐官方 `form-select`、`dropdown-trigger`、`menu-item`，含箭头 180ms 旋转、菜单 150ms opacity/translate/scale 过渡、Esc 关闭、方向键选项移动和焦点恢复。
- `src/components/ui/FridayTabs.vue` 对齐官方 38px tab、24px 间距和 2px 活跃下划线。
- `src/components/ui/FridayNotice.vue` 对齐官方 `local-task-notice` 的行高、圆角、主题色和状态图标。
- `src/components/ui/FridayConfirmDialog.vue` 对齐官方自动化弹窗的 180ms fade、8px 上移及 0.99 scale，并提供 Esc、焦点循环和焦点恢复。
- 列表项悬停/按下反馈沿用 History 的 150ms 行状态转换；搜索框 focus ring 沿用官方 History 的 `accent-light`。

## 自动检查

- `npm run build`：通过。
- `node --test scripts/tests/preview-core.test.mjs`：7 项通过，涵盖迁移、置顶、敏感剪贴板、选项卡导航和背诵来源。
- Node 回归 70/70；创建/多选与媒体探针通过真实 preload/IPC、窄窗口、图片编辑像素和媒体播放检查。原版 NoteEditor 已验证富文本多图笔记的实际加载和保存重载。
- 当前独立测试运行目录已取得真实可交互主窗口和剪贴板浮窗；实机 Ctrl+A 全选、快捷键唤起、两条顺序粘贴逐字比对通过。浮窗使用相同主题变量和 Friday 控件。该运行目录不是最终安装包，不能替代安装版验收。

## 尚需实机图像验收

- 用 Electron 开发版和最终安装包各检查一次：浅色与深色、正常宽度与窄窗口、菜单和敏感确认弹窗的打开/关闭动效、TAB 焦点路径、真实音频与剪贴板数据。
- 当前安装版仍是 3.0.6，不能把开发页预览截图写成安装版验收证据。


## 10 月 24 日 Office 文件菜单与选项

Office 四类编辑器在 `vendor/happyoffice/packages/ui` 使用共享 `OfficeFileMenu` 和 `OfficeOptionsDialog`，沿用上游 `file-menu`、`modal`、`modal-backdrop`、菜单阴影和各编辑器主题变量。保持上游 Ribbon、文件入口和文档区；没有增加新的主应用导航或通用页面卡片。

窄窗口真实鼠标检查发现复选框被上游通用 `.modal label/input` 覆盖，已用局部 `.modal.office-options` 修复，避免影响其他弹窗。隔离测试宿主已按内容区同步嵌入视图尺寸。最新真实编辑器检查覆盖 760px 视口边界、同排复选框、浅深色、Home/End/Esc 与焦点恢复；鼠标可打开文件菜单和选项，Esc 可关闭。截图在 `app-data/diagnostics/office-options-word-narrow-dark.png`、`office-options-word-narrow-light.png`。证据仍属于开发副本，完整主应用及最终安装版审计未完成。

PDF 正文菜单复用原 `thumb-menu` / `file-menu`、主题、悬停/禁用样式和 `useDismissablePopover`，补键盘导航、焦点恢复和视口内滚动。真实右键操作完整通过，已查看 `pdf-document-menu-readonly-narrow.png`，760×700 视口内菜单无越界，加密只读命令有禁用原因；普通选区截图 `pdf-document-menu.png`。这不代表四类上下文菜单均已完整验收。

背诵逐段校对继续使用 Friday 原有页面、Button/Tabs/Select/Notice 和字体/间距变量，原始转写可展开查看。真实 Vue/preload 页面在 640px 下通过导入、播放、校对保存/取消、计划/题目和音频来源跳转；截图 `recitation-transcript-correction-ui.png`、`recitation-analysis-ui.png`。最终安装版、浅深色动效及所有新增模块仍须继续审计。
