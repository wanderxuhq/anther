# anther

> [English](README.md) | 中文

移动优先的浏览器代码查看和编辑工具。在项目目录运行后，打开日志里的地址即可。

## 安装 / 运行

需要 Node.js 22.7+。

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

如果端口已经由 anther 提供服务，在另一个目录运行 `anther` 会附加到该服务器；用 `--no-attach` 关闭附加，用 `anther --detach` 卸载。终端需要 POSIX 的 `script`、`stty` 和 `bash`（Windows 请用 WSL）。

`npm run build` 后可用 `npm start` 启动构建产物。

运行中可以在 ⓘ 服务器信息里把监听地址在本地（`127.0.0.1`）和局域网（`0.0.0.0`）之间切换，已建立的终端/LSP WebSocket 连接不会中断。

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

后端和 Vite 默认都只监听本机。要在局域网内用手机调试，运行 `npm run dev -- --lan`（或 `--host 0.0.0.0`），两者会一起开放。Vite 将 `/api` 代理到 `127.0.0.1:3000`；修改后端端口时需同步更新 `web/vite.config.ts` 的 proxy target。
