# Office 首开性能续做与证据

日期：2026-10-24。范围：隔离数据的 3.0.6 安装源码与当前开发副本，Electron 42.2.0，同一 kitchen-sink.docx，交替三轮。不是最终安装版结论。

## 本轮修复

- Word 在隐藏状态预先挂载空 EditorContent，原“正在打开”界面保持；文档解析后显示同一实例。避免完整文档首次挂载时 createNodeViews 再重建全部文档 DOM。CPU 采样中 updateStateInner 从 160 个采样下降到约 2 个，采样范围及系统负载不同，不能把此数字当作总启动加速比。
- 文档切换清空撤销栈改为两次内存 reconfigure、一次 view.updateState。保留其他插件状态、文档和选择位置，仍禁止跨文档撤销，并避免原 unregister/register 连续重建全部布局插件。
- 原版 Ribbon 样式库按卡片宽度与容器可用宽度计算完整卡片数量，先读后写；ResizeObserver 完成布局后再测量。保留原卡片、间距、裁切和“更多样式”交互，减少反复清除 maxWidth 后逐卡 offsetTop 导致的强制布局。
- 仅有欢迎语的空 AI 会话不读取 scrollHeight；真实历史、流式消息与展开时仍自动滚动。收起后保留草稿、会话和实例，继续由原 Ribbon 按钮重新展开。
- 创建 Word 视图时并行准备源字节，密码/恢复确认、归档与写入授权仍由正式打开流程处理。消费时复核 size/mtime，变化则重读；视图销毁和失败会释放待处理记录，没有未处理 Promise 拒绝。
- 启动探针仅在 editor DOM 已挂载且宽度大于零后实际插入文字，隐藏预挂载不算完成。增加只含阶段和耗时的读源/归档指标，不记录路径、正文或密码。

## 验证

| 证据 | 结果 |
| --- | --- |
| office-startup-ui-final-tests.log | 15/15，撤销边界、分阶段加载、样式库完整卡片、AI 草稿与历史自动滚动 |
| office-startup-final-tests.log | 32/32，包括上述基础专项与 DOCX 密码回归（该次未包含后增 AI 空会话专项） |
| office-startup-final-typecheck.log | Docs TypeScript 通过 |
| office-startup-ui-final-build.log | Docs main/preload/renderer 构建通过 |
| office-startup-source-validation-stage.log | 正式 Office stage 通过，源读取复核由 main bundle 带入 |
| docs-context-startup-final.log | 真实 Electron 鼠标右键、全文复制、撤销重做、查找、只读、760px 深色、完整样式卡片、源哈希均通过 |
| office-file-menu-startup-final.log | 真实 preload/IPC 的未保存 Word 导出 DOCX/TXT/MD、源保护、dirty 保留、取消、拒绝源覆盖、选项持久化、键盘与浅深色窄窗口通过，退出 0 |

## 仍未通过的性能门禁

不能宣称普通文档首开已经达到基线 80%。三轮交替测试仍存在明显系统负载波动，需在稳定环境重新定位并复验。

| 日志 | 基线 Ribbon / 实际输入 / 总耗时 | 预览 Ribbon / 实际输入 / 总耗时 | 比例 |
| --- | --- | --- | --- |
| office-startup-source-comparison.log | 923 / 1563 / 3783 ms | 780 / 1336 / 2345 ms | 84.5% / 85.5% / 62.0% |
| office-startup-final-comparison.log | 810 / 1574 / 3329 ms | 816 / 1482 / 2592 ms | 100.7% / 94.2% / 77.9% |

第二次单轮 main 阶段采样显示，预读取约 304ms 已与 renderer 启动重叠，正式消费总约 14ms，其中归档约 7ms。后续重点是 renderer 首次脚本执行、字体与布局成本；不能再归因于 parseDocx 或归档阻塞。

真实安装器生命周期、完整 Word 兼容性矩阵和四类最终安装版性能仍属于整轮待办。
