# 语法高亮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 anther 编辑器打开文件时按路径识别语言并语法高亮（VS Code 式：先纯文本、语言加载后补高亮）。

**Architecture:** 新模块 `web/src/editor/language.ts` 提供 `describeLanguage(path)`（同步匹配路径→`LanguageDescription`）与 `loadLanguage(desc)`（动态 import 解析器→`Extension`）。编辑器适配层加 `languageCompartment` + `setLanguage(ext)`。`App.tsx` 的 `loadDoc` 在文档显示后异步加载语言，用既有 `loadSeq` 竞态守卫丢弃过期结果。

**Tech Stack:** CodeMirror 6、`@codemirror/language-data`（已安装）、Solid.js、node --test（--experimental-transform-types）。

## Global Constraints

- **依赖**：`@codemirror/language-data@^6.5.2`（已 npm install；`package.json`/`package-lock.json` 当前已修改、未提交，Task 1 一并提交）。**不再新增其他依赖**；禁止 node-gyp。
- **无状态**：高亮纯前端渲染，服务端零改动。
- **测试**：`npm test`（node --test --experimental-transform-types，自动收集 `web/src/**/*.test.ts`）。测试文件为 `.test.ts`（Node 24 不能 import `.tsx`）。
- **提交**：中文 commit message，不带 Co-Authored-By，直接提交 main。
- **不显示语言名**（用户确认）；**不做** TextMate grammar、内容嗅探、主题定制（见 spec §10）。

---

### Task 1: 语言匹配模块 language.ts + 测试

**Files:**
- Create: `web/src/editor/language.ts`
- Create: `web/src/editor/language.test.ts`

**Interfaces:**
- Produces:
  - `describeLanguage(path: string): LanguageDescription | null` — 同步匹配，不触发 import
  - `loadLanguage(desc: LanguageDescription): Promise<Extension | null>` — `desc.load()` 动态 import；失败返回 `null`

（`LanguageDescription` 来自 `@codemirror/language`，`Extension` 来自 `@codemirror/state`。已实测 `languages` 数组 143 条、`extensions` 为**不带点**小写数组、`filename` 为锚定 `^…$` 正则；匹配逻辑已在 node ESM 下验证。）

- [ ] **Step 1: 确认依赖已安装（brainstorming 阶段已装，未提交）**

```bash
npm ls @codemirror/language-data
# 期望：anther@0.1.0 └─ @codemirror/language-data@6.5.2（或其 ^6 最新版）
git status --short
# 期望：M package.json / M package-lock.json（未提交，Task 1 收尾一并提交）
```

- [ ] **Step 2: 写失败测试**

创建 `web/src/editor/language.test.ts`：

```ts
// web/src/editor/language.test.ts
// 匹配逻辑纯函数，node --test 可测；loadLanguage 依赖 vite 动态 import，留手动验证。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeLanguage } from './language.ts';

test('describeLanguage: 扩展名匹配', () => {
  assert.equal(describeLanguage('a.ts')?.name, 'TypeScript');
  assert.equal(describeLanguage('a.tsx')?.name, 'TSX');
  assert.equal(describeLanguage('a.js')?.name, 'JavaScript');
  assert.equal(describeLanguage('a.md')?.name, 'Markdown');
  assert.equal(describeLanguage('a.py')?.name, 'Python');
  assert.equal(describeLanguage('a.json')?.name, 'JSON');
});

test('describeLanguage: 扩展名大小写不敏感', () => {
  assert.equal(describeLanguage('a.TS')?.name, 'TypeScript');
});

test('describeLanguage: 含目录路径按 basename 提取扩展名', () => {
  assert.equal(describeLanguage('dir/deep/a.tsx')?.name, 'TSX');
});

test('describeLanguage: 精确文件名匹配', () => {
  assert.equal(describeLanguage('Dockerfile')?.name, 'Dockerfile');
  assert.equal(describeLanguage('Jenkinsfile')?.name, 'Groovy');
  assert.equal(describeLanguage('CMakeLists.txt')?.name, 'CMake');
  assert.equal(describeLanguage('Gemfile')?.name, 'Ruby');
  assert.equal(describeLanguage('nginx.conf')?.name, 'Nginx');
});

test('describeLanguage: 无扩展名/未知扩展名/点文件降级为 null', () => {
  assert.equal(describeLanguage('Makefile'), null); // language-data 未覆盖 Makefile
  assert.equal(describeLanguage('a.xyzabc'), null);
  assert.equal(describeLanguage('.gitignore'), null);
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npm test 2>&1 | grep -A2 "describeLanguage\|language.test"`
期望：FAIL，`Cannot find module './language.ts'`（模块不存在）。

