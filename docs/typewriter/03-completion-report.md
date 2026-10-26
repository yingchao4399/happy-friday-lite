# Typewriter Nocturne 修复完成报告

版本：`3.0.6-preview.12`。上游基线：`Chaosnap/Typewriter-Nocturne`，commit `e19d64ef42b9241b462439e22d7b905b266633e1`。

本轮将 Friday 的 Typewriter 改为官方 Nocturne React 外壳嵌入 Vue 路由，保留原版 DOM/CSS、Three.js 机身、纸张和灯光层、声音引擎、墨迹、游标、灯绳、滚轮、Studio、Press、Archive 与回形针滚动条。Vue 只负责路由、插件装载、全局语言和 Friday 数据适配。

笔记插件使用透明 textarea，仅承担输入、选择、滚动和几何回报；其 Markdown 映射会保护图表、媒体和带 data 属性节点，保存时更新现有 note ID。新增笔记直接通过 NoteStore 创建。另存为和 Markdown/代码导入使用文件 IPC，不再把文件内容拼接成 Shell 命令。输入未能保存时保留编辑内容，同时写入本地草稿恢复记录。

终端插件使用 xterm 5.3 与 node-pty，主进程只允许选择受控 Shell 和用户主目录，renderer 不能传任意可执行路径。PTY 的创建、写入、调整、退出和释放均绑定到窗口；退出后可以重新启动。xterm 的 Canvas、Image、Unicode 和 Fit addon 在销毁前按正确顺序释放。

新增中英文 Typewriter 文案、原作设置翻译、许可证和来源映射；原版四种回形针 finish、拖动与弹簧倾斜在笔记和终端中共用。

仍按原作边界处理：AI、RAG、Agent、对话历史、Office 和现有 Notes 编辑器核心没有改写。
