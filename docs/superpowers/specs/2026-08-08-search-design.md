# anther 搜索功能设计文档

## 1. 概述

三个功能（用户明确：查找和替换是两个独立功能）：

1. **文件内查找**（VS Code Ctrl+F 式）——查找面板、高亮全部匹配、计数、上/下跳转
2. **文件内替换**（VS Code Ctrl+H 式）——替换面板、逐个/全部替换当前文件匹配；仅编辑模式可用
3. **全局搜索**（VS Code Ctrl+Shift+F 式）——跨文件查找，**SSE 流式**边搜边出结果，点击结果跳转到文件对应行

前两项纯前端（@codemirror/search 官方包），服务端零改动。第三项新增服务端 SSE 端点 + 前端搜索视图。

## 2. 设计原则（沿用主设计文档）

- **无状态**：搜索是纯读操作，服务端零磁盘写入；排除框配置不持久化（本次会话生效，打开即默认值）
- **移动优先**：手机没有 Ctrl，工具栏提供 🔍 入口；桌面端保留 Ctrl+F / Ctrl+H / Ctrl+Shift+F
- **零新增传递依赖**：@codemirror/search 已是 codemirror 的传递依赖（6.7.1），npm install 声明为直接依赖后新增传递包为零；纯 JS 无 node-gyp

## 3. 文件内查找/替换（纯前端）

### 3.1 依赖

`npm install @codemirror/search@^6`（经用户确认）。

### 3.2 编辑器扩展（web/src/editor/index.ts）

- 编辑器扩展数组加 `search()`：查找面板（Mod-f）、替换面板（Mod-h）、高亮全部匹配、Enter/Shift+Enter 上/下跳转、大小写开关；键位绑定 basicSetup 已含（searchKeymap），只补扩展
- **工具栏 🔍 按钮** → 打开查找面板（App.tsx 持 EditorHandle，加 `openSearch()` 方法 dispatch `openSearchPanel`；移动端主入口；全局搜索入口不占工具栏，见 §5.1）
- **只读门控**：`setReadOnly(true)` 时同时 dispatch `setReplacePanelOpen.of(false)` 关闭替换面板。原因：@codemirror/search 的 replaceNext/replaceAll 不检查 readOnly facet，直接 dispatch changes 会改写只读文档；替换是写操作，必须显式关面板
- **自动保存联动**：@codemirror/search 的替换 dispatch 带 `userEvent: "input.replace"`，命中现有 `isUserEdit` 的 input 前缀匹配 → 走 1s 防抖自动保存。实现时用测试验证；若不命中则补 `input.replace` 到 isUserEdit
- 替换命令在只读文档上不响应（readOnly facet 拒绝 changes），与面板关闭双保险

### 3.3 快捷键

- Ctrl+F / Ctrl+H / F3 / Ctrl+G：searchKeymap 已含（basicSetup），零新增
- 移动端无键盘，工具栏 🔍 按钮覆盖查找入口；替换入口在查找面板内（面板底部替换行），与 VS Code 一致

## 4. 全局搜索服务端

### 4.1 路由层 SSE 支持（server/http.ts）

新增 `sse(pattern, handler)` 注册方法：handler 签名 `(req, res, query) => void | Promise<void>`，直接拿 `ServerResponse` 写流，不走 JSON 封装（不 readBody、不 res.json）。`handle()` 内对 SSE 路由直接调用，错误同样直接写在流里（error 事件）或销毁连接。

### 4.2 FileStore.search（server/files.ts）

流式遍历，回调式接口：

```ts
search(relPath: string, query: string, opts: {
  caseSensitive?: boolean;
  exclude?: string[];      // 用户排除框的目录名列表
  maxFiles?: number;       // 默认 500
  maxMatches?: number;     // 默认 5000
  onFile: (path: string, matches: Match[]) => void;  // 每搜完一个文件调一次
}): Promise<{ truncated: boolean; fileCount: number; matchCount: number }>
```

- **遍历**：从 `resolveSafe(relPath)` 递归 walk；目录名命中排除集（默认 `.git`、`node_modules`、`dist` 与用户 exclude 并集）则整棵跳过；复用 list 的单条目 stat 失败容错
- **匹配**：非 UTF-8 文件跳过（复用 `hasInvalidUtf8`）；`case` 决定 `includes`/`toLowerCase().includes`；逐行收集 `{ line: 1基行号, col: 0基列号, text: 该行文本 }`
- **上限**：`maxFiles` = 已搜文件数上限，`maxMatches` = 匹配总数全局上限；任一达上限 → 停止遍历，返回 `truncated: true`
- **取消**：调用方持有 abort 信号（前端断开连接），遍历循环检查，中止即停止

### 4.3 SSE 端点（server/routes/fs.ts）

`GET /api/search?q=&case=1&exclude=a,b`：

