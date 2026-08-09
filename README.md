# anther

移动优先的浏览器代码查看/编辑工具。在浏览器中查看和编辑服务器上的代码，移动端体验优先（区别于 code-server 的桌面 UI 缩放）。支持多终端（PTY）、文件/终端通用标签混排、刷新重连。

## 安装 / 运行

```bash
# 免安装直接跑（自动下载）
npx anther

# 指定工作目录
npx anther /path/to/project

# 换端口
npx anther /path/to/project --port 8080

# 或全局安装
npm i -g anther
anther /path/to/project
```

启动后浏览器打开 `http://localhost:3000`（日志里也会打印局域网地址，方便从手机/别的设备访问）。

## 使用

- 默认只读（浏览模式）；点工具栏 ✎ 切换编辑模式即可编辑文件（写入由请求级 ro 裁决，无启动参数）
- 活动栏点文件 → 文件标签；点 ➕ → 终端标签（bash），可多开；文件/终端标签混排
- 终端右上角 ✕ 关标签会杀掉对应进程；终端内 `exit` 自动关标签
- 深链：`?path=` 打开文件、`?term=` 直连终端（终端按用户私有隔离，他人 URL 静默忽略）
- 刷新页面终端自动重连，画面恢复
- 无数据库、无配置文件；标签列表存服务器内存，重启后由首个访问者的浏览器快照恢复

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
