# Typewriter Nocturne 测试报告

环境：Windows x64，Electron `42.2.0`，Node `24.19.0`，PowerShell，隔离临时 userData。

## 已执行

- `npm run build`：通过，Typewriter bundle 已进入 `dist/assets/TypewriterView-*.js`。
- `node --test "scripts/tests/*.test.mjs"`：`226/226` 通过。
- `node --test scripts/tests/typewriter.test.mjs`：原作迁移单元和 locale parity `108/108` 通过。
- `node_modules/.bin/electron.cmd scripts/probe-typewriter-workspace.mjs`：通过，报告见 `artifacts/typewriter/workspace-report.json`。

## 隔离验收覆盖

新建笔记和自动保存、同 ID 更新、富节点保留、Markdown 文件导入、中文和空格路径、原版 Studio/Press/Archive、中英文切换、真实击键声和音频能量、光标/机头移动、纸张纹理与灯光、四种回形针材质和真实指针拖动、PowerShell 计算输出、终端回形针滚动、PTY 退出重启、笔记/终端切换释放、RouterView KeepAlive、Focus/Effects 切换、数据库保存失败后 Ctrl+S 重试均已通过。

## 证据

- `artifacts/typewriter/workspace-report.json`：`ok: true`，13 项工作区检查，`errors: []`。
- `artifacts/typewriter/workspace-note.png`：实机身、纸张纹理、灯光和编辑文本截图。
- `artifacts/typewriter/unit.log`：`108` 项 Typewriter 核心与语言测试。
- `artifacts/typewriter/all-tests.log`：`226` 项项目测试。

安装包仍需在生成后运行 unpacked native audit 和一次独立安装包启动验收；这两项不以源码 build 代替。
