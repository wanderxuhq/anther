# Windows 原生终端支持方案（PowerShell / cmd / .bat）

Date: 2026-11-19
Status: 方案调研，待决策
Related: `server/pty.ts`、`server/terminal.ts`、`server/routes/terminal.ts`、`web/src/views/terminal.tsx`

## 1. 背景

anther 当前的终端是纯 POSIX 实现：

```text
script -qfc 'echo PTYMARKER $(tty); exec bash' /dev/null
stty -F <dev> cols <n> rows <n>
```

依赖 util-linux `script`、GNU `stty` 和 `bash`。这在 Linux / WSL 上工作良好，但无法在原生 Windows 上启动 PowerShell 或 cmd：

- 原生 Windows 没有 `script` / `stty`。
- Git Bash / MSYS2 即使提供 `script`，也只能分配 Cygwin/MSYS pty，Win32 程序（PowerShell、cmd、node、git）不会使用这个 pty。
- `child_process.spawn` 只能得到管道，不是 TTY；PowerShell 会关闭 PSReadLine，TUI、resize、交互式输入都会降级。
- 因此 Windows 原生支持的核心不是“换一个 shell 命令”，而是**换掉 PTY 实现**。

当前 README 的说明是“Windows 请用 WSL”。本文讨论的是让 anther 原生跑在 Windows 上，并提供 PowerShell、cmd 终端。

## 2. 目标与非目标

### 目标

- Windows 10 1809+ / Windows 11 原生运行 anther。
- 新建终端时可以选择或自动检测：
  - PowerShell 7（`pwsh.exe`）
  - Windows PowerShell 5.1（`powershell.exe`）
  - cmd（`%ComSpec%`）
- 支持基本终端行为：输入、输出、ANSI/VT、窗口 resize、Ctrl+C、退出事件、回滚区。
- 支持运行 `.bat` / `.cmd` / `.ps1`。
- 中文路径和中文输出不乱码。
- Linux 现有行为不变，且 Linux 不需要安装/编译 Windows 专用依赖。

### 非目标

- 不追求 Windows 与 Unix 完全一致的作业控制语义（`Ctrl+Z`、前后台进程组等）。
- 不保证 cmd 的当前目录（OSC 7）100% 准确；PowerShell 优先。
- 不为终端提供沙箱；终端命令仍以 anther 服务端权限运行。
- 不重新引入 xterm.js；继续使用现有服务端 VT 解析 + 前端渲染架构。
- 不把 anther 的 Web 前端打包成 Electron 或桌面应用。

## 3. 关键结论

### 3.1 ConPTY 是 Windows 的系统能力

- `CreatePseudoConsole` 从 Windows 10 1809（build 17763）开始内置于 `kernel32.dll`，Windows 11 自带。
- 默认不需要额外 DLL；`conpty.dll` / `OpenConsole.exe` 只在 `useConptyDll: true` 时使用。
- 旧于 build 18309 的系统，官方 `node-pty` 会自动回退到 winpty。
- 但 **Node 核心没有 PTY / ConPTY API**，必须经过原生模块或 FFI。

### 3.2 node-pty 与 node-gyp 的关系

- `node-pty` 是 npm 包，包含 JS API + C++ 原生代码。
- `node-gyp` 是编译 Node 原生模块的工具，只在**构建时**使用。
- `binding.gyp` 是 node-gyp 的构建配置，不是运行时依赖。
- `node-pty` 的安装脚本是：

```json
"install": "node scripts/prebuild.js || node-gyp rebuild"
```

- Windows x64 / arm64 的 npm 包内自带 `prebuilds/win32-x64` / `win32-arm64`，`prebuild.js` 成功后退 0，**不会执行 `node-gyp rebuild`**。
- Linux 官方包没有 `prebuilds/linux-*`，因此 `npm install node-pty` 会触发 `node-gyp rebuild`，需要 `python3`、`make`、`g++`。
- macOS 有 x64 / arm64 预编译。
- node-pty 1.1.0 使用 N-API（`node-addon-api`），预编译文件不随 Node 大版本变化，Node 22 / 24 可以直接加载。

### 3.3 gyp 触发条件汇总

