# 编辑器本地智能感知（补全触发 + 语法红线）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 anther 编辑器补两块本地智能感知：移动端补全手动触发（悬浮按钮）+ 实时语法错误红线，全部客户端、零服务端改动、零新依赖。

**Architecture:** 三件客户端件：(1) `web/src/editor/lint.ts` 纯函数 `parseErrorLinter`，遍历 `syntaxTree` 找 `node.type.isError` → lint `Diagnostic[]`；(2) `web/src/editor/index.ts` 接线——state 加 `linter(parseErrorLinter, { delay })` + `lintGutter()`，`EditorHandle` 加 `startCompletion()`；(3) `App.tsx` 悬浮补全按钮，仅文件态+编辑模式显示。`@codemirror/lint`、`@codemirror/autocomplete` 均为 node_modules 传递依赖，直接 import（代码库已有此先例：`language.ts` import 未在 package.json 声明的 `@codemirror/language`）。

**Tech Stack:** CodeMirror 6（`@codemirror/lint` / `@codemirror/autocomplete` / `@codemirror/language`）、lezer、SolidJS、node --test。

## Global Constraints

- 零新依赖：不运行 `npm install`，不手改 package.json 依赖字段，lockfile 不动。`@codemirror/lint`/`@codemirror/autocomplete` 已在 node_modules（`codemirror` 元包的依赖），直接 import 即可。
- 服务端零改动：本期所有改动限于 `web/src`。
- 不做 LSP / 语义 / 类型检查；不做无解析器文件兜底补全；不接 eslint。
- 中文 commit message，**不写 Co-Authored-By 行**。
- 移动端触控目标 ≥ 40px。
- 提交直接到分支 `feat/editor-intellisense`（当前分支），不回 main。
- 测试命令：`npm test`（`node --test --experimental-transform-types 'server/**/*.test.ts' 'web/src/**/*.test.ts'`）；类型：`npm run typecheck`；构建：`npm run build`。

---

### Task 1: `parseErrorLinter` 纯函数 + TDD 测试

**Files:**
- Create: `web/src/editor/lint.ts`
- Test: `web/src/editor/lint.test.ts`

**Interfaces:**
- Consumes: `@codemirror/language` 的 `syntaxTree`；`@lezer/common` 的 `Tree.iterate`（`syntaxTree` 返回值自带）。
- Produces:
  - `export type ErrorRange = { from: number; to: number }`
  - `export function collectErrorRanges(tree: ReturnType<typeof syntaxTree>): ErrorRange[]`
  - `export function parseErrorLinter(view: EditorView): Diagnostic[]`（`Diagnostic` 来自 `@codemirror/lint`）
  - Task 2 直接 import `parseErrorLinter`；测试直接测 `collectErrorRanges`（纯函数，headless 可测）。

已用 spike 验证：`EditorState.create({ doc, extensions: [javascript()] })` + `syntaxTree(state).iterate({ enter(n){ if (n.type.isError) ... } })` 在 node --test 下对 JS/HTML 断代码均正确命中 error 节点。

- [ ] **Step 1: 写失败测试**

`web/src/editor/lint.test.ts`：

```ts
// web/src/editor/lint.test.ts
// collectErrorRanges 是纯函数（输入 syntaxTree，输出 ErrorRange[]），node --test 直测。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { collectErrorRanges } from './lint.ts';

test('JS 合法代码：无 error 区间', () => {
  const state = EditorState.create({ doc: 'const x = 1;\nconsole.log(x);\n', extensions: [javascript()] });
  assert.equal(collectErrorRanges(syntaxTree(state)).length, 0);
});

test('JS 断代码（const x = ;）：有 error 区间', () => {
  const state = EditorState.create({ doc: 'const x = ;\n', extensions: [javascript()] });
  const ranges = collectErrorRanges(syntaxTree(state));
  assert.ok(ranges.length >= 1);
});

test('JS 断代码：error 区间覆盖坏 token（区间非空）', () => {
  const state = EditorState.create({ doc: 'const x = ;\n', extensions: [javascript()] });
  const ranges = collectErrorRanges(syntaxTree(state));
  const doc = state.doc.toString();
  assert.ok(ranges.some((r) => r.to > r.from && doc.slice(r.from, r.to).length > 0));
});

test('HTML 未闭合标签：有 error 区间', () => {
  const state = EditorState.create({ doc: '<div><span></div>', extensions: [html()] });
  assert.ok(collectErrorRanges(syntaxTree(state)).length >= 1);
});

test('无语言扩展（.md 未加载解析器）：零 error 区间（不误报）', () => {
  const state = EditorState.create({ doc: 'hello world\nplain text' });
  assert.equal(collectErrorRanges(syntaxTree(state)).length, 0);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test --experimental-transform-types web/src/editor/lint.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND`（`./lint.ts` 不存在）。若缺模块报错而非断言失败，属预期（文件未建）。