- 响应头 `Content-Type: text/event-stream` + `Cache-Control: no-cache` + `Connection: keep-alive`
- 事件协议（每行 `data: <json>\n\n`）：

| 事件 | 载荷 |
|---|---|
| `file` | `{ type, path, matches: [{line, col, text}] }` —— onFile 每交一个文件发一条 |
| `done` | `{ type, truncated, fileCount, matchCount }` —— 遍历结束，关闭连接 |
| `error` | `{ type, message }` —— 参数错误（q 空、越界等），随后关闭连接 |

- **断开即停**：`req.on('close')` → abort 遍历信号（浏览器取消/关页面/改关键词都会触发）
- 校验：`q` 必填非空（空 → error 事件）；`exclude` 逗号分隔解析；`path` 缺省根

### 4.4 前端 SSE 客户端（web/src/api.ts）

`searchStream(params, onFile): { cancel() }`：

- fetch 同源 GET（走 vite proxy，与现 API 一致）；AbortController 取消
- `res.body.getReader()` 按 `\n` 分帧解析 `data:` 行 → JSON → 按 type 分发：`file` → onFile(path, matches)，`done`/`error` → 结束回调
- 非 2xx（如 404）走现有 ApiError 逻辑

## 5. 全局搜索前端

### 5.1 视图（web/src/views/registry.tsx + 新 search.tsx）

- 注册表加第三项 `{ id: 'search', icon: '🔍', title: '搜索', render: <SearchView /> }`（抽屉 ☰ 内，与 🗂 📑 并列；移动端入口为 ☰ → 🔍 两步）
- 桌面端 Ctrl+Shift+F → 开抽屉 + `setActiveView('search')` + 聚焦输入框（App.tsx 加 keydown 监听；App.tsx 需要把 activeView 暴露/传入）

### 5.2 面板结构（SearchView）

- 输入行：关键词输入框（聚焦即搜，300ms 防抖）+ 大小写开关
- **排除框**：文本输入，默认值 `.git,node_modules,dist`，逗号分隔；修改后重新搜索；不持久化（本次会话生效，符合无状态）
- 结果区（VS Code 式）：
  - 按文件分组：组头 = 相对路径 + 匹配数，点击展开/收起
  - 匹配行：行号 + 行文本，关键词子串 `<mark>` 高亮
  - 空关键词 → 空态提示；无匹配 → 「无结果」；`truncated` → 「结果过多，请细化关键词」
- 搜索中状态：进度提示（已搜 N 文件）+ **取消按钮**（abort）
- 每次输入变化 → cancel 旧流 → 新搜索（避免过期流追加旧结果；用序号 guard，与 loadDoc 同款）

### 5.3 跳转到行

- `EditorHandle` 加 `gotoLine(line0)`：dispatch 选区到行首 + `scrollIntoView()`（实现时验证对未渲染行的滚动，必要时先 `doc.line(n)` 定位）
- stores 加 `pendingGoto: { path, line0 } | null`
- 点击匹配行 → `openTab(path)` + 设置 pendingGoto；`loadDoc` 完成后消费（`path === currentFile()` 才生效），编辑器 `setDoc` 后调 `gotoLine`；文件打开失败/已切换 → 丢弃
- 显示行号 1 基 → 内部 0 基转换在跳转消费处（line0 = line - 1）

## 6. 错误处理

| 场景 | 处理 |
|---|---|
| 搜索路径越界/不存在 | error 事件（400 文案），前端 Toast 或视图内提示 |
| 用户中断/改关键词 | abort → 服务端停止遍历；序号 guard 丢弃过期流 |
| 匹配超上限 | done 带 truncated → 前端提示 |
| 服务端中途异常 | error 事件 → 前端提示已搜到的部分仍显示 |

## 7. 测试

**服务端：**

- FileStore.search 单测：排除规则（默认 + 自定义并集）、大小写、上限截断（truncated + 停止遍历）、非 UTF-8 跳过、越界 400、onFile 调用次数与载荷、abort 停止
- HTTP 路由测试：SSE 端点返回 200 + event-stream 头；curl 式消费流断言 file/done 事件序列；q 空 → error 事件

**前端：**

- api.searchStream：fetch 桩返回流式 body → 解析 file/done/error 分发正确；cancel 触发 abort
- 跳转消费逻辑抽纯函数测（path 匹配才消费、失败丢弃）
- 编辑器层 gotoLine：DOM 依赖，真机/手动验证（现有 ro-mode-effect 同款定位）
- 替换触发自动保存：验证 userEvent 命中（若需要，isUserEdit 补 input.replace 后加回归测试）

## 8. 不做（明确排除）

- 全局搜索的替换/替换全部（跨文件批量写，风险大，用户已确认不做）
- 正则/全词匹配开关（移动端输入不便，MVP 不做）
- 排除框持久化（无状态原则）
- 文件内查找的高亮配色主题化（沿用编辑器默认主题）
