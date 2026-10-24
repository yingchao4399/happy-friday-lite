# 数据迁移、最近删除与模块排序验收

日期：2026-10-24。目标版本：3.0.6-preview.2。

本次使用独立数据目录，没有覆盖已安装程序或真实用户数据。这是数据层与开发界面验收，不等于最终安装、升级、回退、卸载和重装通过。

## 1. 真实用户数据副本：通过

脚本：scripts/probe-user-data-migration.mjs。

数据源是已安装且包含先前 AI Core 扩展的 3.0.6 用户目录。复制 friday.db、config.json、session.json 和迁移标记到系统临时目录，子进程分阶段运行，避免不同版本数据库单例互相影响。日志只输出汇总，不输出笔记、对话、模型配置或 API Key。

实际数据库大小为 430,559,232 字节。已安装旧版数据库代码正常打开副本后，得到 16 张原表、4,043 行原始记录。

验收链路：

1. 使用当前安装 3.0.6 的 src-electron/db.js 打开并关闭副本，记录原表列名、行数与逐行内容 SHA256。
2. 调用正式 createUpgradeSnapshot，验证升级前 ZIP 中数据库、配置、会话和迁移标记的内容哈希；再次调用复用同一快照。
3. 使用预览版数据库代码升级，向全部 8 张新增表写入夹具，关闭后检查原表每行内容不变。
4. 调用 rollbackPreviewMigrations，删除预览迁移标记，保留新增表与用户新增数据。
5. 再用已安装 3.0.6 的数据库代码重开，确认原表仍一致、新增表中的记录仍保留。
6. 再次升级预览版，确认迁移幂等，8 张新增表中的记录不丢失。
7. 检查升级前 ZIP 的 SHA256 未变化、配置与会话原始字节未变化、真实源文件 SHA256 未变化。
8. 实际调用正式 restoreBackup 恢复升级前快照，核对全部原表、配置和会话，8 张新增表自动重建为空；保留 Chromium profile 运行标记，清理临时恢复及回滚目录。损坏数据库 ZIP 在验证阶段被拒绝，已有数据库和配置不变。

上述各阶段 SQLite quick_check 均为 ok，正式恢复还执行 integrity_check，最终进程退出码 0。

证据：

- app-data/diagnostics/user-data-migration.log
- app-data/diagnostics/user-data-migration-result.json

回退语义：回退应用版本并保持追加表，3.0.6 忽略这些表，后续升级重用；不通过删除新表来丢弃预览版新增数据。需要回到升级前完整状态时，保留的外置 ZIP 已通过正式备份恢复流程验证。此次未执行安装器替换。

## 损坏备份导致待落盘编辑丢失：已修复

额外调查发现：restoreBackup 在备份验证失败时，无条件重新 initDb。原数据库此时并未关闭，200ms 防抖期间的内存编辑会被旧磁盘副本替代。新回归先保存空库，再写入尚未落盘的笔记，并尝试恢复损坏 ZIP；修复前笔记立即丢失，修复后当前查询及关闭重开均保留正文。

src-electron/backup.js 现在只在已经进入替换、关闭数据库后重新初始化。原版备份错误提示及恢复流程保留。

- 修复前证据：app-data/diagnostics/backup-restore-pending-before.log，退出 1，待落盘正文读为 undefined。
- 修复后证据：app-data/diagnostics/backup-restore-pending-after.log，backup-restore、preview-core、trash 合计 14/14，通过且无跳过。
- 新测试：scripts/tests/backup-restore.test.mjs。

## 2. 原版设置界面：通过并修复一处实际缺口

脚本：scripts/probe-trash-module-order-ui.mjs，使用真实 Vue SettingsModules/Sidebar、正式 preload 和 registerCommands。

发现 Office 存在于模块列表，但未进入 Pinia 的显隐状态及配置归一化。导致 Office 无法保持隐藏、全部显示时数量为 10/11。

修复：

- src/store/modules/app.js 补上 Office 默认状态与配置归一化。
- SettingsModules 按实际支持的稳定模块 ID 计算显示数量和隐藏状态。
- 使用原组件、样式和交互，没有新增视觉体系。

本次通过：

- 旧的不完整顺序保留，并按默认顺序追加背诵分析、剪贴板。
- 真实键盘 Space 触发上移/下移按钮，通过配置文件和 module_order 表核对稳定 ID。
- Vue 拖拽事件进入原处理器，顺序变更并持久化。
- 重载后原侧栏顺序保持；切换中英文时保存的 ID 不变。
- 显示文本不能作为 ID 保存，非法排序参数被拒绝且旧配置保留。
- 恢复默认后配置为空序列、module_order 表清空，侧栏恢复默认。
- Office 隐藏、重载保持、全部恢复与 10/11、11/11 计数准确。

边界：拖拽使用 DragEvent/DataTransfer 驱动，不能替代最终安装版鼠标和触控板原生拖放验收。

## 3. 原版最近删除界面：通过

同一脚本使用正式 TrashView、preload 和主进程 IPC。

本次通过：

- 名称搜索、资源类型筛选、取消筛选。
- 过期敏感条目遮罩，恢复按钮禁用。
- 笔记、知识库文件夹和剪贴板三类混合批量恢复。
- 笔记原始正文、置顶和知识库引用保留，文件夹内容保留。
- 原笔记本缺失时确认恢复到全部笔记；取消不恢复。
- 同名目标冲突显示原因且不覆盖原目标。
- 恢复到其他位置、导出笔记副本。
- 永久删除确认取消不删除；确认清空全部、完整审计。
- 审计记录不含笔记正文。
- 浅色正常宽度与深色 640 像素窗口截图人工检查，操作按钮可见、无右侧越界。

目录选择对话框在该开发探针中只替换返回目录，后续仍需最终安装版真实原生选择器操作。

证据：

- app-data/diagnostics/trash-module-order-ui.log，退出码 0。
- app-data/diagnostics/module-order-light.png。
- app-data/diagnostics/trash-list-light.png。
- app-data/diagnostics/trash-list-dark-narrow.png。
- node --test scripts/tests/preview-core.test.mjs scripts/tests/trash.test.mjs：13/13 通过，0 跳过；日志 trash-migration-tests.log。

## 4. 保留的交付门禁

- 最终安装版鼠标/键盘/触控板与原生目录选择器操作。
- Windows 安装、更新、应用版本回退、卸载、重装。
- 完整用户业务目录及知识库复杂文件恢复；此次真实数据迁移聚焦数据库、配置和会话，资源恢复使用独立夹具。
- 其余模块、系统集成和整轮性能门禁。未生成最终安装包或 GitHub 发布。
