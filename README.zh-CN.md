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
- 从「新建」或文件列表的 ⋯ 菜单上传文件或整个文件夹，支持一次选择多个文件；也可以把电脑上的文件、文件夹拖到文件树上，拖到目录行即上传到该目录。不额外限制大小或类型，同名文件不会被覆盖。
- Git 工具栏可切换待提交列表、历史和分支管理。改动面板支持暂存/取消暂存、丢弃改动、修改上次提交，以及 fetch/pull/push 并显示领先/落后提交数；pull 仅做快进合并。
- 文件、数据库对象和终端共用标签栏，可分别打开多个标签。刷新会自动重连终端；关闭终端标签会结束对应进程。触屏设备上终端底部有按键条，提供 Esc、Tab、方向键和 Ctrl 组合键。
- 终端默认以 HTML 渲染：输出里的文件和目录路径可点击，复用现有文件预览（手机上全屏、电脑上占主区域），Markdown 输出复用项目已有的 Markdown 渲染。终端工具栏的 **HTML / 纯文字** 开关可切回经典等宽网格；切换只改变渲染，不会重置 shell 会话、回滚内容或中断进程。预览关闭按钮会回到终端。
- 点击抽屉底部的 ⓘ 查看服务器信息：主机名、系统、CPU、内存、磁盘、运行时长、Node.js 与 Anther 版本，以及工作区路径；对话框内可刷新。
- 电脑端文件列表和编辑区独立滚动。

## 识别 API

`GET /api/anther` 是 anther 专属的识别接口，供启动器、探测脚本和集成方使用：

```json
{
  "name": "anther",
  "package": "@wanderxuhq/anther",
  "version": "0.1.5",
  "apiVersion": 1,
  "workspace": "/path/to/workspace",
  "instanceId": "0f9c…",
  "startedAt": 1760000000000
}
```

只返回身份与实例上下文，不包含主机名、硬件等系统细节。启动器可用 `name`/`apiVersion` 确认对面是 anther，再用 `workspace` 判断占用端口的实例是否服务同一目录，决定能否直接复用。

## 文件预览

| 类型 | 支持功能 |
| --- | --- |
| 文本和代码 | 语法高亮、搜索、编辑 |
| Markdown | 只读时默认渲染，可切换源码；支持相对路径图片；文件树标题大纲 |
| 图片 | 常见浏览器图片格式；缩放、拖动、滚轮和双指缩放；SVG 可编辑源码 |
| PDF | 连续滚动、页码跳转、缩放、双指缩放、文本选择；文件树和阅读器工具栏均可打开内置大纲 |
| EPUB | 按章节连续滚动、章节跳转、缩放和双指缩放；文件树和阅读器工具栏均可打开目录 |
| 音频和视频 | 播放、进度跳转，格式支持取决于浏览器 |
| CSV / TSV | 表格预览，可切换源码和编辑；预览最多 1000 行、100 列 |
| SQLite | 文件树中展开表和视图，数据与结构分别打开标签；只读分页、排序、筛选 |
| ZIP / 7z / RAR / TAR / GZ / BZ2 / XZ | 在文件树中展开，查看或下载包内文件，支持嵌套压缩包 |

不支持预览的二进制文件可直接下载。

EPUB 2/3 流式排版书籍沿用现有 ZIP 库在浏览器中读取，也支持压缩包内的书籍。章节及本地图片、样式按需加载。暂不支持 DRM 和固定版式，混淆字体使用替代字体；不运行书内脚本，不加载远程资源。

SQLite 预览使用官方 SQLite WASM 在浏览器 Worker 中计算，服务端仅传输文件。打开时将数据库下载到浏览器内存，刷新时重新读取；大数据库受浏览器可用内存限制。工作区和压缩包内的数据库（包括嵌套压缩包）共用表和视图树、标签页及预览。暂不支持加密数据库和 WAL 模式文件；请导出 DELETE 日志模式的独立快照用于预览。表格最多预览 200 列，长文本和 BLOB 显示摘要；慢查询可取消或自动超时。下载仍为原文件，不包含正在使用的 WAL 数据库的一致性快照。

压缩包在浏览器中处理，打开文件或展开大纲时才解压。包内 PDF、EPUB 和 Markdown 同样支持文件树大纲与章节跳转，适用于嵌套压缩包；阅读器内的目录也保留。默认最多展开 3 层（含最外层），缓存和解压输出预算为 128 MiB；可在压缩包设置中调整。该预算不代表浏览器总内存上限，大文件可能超出可用内存。包内文本预览最多读取 1 MiB，下载保留完整内容。

## 下载

点击铅笔旁的下载图标，或文件列表 ⋯ 菜单中的「下载」。文件直接下载，目录以仅打包、不压缩的方式生成 ZIP，优先保证准备速度，并显示扫描、打包和校验进度。

