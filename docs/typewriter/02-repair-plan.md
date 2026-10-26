# Typewriter 修复方案

## 目标结构

```text
Friday /typewriter 路由（入口、笔记选择、全局语言）
└── 原版 NocturneShell（始终保持同一个实例）
    ├── 原版机器、灯光、纸张、声音、光标、Studio、Press、Archive
    └── 内容插件插槽
        ├── Notes：Markdown/代码文本编辑 → 现有 Note store 与 SQLite
        └── Terminal：xterm ↔ 专属 preload IPC ↔ node-pty
```

## 1. 替换旧外壳

删除近似 Vue 舞台和简化设置，Vue 只挂载原版 React 子树。保持原版 DOM 层级、CSS 类、图层顺序、物理参数与二级菜单。仅对 Electron transport、宿主生命周期、插件接口和中英文做必要修改。固定上游提交并保留 MIT、字体和资源许可证。

## 2. 分离两个插件

外壳读取 cursor、key、strike、selection、marginBell、cue，不接收 Shell 字节，也不持有 Note store。通用接口提供 focus、text、scroll、flush 和 dispose。

Terminal 负责 onData/write、启动输出、resize、退出和释放；直接使用原作只读 terminal bridge。Notes 负责文字输入、选择/光标几何与 Markdown 映射。两个插件均透明，字体和纸张来自 Nocturne 设置；切换插件不重建外壳。

## 3. 笔记联动

- 新建立即调用笔记模块的 create_note，获得真实笔记 ID。
- 选择器列出现有笔记，读取同一条记录；保存更新该 ID，不额外创建副本。
- 输入后自动保存；切换笔记、切换插件、离开路由前等待保存完成。失败保留正文并提示，不静默切换。
- HTML 与 Markdown 转换保留非 Markdown 节点；没有编辑时不改写原笔记。
- Markdown/代码文件经文件 API 读取后导入笔记；不拼接、不执行 Shell 命令。
- 支持跳回笔记模块打开同一笔记。后续插件可扩展 Office/Agent，本次不改 AI/RAG 链路。

## 4. 拟真反馈与官方菜单

复用原作 observeKeys、StageController 和 TypewriterSounds；笔记桥提供实际纸面位置。复用三主题、六纸张、原版灯绳和纸夹、完整 Studio/Press 设置。所有显示标签增加中英文，使用 Friday 全局语言。灯光开关不移除纸张纹理。

## 5. 终端与主进程

Windows 优先 PowerShell；POSIX 使用系统 Shell。原生模块按需加载，启动失败只影响终端插件。PTY 绑定窗口，销毁/关闭时释放；renderer 不能指定任意可执行路径。终端密码只产生按键种类，不在墨迹里重绘隐藏输入。

## 6. 测试与发布门槛

1. 单元：设置、物理、纸张/光照、按键分类、folio 校验、locale key parity、笔记保存与转换。
2. 隔离 Electron：两个插件实际键入、输入后光标/机头变化、实时音频播放、中文、粘贴、删除、回车、保存重开、插件切换不重建外壳。
3. UI：官方菜单、主题/纸张/灯光/质量/Focus、Press 蜡封丝带预览与打印、档案重命名/恢复/导出。
4. PTY：真实命令计算输出、resize、退出重进、ANSI、CJK、无回显输入、图像协议。
5. 构建与原生模块：前端 build、现有测试、打包后 node-pty 和资源实际检查；安装包再冒烟。
6. 核对已发布与本地安装包版本，选择下一个顺位版本；生成 SHA256、修复报告与测试报告，GitHub 上传并核验资产。

完成报告只列已实现且验证的项目；测试报告写明命令、证据、平台和限制，不以 build 成功等同于功能完成。
