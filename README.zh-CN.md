# anther

> [English](README.md) | 中文

移动优先的浏览器 Web IDE。在项目目录中运行一个无状态的 Node 进程，用浏览器打开打印出的地址，即可浏览、编辑、预览、搜索项目，以及在浏览器里使用 Git 和终端。无需配置文件、数据库或桌面应用。

## 主要功能

**编辑**

- CodeMirror 6 编辑器：按需加载语法高亮、查找替换、行号范围链接，每个文件标签拥有独立的撤销历史。
- 文件默认以只读模式打开，可在工具栏切换到编辑模式；编辑内容 1 秒防抖自动保存，失败自动重试并提示错误。
- 通过内置的 `typescript-language-server` 提供 TypeScript/JavaScript 补全和类型诊断，支持断线重连和崩溃后自动重启。

**文件与搜索**

- 懒加载文件树：定位当前文件、新建/重命名/删除、上传文件或整个文件夹（支持拖拽），文件和文件夹均可打包为 ZIP 下载。
- 全项目内容搜索：SSE 流式返回结果，支持大小写敏感和排除目录，按文件分组展示，点击结果直接跳转到对应行。
- 文件、终端、Git 和数据库标签统一管理；文件标签和数据库标签在刷新页面后恢复。

**预览**

- Markdown 预览（内容清洗、相对路径图片）与源码切换；工作区根目录存在 `.obsidian` 时，预览额外处理 Obsidian 的 frontmatter 属性面板、可点击并通过 vault 索引解析的 wikilink 与 Markdown 内部链接（含 alias、标题和块目标）、笔记内嵌、callout、高亮、注释、tag 搜索、脚注、MathJax 数学公式（含 mhchem 化学式）和 Mermaid 图表。图片缩放/适应窗口；音频、视频播放并记住进度；CSV/TSV 表格预览。
- PDF 阅读器支持翻页、缩放、目录和密码；EPUB 阅读器支持章节跳转和内嵌目录。
- 在浏览器内浏览 ZIP/JAR/WAR/APK/XPI/CBZ 以及 7z/RAR/TAR/GZ/BZ2/XZ 压缩包，支持嵌套压缩包、密码、只读条目和单文件下载。
- SQLite/SQLite3/DB 查看器：`sqlite-wasm` 在 Web Worker 中运行，可查看表/视图、结构、索引和外键，支持分页、排序和按列过滤。

**Git**

- 查看工作区状态，暂存/取消暂存、丢弃改动（两击确认）、提交、修改上次提交（amend）、fetch/pull/push，并显示 ahead/behind。
- 行内 diff、提交历史图（最多 1000 条）、创建和切换分支，以及单个提交的多文件 diff。

**终端**

- 每个用户可创建多个真实 PTY 终端；VT 屏幕由服务端维护，刷新页面后重新连接仍保留回滚内容。
- Windows 原生终端（ConPTY）：新建终端时可选择 PowerShell 7（`pwsh`）、Windows PowerShell 或 `cmd`；Linux/macOS/WSL 仍使用 `bash`。
- 移动端支持触摸滚动和屏幕按键栏（Ctrl/Alt/Shift、方向键等）；可在 HTML 渲染（可点击路径、Markdown、自动换行）和纯文本模式间切换。
- 点击终端输出里的文件路径，可直接在文件树中定位或在编辑器中打开。

**Agent**

