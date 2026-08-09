# anther 终端面板设计文档

日期：2026-08-09
状态：已与用户逐节确认

## 1. 概述

为 anther 加两个能力：

1. **终端**：VS Code 式，可打开多个终端，每个是服务端真 PTY 进程，后台常驻、刷新重连。
2. **面板标签通用化**：主区域不再是"编辑器专属"——任何"面板"（终端是第一个）都可以在主区域打开，并被标签管理（侧栏标签视图混排、图标区分）。

目标体验对齐 VS Code：vim / top / **Claude Code** 等重度 TUI 程序完整可跑、可交互。

## 2. 设计原则（沿用主设计文档）

- **无状态（硬约束）**：终端进程是运行态，存在于服务器内存，重启即消失；服务端对磁盘零写入
- **依赖硬约束**：只加纯 JS 依赖，零 node-gyp；新依赖必须经用户确认
- **移动优先**：终端在手机浏览器可完整使用（fit 自适应 + 虚拟键盘）
- **面向扩展**：标签体系抽象成通用"面板类型"，未来其他面板（git、预览等）注册即用

## 3. 技术选型与可行性验证

| 层 | 选择 | 理由 |
|---|---|---|
| 服务端 WebSocket | `ws`（纯 JS） | 双向通道，键盘即时上行、输出即时下行；已实测 |
| 前端终端模拟器 | `xterm` + `@xterm/addon-fit` | web 终端事实标准，纯 JS |
| 服务端 PTY | **Node 子进程包装 `script -qfc bash`**（非 node-pty） | 零 node-gyp；`script` 是真 PTY 包装，能力与 node-pty 等价 |

**可行性已实测（2026-08-09）**：

- `script -qfc bash /dev/null` → 出真交互提示符、回显、bracketed-paste、`exit` 正常
- **Claude Code 在该 PTY 内完整运行**：TUI 界面（信任确认页/选项菜单）、24 位真彩色、alt-screen、光标定位、交互输入全部正常
- **PTY 尺寸**：默认 `0 0`（无尺寸）；`COLUMNS`/`LINES` 环境变量不生效；**运行中 `stty cols N rows M` 有效** → resize 通过发 stty 实现

**平台限制**：`script` 是 util-linux 工具，**仅 Linux/macOS 有**。Windows 上 anther 无终端（编辑器/文件/搜索照常），活动栏 ➕ 置灰 + Toast 提示。**MVP 明确不做 Windows**（node-pty 是 node-gyp，违反硬约束；用户部署目标是 Linux 服务器）。

**依赖（已确认）**：`ws`、`xterm`、`@xterm/addon-fit` —— 全部纯 JS、零 node-gyp、经用户确认。

## 4. 架构总览

```
浏览器 (xterm.js)               WebSocket (ws)             服务器
┌────────────────┐  双向通道    ┌────────────────┐   PTY   ┌────────────┐
│ TerminalView    │◄───────────►│ 终端管理器      │◄────────►│ bash       │
│ (xterm + fit)   │ input/output│ (每用户私有)    │  spawn  │ script     │
└────────────────┘             └────────────────┘         └────────────┘
        ▲ solid store: terminals（信号）
        │
┌───────┴────────────────────────────────┐
│ 主区域 = 当前面板（编辑器 / 终端面板）   │
│ 侧栏 📑 = 通用标签（文件 + 终端混排）   │
└────────────────────────────────────────┘
```

核心规则：**主区域同一时刻只显示一个内容**——要么编辑器（当前文件），要么某个终端面板。切文件 → 编辑器；点终端标签 → 终端。与 VS Code 主编辑区行为一致。

### 数据流

1. 浏览器敲键盘 → WS `input` → 服务器 → PTY stdin（bash 收到输入）
2. bash 输出 → PTY → 服务器 → WS `output` → xterm 渲染
3. 尺寸变化 → 浏览器 `resize` → 服务器 `stty cols N rows M` → bash 收到新尺寸

## 5. 标签模型通用化（核心改造）

### 5.1 现在的模型

```ts
tabs: string[]              // ["a.ts", "b.ts"]，路径即标签
currentFile: string | null  // 当前前台（只可能是文件）
编辑器 = 唯一主区域内容
```

### 5.2 升级后的模型

```ts
type TabItem =
  | { kind: 'file';   id: string; path: string }  // 文件标签：id = path（零改动兼容）
  | { kind: 'terminal'; id: string; name: string } // 终端标签：id = terminalId

tabs: TabItem[]              // 文件 + 终端混排
currentTabId: string | null  // 当前前台标签 id
```

- **文件标签 `id = path`**，与现有 URL `path` 参数天然对应
- **终端标签 `id = terminalId`**（服务端生成，`t_` + 随机）——同一 id 贯穿：服务端进程标识、标签 id、URL 前台表达、WebSocket 连接参数，四处共用
- 图标区分：文件 📄 / 终端 🖥

### 5.3 主区域按当前标签渲染

