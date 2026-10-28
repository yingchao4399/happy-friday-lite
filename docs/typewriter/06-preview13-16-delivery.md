# Preview 13–16 四批迭代交付记录

基线：`3.0.6-preview.12`。交付平台：Windows x64 / Electron 42.2.0。原版 Typewriter Nocturne 固定于 `e19d64ef42b9241b462439e22d7b905b266633e1`。本轮保留已有 Office、笔记和其他工作区改动。

## 安装包

四批安装包均位于项目 `release/` 目录，版本递增；最新 preview.16 包含之前各批变更。preview.13、.14、.15 已保留，可以分别对照，不需要逐个安装。

| 批次 | Windows 安装包 | 范围 |
| --- | --- | --- |
| 1 | `Happy Friday Lite-3.0.6-preview.13-win-x64-setup.exe` | 墨色、字体、笔记引用和 revision |
| 2 | `Happy Friday Lite-3.0.6-preview.14-win-x64-setup.exe` | 命令浮窗、快捷键、Office 协调 |
| 3 | `Happy Friday Lite-3.0.6-preview.15-win-x64-setup.exe` | 原生插件管理和隔离宿主 |
| 4 | `Happy Friday Lite-3.0.6-preview.16-win-x64-setup.exe` | 社区市场和 Obsidian 兼容子集 |

安装包字节数、SHA256 和报告摘要见 `artifacts/typewriter/delivery-manifest.json`，校验清单见 `release/SHA256SUMS-preview.13-16.txt`。

## 第一批：打字机与笔记

- 保留原版 React 外壳及 Studio 二级菜单、Three.js 机身、纸张/光照、声音、回形针、灯绳、Press 和 Archive；笔记与真实终端继续作为独立内容插件。
- 纸面、终端默认文字、启动状态、游标和压印共享墨色解析。Studio 提供跟随纸张、六种预设、自定义和恢复默认。xterm 最低对比度生效，ANSI 颜色保留语义。
- 内置 IBM Plex Mono、Courier Prime、JetBrains Mono、Fira Code 和完整 Sarasa Mono SC。新增字体加载完成后切换，重新测量终端和拟真层；扩展字体支持应用本地导入、下载和离线读取，失败不会切换到未加载字体。
- 五种内置字体及字体许可证随包交付。扩展目录当前提供 Source Code Pro；用户可导入其他合法字体文件，不代表所有字体建议项都会自动下载。
- 笔记和打字机共享 noteId/revision 读写服务。正常保存更新引用索引；版本不匹配拒绝覆盖。保留本地输入与错误提示，未编辑的页面可接收外部更新。笔记保存串行，失败不再显示“已保存”。
- 有向出链、反向链接、未解析链接、旧相关笔记分别显示；列表支持继续加载。正文解析跳过代码，支持 WikiLink 别名/标题、稳定 ID 引用、补全和引用位置导航。
- 旧双向关系不直接当作正文引用；能够从正文确认的方向由索引重建，其余作为相关笔记保留。
- 数据库迁移前使用 SQLite 在线备份；新增设置带版本，保留旧版无包装设置的读取兼容。索引可重建。

## 第二批：命令和快捷键

- 全应用常驻按钮打开居中命令面板，按模块分类；支持中英文词条、拼音/首字母、最近使用、快捷键提示、上下选择、Enter 和 Escape。
- 导航、笔记、新建/保存/引用、打字机动作、设置及插件命令通过稳定 commandId 注册/执行/释放。现有 Office 和其他模块的全部内部菜单动作没有逐项重新注册；命令集合可继续扩充。
- 设置页提供快捷键录制、作用域冲突、清除、恢复、JSON 导入导出。系统全局剪贴板快捷键仍由原有系统设置管理，并提供入口。
- 命令面板默认 `Ctrl/Cmd+Shift+P`，Press 改为 `Ctrl/Cmd+Alt+P`，设置页提示迁移。移除舞台旧硬编码绑定，清除/改键后不会继续触发原快捷键。
- 全局绑定保护终端常用控制键和 Office `Ctrl/Cmd+P`；笔记作用域仍能使用保存快捷键。
- 原生 Office 视图通过主进程键盘桥和浮层暂停/恢复协议与命令面板协调。关闭浮窗恢复原文档及焦点，避免重载文档。