- [ ] **Step 4: 写最小实现**

创建 `web/src/editor/language.ts`：

```ts
// web/src/editor/language.ts
// 路径 → CodeMirror 语言解析器。与编辑器适配层分离：纯函数便于 node --test 直测。
// 匹配语义对齐 language-data 官方示例：扩展名优先（find 首个命中，lezer 条目在前、
// legacy 在后，故常用语言自动取高质量解析器），filename 正则兜底。
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import type { Extension } from '@codemirror/state';

/** 路径 → 语言描述；未命中返回 null。纯同步，不触发动态 import。 */
export function describeLanguage(path: string): LanguageDescription | null {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : ''; // 点开头文件（.gitignore）dot=0 → 空
  return (
    languages.find((desc) => {
      if (ext && desc.extensions.includes(ext)) return true;
      if (desc.filename && desc.filename.test(base)) return true;
      return false;
    }) ?? null
  );
}

/** 加载语言解析器（动态 import）；失败静默降级纯文本（高亮是锦上添花）。 */
export async function loadLanguage(desc: LanguageDescription): Promise<Extension | null> {
  try {
    const support = await desc.load();
    return support.extension;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test 2>&1 | grep -E "describeLanguage|language.test|# (pass|fail)"`
期望：全部 PASS（含既有测试不回归）。

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json web/src/editor/language.ts web/src/editor/language.test.ts
git commit -m "feat: 语言匹配模块 describeLanguage/loadLanguage（language-data 按需加载）"
```

---

### Task 2: 编辑器语言 Compartment + setLanguage

**Files:**
- Modify: `web/src/editor/index.ts`

**Interfaces:**
- Consumes: `Extension`（来自 `@codemirror/state`，本文件 import 语句加 `type Extension`）
- Produces: `EditorHandle.setLanguage(ext: Extension | null): void` — Task 3 消费

**要点**：`languageCompartment` 初始值 `[]` 必须进 `makeState` 的 extensions 数组（Compartment 未进 state 就 reconfigure 会抛错）。语言与 readOnly 正交，`setLanguage` 与 `setReadOnly` 互不影响。

- [ ] **Step 1: 改 import 行加 `type Extension`**

```ts
// 现在：import { EditorState, Compartment, type Transaction } from '@codemirror/state';
import { EditorState, Compartment, type Transaction, type Extension } from '@codemirror/state';
```

- [ ] **Step 2: 加语言 Compartment（模块级，紧挨 editableCompartment）**

```ts
const editableCompartment = new Compartment();
const languageCompartment = new Compartment();
```

- [ ] **Step 3: makeState extensions 数组加初始空值**

在 `EditorState.create({ doc, extensions: [ ... ] })` 数组里、`basicSetup` 之后加一行：

```ts
languageCompartment.of([]),
```

（插入位置：`basicSetup,` 与 `search(),` 之间或数组任意位置均可，保持既有顺序即可。）

- [ ] **Step 4: EditorHandle 接口加 setLanguage**

```ts
export type EditorHandle = {
  setReadOnly(r: boolean): void;
  setDoc(doc: string): void;
  setLanguage(ext: Extension | null): void;   // 新增
  openSearch(): void;
  gotoLine(line0: number): void;
  destroy(): void;
};
```

- [ ] **Step 5: 实现 setLanguage（返回对象里，setDoc 之后）**

```ts
setLanguage(ext: Extension | null) {
  view.dispatch({
    effects: languageCompartment.reconfigure(ext ? [ext] : []),
  });
},
```

- [ ] **Step 6: 验证编译与既有测试**

Run: `npm test 2>&1 | tail -5`
期望：PASS（setLanguage 尚无调用者，不影响既有行为）。再 `npm run typecheck` 确认类型无误。

- [ ] **Step 7: Commit**

```bash
git add web/src/editor/index.ts
git commit -m "feat: 编辑器加 languageCompartment 与 setLanguage（动态切换语言解析器）"
```

---

### Task 3: App.tsx 接入 loadDoc + 手动验证

**Files:**
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `describeLanguage(path)`, `loadLanguage(desc)`（Task 1）、`editor.setLanguage(ext)`（Task 2）、既有 `loadSeq`/`currentFile()`

**要点**：文档先显示（不等语言），语言加载完成后校验 `path === currentFile() && seq === loadSeq` 再 setLanguage——复用现有竞态守卫。`setDoc` 会用 `makeState` 重建 state（compartment 重置为 `[]`），故每次切文件语言自动清空，无需显式 `setLanguage(null)`。

- [ ] **Step 1: 加 import**

在 `App.tsx` 顶部（`./editor/index.ts` import 旁）：

```ts
import { describeLanguage, loadLanguage } from './editor/language.ts';
```

- [ ] **Step 2: loadDoc 在 setDocLoadedPath 之后加语言加载**

`loadDoc` 当前结构（约 122-153 行）：

```ts
      editor.setReadOnly(roMode());
      setDocLoadedPath(path); // 搜索跳转消费 effect 的前提：文档确已加载
    } catch (e) {
```

在 `setDocLoadedPath(path);` 后、`} catch (e) {` 前插入：

```ts
      // 语法高亮：文档先显示纯文本，语言异步加载完成后补上（VS Code 同款体验）。
      // 竞态守卫与 readFile 一致：响应到达时已切换文件/有更新加载请求 → 丢弃。
      const desc = describeLanguage(path);
      if (desc) {
        const ext = await loadLanguage(desc);
        if (path !== currentFile() || seq !== loadSeq) return;
        editor?.setLanguage(ext);
      }
```

- [ ] **Step 3: 编译与既有测试**

Run: `npm test 2>&1 | tail -5` + `npm run typecheck`
期望：PASS，typecheck 无误。

- [ ] **Step 4: 手动验证（dev server + 浏览器）**

```bash
npm run dev
```

浏览器打开后逐项确认：
1. 打开 `.ts` 文件 → 先纯文本、随后关键字/字符串/注释着色（暗色主题下 `tok-*` 配色，styles.css:144-157）
2. 打开 `Dockerfile` → 有高亮（filename 精确匹配路径生效）
3. 打开 `Makefile` → 保持纯文本（降级正确）
4. 打开 `.ts` 后快速切 `.md` → 高亮不残留 TS 色（`setDoc` 重置 compartment 生效）
5. 只读模式打开 `.ts` → 高亮正常（语言与 readOnly 正交）
6. 打开 → 立即切换文件 → 再切回，高亮最终正确（竞态丢弃不产生串色）

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat: 打开文件按路径加载语法高亮（竞态守卫复用 loadSeq）"
```

---

## 验证收尾

- [ ] `npm test` 全绿（含既有搜索/文件树测试无回归）
- [ ] `npm run typecheck` 通过
- [ ] 手动验证清单（Task 3 Step 4）逐项过
- [ ] 请求代码审查（superpowers:requesting-code-review）