- [ ] **Step 3: 写最小实现**

`web/src/editor/lint.ts`：

```ts
// web/src/editor/lint.ts
// 语法错误红线：遍历 CodeMirror 语法树找 lezer error 节点 → lint Diagnostic[]。
// 与具体语言包解耦（全靠 node.type.isError），collectErrorRanges 为纯函数便于 node --test 直测。
import { syntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import type { Diagnostic } from '@codemirror/lint';

export type ErrorRange = { from: number; to: number };

/** 收集语法树中全部 isError 节点区间。纯函数，可脱离 EditorView 直测。 */
export function collectErrorRanges(tree: ReturnType<typeof syntaxTree>): ErrorRange[] {
  const out: ErrorRange[] = [];
  tree.iterate({ enter(n) { if (n.type.isError) out.push({ from: n.from, to: n.to }); } });
  return out;
}

/**
 * linter source：syntaxTree(state) → Diagnostic[]。全为 error 级。
 * try/catch 防御：linter 回调异常会被 CM 静默，此处兜底返回空数组。
 */
export function parseErrorLinter(view: EditorView): Diagnostic[] {
  try {
    return collectErrorRanges(syntaxTree(view.state)).map((r) => ({
      from: r.from,
      to: r.to,
      severity: 'error',
      message: 'Syntax error',
    }));
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test --experimental-transform-types web/src/editor/lint.test.ts`
Expected: PASS，5 个测试全绿。

- [ ] **Step 5: 全量测试 + 提交**

Run: `npm test`
Expected: 全部通过（原有用例 + 新增 5 个）。

```bash
git add web/src/editor/lint.ts web/src/editor/lint.test.ts
git commit -m "feat(editor): 语法错误红线 parseErrorLinter 纯函数 + 单测"
```

---

### Task 2: 编辑器接线（linter + lintGutter + startCompletion）

**Files:**
- Modify: `web/src/editor/index.ts`
  - 顶部 import 区（第 13-15 行附近）
  - `EditorHandle` 接口（第 17-24 行）加 `startCompletion`
  - `makeState` extensions 数组（第 57-75 行）加 lint 扩展
  - 返回对象（第 83-123 行）加 `startCompletion` 实现

**Interfaces:**
- Consumes: Task 1 的 `parseErrorLinter`；`@codemirror/lint` 的 `linter`、`lintGutter`；`@codemirror/autocomplete` 的 `startCompletion`。
- Produces: `EditorHandle.startCompletion(): void` —— Task 3 的悬浮按钮调用 `editorHandle()?.startCompletion()`。

- [ ] **Step 1: 加 import**

在 `web/src/editor/index.ts` 第 15 行（`import { EditorView, basicSetup } from 'codemirror';`）之后加：

```ts
import { linter, lintGutter } from '@codemirror/lint';
import { startCompletion } from '@codemirror/autocomplete';
import { parseErrorLinter } from './lint.ts';
```

- [ ] **Step 2: `EditorHandle` 接口加 `startCompletion`**

第 17-24 行接口内，`openSearch(): void;` 后加：

```ts
  startCompletion(): void;
```

- [ ] **Step 3: `makeState` extensions 加 lint**

第 61 行 `languageCompartment.of([]),` 后加：

```ts
        lintGutter(),
        linter(parseErrorLinter, { delay: 300 }),
```

（`lintGutter()` 在行号左侧加 ⚠ 标记列；`linter` 提供实时诊断，`delay: 300` 缩短输入抖动。）

- [ ] **Step 4: 返回对象加 `startCompletion` 实现**

第 96 行 `openSearch() {` 块之后加：

```ts
    startCompletion() {
      // 语言异步加载完成前调用 → CM 内部安全 no-op
      startCompletion(view);
    },
```

- [ ] **Step 5: typecheck + 全量测试**

Run: `npm run typecheck`
Expected: 无类型错误（`@codemirror/lint`/`@codemirror/autocomplete` 自带 .d.ts，可解析）。

Run: `npm test`
Expected: 全绿。

- [ ] **Step 6: 提交**

```bash
git add web/src/editor/index.ts
git commit -m "feat(editor): 接线语法红线（lintGutter+linter）与 startCompletion 句柄"
```

