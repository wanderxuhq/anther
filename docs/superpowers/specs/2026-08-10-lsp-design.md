# LSP 接入（补全 + 类型诊断）设计

- 日期：2026-08-10
- 分支：`feat/lsp`（拟定）
- 范围：服务器端 + 浏览器端。交付 TS/JS 语言（框架先行为多语言预留）。

## 背景与目标

anther 是移动优先代码编辑器。上一期「编辑器本地智能感知」交付了语法级红线（`parseErrorLinter`，lezer `node.type.isError`）和手动补全触发（悬浮 ⌘ 按钮）。本期待验证的是：**真正的类型感知体验**——类型错误红线 + 类型感知补全。这是「移动端能否真正写代码」的第二级台阶，也是「LSP 是否有价值」的最终验证。

**已验证的技术事实**：

- `vscode-languageserver-protocol@3.18.0` 官方协议库：纯 JS，~1MB（含 `vscode-jsonrpc@9.0.1`、`vscode-languageserver-types@3.18.0` 两个纯 JS 传递依赖），零 node-gyp。
- `typescript-language-server@5.3.0`：rollup 打包 501KB，**声明依赖为空**，但运行时从 `node_modules/typescript/lib` 解析 tsserver。⟹ `typescript@^5.9.3` 必须从 devDependencies **移入 dependencies**（同包零新增下载，但需运行时可见）。
- 服务器已有 `ws`（终端用）→ LSP WebSocket 路由复用既有 `HttpServer.ws()` 模式，零新传输依赖。
- `@codemirror/lint` / `@codemirror/autocomplete` 已在 node_modules：诊断 source 用 `linter()`，补全 source 用 `CompletionSource`，零新客户端依赖。

**目标**：本期交付（1）类型感知补全，（2）类型诊断红线（替换 LSP 语言的语法级红线）。LSP 进程跑在 anther 服务器（手机浏览器无法 spawn 进程），浏览器经 WebSocket 代理。

**明确不做**（YAGNI，后续可加）：

- 不做 hover / 定义跳转 / 重命名（v2 候选）。
- 不做诊断外的语义特性（折叠、符号大纲等）。
- 不接 eslint / prettier。
- 不做 didChange 增量 diff（全量同步，简单正确；打字节流见下）。
- 不做增量同步 / 内存 DB 化（tsserver 自管文档状态，服务器只透传）。
- 不做多服务器进程复用（一个 tsserver 服务所有 TS/JS 文件；项目根固定为 anther 工作区根）。

## 架构

LSP 进程服务器侧，浏览器经 WS 代理。三层：

```
┌─ 手机浏览器 ─────────────┐        ┌─ anther 服务器 ──────────────────────────┐
│ CodeMirror 6            │  WS    │  /api/lsp 路由（连接态：openUris）        │
│  lsp.ts (CM 扩展)       │◄──────►│     ↓ FIFO 队列（多客户端串行）           │
│  lsp-client.ts (传输+纯) │  JSON  │  LspManager（语言注册表，框架先行）        │
│  │ 补全 source / 诊断    │        │     ↓ stdio LSP（官方协议库）             │
│  └ 定位转换 UTF-16       │        │  LspSession → typescript-language-server │
└──────────────────────────┘        └──────────────┬──────────────────────────┘
                                                   │  spawn on first TS/JS open
                                             tsserver 进程（懒启动，常驻）
```

### 服务器侧（`server/`）

**`lsp-session.ts`** —— 一个语言服务器进程的 LSP 客户端封装：

- `createProtocolConnection(StreamMessageReader(子进程 stdout), StreamMessageWriter(子进程 stdin))`（官方库，纯 JS）+ `initialize`（capabilities 协商）→ `didOpen/didChange/didClose/completion` → `publishDiagnostics` 监听 → `dispose()`。
- **每会话 FIFO 队列**：多客户端消息进同一进程保序（didChange 必须先于后续 completion 到达）。
- `path`（仓库绝对路径）→ `file://` URI 规范化：`canonicalUriFor(path)` 纯函数（含 Windows 盘符、空格、中文），与浏览器 `pathToLanguageId` 同源逻辑。
- 启动失败 / 崩溃 / 超时状态机见「错误处理」。

**`lsp-manager.ts`** —— 语言注册表（框架先行）：

