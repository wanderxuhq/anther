# anther

移动优先的浏览器代码查看/编辑工具。在浏览器中查看和编辑服务器上的代码，移动端体验优先（区别于 code-server 的桌面 UI 缩放）。

## 使用

```bash
npx anther [目录] [--port <端口>] [--rw]
```

- 默认只读（浏览模式）；`--rw` 允许写入
- 默认端口 3000，目录默认当前目录
- 无数据库、无配置文件；标签列表存服务器内存，重启后由首个访问者的浏览器快照恢复

## 开发

```bash
npm install
npm run dev -- --rw          # 一键：后端 :3000（--watch）+ 前端 :5173（vite，代理 /api）
npm test                     # 全部测试（node:test，前后端统一）
npm run build                # 编译后端 + 构建前端
```

也可分开启动（调试时）：`npm run dev:server -- --rw`（后端）+ `npm run dev:web`（前端）。

## 真机测试清单

见 `docs/superpowers/specs/2026-08-08-anther-design.md` 附录 A。