```
currentTabId 指向？
├─ 文件标签 → 渲染编辑器（现有逻辑不动）
└─ 终端标签 → 渲染 TerminalView（xterm 挂载到该面板）
```

### 5.4 侧栏 📑 标签视图（混排，无分隔）

```
📄 a.ts      ×
🖥 终端 1    ×     ← 混排，无分隔线，图标区分
📄 b.ts      ×
```

### 5.5 关闭终端标签 = 杀进程

```
用户点终端标签 ×
  → 服务端 kill 对应 bash 进程（SIGTERM → 超时 SIGKILL）
  → 从该用户终端列表移除
  → 前端从标签列表移除
  → 若它是当前前台 → 主区域回文件（或空）
```

### 5.6 文件标签与终端标签的归属差异

| | 文件标签 | 终端标签 |
|---|---|---|
| 存储 | 服务端共享 tab-store（多用户 + 心跳存续） | 服务端每用户私有列表 + 前端 |
| 可见性 | 所有用户共享 | **每用户私有**（终端含密钥/路径等隐私） |
| 心跳存续 | 参与 | 不参与（不活跃用户终端仍存活） |
| 标签关闭 | tab-store close | 杀进程 + 移除 |

### 5.7 URL 协议

```
文件前台：  /src/a.ts?ro=0&theme=dark&fs=110        （不变）
终端前台：  /?term=t_7f3a&ro=0&theme=dark&fs=110    （新增 term 参数）
```

- 二者**互斥**：`path`（文件）或 `term`（终端）二选一，主区域只有一个前台
- `ro`/`theme`/`fs` 照旧，终端前台时也保留

### 5.8 刷新页面恢复流程

```
页面加载
  → 解析 URL
     ├─ 有 path → 文件前台（现有流程）
     └─ 有 term → 终端前台
  → 拉取该用户的服务端终端列表 GET /api/terminals（后台常驻进程都在）
  → 恢复终端标签进侧栏（🖥 终端 1 / 终端 2 …）
  → 若 term 指向的终端还在 → 设为前台，WebSocket 重连
  → 若不存在 → 静默降级到文件态，不报错
```

**跨用户 URL 规则（用户明确）**：他人打开的带 `?term=` 的 URL，其终端 id 不在自己的私有列表里 → **静默忽略终端逻辑**（不回文件态也无错误提示，按普通无 path 页面处理）。天然兜底"服务器重启终端全消失"场景。

## 6. 终端会话与 WebSocket 协议

### 6.1 会话生命周期（服务端）

```
创建：  POST /api/terminals
         → 生成 terminalId（t_ + 随机）
         → spawn script -qfc bash（cwd = anther 根目录）
         → 启动后立即发 stty cols <宽> rows <高>（PTY 默认 0 0，必须设置）
         → 记入该用户终端列表（后台常驻，不随页面关）

连接：  WebSocket /api/terminal?term=<id>
         → 校验 id 属于该用户 → 桥接 PTY 输出 ↔ WS 消息
         → 校验失败 → 关闭连接

关闭标签：POST /api/terminals/<id>/close
         → kill bash（SIGTERM → 超时 SIGKILL）→ 从用户列表移除

服务器重启：内存清空 → 所有终端消失 → 客户端 id 失效 → 降级文件态
```

### 6.2 WebSocket 消息协议

```
浏览器 → 服务器：
  { type: 'input',  data: "<按键>" }
  { type: 'resize', cols: 100, rows: 30 }
  { type: 'ping' }

服务器 → 浏览器：
  { type: 'output', data: "<终端输出>" }
  { type: 'exit',   code: 0 }
  { type: 'pong' }
```

**不做逐字节流式转发**：PTY 输出聚成小批再发（几十毫秒），减少 WS 帧数，键盘输入仍即时。

### 6.3 断开重连（方案 B：输出历史重放）

**原则（用户明确）**：方案选择以**不干扰 vim / Claude Code 等 TUI 操作**为准。

- vim / Claude Code 是 alt-screen 应用，画面靠实时 ANSI 转义序列绘制
- 方案 A（清屏续跑）会破坏画面 → 需手动按键触发重绘，打断操作 → 否决
- **方案 B（输出历史重放）**：重连时服务端重放完整输出历史，xterm 重新执行转义序列 → **画面精确恢复到断线那一刻**，vim 光标、Claude Code 菜单与断开时一致，进程状态未变，**无缝接着操作**

```
每终端：输出历史环形缓冲（上限 ~2MB，防内存膨胀）
重连：
  1. 先重放全部历史 → xterm 恢复中断前画面
  2. 期间用户输入先缓冲（几十 ms），重放完再写入 PTY
  3. 重放完 → 应用当前尺寸（resize）→ 切实时流
```

- 上限内重放完整重建画面；超限（罕见）截断 → 画面可能不完整但进程状态仍在，触发重绘恢复

### 6.4 WebSocket 断开（刷新 / 关页面）