- anther 内置 `/_/agent` Agent 面板，通过 stdio 说 Agent Client Protocol（ACP）。
- Agent 面板通过 `/resume` 命令提供可搜索的会话列表；点开某个会话才会把它加入 anther 的标签栏，其他会话不会占用标签。
- 新建会话只打开空白草稿，不会立即创建 agent 会话；发送第一条消息时才创建。
- 首个原生 ACP agent 是本地 `opencode` CLI（`opencode acp`）。它使用 OpenCode 自己的配置、登录、工具和会话存储；anther 不再嵌入 OpenCode SDK。
- 工具卡、diff、Markdown、权限、ACP elicitation 表单和经用户确认的 URL 链接、模型选择、fork/delete 和流式回复都由 anther 渲染。
- 内置技能安装器（`/skills` 命令），基于 `vercel-labs/skills`：预览 GitHub/Git/本地来源，选择技能和目标 ACP agent，然后安装或移除。遥测已关闭。
- 支持 ACP 客户端文件系统和终端能力：agent 可以读写工作区文本文件、运行非交互命令，终端输出会实时显示在工具卡片里。Agent 的认证方式也会显示在面板中。
- 支持 ACP 富内容：图片、音频、resource link 和嵌入资源会显示在消息和工具卡片中。输入框可以附加图片、音频和文件，并根据 agent 的 prompt capability 自动限制。
- ACP 的 notice 和上下文压缩会以行内状态显示在时间线中；压缩摘要会流式追加，并更新同一个条目。
- 按工作区设置 ACP 会话的追加系统提示词，仅在 agent 声明支持 `sessionCapabilities.systemPrompt` 时发送。
- 按工作区配置 ACP 会话的 MCP 服务：使用 `/mcp` 添加 stdio/HTTP/SSE 服务，按 agent capability 过滤不支持的传输方式，并注入到新建和重新打开的会话。

**多工作区与导航**

- 一个服务可附加多个工作区目录，每个工作区有独立的 URL 前缀以及互相隔离的文件、终端、Git 和 LSP 状态；`/-` 页面列出并卸载实例。
- URL 即导航状态：文件与行范围、搜索、Git 提交、数据库表/过滤条件、阅读位置、主题、字号和界面语言都可以通过链接分享，并支持浏览器前进/后退。
- 响应式移动布局、抽屉式侧栏、自动/亮/暗主题，以及根据浏览器语言自动切换的中英文界面（可用 `?lang=en|zh` 覆盖）。

## 安装 / 运行

需要 Node.js 22.7+。内置技能安装器需要 Node.js 22.20+。

```bash
# 直接运行，默认打开当前目录
npx @wanderxuhq/anther

# 指定目录和端口
npx @wanderxuhq/anther /path/to/project --port 8080

# 或全局安装
npm i -g @wanderxuhq/anther
anther /path/to/project
```

默认访问 `http://localhost:3000`。服务默认只监听本机（`127.0.0.1`）；用 `--lan` 监听所有网卡（`0.0.0.0`），局域网内的手机或其他电脑即可使用启动日志里的 LAN 地址访问；也可以用 `--host <地址>` 指定监听地址（`--host ::` 会同时监听 IPv6）。服务本身没有认证：请只在可信网络中开放，或放在带认证的反向代理后面。

| 选项 | 说明 |
| --- | --- |
| `[dir]` | 工作区目录（默认为当前目录） |
| `--port <端口>` | 监听端口（默认 `3000`） |
| `--lan` | 监听 `0.0.0.0` |
| `--host <地址>` | 监听指定地址 |
| `--no-attach` | 不附加到已经占用该端口的 anther |
| `--detach` | 从运行中的服务器卸载当前目录并退出 |
| `--update` | 更新到最新发布版本并退出 |
| `--feature <spec>` | 加载可选的第一方功能包（可重复；也支持 `ANTHER_FEATURES`） |
| `--shell <shell>` | 默认终端 shell：`auto`、`bash`、`pwsh`、`powershell` 或 `cmd`（也支持 `ANTHER_SHELL`） |

如果端口已经由 anther 提供服务，在另一个目录运行 `anther` 会把该目录附加到现有服务器。每个附加的工作区都有自己的 URL 前缀（`/-/<名称>/`），`/-` 页面会列出所有实例，可直接打开或卸载。用 `--no-attach` 关闭附加，用 `anther --detach` 从命令行卸载。

启动时 anther 会在后台向 npm 检查是否有更新的发布版本。检查不会拖慢启动，仅在存在新版本时输出提示，可用 `ANTHER_NO_UPDATE_CHECK=1` 关闭。`anther --update` 会升级正常安装的版本；通过 npx 运行或源码目录则只打印对应的升级命令。

