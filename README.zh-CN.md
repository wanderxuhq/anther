# anther

> [English](README.md) | 中文

移动优先的浏览器代码查看/编辑工具。在浏览器中查看和编辑服务器上的代码，移动端体验优先（区别于 code-server 的桌面 UI 缩放）。支持多终端（PTY）、文件/终端通用标签混排、刷新重连。

## 安装 / 运行

```bash
# 免安装直接跑（自动下载）
npx @wanderxuhq/anther

# 指定工作目录
npx @wanderxuhq/anther /path/to/project

# 换端口
npx @wanderxuhq/anther /path/to/project --port 8080

# 或全局安装
npm i -g @wanderxuhq/anther
anther /path/to/project
```

启动后浏览器打开 `http://localhost:3000`（日志里也会打印局域网地址，方便从手机/别的设备访问）。

## 使用

- 默认只读（浏览模式）；点工具栏 ✎ 切换编辑模式即可编辑文件（只读仅控制编辑器能否输入，纯客户端行为，服务端不参与裁决）
- 从「新建」或文件列表的 ⋯ 菜单选择「上传文件」，上传到对应目录。不额外限制文件大小或类型；同名文件不会被覆盖。
- Markdown 文件（包括 README）在只读模式默认渲染，使用 marked.js 和 DOMPurify；工具栏图标可切换源码和预览，进入编辑模式时显示源码。
- 从文件列表打开 PNG、APNG、JPEG、GIF、WebP、AVIF、BMP、ICO 或 SVG 文件时会显示图片预览，保持比例并适配视口，仍可下载。支持放大、缩小、查看原始尺寸或适应窗口，也可用鼠标滚轮或双指缩放；放大后可拖动查看。二进制图片不能作为文本编辑；SVG 可点铅笔编辑源码。Markdown 支持相对于文档目录的本地图片；图片能否解码由浏览器决定。
- Git 顶部工具栏使用图标切换待提交列表、历史、分支管理及刷新；查看历史后，点击历史旁的改动图标即可回到待提交列表。
- 电脑端文件列表和编辑区各自独立滚动。
- 点 ✎ 旁边的下载图标可下载原文件，保留文件名和原始字节；待保存的修改会先保存，不额外限制下载大小或文件类型。支持断点续传与多连接并发分段下载。
- 文件列表的 ⋯ 菜单中选择「下载」：文件直接下载，目录先准备临时 ZIP。目录未变化且缓存仍在时复用 ZIP；文件增删、改名或修改后生成新 ZIP，旧下载继续读取原快照。
- 活动栏点文件 → 文件标签；点 ➕ → 终端标签（bash），可多开；文件/终端标签混排
- 终端右上角 ✕ 关标签会杀掉对应进程；终端内 `exit` 自动关标签
- 深链：`/src/main.ts` 打开文件、`/?term=t_…` 直连终端（终端按用户私有隔离，他人 URL 静默忽略）
- 刷新页面终端自动重连，画面恢复
- 无数据库、无配置文件；标签列表存服务器内存，重启后由首个访问者的浏览器快照恢复

## 下载

下载地址为 `/api/download?path=<URL 编码的相对文件路径>`，可直接交给支持 HTTP Range 的下载器。接口支持 HEAD、单区间和多区间请求，返回 `Accept-Ranges`、`Content-Range`、ETag 和 Last-Modified；通过携带 ETag 的 `If-Range` / `If-Match` 校验续传版本。仅提供秒级日期的 `If-Range` 会返回整文件，避免同一秒内多次编辑造成误判。

目录通过 `POST /api/download/prepare`（JSON：`{"path":"目录相对路径"}`）异步准备，轮询返回 ID 对应的 `/api/download/status?id=...`，就绪后使用响应中的 `url` 下载 ZIP。该链接同样支持 HEAD、续传和并发分段；准备期间会将源目录各条目的路径、大小、纳秒时间戳、文件身份和权限与缓存记录比较，以复用未变化的归档。

