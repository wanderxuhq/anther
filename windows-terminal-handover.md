# Windows 原生终端支持 — 交接文档

- Date: 2026-11-19
- Branch: `win`
- Status: 代码完成，待发布包装包 + Windows/Linux 实机验收
- 原始方案: [`windows-terminal-support.md`](./windows-terminal-support.md)
- 决策: 采用「Windows-only 包装包 + 官方 `node-pty`」；本轮范围 = 终端核心 + shell 选择（不含 `.bat` / `.ps1` 运行入口）

## 1. 一句话总结

终端从「只支持 POSIX `script`/`stty`/`bash`」拆成 Unix / Windows 两套实现：Windows 走 ConPTY（`node-pty`），自动探测 `pwsh` → `powershell` → `cmd`，前端新建终端时可选 shell；Linux 现有行为不变，且不会安装/编译 `node-pty`。

## 2. 已完成内容

### 2.1 服务端 PTY 抽象

- `server/pty.ts`
  - 新增 `PtySession` 接口（`ready` / `data` / `exit` / `write` / `resize` / `kill`）。
  - 原实现改名为 `UnixPtySession`，行为不变（`script -qfc` + `PTYMARKER` + `stty -F`）。
  - 新增 `createPtySession(cwd, spec)`：`win32` 时动态 `import('./pty-windows.ts')`，其他平台不加载 Windows 代码。
- `server/pty-windows.ts`（新）
  - `WindowsPtySession`：ConPTY，80×24 初始尺寸，spawn 成功即 `ready`。
  - 加载顺序：`@wanderxuhq/anther-node-pty` → 直接安装的 `node-pty`；都缺失时返回可操作错误（提示不要用 `--omit=optional`）。
  - 输入换行统一 `\n` → `\r`（ConPTY 的 Enter 是 CR）；`kill()` 无信号参数，1.5s 未退出时用 `taskkill /PID <pid> /T /F` 兜底。
  - 清理 `node-pty` 未释放的 `_inSocket` / `_conoutSocketWorker`（私有字段，失败静默），避免长期开关终端累积句柄。

### 2.2 shell 选择

- `server/shell.ts`（新）
  - `ShellKind = 'bash' | 'pwsh' | 'powershell' | 'cmd'`；`auto` 单独表示自动探测。
  - Windows 自动顺序：`pwsh.exe`（PATH / Program Files / WindowsApps）→ `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` → `%ComSpec%`。
  - PowerShell：`-NoLogo -NoExit -EncodedCommand <base64>`（UTF-16LE），不改 profile；脚本设置 UTF-8 输出，并包装 `prompt` 以 OSC 7 上报当前目录。
  - cmd：`/d /k chcp 65001>nul`；仅当环境里没有 `PROMPT` 时注入 `$E]7;file://<host>/$P$E\`（best-effort）。
  - 非 Windows 只允许 `bash`/`auto`；显式选择其他 shell 返回明确错误。
- `server/terminal.ts`
  - `TerminalManager.create(userId, name, shell?)`，返回 `TerminalInfo.shell`。
  - 新增 `shells()`（缓存可用列表）与 `defaultShell()`（读取 `ANTHER_SHELL`）。
- `server/routes/terminal.ts`
  - `POST /api/terminals` 接受 `shell`，只允许枚举 + `auto`，拒绝任意可执行文件路径。
  - `GET /api/terminals` 额外返回 `shells`、`defaultShell`。
- `server/cli.ts`
  - 新增 `--shell auto|bash|pwsh|powershell|cmd`；设置 `process.env.ANTHER_SHELL`，对宿主与附加工作区统一生效。

### 2.3 路径与 OSC 7

- `server/file-url.ts`（新）
  - `file//` URL → 当前平台路径：Windows 盘符（`/C:/...` → `C:\...`）、UNC（`file://server/share` → `\\server\share`）、本机 hostname 忽略、非法 `%` 兜底。
- `server/files.ts`
  - `locateTerminalPath()` 改用 `fileUrlPath()`，删除原来的私有转换。