| 环境 / 操作 | 是否触发 gyp |
|---|---|
| Windows x64 / arm64，默认安装 | 否 |
| Windows ia32，或未限制 `cpu` 的 ia32 | 是（没有预编译） |
| `npm_config_build_from_source=true` / `--build-from-source` | 是（会主动删除预编译） |
| Windows 上 `npm install --ignore-scripts` | 否；预编译文件仍在包里，运行时仍可加载 |
| Linux 直接安装官方 node-pty | 是（无 Linux 预编译） |
| Linux 使用 `os: ["win32"]` 包装包 | 否（包装包和 node-pty 都不安装） |
| 项目里同时直接声明 node-pty | Linux 上仍会安装并编译 |

## 4. 依赖策略

### 4.1 推荐：Windows-only 包装包 + optionalDependencies

目标：Linux 完全不出现 node-pty，Windows 使用官方预编译。

新增一个独立的小包，例如 `@wanderxuhq/anther-node-pty`：

```json
{
  "name": "@wanderxuhq/anther-node-pty",
  "version": "1.0.0",
  "description": "Windows-only node-pty loader for anther",
  "license": "MIT",
  "os": ["win32"],
  "cpu": ["x64", "arm64"],
  "main": "index.js",
  "files": ["index.js"],
  "dependencies": {
    "node-pty": "1.1.0"
  }
}
```

```js
// index.js
module.exports = require('node-pty');
```

anther 的 `package.json`：

```json
{
  "optionalDependencies": {
    "@wanderxuhq/anther-node-pty": "^1.0.0"
  }
}
```

行为：

- Linux：npm 检查 `os` 不匹配，作为 optional dependency 跳过；node-pty 及其 install 脚本都不会出现。
- Windows x64 / arm64：安装包装包 → 安装 node-pty → 使用 `prebuilds/win32-*`，不触发 gyp。
- Windows ia32：包装包的 `cpu` 不匹配，跳过安装；终端不可用，但不会触发 gyp。
- `npm install --omit=optional`：Windows 上也不会安装包装包，终端创建时应给出明确错误。

> 注意：`os` / `cpu` 只能写在被依赖的包自身，不能写在 anther 的 dependency 条目上，所以需要这个包装包。

### 4.2 备选方案对比

| 方案 | Linux 下载 node-pty | Linux 跑 gyp | 优点 | 缺点 |
|---|---|---|---|---|
| 直接 `optionalDependencies: node-pty` | 是，约 63 MB | 是 | 配置最简单 | Linux 安装日志差、体积大 |
| **Windows-only 包装包** | 否 | 否 | Linux 完全无感 | 多发布/维护一个小包 |
| `@lydell/node-pty` optional | 是，约 100 KB Linux 包 | 否 | 无 install 脚本，体积小 | 当前为 beta；只支持 ConPTY，无 winpty 回退 |
| `@homebridge/node-pty-prebuilt-multiarch` optional | 是，约 6.4 MB | 否 | 多平台预编译，体积较小 | 社区 fork |
| vendor 预编译 `.node` 进仓库 | 否 | 否 | 无 npm 依赖 | 需要自己更新、审计、覆盖架构 |

当前推荐 **Windows-only 包装包**。如果不想维护第二个包，`@lydell/node-pty` 是次优选择；如果只要求“Linux 不跑 gyp”，它已经足够。

### 4.3 类型问题

Linux 上包装包和 node-pty 都不存在，因此不能写：

```ts
import type { IPty } from 'node-pty';
```

否则 Linux 上 `npm run typecheck` 会找不到模块。建议在仓库内定义最小接口：

```ts
export interface NodePtyProcess {
  pid: number;
  onData(cb: (data: string) => void): { dispose(): void };
  onExit(cb: (e: { exitCode: number }) => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface NodePtyModule {
  spawn(file: string, args: string[], options: Record<string, unknown>): NodePtyProcess;
}
```

运行时通过 `createRequire` 加载，不参与 TypeScript 的模块解析：

```ts
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

export function loadWindowsPty(): NodePtyModule {
  if (process.platform !== 'win32') throw new Error('Windows PTY is only available on win32');
  try {
    return require('@wanderxuhq/anther-node-pty') as NodePtyModule;
  } catch {
    throw new Error(
      'Windows terminal requires @wanderxuhq/anther-node-pty. ' +
      'Reinstall without --omit=optional.',
    );
  }
}
```

