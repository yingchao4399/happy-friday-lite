# Typewriter Nocturne 研究报告

研究基线：[Chaosnap/Typewriter-Nocturne](https://github.com/Chaosnap/Typewriter-Nocturne)，固定提交 `e19d64ef42b9241b462439e22d7b905b266633e1`。本次目标是保留原版外壳及反馈体验，按需装载笔记和终端两个内容插件。

## 1. 官方文档与实现的关系

已核对 README、`docs/ARCHITECTURE.md`、中文指南的 stage、paper、lamp、sounds、type、settings、press、privacy、building、shortcuts、faq，并对照实际源码。架构文档开头注明是早期架构调查，包含 Plan 和旧版 Hyper 基线；不能把其中的计划或 Electron 22 配置视作 Friday 的迁移要求。当前源码与用户提供的截图共同作为实现与视觉基准。

原作明确分成两层：Hyper 提供真实 PTY、xterm 缓冲及键盘输入；Nocturne 提供舞台外壳、灯光和机械反馈。后者不修改终端字节流，只接收光标几何、已显示字符、选区和按键种类。这正好允许替换内容模块。

## 2. 应保留的原版实现

| 区域 | 官方源文件 | 迁移方式 |
| --- | --- | --- |
| 完整舞台和 DOM 图层 | `lib/nocturne/components/shell.tsx` | 保留 React 组件，在 Vue 路由中挂载 |
| Studio 与二级设置 | `components/studio.tsx`、`controls.tsx`、`font-picker.tsx` | 保留 DOM、样式、分组、滑杆、按钮与行为；增加 i18n |
| 工具栏、墨水/羽毛光标、纸夹、灯绳 | `components/` | 直接复用，替换宿主命令传输 |
| 机身、程序纹理和运动 | `machine/`、`stage-controller.ts`、`carriage-physics.ts` | 保留几何、材质、参数和调度 |
| 纸面与灯光 | `lighting/paper-light.ts`、`light-model.ts`、`papers.ts` | 保留纸张表面与光照两遍渲染 |
| 声音与 IME | `typewriter/sound-engine.ts`、`keys.ts` | 保留离线合成和被动监听，增加笔记输入目标 |
| 印刷台、火漆与丝带 | `print/press.tsx`、`folio-canvas.ts`、`seal.ts` | 直接复用完整预览与动画 |
| 档案 | `print/archive.ts`、`app/nocturne/archive-store.ts` | 保留校验与存档格式，换成 Friday preload/用户目录 |
| 终端只读桥 | `lib/nocturne/terminal-bridge.ts` | 保留原作回显确认、密码保护、DECTCEM 与命令标记 |

完整对应表保存于 `src/features/typewriter/nocturne-core/UPSTREAM.json`。不迁移 Hyper 的 Redux、主窗口、旧版 Electron、Node integration 或 remote 权限体系。

## 3. 拟真体验的关键机制

1. 字头跟随可见输入位置，齿条列数来自内容网格，使用加速、撞停、回弹、摆动和回车物理；击键同时抬色带、转卷轴。
2. 纸张先生成反照率与纤维法线，再计算光照。纹理不能被终端不透明背景或插件自己的背景覆盖；灯光变亮也不能直接把纸面换成纯白层。
3. 声音预先用 OfflineAudioContext 合成，击键时播放短缓冲，声像跟随机头。输入法由 composition 事件驱动，快捷键不误击键。
4. 墨迹只绘制内容区已经显示的文字。终端密码不回显时不产生字符墨迹。
5. 原版 CSS 决定图层混合：纸面光 multiply、光晕 screen；光标在正确的纸面/舞台坐标中定位。所有视觉 canvas 忽略指针。
6. 设置变化不重建编辑区；Focus、Effects Off、Reduced Motion 与 Auto 无 GPU 降级保留输入及内容。

## 4. 本地旧实现发现的问题

| 用户现象 | 代码与运行证据 | 根因 |
| --- | --- | --- |
| 三个入口都是终端 | 空白稿和打开文件都挂载同一 Stage，且 Stage 无内容插件分支 | 没有实际的笔记/文档输入模块 |
| 打不上字 | 未注册 `xterm.onData → pty.write`；隔离运行后光标不随键入前进 | 输入通道遗漏 |
| 没有击键声和联动 | 未调用原作 `observeKeys()`；隔离运行 keys=0 | 视觉引擎未收到原版按键事件 |
| Markdown 加载失败 | `Get-Content` 拼接到 CMD，截图明确报告不是内部命令 | 文件读取与 Shell 执行混淆 |
| 背景像白纸、设置缺失 | 简化外壳遗漏原版条件类、设置和完整图层行为 | 重写壳与原作产生偏差 |
| 双光标与位置错位 | 在文本容器中使用舞台坐标，同时保留 xterm 光标 | 没有复用原版自绘光标和桥接配置 |
| 没有笔记联动 | 适配器未连接 Note store/数据库 | 独立的空白稿状态不是笔记 |
| Press/Archive 只是简化弹窗 | textarea 与 localStorage 占位实现 | 没有复用原作完整组件 |

已建立 `scripts/probe-typewriter.mjs` 隔离 Electron 检查。旧实现可复现 keys=0；替换原版 Shell 后，同一真实键盘检查已观察到 keys=11、实时音源播放=11、光标列随输入变化。此证据仅覆盖该输入链路，不能替代笔记、完整 UI 或安装包测试。

## 5. 必须验证的边界

笔记选择、新建和自动保存必须操作现有 notes 数据；加载笔记不载入终端、不带笔记编辑器背景；Markdown 导入后属于笔记模块。内容插件只能提供通用几何和编辑/滚动能力，不能控制主题。平台相关 Shell、中文输入法、图像协议与 GPU 降级分别验收。Linux/macOS 的结果不能由 Windows 测试推断。