- `web/src/views/terminal.tsx`
  - 不再在浏览器里转换 OSC 7；原样把 URL 交给服务端（浏览器不知道服务端平台，远程客户端也不应假设本地平台）。

### 2.4 前端

- `web/src/api.ts`
  - `TerminalShellKind`、`TerminalList`、`TerminalInfo.shell?`；`terminals.create(name, shell?)`。
- `web/src/stores.ts`
  - `terminalShells` / `defaultTerminalShell` 信号；`openTerminal(shell?)` 透传。
- `web/src/App.tsx` + `styles.css`
  - 活动栏「新建终端」：Unix（`shells` 为空）点击直接创建；Windows 弹出 shell 菜单（Auto / PowerShell 7 / Windows PowerShell / Command Prompt）。
- `web/src/i18n.ts`
  - 新增 `terminal.shell.*`，中英文都已补齐。
- `web/src/terminal/linkify.ts`
  - 支持 Windows 盘符、`C:/`、`C:\`、UNC、反斜杠相对路径，以及 `:line:col`；排除 `C:`、`\\server` 等误报。
- `web/src/terminal/input.ts`
  - 粘贴换行归一化：`\r\n?` → `\n`；非 bracketed paste 再 → `\r`（Windows shell 才会执行）。

### 2.5 依赖与发布包

- `packages/anther-node-pty/`（新，待发布）
  - `@wanderxuhq/anther-node-pty@1.0.0`，`os: ["win32"]`、`cpu: ["x64","arm64"]`，`dependencies: node-pty@1.1.0`，`index.js` 只做 re-export。
  - 目的：npm 的 `os`/`cpu` 过滤只能写在包自身；这样 Linux 不会安装/编译 `node-pty`。
- 根 `package.json`
  - `optionalDependencies: { "@wanderxuhq/anther-node-pty": "^1.0.0" }`。
- 根 `package-lock.json`
  - 该包尚未发布，锁文件里是占位 `{ "optional": true }`；发布后执行一次 `npm install` 即可解析。

### 2.6 文档

- `README.md` / `README.zh-CN.md`：Windows 原生终端、`--shell` 选项、依赖说明。
- `AGENTS.md`：PTY 平台拆分、shell 枚举、OSC 7 服务端转换、Windows 安装约束。

## 3. 验证结果（本机 Windows 11 / Node 24.4.1）

- `npm run typecheck`：通过。
- `npm run build`：通过（`dist/server/pty-windows.js` 正常产出，动态 import 已改写为 `.js`）。
- 本机用临时 junction 接入包装包后：
  - `server/shell.test.ts`、`server/file-url.test.ts`：12 项通过。
  - `server/pty-windows.test.ts`：2 项通过（真实 cmd / UTF-8 / resize / exit / kill）。
  - `server/terminal.test.ts`：8 项通过（真实 ConPTY，默认 PowerShell）。
  - `server/routes/terminal.test.ts`：9 项通过（HTTP + WS + 真实 shell，含 `shell` 校验）。
  - `web/src/terminal/linkify.test.ts`、`input.test.ts`、`i18n.test.ts`：通过。
  - 合并跑 49 项，全部通过。
- 手工 probe：默认选中 Windows PowerShell；OSC 7 得到 `file:///D:/projects/anther`；resize 到 100×30 生效；中文输出正常。

## 4. 发布前必做

1. 发布包装包：
   ```sh
   cd packages/anther-node-pty
   npm publish --access public
   ```
2. 回到仓库根目录执行 `npm install`，把锁文件里的占位解析为真实依赖。
3. Windows 实机验收（`npm run dev` 或 `npm start`）：
   - 新建 PowerShell 7 / Windows PowerShell / cmd 终端；
   - `echo 中文`、resize、Ctrl+C、`exit`；
   - 手动运行 `.bat` / `.ps1`（本轮未提供文件树运行入口）；
   - 关闭终端后确认无残留进程/句柄。