- `LSP_ENGINES = { typescript: { cmd: 'typescript-language-server', args: ['--stdio'] } }`。加 Python/Go 将来就是表里加一行 + 客户端映射加一行。
- 懒启动：首个「编辑模式 + TS/JS 文件」打开才 spawn；`dispose()` 全部杀掉；`shutdown` 时 SIGTERM 清理。

**`routes/lsp.ts`** —— WS 路由（复用 `HttpServer.ws()` 模式）：

- JSON 信封 `{id, method, params}`；`method` ∈ `open`/`change`/`close`/`completion`。过期响应由客户端 docVersion 丢弃（不做 cancel 往返，YAGNI）。
- 按 `path` 路由到会话；记录每连接的 `openUris`。
- `publishDiagnostics` 只推给打开了该文件的连接；缓存每文件最新诊断，重连/重开时重放。
- 连接关闭 → 清该连接 openUris + 启动空闲计时（5min，无剩余 openUris 则 dispose 会话）。

**`cli.ts`** —— `main()` 里加 `registerLspRoutes(server, lspManager)`（与既有路由注册并列）。

### 浏览器侧（`web/src/editor/`）

**`lsp-client.ts`** —— WS 传输 + 纯函数：

- 连接/重连（指数退避，上限 5 次）/请求/推送分发。
- 纯函数（node --test 直测）：
  - `pathToLanguageId(path)`：`.ts/.tsx/.js/.jsx → 'typescript'`，其余 → null。
  - CM 偏移 ↔ LSP 位置（UTF-16）：`offsetToPosition(doc, offset)` / `positionToOffset(doc, pos)`，边界钳制。
  - `completionItemToCm(item)`：label/detail/documentation/kind 映射，未知 kind 兜底。
  - `lspDiagnosticToCm(d)`：severity（error/warning/information/hint → error/warning/info/info）、range 钳制到 doc 边界。

**`lsp.ts`** —— 一个 CM `ViewPlugin` 扩展：

- 补全 source：请求 `completion`，带 `docVersion`；响应比对版本，过期即丢。
- updateListener：用户编辑 → 防抖 250ms 发 `change`（全量 content 同步）。
- 诊断推送 → `setDiagnostics`（CM 画红波浪线，复用 `lintGutter()`）。
- `destroy` → 发 `close`；`setDoc` 重建 state 时自然触发（复用 `EditorHandle.setDoc` 路径）。

**`editor/index.ts`** —— `EditorOptions` 加 `path`；makeState 按 `pathToLanguageId` 二选一：

- LSP 语言 → LSP 诊断（**替换** `parseErrorLinter`：类型错误 ⊇ 语法错误），补全 source 接 LSP。
- 非 LSP 语言 → 维持现状（语法红线 + language-data 补全）。

**`App.tsx`** —— `createEditor` 传 path。

### 依赖（用户已确认协议库选择；安装前最终清单见「验证成功标准」）

- 新增直接依赖：`vscode-languageserver-protocol`、`typescript-language-server`（经 `npm install` 命令，不手改 package.json）。
- `typescript` devDependencies → dependencies（运行时供 tsserver 解析）。
- 装后验证 `npm ls node-gyp --all` 为空。

## 数据流 / 交互

**打开文件**（首次打开可编辑 TS/JS）：

1. 浏览器 `open`（content 全量 + path）→ WS → 路由按 `pathToLanguageId` 找引擎 → 会话懒 spawn → initialize 握手 → `didOpen`。
2. tsserver 分析 → push `publishDiagnostics` → 服务器记缓存 → 推给打开该文件的连接 → 浏览器画波浪线。

**打字**：

- 补全路径：CM 查 CompletionSource → `completion` 请求（docVersion + 光标）→ FIFO 进 tsserver → 结果比对 docVersion 最新 → 渲染。
- 诊断路径：防抖 250ms → `change`（全量）→ tsserver 重分析 → 新一轮 publishDiagnostics。

**切换文件**：`close` 旧文件 + `open` 新文件（`setDoc` 重建 state 自然触发）。

**关闭标签 / 连接断开**：`close`（或连接关闭服务器批量清理）→ 清缓存 → 会话无剩余 openUris 且空闲 5min → dispose 进程。