- 工作区文件和目录 ZIP 支持断点续传、多线程分段下载。文件下载地址为 `/api/download?path=<URL 编码的相对路径>`，可交给支持 HTTP Range 的下载器。
- 目录 ZIP 临时保存在服务器上，支持超过 4 GiB 的归档，需要足够的临时磁盘空间。目录未变化且缓存仍在时会复用 ZIP。
- 完整传输后约 1 分钟、未完成或未使用时闲置约 30 分钟，临时 ZIP 会自动清理。清理后需要重新准备下载。
- 压缩包内文件下载需要在浏览器中解压，受解压预算限制，不支持外部下载器的断点续传和多线程下载。

## 地址栏状态

链接可保存当前文件、Git 界面和显示设置，支持刷新恢复及浏览器前进/后退。

所有文件的位置与预览状态统一使用 `#字段:值;字段:值`。字段顺序无关，重复字段取最后一个，未知或非法字段忽略；默认设置省略。值中的分隔符和特殊字符使用百分号编码。文件身份、数据库筛选和全局设置仍使用查询参数。

| 状态 | 示例 |
| --- | --- |
| 文件、行号或选区 | `/src/main.ts#line:42`、`/src/main.ts#line:42-50` |
| EPUB 阅读位置 / 缩放 | `/book.epub#lbp:2@1/3%2342;zoom:125` |
| PDF 页码 / 页内坐标 | `/manual.pdf#page:7;x:0;y:600` |
| Markdown 标题 | `/README.md#heading:3` |
| 图片缩放 / 中心点 | `/image.png#zoom:200;x:0.7;y:0.3` |
| 音视频时间 / 倍速 | `/movie.mp4#time:90.5;rate:1.5` |
| CSV/TSV 位置 / 详情 | `/data.csv#at:30;across:4;row:35;expanded:1`、`/data.csv#row:20;column:3` |
| 编辑模式、主题、字号 | `/src/main.ts?ro=0&theme=dark&fs=110` |
| Git 改动 / 分支 | `/-/git`、`/-/git/branches` |
| 文件 diff | `/-/git/diff/src/main.ts` |
| 提交历史 / 某次提交 | `/-/git/history?branch=main`、`/-/git/commit/abc1234` |
| 侧栏 / 搜索 | `/?panel=tabs`、`/?panel=search&q=TODO&case=1&exclude=dist` |
| 压缩包内文件 / 嵌套压缩包 | `/books.zip?entry=readme.md`、`/books.zip?inside=inner.zip&entry=readme.md` |
| 包内数据库 | `/-/database/data.zip?inside=inner.zip&entry=app.db&object=users` |
| 数据库表 / 结构 | `/-/database/app.db?object=users`、`/-/database/app.db?object=users&mode=structure` |
| 数据库筛选 / 排序 / 分页 | `/-/database/app.db?object=users&filter=name&value=Alice&sort=id&order=desc#offset:100` |
| 终端 | `/?term=t_…` |
| 界面语言 | `?lang=zh`、`?lang=en` |

参数可组合。默认只读、跟随系统主题和浏览器语言、字号 100%。搜索默认忽略大小写，排除 `.git,node_modules,dist`。`panel` 保存侧栏选中项，刷新不会自动展开移动端侧栏。

阅读位置随滚动更新当前地址，不为连续滚动新增历史记录；支持刷新、分享与前进/后退，也适用于压缩包内文档。EPUB 复用 [Leaf Reader](https://github.com/wanderxuhq/leaf-reader) 的 LBP 定位：`章节索引@正文元素路径#UTF-16 字符偏移`，索引从 0 开始；文件身份由 URL 路径和压缩包参数提供。位置不依赖屏幕像素，改变宽度后仍定位到对应文字；正文修改后可能回退到上级元素或章节开头。`zoom` 是阅读器缩放百分比，省略时 PDF 适应宽度、EPUB 为 100%。Markdown 保存当前标题，不保存源码/渲染切换状态。

Git 使用 `/-/git` 路由；路径以 `-/` 开头的文件使用 `/-/file/` 前缀，例如 `/-/file/-/git/history`。

图片的 `x/y` 为原图中心点比例（0–1），省略 `zoom` 时适应窗口。音视频的 `time` 以秒计，恢复位置后保持暂停。表格的 `at/across` 是可视区域起始行列，`row/column` 指定详情，均从 1 开始；`expanded:1` 展开整行详情。SQLite 也使用这些表格参数，`offset` 为查询结果偏移，顺序分页时可附带 `cursor`。这些状态及文本的 `line` 参数同样支持压缩包内文件。

## 平台说明

文件浏览和编辑支持跨平台。终端依赖 `script`、`stty`：Linux、Termux、WSL 和 macOS 可用；Windows 不支持终端。

Git 同步沿用本机 git 配置。为避免请求挂起，交互式凭据提示已禁用；推送前请配置 SSH agent、credential helper 或 HTTPS token。

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