## 5. 架构设计

### 5.1 PTY 接口

把 `server/pty.ts` 中的具体类抽成接口，保留 Unix 实现：

```ts
export interface PtySession extends EventEmitter {
  readonly pid: number;
  readonly ready: Promise<void>;
  write(data: string): void;
  resize(cols: number, rows: number): Promise<void>;
  kill(): Promise<void>;
}
```

新增 `server/pty-windows.ts`：

```ts
export class WindowsPtySession extends EventEmitter implements PtySession {
  readonly pid: number;
  readonly ready = Promise.resolve();
  private proc: NodePtyProcess;

  constructor(cwd: string, spec: ShellSpec) {
    super();
    const pty = loadWindowsPty();
    this.proc = pty.spawn(spec.file, spec.args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: spec.env,
      // 官方 node-pty：true 表示优先 ConPTY（build >= 18309），旧系统回退 winpty
      useConpty: true,
    });
    this.pid = this.proc.pid;
    this.proc.onData((data) => this.emit('data', data));
    this.proc.onExit(({ exitCode }) => this.emit('exit', exitCode ?? 0));
  }

  write(data: string): void { this.proc.write(data); }
  async resize(cols: number, rows: number): Promise<void> { this.proc.resize(cols, rows); }
  async kill(): Promise<void> {
    try { this.proc.kill(); } catch { /* 已退出 */ }
  }
}
```

工厂按平台分派，Linux 上不加载 Windows 文件：

```ts
export async function createPty(cwd: string, shell: ShellSpec): Promise<PtySession> {
  if (process.platform === 'win32') {
    const { WindowsPtySession } = await import('./pty-windows.ts');
    return new WindowsPtySession(cwd, shell);
  }
  return new UnixPtySession(cwd, shell);
}
```

`server/terminal.ts` 的 `Terminal` 不需要感知平台，继续依赖：

- `on('data', string)`
- `on('exit', number)`
- `resize(cols, rows)`
- `kill()`

Windows 不需要 `PTYMARKER`：`ready` 直接 resolve；spawn 失败时 reject，并由 `TerminalManager.create` 转成 400。

### 5.2 Shell 解析

新增 `server/shell.ts`：

```ts
export type ShellKind = 'bash' | 'pwsh' | 'powershell' | 'cmd' | 'wsl';

export interface ShellSpec {
  kind: ShellKind;
  file: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}
```

Windows 自动检测顺序：

1. `pwsh.exe`（PowerShell 7）
2. `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`
3. `%ComSpec%`（通常是 `cmd.exe`）

配置方式：

- CLI：`anther --shell auto|pwsh|powershell|cmd|bash|wsl`
- 环境变量：`ANTHER_SHELL`
- 前端新建终端时可选 `shell` 字段，服务端做白名单校验

不要接受客户端传来的任意命令行或可执行文件路径；shell 选择必须是枚举或服务端可验证的配置。

### 5.3 TerminalManager

`TerminalManager.create(userId, name)` 增加可选的 `shell` 参数：

```ts
async create(userId: string, name: string, shell?: ShellKind): Promise<TerminalInfo>
```

`POST /api/terminals` 的 body 增加 `shell?: string`，校验后传给 manager。`TerminalInfo` 可选择性地回传 `shell`，用于前端显示和重连。

## 6. Windows 启动参数与 Shell 集成

### 6.1 PowerShell / pwsh

启动参数：

```text
-NoLogo -NoExit -Command <integration script>
```

- 不要加 `-NoProfile`，否则用户自己的 profile、环境、别名都会丢失。
- `-NoExit` 保证 `-Command` 执行完继续交互。
- `-Command` 在 profile 之后执行，可以捕获用户已有的 `prompt` 函数。

集成脚本同时处理 UTF-8 和 OSC 7：

```powershell
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

$global:__anther_prompt = $function:prompt
function global:prompt {
  if ($PWD.Provider.Name -eq 'FileSystem') {
    $uri = ([System.Uri]$PWD.ProviderPath).AbsoluteUri
    [Console]::Write("$([char]27)]7;$uri$([char]7)")
  }
  & $global:__anther_prompt
}
```

