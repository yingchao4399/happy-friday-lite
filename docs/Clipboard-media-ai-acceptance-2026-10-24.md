# 剪贴板文件与音视频 AI 归档增量验收

日期：2026-10-24。源码版本：3.0.6-preview.2。仅修改独立开发副本，未覆盖安装 3.0.6 或真实用户数据。

## 根因及实现

- 文件解析后台已经存在，但文件条目右键菜单隐藏了 AI 命令。恢复文件类型的命令入口；文件夹仍不冒充可解析文档。
- 音视频只有有效缓存时才可分析，未转写时直接报错。现在复用版本匹配的缓存；缺失或过期时先转写，再进行敏感检查和重要性分析。
- 新增独立的音视频转写引擎设置，沿用 FridayDialog、FridaySelect 与既有主题和动效。默认 Windows 本机语音，可显式选择配置过的兼容模型；已知仅聊天的模型不会列为转写引擎。旧设置自动补本机默认值，不继承聊天模型。
- 自动转写对未知隐私内容使用 transcribeMedia 的可选 persist:false，结果只留内存，不写普通转写缓存；旧的三参数调用仍保持原行为。识别为敏感时，不调用归档模型、不生成笔记，也不继续处理后续媒体。
- AI 任务的 AbortController 覆盖内容准备、转写与分类请求。关闭自动归档会取消自动任务，保留用户手动任务；应用关闭会取消全部任务。取消显示为已取消，不再误报超时。
- 转写过程中重复校验条目隐私、内容修订、删除和过期；原转写器仍校验源文件版本。媒体转写正文在笔记中明确标记为音视频转写，并保留原始来源路径。
- 本机语言包缺失、错误模型、解码失败、文件过大、超时、服务失败和无效结果均显示具体下一步；服务响应正文不回传 UI。
- 钉窗也显示 AI 阶段与错误，原菜单返回的失败状态不会静默丢失。

## 已完成的开发验收

| 范围 | 证据 | 结果 |
| --- | --- | --- |
| 新增自动转写与保护测试 | scripts/tests/clipboard-transcription.test.mjs | 8 项通过，覆盖默认本机、缓存、自选引擎、敏感过滤、取消与手动任务、隐私/编辑/过期竞争、错误、设置迁移和真实 HTTP 缓存契约 |
| 剪贴板与背诵/转写兼容回归 | app-data/diagnostics/clipboard-transcription-regression.log | 58/58 通过，覆盖所有 clipboard 测试及 preview-core、transcription-contract |
| 真实 DOCX 与未转写录音模型归档 | app-data/diagnostics/clipboard-media-ai-real.log 及 .json | 退出 0；合成 DOCX 与新合成课程 WAV，Windows SAPI 实际识别，现有配置模型实际请求 2 次，均保存笔记；正文和来源保留、源 SHA256 不变、数据库重开通过 |
| 原版 Vue / 正式 preload / 正式 IPC | app-data/diagnostics/clipboard-transcription-ui-after.log | 退出 0；文件右键 AI 可用、音频主动本机转写后归档、引擎设置保存/重开、聊天模型排除、无效模型拒绝、窄窗口深色控件可见 |
| UI 协议模型 | 同上 | 使用仅监听本机的聊天协议夹具，收到 2 次实际请求。该测试验证真实 UI 与 IPC 接线，不表述为两次云端模型验收；上行真实模型证据单列 |
| 受保护缓存行为 | 同上及转写测试 | 自动识别没有产生 media-transcripts.json；明确调用旧转写接口仍可持久化 |
| 深色窄窗口人工查看 | app-data/diagnostics/clipboard-transcription-settings-dark.png | 转写选项使用原设置行、控件、弹窗，640px CSS 窗口内可见 |
| 最终前端构建 | app-data/diagnostics/clipboard-transcription-build-final.log | 成功，51.23 秒；包含钉窗阶段显示改动 |

最后一次正文标签和错误映射调整后，新转写专项再次 8/8 通过，见 app-data/diagnostics/clipboard-transcription-final-tests.log。完整 58 项回归在该文案调整前通过，没有以 8 项替代整轮回归。

运行真实模型验收：node scripts/probe-clipboard-media-ai.mjs。仅读已有模型配置，密钥只留内存，不写测试目录或输出。仅发送脚本生成的学习材料。

运行 UI 验收：先启用开发服务器，再运行 node scripts/probe-clipboard-transcription-ui.mjs。Node 父进程启动独立 Electron，并在其退出、释放 Chromium 缓存后，用不跟随链接删除函数清理临时目录。原第一次探针已通过功能断言但清理时碰到缓存占用，该次不能计为退出成功；修正后的 after 日志退出 0。

## 本项仍须完成的范围

- 最终安装版的同一路径及用户常用编码/真实口音/噪声测试。
- 用户配置云端或本地转写模型的实际服务兼容性。已验证 OpenAI multipart 协议和本机 SAPI，不把 DeepSeek 聊天能力当作语音能力。
- 整个剪贴板仍缺真实手机 LAN、多网卡/防火墙、原生钉窗拖动、常用外部应用互拷与敏感确认、实际录屏软件录制到自动收录等完整系统证据。
- 本记录不证明整轮计划完成，不产生最终安装包或 GitHub 发布。