```
断开 → PTY 进程不杀（后台常驻）→ 终端仍在用户列表
刷新 → 重连同 id → 历史重放 → 进程没中断
关闭标签 → 才杀进程
```

## 7. 前端 TerminalView（web/src/views/terminal.tsx）

```
TerminalView（主区域，currentTab 是终端时挂载）
  ├─ 创建 xterm 实例
  │    theme：跟随暗色/亮色（现有 theme 信号）
  │    fontSize：跟随 fontScale（?fs= 参数）
  ├─ 挂 @xterm/addon-fit → 自适应容器尺寸
  ├─ WebSocket /api/terminal?term=<id>
  │    onmessage → xterm.write(data)
  │    onopen → 服务端历史重放 → 画面恢复
  │    oninput → WS input
  └─ 容器尺寸变化（ResizeObserver）→ fit() → WS resize
```

**键盘**：xterm 原生支持打字/方向键/Tab/Ctrl 系列/复制粘贴/移动端长按。**不做**自定义快捷键（保持简单，xterm 默认即标准终端）。

**移动端**：fill 填满主区域 + 100dvh 自适应（现有体系已处理）；fit 自动算字符网格，窄屏整齐。终端无工具栏。

## 8. 工具栏与入口

```
活动栏：  🗂 📑 🔍 ➕        ← ➕ 新建终端（点一下：新建 + 切到该标签）
侧栏 📑：  📄 a.ts      ×
          🖥 终端 1    ×     ← 混排，图标区分，无分隔
          📄 b.ts      ×
```

新建流程：点 ➕ → `POST /api/terminals` → 拿到 id → 加终端标签 + 设为当前 → 切主区域到终端 → WS 连接 → 显示 bash 提示符。

平台不支持（无 script）：➕ 置灰 / 不显示 + Toast「当前平台不支持终端」。

## 9. 终端退出行为（用户明确）

**bash 进程退出（exit / 被杀）→ 自动关闭 + 自动从标签移除**（方案 A，非 VS Code 的保留灰态）。

- WS 收到 exit → 自动关闭标签 → 移除
- 前台是它时 → 主区域回文件（或空）
- 若因用户点 × 被杀 → 正常关闭流程，不重复提示

## 10. 错误处理

| 场景 | 行为 |
|---|---|
| 平台不支持 PTY（Windows/无 script） | ➕ 置灰 + Toast「当前平台不支持终端」 |
| 新建终端失败（spawn 异常） | Toast 报错，不产生标签 |
| WebSocket 连接失败 | 自动重连（指数退避），标签显示「重连中…」 |
| term=<id> 不属于自己 / 已失效 | 静默忽略 → 文件态（已定） |
| 终端进程异常退出 | 自动关闭 + 移除标签（已定） |
| 服务器重启（终端全消失） | 重连 → 所有终端 id 失效 → 终端标签清空 → 回文件态 |

## 11. 测试

**服务端（node --test，可自动化）**：

- `server/pty.test.ts`：spawn `script` PTY → 启动出提示符、stdin 回显、resize 后 `stty size` 更新、exit 进程清理、畸形参数拒绝
- `server/terminal.test.ts`：终端管理器 → 创建/列表（每用户隔离）/关闭杀进程/未知用户空列表/失效 id 拒绝
- `server/routes/terminal.test.ts`：HTTP → POST 创建返回 id；GET 列自己；/close 杀进程；**WS 集成测试**（真实 ws 连接：发 input → 收到 output / exit 帧）

**前端（node --test，纯函数可测）**：

- 标签模型通用化纯函数：tabs 增删、当前 tab 切换、文件↔终端 id 解析
- URL 解析：`?term=` 与 `path` 互斥、非法 term 忽略、round-trip

**手动验证清单**：

1. 点 ➕ → 终端出现，bash 提示符可输入，`ls`/`cd` 正常
2. `vim` 打开文件 → 正常编辑，方向键/`i`/`esc`/`wq` 全通
3. **`claude` 跑起来** → TUI 界面完整，可交互
4. 手机浏览器打开 → fit 自适应，虚拟键盘打字正常
5. 开 2 个终端 → 侧栏 2 个标签，切换正常
6. 关标签 → 进程死（`ps` 验证）
7. `exit` 退出终端 → 自动关闭移除
8. 刷新页面 → 终端重连，vim 画面恢复（历史重放）
9. 两个用户各开终端 → 互不可见
10. 暗色/亮色切换 → 终端主题跟随

## 12. 不做（明确排除）

- **Windows 终端支持**（node-pty 是 node-gyp，违反硬约束；`script` 仅 Linux/macOS；MVP 只做 Linux）
- 终端拆分（VS Code 的 split pane）
- 终端自定义快捷键（Ctrl+K 清屏等）
- 终端标题自定义 / 重命名
- 多用户共享终端
- 终端持久化（无状态原则：重启即消失）
- 非交互式终端（纯管道方案已否决——达不到 Claude Code 用例）