要点：

- `[System.Uri]` 会生成 `file:///C:/...`，并处理空格和 `%` 转义。
- 用 `[char]27` 而不是反引号 `e`，兼容 Windows PowerShell 5.1。
- 如果用户 profile 自己改 prompt，wrapper 仍以“捕获时的 prompt”为准；这是可接受的限制。

### 6.2 cmd

启动参数：

```text
[ComSpec, '/K', 'chcp 65001>nul']
```

- 交互式 shell 用 `/K`；`/C` 执行完就退出，终端会立即消失。
- `chcp 65001` 让 cmd 和多数程序使用 UTF-8。
- cmd 没有 prompt hook，OSC 7 只能通过 `PROMPT` 做 best-effort：

```ts
env.PROMPT = `$E]7;file://${os.hostname()}/$P$E\\`;
```

`$P` 不做 URL 转义，路径包含空格、`%`、`#` 时可能失效。建议：

- PowerShell 作为默认 shell，提供可靠的 cwd。
- cmd 不支持 cwd 时优雅降级：`cwd` 为空，前端相对路径回退到工作区根目录（现有逻辑已支持）。

### 6.3 .bat / .cmd / .ps1

`.bat` 不是一种 shell，而是 cmd 的脚本文件。

用户在终端中手动运行：

- cmd：`build.bat`
- PowerShell：`.\build.bat` 或 `& .\build.bat`

从文件树/编辑器点“运行”：

```ts
// 保留输出：/K
spawn('cmd.exe', ['/d', '/k', `call "${batPath}"`], { cwd: dirname(batPath), ... });

// 一次性执行：/C
spawn('cmd.exe', ['/d', '/c', `call "${batPath}"`], { cwd: dirname(batPath), ... });
```

`.ps1`：

```ts
spawn('powershell.exe', [
  '-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', ps1Path,
], { cwd: dirname(ps1Path), ... });
```

执行策略绕过应作为显式选项，不要默认放宽。

## 7. 编码与环境

- cmd：启动时 `chcp 65001 >nul`。
- PowerShell 5.1：设置 `[Console]::OutputEncoding` 和 `$OutputEncoding`；PowerShell 7 默认 UTF-8，可不设置。
- 注入环境变量：

```ts
env.PYTHONUTF8 = '1';
env.PYTHONIOENCODING = 'utf-8';
env.TERM = 'xterm-256color';
env.COLORTERM = 'truecolor';
env.TERM_PROGRAM = 'anther';
```

- `node-pty` 在 Windows 上的 `onData` 已经是 UTF-8 解码后的字符串，不要再套 `StringDecoder`。
- 老程序直接写 OEM 代码页字节的情况无法完全避免；如果出现乱码，优先检查该程序是否支持 UTF-8。
- Windows 上不要传最小 env；至少保留 `SystemRoot`、`ComSpec`、`PATHEXT`、`USERPROFILE`、`APPDATA`、`LOCALAPPDATA`、`TEMP`、`TMP`。最简单是 `{ ...process.env, ...覆盖 }`。

## 8. 路径与 OSC 7

### 8.1 前端

`web/src/views/terminal.tsx` 当前：

```ts
function cwdPath(value: string): string {
  if (value.startsWith('file://')) {
    try { return decodeURIComponent(new URL(value).pathname); } catch { return value; }
  }
  return value;
}
```

Windows 上 `file:///C:/Users/a` 的 `pathname` 是 `/C:/Users/a`，直接传给服务端会解析错误。需要改成平台感知的 `fileUrlToPath()`：

- `/C:/...` → `C:\...`
- `file://server/share/...` → `\\server\share\...`
- 保留 `decodeURIComponent` 的失败兜底
- 统一处理 `/` 与 `\`

### 8.2 服务端

`server/files.ts` 的 `fileUrlPath()` 和 `locateTerminalPath()` 也要做同样处理：

- 识别 `file://` URL 的 drive letter 和 UNC host；
- `path.isAbsolute` / `path.relative` 仍然按当前平台工作；
- 继续用工作区根目录做 confinement，工作区外路径返回 404；
- 增加 Windows 路径测试。

