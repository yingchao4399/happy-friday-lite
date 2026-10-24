# DSH 运行依赖反复丢失：根因与修复证据

日期：2026-10-24。开发版本：3.0.6-preview.2。此报告不是整轮迭代或最终安装版验收结论。

## 故障链路

此前反复出现“依赖校验通过 → Electron 验收可启动 → 下次启动缺少包”的现象。重新安装只恢复被删文件，没有修正导致文件丢失的操作。

DSH 在 `$DSH_HOME/profiles/node_modules` 中建立 Windows junction，目标是应用的运行依赖。开发探针退出后调用 Electron 的 `fs.rmSync(profile, { recursive: true, force: true })`。在本机 Electron 42.2.0 / 内置 Node 24.15.0 中，这个调用穿透 junction，删除了链接目标中的文件，留下空的依赖目录。

最小复现只创建全新的临时目录与一个 package.json，不读取真实配置、不修改真实安装或用户目录：

```powershell
node node_modules/electron/cli.js scripts/probe-junction-cleanup.mjs --unsafe-repro
```

原始路径复现结果：`targetPreserved: false`。同样的小样本在普通 Node 24.19.0 中结果为 `true`。这是一项已复现的运行时行为差异；不能据此推断所有 Electron/Node 版本均存在同一问题。

## 公共修复

新增 `src-electron/fs-safe.js`，提供同步及异步的不跟随链接删除方法：

- 每层用 lstat 检查，链接只 unlink；不进入链接目标。
- 调用者必须指定所属目录，拒绝删除该边界本身、越界目标及通过中间目录链接访问外部文件。
- 处理悬空链接、不存在目标、只读文件及 Windows 路径大小写。

接入 DSH 和其他 Electron 验收探针，并替换备份恢复/回滚清理、最近删除跨盘清理和永久删除、技能删除/恢复、RAG 索引清理、剪贴板分享归档清理中的递归删除。构建脚本由普通 Node 运行，未将构建阶段的全部目录操作无差别重写。

DSH 网页探针同时改用唯一 mkdtemp 工作区，避免固定目录误删；输入与发送分开等待。成功标准为持久化的 `assistant/message`，不再数页面中的测试字符串。DSH 会将会话追加为多个独立 Zstd frame，因此读取时逐帧解压，避免只读到会话头而错误判为模型超时。

修正根因后通过现有锁文件执行 `npm ci --legacy-peer-deps --prefer-offline --no-audit --no-fund`，运行必要 postinstall；未再从已安装应用零散拼接依赖。

## 实际结果

| 验证 | 结果 |
| --- | --- |
| 原始 junction 删除最小复现 | 真实 Electron 删除外部 fixture 文件，确认故障 |
| 新公共方法，同步/异步清理 | 真实 Electron 中链接目标文件保留 |
| `npm run verify:dsh` | DSH CLI、llm-pi-ai、MCP、ACP、typebox 入口及导入树通过 |
| `node scripts/probe-dsh-integrity.mjs --task` | 连续两次真实 Electron 启停及一次真实模型任务通过，每次后校验 7,103 个依赖文件 SHA256，0 个变化 |
| DSH 实际对话 | 正常选工作区、发送只读提示、使用现有 DeepSeek/deepseek-flash 配置收到回答；29 个应用工具同步 |
| `node node_modules/electron/cli.js scripts/probe-data-cleanup.mjs` | 最近删除永久删除不穿透子目录 junction；真实备份/恢复还原笔记，回滚目录清理后外部运行文件保留 |
| Node 回归 | 93/93 通过，含真实 Electron junction 回归；没有跳过 |
| `npm run build` | 通过 |
| `node scripts/build-office.mjs --skip-renderer` | Rust xlsx-sidecar 编译、四类主进程/CLI 构建及 staging 通过，验证中文空格路径修复；renderer 使用本轮已构建产物 |
| Office 真实 Electron DOCX 选区 | 重建后通过 |

命令输出保存在开发目录 `app-data/diagnostics/`，不作为安装包内容。

## 仍需完成

这是 DSH 开发运行链路及公共清理缺陷的修复，尚未代替最终安装版的图标启动、最小任务、安装升级回退验收。Office 完整导出、PDF 精确选区/OCR/性能、音频完整链路、剪贴板系统/手机集成及其余整轮要求继续以 `Friday-preview-delivery-status.md` 为准。

预防措施：保留真实 Electron 不跟随链接回归，以及 DSH 启停/任务后的依赖哈希验证；开发验证不得只在普通 Node 中执行后就声称桌面运行时通过。
