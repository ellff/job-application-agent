# Windows辅助脚本

日常使用只需项目根目录的 launch-fill.cmd，它自动调用 start-window.ps1。

| 脚本 | 用途 | 是否必需 |
| --- | --- | --- |
| start-window.ps1 | 启动控制窗口 | 双击入口自动调用 |
| start.ps1 | 本地实验、测试及旧终端统一入口 | 开发和复现实验时使用 |
| try-zhaopin.ps1 | 旧终端规则流程 | 可选 |
| try-ollama.ps1 | 本地模型测试、旧终端辅助流程 | 可选 |
| try-sinomach.ps1 | 集团接口旧终端辅助流程 | 可选 |
| test-sinomach.ps1 | 集团接口连接诊断 | 可选 |

.ps1是PowerShell文本脚本，不是编译后的应用程序，不需要依次执行。请从项目根目录运行文档中的命令。个人档案路径使用绝对路径或相对于项目根目录的路径。