### 8.3 OSC 7 格式

标准形式：

```text
ESC ] 7 ; file://HOSTNAME/C:/path/to/dir BEL
```

- 路径使用 `/`，盘符保留 `C:`；
- 空格、中文、`%` 需要 URL 编码；
- PowerShell 的 `[System.Uri]` 会正确处理；
- cmd 的 `PROMPT` 只能 best-effort。

## 9. 前端改动

- 新建终端入口增加 shell 选择：Auto / PowerShell / cmd / WSL。
- `web/src/api.ts`：

```ts
create: (name: string, shell?: string) =>
  request<TerminalInfo>('POST', '/api/terminals', { name, shell }),
```

- `web/src/stores.ts` 的 `openTerminal()` 透传 shell。
- i18n 新增 key，必须同时补 `en` 和 `zh`。
- 按键处理基本沿用 `web/src/terminal/input.ts`：
  - `Ctrl+C` 继续作为 shell 中断；
  - `Ctrl+Shift+C` 复制；
  - 方向键、`Alt`、`Ctrl+Shift+V` 不变；
  - 建议把粘贴中的 `\r?\n` 统一为 `\r`，对 cmd/PowerShell 更可靠。
- IME 组合输入已有 `isComposing` 保护，但需要在 Windows 中文输入法下实测候选框和重复上屏。
- 字体补 Windows 常见回退：Cascadia Mono、Consolas；CJK 宽字符由现有 VT 处理。

## 10. 生命周期、错误与清理

- `node-pty.spawn` 失败可能同步抛错，`WindowsPtySession` 构造函数要捕获并 reject `ready`，由 `TerminalManager.create` 转成 HTTP 400。
- `kill()` 在 Windows 上不要传信号；`kill('SIGTERM')` 会抛错。
- ConPTY 关闭后，通过 npm/node 启动的子进程可能残留；必要时兜底：

```ts
execFile('taskkill', ['/PID', String(pid), '/T', '/F']);
```

- 可选依赖缺失（`--omit=optional`、平台不匹配）时，终端创建应返回可操作的错误，而不是崩溃。
- Windows 上 `process.on('SIGTERM')` 行为与 Unix 不同；服务关闭逻辑要确保 `closeAll()` 被调用。
- `proc.clear()` 可在前端清屏后同步 ConPTY 内部缓冲，避免重绘。

## 11. 测试计划

### 可在 Linux 上运行的单元测试

- `resolveShell()` 的自动探测顺序、参数和环境变量。
- `fileUrlToPath()`：`file:///C:/a%20b`、UNC、反斜杠、中文路径。
- `locateTerminalPath()` 的 Windows 路径分支（平台参数注入）。
- 粘贴换行归一化。
- shell 白名单校验。
- 工厂在 `linux` 下不加载 `pty-windows.ts` / node-pty。

### 只能在 Windows 上运行的集成测试

- 创建 PowerShell 终端，输出 `hello`。
- 创建 cmd 终端，输出 `hello`。
- 输入 `echo 中文`，验证无乱码。
- resize 后 `stty size` 等价物：PowerShell 中 `$Host.UI.RawUI.WindowSize` 或程序输出列数。
- `Ctrl+C` 中断长命令。
- 退出 PowerShell/cmd，WS 收到 `exit` 并移除终端。
- 运行 `.bat` 和 `.ps1`。
- 关闭终端后子进程不残留。

测试文件建议：

```text
server/pty.test.ts          # 现有 POSIX 测试，保持
server/pty-windows.test.ts  # process.platform !== 'win32' 时 skip
```

### CI / 安装检查

Linux：

```bash
npm ci
test ! -d node_modules/node-pty
```

Windows：

```bash
npm ci
node -e "require('node-pty')"
test -d node_modules/node-pty/prebuilds/win32-x64
test ! -d node_modules/node-pty/build/Release
```

`build/Release` 不存在、`prebuilds/win32-x64` 存在，说明走的是预编译而不是 gyp。

## 12. 实施阶段

### Phase 1：依赖与 PTY 抽象