ZIP 写入系统临时目录，逐文件流式压缩并自动支持 ZIP64（超过 4 GiB 或大量条目），不把整个目录或 ZIP 读入内存；目录条目索引仍占用内存。最多同时压缩两个目录、共接受八个准备任务。临时磁盘必须容纳压缩后的归档，写入期间检查剩余空间，空间不足会终止并清理残留。目录中的符号链接作为链接保存，不递归跟随；生成期间检测到源目录变化会报错，可重新下载。

服务器发完完整 ZIP（含多个 Range 合计覆盖全部字节）后，在最后一次请求结束约 1 分钟后清理；未下完或尚未开始下载的 ZIP 闲置约 30 分钟后清理。每 30 秒巡检一次，正在准备或传输的归档不会被删除。正常关闭服务会删除缓存，后续归档准备和巡检也会清理已退出进程的过期残留。过期链接返回 410，需要重新准备；已被删除的 ZIP 即使目录未变也需要重新压缩。

## 地址栏状态

打开链接、刷新以及浏览器前进/后退都会恢复对应界面。文件无需预先存在于标签列表中。默认参数省略。

| 状态 | 示例 |
| --- | --- |
| 编辑模式、主题、字号 | `/src/main.ts?ro=0&theme=dark&fs=110`（默认只读、跟随系统主题、100%） |
| 行号 / 多行选区 | `/src/main.ts?line=42`、`/src/main.ts?line=42-50`（行号从 1 开始） |
| Git 改动 / 分支管理 | `/-/git`、`/-/git/branches` |
| 文件 diff | `/-/git/diff/src/main.ts` |
| 提交历史与分支筛选 | `/-/git/history?branch=main`（仅筛选，不切换工作区分支） |
| 某次提交 | `/-/git/commit/abc1234`（支持短或完整 hash） |
| 侧栏 | `/?panel=tabs`、`/?panel=search`（默认文件树） |
| 搜索条件 | `/?panel=search&q=TODO&case=1&exclude=dist` |
| 界面语言 | `?lang=zh`、`?lang=en`（未指定时跟随浏览器语言） |

参数可以组合，例如 `/src/main.ts?lang=zh&line=42&panel=search&q=TODO`。搜索默认忽略大小写，排除 `.git,node_modules,dist`；`exclude=` 表示不排除目录。输入和光标移动只更新当前历史，打开文件、切换主视图和侧栏会新增历史记录。Markdown 源码/预览切换不写入地址栏。

`panel` 只保存侧栏选中项，刷新和前进/后退不会自动展开移动端侧栏。恢复链接时会清理不适用于当前视图的参数和路径，例如历史页不保留文件路径、行号或提交参数；这不会新增历史记录。

Git 路由使用保留的 `/-/git` 命名空间，`/git/history` 仍然打开普通文件。路径以 `-/` 开头的真实文件使用显式文件路由，例如 `-/git/history` 对应 `/-/file/-/git/history`。不再解析旧的 `view`、`commit` 查询参数。

## 平台说明

文件浏览/编辑是纯 Node 跨平台的。**终端（PTY）依赖 Linux 系工具**（`script`、`stty`）：

- Linux 桌面 / Termux / WSL：终端全功能
- macOS：`script` 语法兼容，可用
- Windows：文件功能可用，终端不可用

## 开发

```bash
npm install
npm run dev                  # 一键：后端 :3000（--watch）+ 前端 :5173（vite，代理 /api）
npm test                     # 全部测试（node:test，前后端统一）
npm run typecheck            # 双 tsc 类型检查
npm run build                # 编译后端 + 构建前端，产物进 dist/
npm pack                     # 本地打包（触发 prepack 构建，验证发布形态）
```

也可分开启动（调试时）：`npm run dev:server`（后端）+ `npm run dev:web`（前端）。

## 真机测试清单

见 `docs/superpowers/specs/2026-08-08-anther-design.md` 附录 A。
