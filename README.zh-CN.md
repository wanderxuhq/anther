# anther

> [English](README.md) | 中文

移动优先的浏览器代码查看和编辑工具。支持文件管理、多格式预览、Git 和多终端，可从电脑或手机访问服务器上的项目。

## 安装 / 运行

```bash
# 直接运行，默认打开当前目录
npx @wanderxuhq/anther

# 指定目录和端口
npx @wanderxuhq/anther /path/to/project --port 8080

# 或全局安装
npm i -g @wanderxuhq/anther
anther /path/to/project
```

默认访问 `http://localhost:3000`，启动日志也会显示局域网地址。

## 使用

- 默认只读，点击工具栏的铅笔图标切换编辑模式。
- 从「新建」或文件列表的 ⋯ 菜单上传文件，不额外限制大小或类型，同名文件不会被覆盖。
- Git 工具栏可切换待提交列表、历史和分支管理。
- 文件和终端共用标签栏，终端可多开。刷新会自动重连终端；关闭终端标签会结束对应进程。
- 电脑端文件列表和编辑区独立滚动。

## 文件预览

| 类型 | 支持功能 |
| --- | --- |
| 文本和代码 | 语法高亮、搜索、编辑 |
| Markdown | 只读时默认渲染，可切换源码；支持相对路径图片 |
| 图片 | 常见浏览器图片格式；缩放、拖动、滚轮和双指缩放；SVG 可编辑源码 |
| PDF | 连续滚动、页码跳转、缩放、双指缩放、文本选择；工具栏目录按钮可打开内置大纲 |
| 音频和视频 | 播放、进度跳转，格式支持取决于浏览器 |
| CSV / TSV | 表格预览，可切换源码和编辑；预览最多 1000 行、100 列 |
| ZIP / 7z / RAR / TAR / GZ / BZ2 / XZ | 在文件树中展开，查看或下载包内文件，支持嵌套压缩包 |

不支持预览的二进制文件可直接下载。

压缩包在浏览器中处理，选中文件时才解压。默认最多展开 3 层（含最外层），缓存和解压输出预算为 128 MiB；可在压缩包设置中调整。该预算不代表浏览器总内存上限，大文件可能超出可用内存。包内文本预览最多读取 1 MiB，下载保留完整内容。

## 下载

点击铅笔旁的下载图标，或文件列表 ⋯ 菜单中的「下载」。文件直接下载，目录下载为 ZIP。

- 工作区文件和目录 ZIP 支持断点续传、多线程分段下载。文件下载地址为 `/api/download?path=<URL 编码的相对路径>`，可交给支持 HTTP Range 的下载器。
- 目录 ZIP 临时保存在服务器上，支持超过 4 GiB 的归档，需要足够的临时磁盘空间。目录未变化且缓存仍在时会复用 ZIP。
- 完整传输后约 1 分钟、未完成或未使用时闲置约 30 分钟，临时 ZIP 会自动清理。清理后需要重新准备下载。
- 压缩包内文件下载需要在浏览器中解压，受解压预算限制，不支持外部下载器的断点续传和多线程下载。

## 地址栏状态

链接可保存当前文件、Git 界面和显示设置，支持刷新恢复及浏览器前进/后退。

| 状态 | 示例 |
| --- | --- |
| 文件、行号或选区 | `/src/main.ts?line=42`、`/src/main.ts?line=42-50` |
| 编辑模式、主题、字号 | `/src/main.ts?ro=0&theme=dark&fs=110` |
| Git 改动 / 分支 | `/-/git`、`/-/git/branches` |
| 文件 diff | `/-/git/diff/src/main.ts` |
| 提交历史 / 某次提交 | `/-/git/history?branch=main`、`/-/git/commit/abc1234` |
| 侧栏 / 搜索 | `/?panel=tabs`、`/?panel=search&q=TODO&case=1&exclude=dist` |
| 压缩包内文件 / 嵌套压缩包 | `/books.zip?entry=readme.md`、`/books.zip?inside=inner.zip&entry=readme.md` |
| 终端 | `/?term=t_…` |
| 界面语言 | `?lang=zh`、`?lang=en` |

参数可组合。默认只读、跟随系统主题和浏览器语言、字号 100%。搜索默认忽略大小写，排除 `.git,node_modules,dist`。`panel` 保存侧栏选中项，刷新不会自动展开移动端侧栏。

Git 使用 `/-/git` 路由；路径以 `-/` 开头的文件使用 `/-/file/` 前缀，例如 `/-/file/-/git/history`。

## 平台说明

文件浏览和编辑支持跨平台。终端依赖 `script`、`stty`：Linux、Termux、WSL 和 macOS 可用；Windows 不支持终端。

## 开发

```bash
npm install
npm run dev          # 后端 :3000，前端 :5173
npm test
npm run typecheck
npm run build        # 输出到 dist/
npm pack
```

也可分别运行 `npm run dev:server` 和 `npm run dev:web`。