- 增加 `PtySession` 接口和 `UnixPtySession`，行为不变。
- 发布/接入 Windows-only 包装包。
- 增加 `WindowsPtySession`，先用硬编码 `cmd.exe` 跑通创建、输入、resize、退出。
- 验证 Linux 安装不出现 node-pty。

### Phase 2：Shell 选择与编码

- 增加 `server/shell.ts`、`--shell` / `ANTHER_SHELL`。
- PowerShell / cmd 启动参数、UTF-8、环境变量。
- 前端 shell picker 和 API 字段。

### Phase 3：路径与 Shell 集成

- Windows 路径转换、OSC 7、PowerShell prompt wrapper。
- cmd 的 cwd 降级策略。
- `.bat` / `.ps1` 运行入口。

### Phase 4：测试、文档、收尾

- Windows 实机测试矩阵。
- 更新 `README.md`、`README.zh-CN.md`、`AGENTS.md`。
- 补充错误提示和 `--omit=optional` 文档。

粗略工作量：2–3 天，其中一半在 Windows 实机验证和 node-pty 打包/安装行为。

## 13. 风险与取舍

| 风险 | 影响 | 应对 |
|---|---|---|
| 原生依赖安装失败 | Windows 终端不可用 | 使用预编译；错误提示；文档说明 |
| Linux 被 node-pty 拖慢/编译 | 安装体验变差 | Windows-only 包装包 + `os` 过滤 |
| 维护第二个 npm 包 | 版本同步成本 | 包装包只做 re-export，锁定 node-pty 版本 |
| ConPTY 重绘/屏幕状态不同步 | 画面异常 | 充分测试 `clear()`、resize、全屏 TUI |
| cmd 无可靠 cwd | 相对路径跳转失效 | PowerShell 优先；cmd 回退到工作区根 |
| 旧程序 OEM 编码 | 中文乱码 | `chcp 65001` + PowerShell UTF-8；无法完全覆盖 |
| 子进程残留 | 端口/文件占用 | `taskkill /T /F` 兜底 |
| 用户 `--omit=optional` | Windows 终端缺失 | 明确错误和安装说明 |
| PowerShell profile 修改 prompt | OSC 7 失效 | wrapper 捕获初始 prompt；可接受 |

## 14. 验收标准

- `npm test` 在 Linux 上全部通过。
- `npm run typecheck` 在 Linux 上通过，且不依赖 node-pty 类型。
- Linux `npm ci` 后 `node_modules/node-pty` 不存在。
- Windows `npm ci` 后 `node_modules/node-pty/prebuilds/win32-x64` 存在，`build/Release` 不存在。
- Windows 上可以：
  - 新建 PowerShell 终端并执行命令；
  - 新建 cmd 终端并执行命令；
  - 输入中文不乱码；
  - resize 生效；
  - `Ctrl+C` 生效；
  - 退出后会话移除；
  - 运行 `.bat` 和 `.ps1`。
- Linux 现有终端行为无回归。
- `README.md` / `README.zh-CN.md` 说明 Windows 原生支持、`--shell` 和 `.bat` 行为。

## 15. 决策建议

1. **Windows 终端是核心功能**：采用 Windows-only 包装包 + `node-pty` 预编译；这是代码量最小、行为最完整的方案。
2. **不接受第二个 npm 包**：使用 `@lydell/node-pty`（无 install 脚本、Linux 100 KB）或 `@homebridge/node-pty-prebuilt-multiarch`（多平台预编译）。
3. **完全不接受原生依赖**：不要做“完整终端”，改为“运行任务/命令”功能，用 `child_process` 管道执行 PowerShell / `.bat`；明确不支持 TUI、resize、交互式输入。
4. **只偶尔用 Windows shell**：继续推荐 WSL，不增加 Windows 原生终端。

## 16. 参考

- Microsoft ConPTY: <https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session>
- node-pty: <https://github.com/microsoft/node-pty>
- OSC 7: <https://gitlab.freedesktop.org/terminal-wg/specs/-/blob/master/design-notes/osc-7.md>
- @lydell/node-pty: <https://www.npmjs.com/package/@lydell/node-pty>
- @homebridge/node-pty-prebuilt-multiarch: <https://www.npmjs.com/package/@homebridge/node-pty-prebuilt-multiarch>