**只读/浏览模式**：不启动 tsserver（懒启动仅编辑模式触发）；已有会话在切只读后保持到空闲 dispose（不主动杀，避免切回时重复冷启动）。

**多客户端**：FIFO 串行；publishDiagnostics 按 openUris 扇出——两浏览器同时编辑同文件，双方收到对方诊断（共享语义正确，tsserver 保服务器端状态一致）。

## 错误处理

**tsserver 启动失败 / 崩溃**（最常见）：

- 启动失败（initialize 8s 超时或进程立即退出）→ 引擎会话标记 failed → 浏览器收到错误推送 → lsp.ts 降级：补全空、诊断回语法级 `parseErrorLinter`（不丢现有能力）→ Toast `t('lsp.unavailable')`（新增 i18n 键）。
- 运行中崩溃（进程 `exit`）→ 清会话 + 清缓存 → 浏览器收 `server_exited` 推送 → **自动重建**（上限 3 次，指数退避）→ 重发 `open`（幂等，TSS 恢复诊断）→ Toast「语言服务已重启」。
- 单请求超时（5s）→ 该请求失败不杀进程（tsserver 偶发慢）；连续 3 次 → 判定死循环 → dispose 重建。

**WS 断开**：服务器清该连接 openUris → 空闲计时；浏览器侧自动重连（退避 5 次）→ 重发 open 恢复。

**定位转换失败**：钳制（line/character 越界 → 文件边界）；转换异常 → 捕获 → 补全降级空列表（不打断输入）。

**内存**：tsserver 重建 = 新进程新内存；空闲 5min dispose 是主要回收。`shutdown` SIGTERM 清全部会话。

**与既有降级哲学一致**：任何失败不让编辑器不可用——降级到无 LSP（语法红线还在），Toast 告知（spec §8）。

## 测试

项目惯例（node --test，不依赖真实 tsserver）。

**纯函数层**（零 mock 直测）：

- `web/src/editor/lsp-client.test.ts`：`pathToLanguageId` 各扩展名 / `offsetToPosition` 与 `positionToOffset`（CRLF、emoji、中文混合往返一致）/ `completionItemToCm` / `lspDiagnosticToCm`（severity 映射、range 钳制）。
- `server/lsp-session.test.ts`：`canonicalUriFor`（含 Windows 盘符、空格、中文）；FIFO 队列保序。
- `server/routes/lsp.test.ts`：`pathToLanguageId` 服务器版同逻辑。

**协议握手测试**（stub 进程代替真实 tsserver）：

- `test/fixtures/lsp-stub.js`：读 stdin JSON-RPC，应答 initialize（capabilities），对 `didChange` 返回预先写死的 publishDiagnostics；env 注入崩溃 / 无响应两种故障。
- `server/lsp-session.test.ts`：启动会话、initialize 成功、open/change 透传、publishDiagnostics 解析、崩溃自动重建、超时判定。

**浏览器集成**：最小 CM 环境（`basicSetup` + lsp 扩展）在 node 跑：模拟编辑 → 断言补全 source 被调 + docVersion 守卫生效；模拟推送 → 断言 setDiagnostics 被调。若 CM 在 headless 跑不动，退到「纯函数 + 协议 stub」覆盖，viewPlugin 仅类型检查。

**手动清单**（真机交付逐项过）：

1. 打开 .ts 文件 → 类型错误波浪线（约 2-5s）。
2. 打字 → 补全弹窗触发（类型感知）。
3. 语法错误包含在类型诊断中。
4. 只读/浏览模式不启动 tsserver。
5. 杀掉 tsserver 进程 → 自动重建 + Toast。
6. 非 TS 文件（.md/.css）无 LSP 行为，语法红线照旧。

## 验证成功标准

1. TS/JS 编辑模式：类型错误红波浪线 + 类型感知补全，移动端手感可用。
2. 语法错误不回归（类型诊断 ⊇ 语法）。
3. 只读模式不拉进程；崩溃自愈（≤3 次重建）；降级不丢语法红线。
4. 全程 `npm run test` / `typecheck` / `build` 通过。
5. **安装前向用户确认最终依赖清单**：新增 `vscode-languageserver-protocol` + `typescript-language-server`（npm install 命令），`typescript` dev→dependencies；装后 `npm ls node-gyp --all` 为空。