## 第三批：原生插件

- 设置增加插件管理、市场和详情。分类为智能体、笔记、Office、Obsidian 及三方、其他。
- 支持 ZIP 导入、市场下载、启停、持久配置、更新、回滚和卸载。安装校验 manifest、入口、相对路径、包体预算和哈希；拒绝符号链接和越界条目。
- 每个插件使用独立、无 Node 的 sandbox 窗口和专属 preload，不能访问主应用 electronAPI。受控接口按清单权限执行；未知模块/API 显示具体失败原因。
- 更新失败恢复旧包与配置并重新启用；权限增加的更新不会自动恢复启用。停用、卸载、崩溃或超时释放宿主及命令。卸载移除包、配置和草稿。
- 内置真实 `friday-writing-tools` 示例，支持字数统计、插入时间戳、写作目标配置。命令接入面板并可改键。
- 智能体插件工具接入实际注册表，使用纯 z.object schema、强制审批元数据和既有 interrupt 配置；没有改写 AI/RAG 请求链路。实际大模型调用仍需要用户自己的可用模型配置。
- Office 插件使用真实的新建/状态/选区/保存接口；已用独立运行探针实际创建 Docs。

## 第四批：Obsidian

- 社区目录来自 `obsidianmd/obsidian-releases`，保留作者、ID 和仓库。本轮联网目录为 9509 项；有离线缓存。发行包通过 GitHub 官方 release 下载，公共 API 不可用时使用同仓库发行页重定向，未使用用户凭据。
- 独立兼容层实现 Component/Plugin 生命周期、配置、命令、Notice、Modal、Setting、设置页、事件/定时器释放等基础能力；受控实现 Vault、MetadataCache、Workspace 和基础 Editor。
- Vault 是数据库笔记的 Markdown 投影，路径使用稳定 noteId。任意文件系统、Node、私有 API 和复杂视图接口未开放。未知接口明确报错，不把“下载成功”当作兼容通过。
- 支持在独立宿主窗口打开 CodeMirror 6 Markdown 模式，同一份 CM6 模块实例承载插件扩展。打字机继续使用原输入和拟真层，未替换为 CodeMirror。
- 表格、图表、媒体和带格式节点使用保护标记。删除/修改标记拒绝保存，失败保留恢复草稿；没有图形化冲突合并工具，遇到冲突时应先复制草稿，再在笔记中合并。
- 从笔记或打字机打开命令面板，搜索“Markdown 兼容编辑器 · 插件名”进入。安装并启用插件后，其注册命令也出现在面板。需要全文改写/任意范围编辑的插件应使用该 Markdown 模式。

### 已实际运行的原包

| 插件及版本 | 来源 | 实测范围 | 状态 |
| --- | --- | --- | --- |
| Obsidian Sample Plugin 1.0.0 | `obsidianmd/obsidian-sample-plugin` 官方 release | 原始 main.js/manifest/styles，ES5 生命周期、命令、Modal、状态栏、设置 | 已验证此版本的上述范围 |
| Sort and Permute Lines 0.9.0 | `vinzent03/obsidian-sort-and-permute-lines` 社区 release | 原包下载/安装/启用；CM6 中 `sort-alphabetically` 排序并保存同一笔记 | 部分兼容，其余命令未验收 |

另外使用现代 Obsidian 测试包验证 class 生命周期、配置重启保留、Editor 回调、Vault 保存、MetadataCache 标题及真实 CM6 扩展。这是兼容接口测试，不作为其他社区插件的验证结果。

官方示例 1.0.0 `main.js` SHA256：`fb38a50b1dbc3987ef34d7c5de77865e7a5c48719ffe3a11baecb6106124b1ae`。原始代码没有为 Friday 改写，样式被限制在插件窗口。