在 Linux、macOS 和 WSL 上，终端需要 POSIX 的 `script`、`stty` 和 `bash`。在原生 Windows（10 1809+）上，anther 通过可选依赖 `@wanderxuhq/anther-node-pty` 使用 ConPTY，可启动 PowerShell 7、Windows PowerShell 或 `cmd`；不要用 `--omit=optional` 安装。`--shell` / `ANTHER_SHELL` 设置默认 shell，新建终端菜单可以逐个选择。Git 功能需要服务器上安装 `git`。

`npm run build` 后可用 `npm start` 启动构建产物。运行中可以在 ⓘ 服务器信息里把监听地址在本地（`127.0.0.1`）和局域网（`0.0.0.0`）之间切换，已建立的终端/LSP WebSocket 连接不会中断。

### 内置 ACP Agent

`/_/agent` 的 Agent 面板是 anther 核心的一部分。它会自动发现原生 ACP
（Agent Client Protocol）agent，作为子进程启动，并通过 stdio 上的 JSON-RPC 通信。
优先使用 OpenCode：

```bash
opencode acp
```

anther 会搜索 `PATH` 和常见安装目录，找不到 OpenCode 时再尝试其他已知原生 ACP
agent（目前是 Command Code）。都没有时，面板会显示安装/配置提示。

检测到多个原生 ACP agent 时，面板会显示一个小的 agent 选择器，并按工作区记住选择。
用过的 agent 会保留自己的 ACP 进程，因此第一次切换后，再切回来可以立即恢复；切换
仍会关闭上一个 agent 打开的会话标签。只有一个 agent 或一个都没有时，选择器不显示。

anther 使用 agent 自己的配置、登录、工具和会话存储，不再嵌入 OpenCode SDK，也不再
管理 provider key 或 agent 数据库。OpenCode 按它自己的方式配置即可（例如
`~/.config/opencode/opencode.json(c)` 和 `~/.local/share/opencode/opencode.db`）。

anther 会声明 ACP `elicitation.form` 和 `elicitation.url` 能力，并把会话级表单请求
显示为待处理卡片。OpenCode 的 `question` 工具也走这条链路：选择选项或填写自定义
答案后，agent 会在同一轮对话中继续。会话级 URL 请求会显示完整地址，只有用户明确
确认后才会在新标签页打开；请求级 elicitation 会被拒绝，非法或非 HTTP(S) 的 URL
也会被拒绝。

模型选择器会按工作区记住你最后一次明确选择的模型，并在新会话创建后通过 ACP
`session/set_config_option` 应用。ACP 本身只定义会话级模型，所以 agent 自己的配置
仍然是 anther 之外创建会话时的默认值。

Mode 选择器使用 ACP `session/set_mode` 或 agent 的 `mode` 配置项；可用模式少于两个时
自动隐藏。在新会话页面选择的是下一个会话使用的 mode；进入会话后则立即切换当前
会话的 mode。

`/resume` 命令会打开一个可搜索、按日期分组的会话选择器，数据来自 ACP
`session/list`，anther 会跟随 `nextCursor` 取完所有分页。点开会话时才加入标签，并
同时加载历史和配置，因此模型和模式会自动恢复，不需要额外请求。如果 agent 支持
`session/resume` 但不支持 `session/load`，anther 会在不回放历史的情况下恢复会话，
仍然可以继续发送消息。关闭标签会把会话保留在 `/resume` 中；只有删除操作才会移除它。

ACP 的 `plan` 更新会以持续更新的清单形式显示在 Agent 时间线中。agent 自己切换
mode 或配置项时，当前会话和会话列表会立即同步。ACP 的 notice 会以行内状态提示
显示；上下文压缩更新会在时间线中保持同一个条目，并流式追加摘要内容。notice 属于
实时事件，重新打开会话时不会回放。

`/mcp` 命令会打开 MCP 服务管理器。可以添加 stdio、HTTP 或 SSE 服务，填写命令/URL
以及环境变量或请求头；配置会保存到浏览器存储，并同步到当前工作区的服务端。agent
没有声明的 ACP 传输方式会被过滤掉。MCP 修改会应用到新建会话。本次运行中创建或
加载过的会话会保留捕获时的服务集合；服务重启后重新打开会话时使用当前列表。MCP
服务可以执行命令并接收凭据，配置（包括环境变量和请求头）会保存在浏览器存储中，
请只添加可信服务。