4. Linux 验收：
   ```sh
   npm ci
   test ! -d node_modules/node-pty
   npm test
   npm run typecheck
   ```
5. 按仓库惯例更新版本与 README（当前版本 0.1.8）。

## 5. 已知问题 / 风险

1. **`AttachConsole failed` 噪音**：`node-pty@1.1.0` 在 `kill()` 时会 `fork` 一个 helper 枚举控制台进程。anther 从终端启动时父进程已附着控制台，helper 的 `AttachConsole` 会失败并打印堆栈；同时 helper 有 5s 超时，会让进程多存活几秒。功能不受影响。可尝试的方向：
   - 暂不启用 `useConptyDll`（本机实测会直接卡死，原因未定位）；
   - 在 `kill()` 调用期间临时给 `child_process.fork` 加 `silent: true`（未采用，属于全局 monkey patch）；
   - 或接受噪音。
2. **私有字段清理**：`releaseAgentHandles()` 依赖 `node-pty` 的 `_agent._inSocket` / `_conoutSocketWorker`。包装包已锁定 `node-pty@1.1.0`，升级时需重新验证；字段不存在时会静默跳过，不会崩。
3. **cmd 的 cwd**：`PROMPT` 只能 best-effort，路径含空格/`%` 时可能失效；前端会自动回退到工作区根目录。
4. **Windows 全量 `npm test` 有历史遗留失败**（与本次改动无关）：
   - `server/cli.test.ts` 断言 POSIX 路径 `/tmp/foo`，Windows 下解析为 `D:\tmp\foo`；
   - `web/src/url-navigation.test.ts` 的 Vite 临时入口在 Windows 上把反斜杠吃掉（`D:projectsanther...`）。
   - 完整测试请用 WSL/Linux 跑。
5. **未实现**：`.bat` / `.ps1` 的文件树「运行」入口；WSL shell 选项（仍可把 anther 跑在 WSL 里）；cmd 的可靠 OSC 7。
6. **Store 版 PowerShell 7**：`pwsh.exe` 探测依赖 PATH / Program Files；如果只有 WindowsApps 别名且未真正安装，可能需要实机确认。
7. 仓库没有 CI 配置，上述验收需要手动执行。

## 6. 代码位置索引

| 文件 | 作用 |
| --- | --- |
| `server/pty.ts` | `PtySession` 接口、`UnixPtySession`、`createPtySession` |
| `server/pty-windows.ts` | ConPTY 实现、node-pty 加载、kill / 句柄清理 |
| `server/shell.ts` | shell 枚举、探测、启动参数、UTF-8 / OSC 7 集成 |
| `server/file-url.ts` | OSC 7 `file://` → 平台路径 |
| `server/terminal.ts` | `TerminalManager` shell 参数、`shells()` / `defaultShell()` |
| `server/routes/terminal.ts` | `POST /api/terminals` shell 校验、`GET` 元数据 |
| `server/cli.ts` | `--shell` |
| `server/pty-windows.test.ts` | Windows 集成测试（非 Windows / 缺依赖时 skip） |
| `server/shell.test.ts` / `server/file-url.test.ts` | 跨平台纯逻辑测试 |
| `packages/anther-node-pty/` | 待发布的 Windows-only 包装包 |
| `web/src/App.tsx` | 新建终端 shell 菜单 |
| `web/src/stores.ts` / `web/src/api.ts` | shell 列表与创建参数 |
| `web/src/terminal/linkify.ts` | Windows 路径点击 |
| `web/src/terminal/input.ts` | 粘贴换行归一化 |

## 7. 常用命令

```sh
# 开发
npm run dev

# 单测
node --test --experimental-transform-types server/shell.test.ts
node --test --experimental-transform-types server/pty-windows.test.ts
node --test --experimental-transform-types server/routes/terminal.test.ts

# 类型检查 / 构建
npm run typecheck
npm run build

# 本地接入未发布的包装包（Windows）
cd packages/anther-node-pty
npm install

# 在仓库根目录创建 junction（见 packages/anther-node-pty/README.md）
```