## 验收记录

| 检查 | 结果与证据 |
| --- | --- |
| 完整脚本测试 | `node --test "scripts/tests/*.test.mjs"`：234/234，通过；含 Nocturne 上游核心、笔记索引/冲突、插件包/投影、键表及中英文 key parity |
| 构建/原生脚本测试 | `node --test "scripts/*.test.cjs"`：20/20，通过 |
| 前端与宿主构建 | `npm run build`、Windows 打包中的 Vite/Nocturne/plugin-host 构建通过；存在既有大 chunk 提示 |
| Windows 原生模块 | `verify-packaged-native-modules` 通过，见 `artifacts/typewriter/batch4-native.log` |
| 第一批打包应用 | `packaged-1-report.json`：真实中英输入、同 ID 保存、AudioContext 声音、内置字体与墨色、PowerShell 计算回显 |
| 第二批打包应用 | `packaged-2-report.json`：包括 Windows 实际按键在真实 Office 原生视图触发 Ctrl+Shift+P，并验证关闭后焦点和正文恢复 |
| 第三批打包应用 | `packaged-3-report.json`：插件管理/命令面板/笔记保存、停用与卸载 |
| 最终打包应用 | `packaged-4-report.json`：13 项功能检查通过，含三主题×六纸张×两档灯光的 36 组切换、同输入实例/正文保持、Source Code Pro 实际下载加载、真实 PowerShell、Office 浮层/焦点、原包兼容和真实市场下载后执行 |
| 最终包快捷键专项 | `packaged-shortcuts-report.json`：4 项通过；实际录制、改键执行、清除/恢复、打印保留键、冲突提示、文件输入导入和导出内容 |
| 原生插件隔离运行 | `plugins-runtime-report.json`：7 项通过，包括真实 Office 接口、审批工具注册、配置持久化、失败升级回滚、宿主真实崩溃、超时清理 |
| Obsidian 隔离运行 | `obsidian-runtime-report.json`：4 项通过，包括官方原包、CM6 连续保存/保护节点/恢复草稿、现代 API 和真实社区排序插件 |
| 社区网络与缓存 | `plugin-market-report.json`：官方目录及缓存、原始发行包下载和安装通过 |
| Nocturne 细节探针 | `workspace-report.json`：14 项通过，覆盖机身实际绘制、击键声音能量/光标运动、真实指针拖动回形针、四种金属材质、Press/Archive/PNG、PTY 退出重启、导入、KeepAlive、Focus/Effects 和保存失败保留输入 |

最终回归直接启动 `release/win-unpacked/Happy Friday Lite.exe`，使用隔离临时 profile；没有替换用户正在运行的安装版，也没有以“进程仍活着”作为通过标准。功能探针会实际检查 DOM、数据库、音频节点、PTY 输出和插件结果。

## 验证边界

- 目前运行验收的是 Windows x64。Bash/Zsh、macOS、Linux、远程桌面、高 DPI、多种硬件 GPU、无 WebGL 的系统级矩阵尚未逐项实际运行。
- 中文插字和原作 IME 逻辑已覆盖；未逐个 Windows 输入法进行候选窗/组合输入人工验收。
- 36 组外观回归验证切换、舞台存在及输入保持；不等于对每种硬件上的纸张光学观感作了逐像素保证。软件 GPU 继续沿用原作自动质量降级策略。
- 无 Node/任意文件访问、复杂工作区视图、渲染后处理、依赖其他插件或私有接口的扩展可能无法运行。具体原因显示在插件管理中；社区兼容性需要按插件版本继续验证。
- 本轮尚无完整浏览器内冲突合并/三方 diff 界面。正文 revision 冲突会拒绝覆盖并保留草稿，而不是自动选择一方覆盖。
- 此处验证的是安装包所包含的实际打包程序；未覆盖每种 Windows 安装器权限/升级路径。安装包未进行代码签名。
