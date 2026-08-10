# 编辑器本地智能感知（补全触发 + 语法红线）设计

- 日期：2026-08-10
- 分支：`feat/editor-intellisense`
- 范围：全部客户端，服务端零改动，零新依赖

## 背景与目标

anther 的编辑器目前只有语法高亮（`editor/language.ts` 接 CodeMirror language-data），没有任何语义能力。移动端是目标场景，打字慢，"手机上能否真正写代码"取决于补全手感。

**已验证的技术事实**（决定本期工作量）：

- `basicSetup`（`codemirror` 元包）已含 `autocompletion()` + `completionKeymap`。
- `@codemirror/language-data` 已把 `.ts/.tsx/.js/.jsx` → `lang-javascript`（声明 `localCompletionSource`）、`.html` → `lang-html`（`htmlCompletionSource`）、`.css` → `lang-css`（`cssCompletionSource`）。
- 因此 **JS/TS/HTML/CSS 的代码补全很可能在当前构建里已随打字触发**（`activateOnTyping` 默认开），只是没有移动端手动入口，也从未被验证过手感。
- `@codemirror/lint`、`@codemirror/autocomplete` 均在 node_modules（传递依赖），零新依赖。
- `syntaxTree` + lezer `node.type.isError` 提供零依赖的语法错误检测，兼容所有 lang 包。

**目标**：本期交付（1）移动端补全手动触发（悬浮按钮），（2）仅语法级别的实时红线。用真机手感验证"补全是否值得投 LSP"，不投 LSP、不做语义/类型检查。

**明确不做**（YAGNI）：

- 不接入 LSP / 语言服务进程（服务端零改动）。
- 不做类型/语义诊断（那是 LSP 范畴）。
- 不做无解析器文件的兜底补全（.md/.txt/legacy-mode 语言维持现状，其语法树天然无 error 节点、零红线零误报）。
- 不接入 eslint（违反依赖最小化约束）。

## 架构

三件客户端件，全部在 `web/src`：

| 件 | 位置 | 职责 |
|---|---|---|
| `parseErrorLinter` 纯函数 | 新 `web/src/editor/lint.ts` | 遍历 `syntaxTree` 找 `node.type.isError` 节点 → `Diagnostic[]`（severity: "error"）。接收语法树为参数，node --test 可直测 |
| 编辑器接线 | `web/src/editor/index.ts` | ① state 增加 `linter(parseErrorLinter, { delay })` + `lintGutter()`；② `EditorHandle` 增加 `startCompletion()`（内部调 `startCompletion(view)`） |
| 悬浮补全按钮 | `web/src/App.tsx` + `styles.css` | 仅「当前是文件标签 且 编辑模式」显示，点击 → `editor.startCompletion()` |

## 数据流 / 交互

- **打字**：JS/TS/HTML/CSS 随 `activateOnTyping` 自动弹补全（现状，不引入回归）。
- **点悬浮按钮**：光标处唤出补全弹窗 = 手机版 Ctrl-Space。
- **语法红线**：输入实时；error 节点 → 红色波浪线（Deco.mark）+ gutter ⚠ + 点按波浪线弹消息（CM6 touch-hover）。
- **只读模式**：悬浮按钮隐藏（浏览模式补全无意义）。读写切换（✎）即时联动显隐。
- **无解析器文件**：`syntaxTree` 无 error 节点 → 零红线、零误报。

## 错误处理

- linter 回调 try/catch 包裹（CM 虽吞异常，防御起见）。
- `startCompletion` 在语言异步加载完成前调用 → CM 安全 no-op。
- 悬浮按钮状态与 `roMode()` 双向同步，读写切换即时。

## 测试

- `web/src/editor/lint.test.ts`（node --test）：用 `javascript()` 语言构造 `EditorState`（lezer 纯数据，headless 可行），断代码 → 断言有诊断且 range 正确；合法代码 → 无诊断。**先验证 `syntaxTree` headless 可用，再实现**。
- typecheck + build 全绿。
- 手动清单（真机验证）：TS 打字自动弹 / 悬浮按钮唤回 / 语法错误波浪线+消息 / 只读隐藏按钮 / 无解析器文件无红线。

## 验证成功标准

1. 真机上 JS/TS 打字能自动弹出补全，悬浮按钮能手动唤回。
2. 语法错误文件出现红色波浪线 + gutter ⚠ + 点按消息。
3. 只读模式下无悬浮按钮。
4. 全程 `npm run test` / `typecheck` / `build` 通过，零新依赖。