`/prompt` 命令还可以设置按工作区生效的系统提示词。当选中的 agent 声明支持
`sessionCapabilities.systemPrompt` 时，anther 会把提示词追加到新建会话以及本次运行中之后加载的会话；会话会保留创建或加载时的
提示词快照。文本保存在浏览器存储中，并通过 ACP `systemPrompt`（`mode: "append"`）
发送。

输入框会显示所有非 model/mode 的会话配置项，包括 boolean 开关；新会话草稿中的
设置会应用到之后新建的会话。权限卡片会按 agent 提供的选项渲染，不再固定为
允许一次/始终允许/拒绝三个按钮。

`/skills` 命令基于 `vercel-labs/skills`，可以直接在 anther 里安装可复用的
Agent 指令。输入 GitHub 简写、Git URL 或工作区内的本地路径，预览发现的技能，选择要安装到的 ACP
agent（OpenCode 使用 `.agents/skills`，Command Code 使用 `.commandcode/skills`），
然后安装。已安装的技能可以在同一面板中移除。安装会启用严格的重名/符号链接检查，将
文件复制到各目标目录，更新 `skills-lock.json`，并关闭遥测。已安装的技能也会出现在
`/` 菜单中，形式为 `/skill:<id>`；选择后会插入 `@<id>` 提及（OpenCode V2 的技能
附加语法），也可以直接输入 `/skill:<id> <任务>` 发送。

anther 会广告 ACP 的 `fs` 和 `terminal` 客户端能力。agent 可以读写工作区内的
文本文件，也可以通过 ACP 终端桥运行非交互命令，输出会实时显示在工具卡片中。
文件路径会被限制在工作区内。终端命令以服务端用户的权限运行；请求的 `cwd` 会被
解析并校验在工作区内，但命令本身没有沙箱隔离。

ACP 富内容块会显示在用户消息、agent 消息和工具卡片中，包括图片、音频、
resource link 以及嵌入的文本/二进制资源。输入框最多可以附加 6 个图片、音频或文件。
只有在 agent 声明对应 prompt capability 时才会接受图片/音频附件；文本文件在支持
`embeddedContext` 时以嵌入资源发送，否则发送 resource link。不支持或过大的文本
文件会回退为 resource link。发送前会按 UTF-8 检查最终 prompt JSON 是否超过请求体
上限。`@file` 工作区提及暂未实现。

`initialize.authMethods` 返回的认证方式会显示在面板中。agent 类型的认证可以直接
在面板里完成；如果 agent 支持 logout，可以使用 `/logout` 命令退出登录。terminal
类型的认证目前显示为暂不支持。

### 可选功能

其他功能是独立包，启动时通过 `--feature <spec>` 或 `ANTHER_FEATURES=<spec,...>`
显式加载。anther 核心不会自动安装或扫描功能包。功能包声明面板（路由 + ESM UI
bundle）、注册工作区 API 路由，并通过 anther 提供的 state API 获取自己的目录。
功能包还可以向 anther 的标签栏发布文档标签，并向主工具栏发布操作。状态默认放在
`~/.anther`，可用 `ANTHER_STATE_DIR` 覆盖。

## 安全

服务没有认证或授权。任何能访问该端口的人都可以读写工作区文件、浏览压缩包、执行 Git 命令，并通过终端打开交互式 shell。只读模式只是前端/编辑器模式，不会限制服务端 API。除非网络可信，否则请只监听回环地址，或在反向代理层添加认证。工作区路径访问被限制在已提供的目录内，并会校验符号链接逃逸。

## 开发

```bash
npm install
npm run dev         # 后端 :3000 + Vite :5173
npm run dev:server  # 仅后端
npm run dev:web     # 仅前端
npm test
npm run typecheck
npm run build
```

后端和 Vite 默认都只监听本机。要在局域网内用手机调试，运行 `npm run dev -- --lan`（或 `--host 0.0.0.0`），两者会一起开放。Vite 将 `/api` 代理到 `127.0.0.1:3000`，也会代理 `/_/<panel>/` 下的功能 bundle 和功能 API；修改后端端口时需同步更新 `web/vite.config.ts` 的 proxy target。

## 许可证

MIT
