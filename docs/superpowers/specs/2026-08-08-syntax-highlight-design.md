# anther 语法高亮设计文档

## 1. 概述

为 CodeMirror 6 编辑器接入语法高亮。目标：打开文件即按扩展名识别语言，高亮代码，体验对齐 VS Code 桌面（打开瞬间纯文本、语言加载完成后补高亮）。

当前状态：编辑器挂 `basicSetup`（codemirror/dist/index.js:59 已含 `syntaxHighlighting(defaultHighlightStyle, { fallback: true })`），高亮样式层**已就位**；styles.css:144-157 已有暗色主题 `tok-*` token 配色。缺的只是**语言解析器**——装上后 token 才有来源。

## 2. 设计原则（沿用主设计文档）

- **无状态**：高亮是纯前端渲染，服务端零改动、零磁盘写入
- **移动优先**：语言解析器按需加载（vite 动态 import 分包），首包不因全量语言数据变重
- **依赖约束**：`@codemirror/language-data` 及其传递依赖（`@codemirror/lang-*`、`@codemirror/legacy-modes`）全部纯 JS，无 node-gyp（已查 npm 依赖树确认）

## 3. 依赖

`npm install @codemirror/language-data@^6`（经用户确认）。

它自动带 ~15 个 `@codemirror/lang-*` 解析器（javascript/typescript/json/css/html/markdown/python/go/rust/cpp 等）+ `@codemirror/legacy-modes`（长尾 ~100 种语言，stream 模式），共覆盖 ~150 种语言。全部纯 JS，无 node-gyp。

## 4. 语言匹配模块（web/src/editor/language.ts，新文件）

职责：路径 → 语言解析器，与编辑器适配层分离，纯函数便于单测。

```ts
describeLanguage(path: string): LanguageDescription | null   // 纯同步匹配，不加载
loadLanguage(desc: LanguageDescription): Promise<Extension | null>  // 调 desc.load() 动态 import
```

匹配顺序（遍历 language-data 的 `languages` 数组）：

1. **扩展名**：取路径最后一段的扩展名（含点，`.ts`/`.jsx`/`.md`…），与 `desc.extensions`（`readonly string[]`，已确认带点格式）匹配
2. **精确文件名**：扩展名未命中时，用路径 basename 测 `desc.filename`（`RegExp | undefined`，已确认）——覆盖 `Dockerfile`、`Makefile`、`package.json` 等无扩展名/特殊文件
3. 均未命中 → `null`（纯文本降级）

`loadLanguage` 内 `desc.load()` 返回 `Promise<LanguageSupport>`，LanguageSupport 即 `Extension`，可直接进 Compartment。失败（解析器 import 异常）→ 返回 `null`，静默降级纯文本。

## 5. 编辑器接入（web/src/editor/index.ts）

`EditorHandle` 加 `setLanguage(ext: Extension | null)`：

- 新增 `languageCompartment = new Compartment()`，初始值 `[]`（无语言），**必须**在 `makeState` 的 extensions 数组里（Compartment 未进 state 就 reconfigure 会抛错）
- `setLanguage(ext)` → `view.dispatch({ effects: languageCompartment.reconfigure(ext ? [ext] : []) })`
- 语言与 readOnly 正交：只读/编辑模式都高亮，`setLanguage` 与 `setReadOnly` 互不影响

## 6. 加载时序与竞态（web/src/App.tsx loadDoc）

打开文件的加载流程（复用现有 `loadSeq` 竞态守卫）：

1. `readFile` 成功 → 先 `createEditor`/`setDoc` 显示纯文本（**不等待语言**，VS Code 同款体验）
2. `describeLanguage(path)`（同步）命中则 `loadLanguage(desc)`（异步动态 import）；未命中 → 保持纯文本
3. 语言加载完成 → 回调内**校验 `path === currentFile() && seq === loadSeq`**，通过才 `editor.setLanguage(ext)`；过期/已切换 → 丢弃

竞态场景：打开 A 后快速切 B，A 的语言加载完成时 A 已不是 currentFile → 丢弃，B 的语言另行加载。序号复用 loadDoc 现有 `loadSeq`，不新增状态。

## 7. 主题

零改动。亮色走 `defaultHighlightStyle` 默认配色（basicSetup 已含 fallback 高亮）；暗色走既有 styles.css:144-157 的 `tok-*` CSS 覆盖（该类名由 defaultHighlightStyle 产出，已 grep @lezer/highlight dist 确认）。

## 8. 工具栏

不显示语言名（用户确认）。工具栏零改动。

## 9. 测试

**language.ts（纯函数，node --test 可测，不触 DOM）**：

- 扩展名匹配：`.ts` → TypeScript、`.tsx` → TSX、`.md` → Markdown、`.py` → Python
- 精确文件名：`Dockerfile`、`Makefile`、`package.json` → 对应语言（匹配逻辑用回归样例锁住）
- 未知扩展名/无扩展名非特殊文件 → `null`
- `loadLanguage` 不单测（内部动态 import 依赖 vite 环境），只在语言匹配测试中验证返回的 desc 非空

**编辑器层 setLanguage**：DOM 依赖，真机/手动验证（切换文件高亮正确、快速切换无串色；与现有 ro-mode-effect 测试同款定位）。

## 10. 不做（明确排除）

- 语言名显示在工具栏/状态栏（用户确认不显示）
- TextMate grammar 直驱（Oniguruma WASM 依赖，与「少依赖」冲突；language-data 已是等价注册表）
- 内容嗅探自动识别（无扩展名且无特殊文件名 → 纯文本，不猜）
- 高亮配色主题化/自定义（沿用编辑器默认主题，暗色已有覆盖）
- 折叠、括号配对等进阶体验（basicSetup 已含 bracketMatching，折叠需 foldGutter 已含，非本任务范围）