---

### Task 3: 悬浮补全按钮（App.tsx + styles.css + i18n）

**Files:**
- Modify: `web/src/App.tsx`（editor-area 内，第 353-358 行 editor-container div 之后）
- Modify: `web/src/styles.css`（`.editor-area` 第 26 行加 `position: relative`；新增 `.complete-btn`）
- Modify: `web/src/i18n.ts`（en 第 12 行 `find` 旁、zh 第 79 行 `find` 旁加 `complete`）

**Interfaces:**
- Consumes: `editorHandle`（App 已有 signal，第 15 行 import）、`currentFile()`、`roMode()`、Task 2 的 `startCompletion`。
- Produces: 无（UI 最终件）。

- [ ] **Step 1: i18n 加键**

`web/src/i18n.ts`：
- en 块（第 12 行 `find: 'Find',` 附近）：加 `complete: 'Complete',`
- zh 块（第 79 行 `find: '查找',` 附近）：加 `complete: '补全',`

- [ ] **Step 2: App.tsx 加悬浮按钮**

第 358 行 `editor-container` div 的闭合 `/>` 之后（仍在 `<main class="editor-area">` 内）加：

```tsx
        <Show when={currentFile() && !roMode()}>
          <button
            class="complete-btn"
            onClick={() => editorHandle()?.startCompletion()}
            title={t('complete')}
          >
            ⌘
          </button>
        </Show>
```

（`currentFile()` 非空 ⟹ 文件上下文；`!roMode()` ⟹ 编辑模式才显示，与 ✎ 联动即时显隐。）

- [ ] **Step 3: CSS**

`web/src/styles.css` 第 26 行 `.editor-area { ... }` 加 `position: relative;`（作为悬浮按钮定位锚）：

```css
.editor-area { min-height: 0; overflow: hidden; grid-column: 1; grid-row: 2; position: relative; }
```

文件末尾加（触控目标 44px ≥ 40px，用 `--accent` 主题变量，light/dark 自动适配）：

```css
.complete-btn {
  position: absolute;
  right: 16px;
  bottom: 16px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  background: var(--accent);
  color: white;
  font-size: 20px;
  line-height: 1;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  z-index: 5;
  touch-action: manipulation;
  display: flex;
  align-items: center;
  justify-content: center;
}
.complete-btn:active { opacity: 0.8; }
```

（`.app` 用 `--vvh, 100dvh` 布局，键盘弹出时 editor-area 随 dvh 收缩，按钮自动浮在键盘上方。）

- [ ] **Step 4: typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: 全绿，产物生成于 `dist/`。

- [ ] **Step 5: 提交**

```bash
git add web/src/App.tsx web/src/styles.css web/src/i18n.ts
git commit -m "feat(editor): 悬浮补全按钮（文件态+编辑模式显示，⌘ 触发 startCompletion）"
```

---

### Task 4: 全量验证 + 手动清单

**Files:** 无新增。只读验证。

- [ ] **Step 1: 全量测试**

Run: `npm test`
Expected: 全绿（server + web 全部用例）。

- [ ] **Step 2: typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: 全绿，`dist/` 重建无错误。

- [ ] **Step 3: 真机手动清单（用户执行）**

启动：`node bin/anther.js <项目目录> --port 3001`，手机浏览器打开 `http://<LAN-IP>:3001`（沙箱环境无 LAN IP，由用户在真机环境跑）。

| # | 验证项 | 预期 |
|---|---|---|
| 1 | 打开 `.ts` 文件，进入编辑模式，打字 | 打字自动弹补全（activateOnTyping） |
| 2 | 点右下角悬浮 ⌘ 按钮 | 光标处弹出补全列表（手动唤回） |
| 3 | 输入 `const x = ;` | `=` 后出现红色波浪线 + gutter ⚠；点按波浪线弹出 "Syntax error" |
| 4 | 修正语法错误 | 波浪线即时消失 |
| 5 | 只读模式（点 ✎ 切回） | 悬浮按钮隐藏 |
| 6 | 打开 `.md` 文件编辑 | 无红波浪线（不误报） |
| 7 | 切换终端/Git 标签 | 无悬浮按钮 |

- [ ] **Step 4: 收尾提交（若手动清单发现需修的问题先修再提交）**

```bash
git status
```
Expected: clean（除未跟踪的计划/文档外）。

> 若 Task 4 手动清单通过，本分支实现完成；是否 merge 回 main 由用户决定（走 finishing-a-development-branch）。
