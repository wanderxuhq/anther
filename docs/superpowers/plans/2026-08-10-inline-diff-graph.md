# 行内 diff + 历史图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 两个已确认诉求——(1) Phase 1：diff 在编辑器层面体现修改（行级红绿 + 状态栏 + 新文件行号，去掉纯文本 `@@ ++ --`），提交视图多文件 GitHub PR「code changes」式堆叠；(2) Phase 2：历史视图改为提交图（泳道岔线/合并菱形 + 分支名徽标），图直接取代扁平列表，无 `graph` 参数。

**Architecture:** git 只在服务端跑真实 CLI（`execFile` 数组参数 + 白名单）。Phase 1：服务端 `show()` 加 `--first-parent`（合并提交输出标准 unified diff）；前端纯函数 `parseUnifiedDiff` 拆多文件/hunk → 专用 CM6 编辑器 `createInlineDiffEditor`（自组扩展，不走 basicSetup，替换默认行号为「状态栏 + 新文件行号」双 gutter + 静态行级 `Decoration.line` 红绿背景）。Phase 2：`log()` 追加 `%P` parents + `--topo-order` + limit 上限 1000；前端纯函数 `layoutGraph` lane-tracing 算泳道 → 每行微型 SVG；`%D` → `parseDecorations` 取分支名徽标。

**Tech Stack:** Node 服务器（`server/git.ts` 薄 git 执行器）、Solid.js 前端、CodeMirror 6（`@codemirror/view`/`@codemirror/commands` 直接依赖声明，已传递安装）、手写 SVG（零图形库）、`node --test --experimental-transform-types` 测纯函数。

## Global Constraints

- **提交**：直接提交到 main（用户已授权），中文提交信息，不加 Co-Authored-By。
- **git 只在服务端跑**：`execFile('git', ['-C', root, ...args])` 数组参数不走 shell；白名单校验（branch 名 ∈ branches()、commit 必须 hex、路径根目录边界）。
- **零新增下载依赖**：`@codemirror/view`/`@codemirror/commands` 已由 `codemirror` 传递安装（纯 JS、无 node-gyp）；本 feature 只在 `package.json` 补**直接依赖声明**，**不跑 `npm install`、lockfile 不变、无新包下载**；历史图纯手写 SVG，不引库。
- **记忆约束**：npm install 加依赖、禁 node-gyp 依赖（本 feature 无任何新装）。
- **纯函数独立可测**：diff 解析/内联文档构建、图布局/徽标解析全部抽 `.ts` 模块（`node --test --experimental-transform-types` 可直接导入，测试 import 带 `.ts` 后缀）；`.tsx` 不可测，DOM 编辑器靠手动验证。
- **i18n** 走 `web/src/i18n.ts` en/zh 双份（`git.binary`、`git.graphTruncated`）。
- **git 标签不写入 URL**（现行为不变）；移动优先无浮层、触控目标 ≥ 40px。
- **进程安全**：绝不裸跑 `pkill -f "bin/anther.js"`，一律按 spawn 时捕获的精确 PID kill；用户 port 3000 生产进程不触碰。
- 验证命令：`npm test`（`node --test --experimental-transform-types 'server/**/*.test.ts' 'web/src/**/*.test.ts'`）、`npm run typecheck`（`tsc -p tsconfig.json --noEmit && tsc -p web/tsconfig.json`）、`npm run build`（`tsc -p tsconfig.json && vite build`）。

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `server/git.ts` | 改 | Phase 1 `show()` 加 `--first-parent`；Phase 2 `GitCommit.parents` + `COMMIT_FORMAT %P` + `--topo-order` + limit 上限 1000 |
| `server/git.test.ts` | 改 | 合并提交 `--first-parent` 断言（T1）；parents/topo/limit 1000 断言 + `101→1001`（T6） |
| `server/routes/git.test.ts` | 改 | `?limit=999→1001`（T6） |
| `web/src/views/diff-model.ts` | 建 | 纯函数：`parseUnifiedDiff`/`buildInlineDoc` + DiffLine/DiffHunk/DiffFile 类型 |
| `web/src/views/diff-model.test.ts` | 建 | diff 解析各行为单测 |
| `web/src/editor/inline-diff.ts` | 建 | 行内 diff 专用 CM6 编辑器 `createInlineDiffEditor` |
| `web/src/views/commit.tsx` | 改 | 多文件堆叠（元信息头 + 文件卡） |
| `web/src/views/git-diff.tsx` | 改 | 单文件行内 diff 渲染 |
| `web/src/editor/diff.ts` + `diff.test.ts` | 删 | 死代码（旧纯文本 diff 编辑器） |
| `web/src/i18n.ts` | 改 | 加 `git.binary`/`git.graphTruncated`；删 `git.loadMore` |
| `web/src/styles.css` | 改 | diff 行级背景/双 gutter/文件卡；图泳道/徽标 |
| `web/src/api.ts` | 改 | `GitCommit.parents: string[]`（T6） |
| `web/src/views/graph-model.ts` | 建 | 纯函数：`layoutGraph`/`parseDecorations` |
| `web/src/views/graph-model.test.ts` | 建 | 图布局/徽标解析单测 |
| `web/src/views/history.tsx` | 改 | 图取代扁平列表 |
| `web/src/views/history-model.ts` + `.test.ts` | 改 | 删 `logParams`（图不翻页）；保留 `formatCommitTime`/`commitTimeLabel` |
| `package.json` | 改 | 直接依赖声明 `@codemirror/view`/`@codemirror/commands`（lockfile 不变） |

---

## Phase 1 — 行内 diff

### Task 1: 服务端 show() 合并提交 --first-parent

**Files:**
- Modify: `server/git.ts:197-204`（`show()` 的 diff 命令 + 注释）
- Test: `server/git.test.ts`（追加一个测试）

**Interfaces:**
- Consumes: `Git.show(commit: string): Promise<GitShow>` 现有签名不变。
- Produces: 合并提交的 `show()` 输出标准 unified diff（相对第一父，GitHub/VSCode 语义）而非 combined diff。普通提交/根提交输出不变。

**原理：** 默认 `git show HEAD` 对合并提交输出 combined diff（`diff --cc`，trivial merge 下为空）→ 无法转行内红绿。`--first-parent` 输出标准 unified diff。此行为变化已与用户确认（spec §3）。

- [ ] **Step 1: 写失败测试** — 在 `server/git.test.ts` 追加：

```ts
test('show：合并提交 → --first-parent 标准 unified diff（非 combined）', async () => {
  // 构造 merge：dev 开分支 → 两线各一提交 → 合并（--no-ff 强制真实 merge commit）
  await gitCmd(['checkout', '-qb', 'dev']);
  await writeFile(path.join(repoDir, 'dev.txt'), 'dev\n');
  await gitCmd(['add', '.']);
  await gitCmd(['commit', '-qm', 'dev work']);
  await gitCmd(['checkout', 'main']);
  await writeFile(path.join(repoDir, 'main.txt'), 'main\n');
  await gitCmd(['add', '.']);
  await gitCmd(['commit', '-qm', 'main work']);
  await gitCmd(['merge', '--no-ff', '-m', 'merge dev', 'dev']);
  const head = (await gitCmd(['rev-parse', '--short', 'HEAD'])).stdout.trim();
  const { diff } = await git.show(head);
  assert.match(diff, /diff --git a\/main\.txt/);   // 标准 unified（相对主线改动）
  assert.doesNotMatch(diff, /diff --cc|diff --combined/);
  assert.match(diff, /\+main/);                     // 含主线侧新增
  assert.doesNotMatch(diff, /dev\.txt/);            // 不含 dev 侧改动（第一父语义）
});
```

- [ ] **Step 2: 跑测试确认失败** — `node --experimental-transform-types --test server/git.test.ts`
  Expected: 该用例 FAIL——当前 `show()` 对合并提交输出 combined diff（此 merge 下为空或 `diff --cc`），`assert.match(diff, /diff --git a\/main\.txt/)` 挂。

- [ ] **Step 3: 实现** — `server/git.ts` `show()` 的 diff 命令（第 202 行）：

```ts
// 合并提交：--first-parent → 标准 unified diff（相对主线改动，GitHub/VSCode 语义），非 combined
const { stdout: diffOut } = await this.execGit(['show', commit, '--format=', '--first-parent']);
```

同步更新 `show()` 上方文档注释：`/** 单次提交的元信息 + diff 正文。... */` 追加一句「合并提交输出相对第一父的 unified diff」。

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `node --experimental-transform-types --test server/git.test.ts` → 该用例 PASS；`npm test` → 全绿（不新增失败）。

- [ ] **Step 5: 提交**

```bash
git add server/git.ts server/git.test.ts
git commit -m "feat(diff): 合并提交 show() 输出 --first-parent 标准 unified diff + 测试"
```

---

### Task 2: diff 解析纯函数（diff-model.ts）

**Files:**
- Create: `web/src/views/diff-model.ts`
- Create: `web/src/views/diff-model.test.ts`

**Interfaces:**
- Consumes: 无（纯函数，无依赖）。
- Produces（Task 3/4 依赖）：

```ts
export type DiffLine = { kind: 'ctx' | 'del' | 'add'; text: string };   // text = 去 `-`/`+`/空格 前缀后的原始内容
export type DiffHunk = { oldStart: number; newStart: number; lines: DiffLine[] };
export type DiffFile = {
  path: string;                              // 显示路径（b/ 侧；删除文件取 a/ 侧）
  status: 'added' | 'deleted' | 'modified' | 'renamed' | 'binary';
  oldPath?: string;                          // rename 时显示 a → b
  addCount: number;
  delCount: number;
  hunks: DiffHunk[];                         // binary → []
};
export function parseUnifiedDiff(text: string): DiffFile[];
export function buildInlineDoc(file: DiffFile): { doc: string; kinds: DiffLine['kind'][]; numbers: (number | null)[] };
```

**行为约定（spec §4.2）：** 按 `^diff --git` 拆多文件；hunk 内「ctx→del→add」子块顺序保留（VSCode 同款）；`\ No newline at end of file` 标记行丢弃；二进制无 hunks；`buildInlineDoc` 正文不带 diff 前缀，返回每行 kind 与新文件行号（ctx/add 自增、del 为 null），`doc`/`kinds`/`numbers` 三数组对齐。

- [ ] **Step 1: 写失败测试** — 创建 `web/src/views/diff-model.test.ts`（完整内容）：

```ts
// web/src/views/diff-model.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUnifiedDiff, buildInlineDoc } from './diff-model.ts';

// 多行字符串辅助：数组 join（diff 内容含 `+`/`-`/空格前缀，不用模板缩进）
const D = (...lines: string[]) => lines.join('\n');

test('parseUnifiedDiff：多文件拆分 + add/del 计数 + 路径', () => {
  const text = D(
    'diff --git a/src/a.ts b/src/a.ts',
    'index abc..def 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,3 +1,4 @@',
    ' keep',
    '-gone',
    '+added',
    '+added2',
    'diff --git a/src/b.ts b/src/b.ts',
    'index 111..222 100644',
    '--- a/src/b.ts',
    '+++ b/src/b.ts',
    '@@ -5 +5,2 @@',
    ' ctx',
    '-old',
    '+new',
  );
  const files = parseUnifiedDiff(text);
  assert.equal(files.length, 2);
  const [a, b] = files;
  assert.equal(a.path, 'src/a.ts');
  assert.equal(a.status, 'modified');
  assert.equal(a.addCount, 2);
  assert.equal(a.delCount, 1);
  assert.equal(b.path, 'src/b.ts');
  assert.equal(b.addCount, 1);
  assert.equal(b.delCount, 1);
});

test('buildInlineDoc：hunk 内 ctx→del→add 子块顺序 + 行号（del 为 null）', () => {
  const text = D(
    'diff --git a/x b/x',
    '--- a/x',
    '+++ b/x',
    '@@ -10,6 +20,7 @@',
    ' ctx-a',
    '-del-1',
    '-del-2',
    '+add-1',
    '+add-2',
    ' ctx-b',
  );
  const file = parseUnifiedDiff(text)[0];
  const { doc, kinds, numbers } = buildInlineDoc(file);
  assert.deepEqual(kinds, ['ctx', 'del', 'del', 'add', 'add', 'ctx']);
  assert.deepEqual(numbers, [20, null, null, 21, 22, 23]);
  assert.equal(doc, D('ctx-a', 'del-1', 'del-2', 'add-1', 'add-2', 'ctx-b'));
});

test('buildInlineDoc：多 hunk 各自从 newStart 起编号', () => {
  const text = D(
    'diff --git a/x b/x',
    '--- a/x',
    '+++ b/x',
    '@@ -1,2 +1,2 @@',
    ' a1',
    '+b1',
    '@@ -10,2 +11,2 @@',
    ' c1',
    '-d1',
    '+e1',
  );
  const { numbers } = buildInlineDoc(parseUnifiedDiff(text)[0]);
  assert.deepEqual(numbers, [1, 2, 11, null, 12]);
});

test('parseUnifiedDiff：重命名 → status renamed + oldPath', () => {
  const text = D(
    'diff --git a/src/old.ts b/src/new.ts',
    'similarity index 90%',
    'rename from src/old.ts',
    'rename to src/new.ts',
    'index abc..def 100644',
    '--- a/src/old.ts',
    '+++ b/src/new.ts',
    '@@ -1 +1 @@',
    '-old',
    '+new',
  );
  const file = parseUnifiedDiff(text)[0];
  assert.equal(file.status, 'renamed');
  assert.equal(file.oldPath, 'src/old.ts');
  assert.equal(file.path, 'src/new.ts');
});

test('parseUnifiedDiff：二进制 → status binary + 空 hunks', () => {
  const text = D(
    'diff --git a/img.png b/img.png',
    'index 111..222 100644',
    'Binary files a/img.png and b/img.png differ',
  );
  const file = parseUnifiedDiff(text)[0];
  assert.equal(file.status, 'binary');
  assert.equal(file.addCount, 0);
  assert.equal(file.delCount, 0);
  assert.deepEqual(file.hunks, []);
});

test('parseUnifiedDiff：新增文件 → status added（a/ 侧为 /dev/null 仍取 b/ 路径）', () => {
  const text = D(
    'diff --git a/dev/null b/new.txt',
    'new file mode 100644',
    'index 0000000..e69de29',
    '--- /dev/null',
    '+++ b/new.txt',
    '@@ -0,0 +1 @@',
    '+hello',
  );
  const file = parseUnifiedDiff(text)[0];
  assert.equal(file.status, 'added');
  assert.equal(file.path, 'new.txt');
});

test('parseUnifiedDiff：删除文件 → status deleted + a/ 侧路径', () => {
  const text = D(
    'diff --git a/gone.txt b/gone.txt',
    'deleted file mode 100644',
    'index 111..000 100644',
    '--- a/gone.txt',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-bye',
  );
  const file = parseUnifiedDiff(text)[0];
  assert.equal(file.status, 'deleted');
  assert.equal(file.path, 'gone.txt');
});

test('parseUnifiedDiff：\\ No newline 标记行丢弃', () => {
  const text = D(
    'diff --git a/x b/x',
    '--- a/x',
    '+++ b/x',
    '@@ -1 +1 @@',
    '-old',
    '\\ No newline at end of file',
    '+new',
  );
  const { kinds } = buildInlineDoc(parseUnifiedDiff(text)[0]);
  assert.deepEqual(kinds, ['del', 'add']);
});

test('parseUnifiedDiff：空 diff → 空数组', () => {
  assert.deepEqual(parseUnifiedDiff(''), []);
});
```

- [ ] **Step 2: 跑测试确认失败** — `node --experimental-transform-types --test web/src/views/diff-model.test.ts`
  Expected: FAIL——`ERR_MODULE_NOT_FOUND`（`./diff-model.ts` 不存在）。

- [ ] **Step 3: 实现** — 创建 `web/src/views/diff-model.ts`（完整内容）：

```ts
// web/src/views/diff-model.ts
// unified diff → 多文件行内模型（纯函数，node --test 直接导入可测）。
// 解析 `git show`/`git diff` 输出的 unified diff 文本 → 按文件拆分 + hunk 子块分组，
// 供行内 diff 编辑器（红绿背景 + 状态栏 + 新文件行号）一次性构建。
export type DiffLine = { kind: 'ctx' | 'del' | 'add'; text: string };   // text = 去 `-`/`+`/空格 前缀后的原始内容
export type DiffHunk = { oldStart: number; newStart: number; lines: DiffLine[] };
export type DiffFile = {
  path: string;                              // 显示路径（b/ 侧；删除文件取 a/ 侧）
  status: 'added' | 'deleted' | 'modified' | 'renamed' | 'binary';
  oldPath?: string;                          // rename 时显示 a → b
  addCount: number;
  delCount: number;
  hunks: DiffHunk[];                         // binary → []
};

/** 按 `^diff --git` 拆多文件段（commit 视图一次 show() → 每文件一节，GitHub 式堆叠）。 */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  for (const section of text.split(/^diff --git /m)) {
    if (!section.trim()) continue; // 首个段（diff 前空行）跳过
    files.push(parseFile('diff --git ' + section));
  }
  return files;
}

function parseFile(seg: string): DiffFile {
  const lines = seg.split('\n');
  const header = lines[0]; // 'diff --git a/x b/y'

  // 状态识别：在文件头元信息行中探测（任一命中即定型）
  let status: DiffFile['status'] = 'modified';
  for (const line of lines) {
    if (line.startsWith('Binary files ')) { status = 'binary'; break; }
    if (line.startsWith('new file mode ')) { status = 'added'; break; }
    if (line.startsWith('deleted file mode ')) { status = 'deleted'; break; }
    if (line.startsWith('similarity index ') || line.startsWith('rename from ') || line.startsWith('rename to ')) {
      status = 'renamed';
      break;
    }
  }

  // 路径：b/ 侧显示；删除文件（b 侧 /dev/null）取 a/ 侧
  const oldPath = header.replace(/^diff --git a\//, '').replace(/ b\/.*$/, '');
  const newPath = header.replace(/^diff --git a\/.* b\//, '');
  const path = status === 'deleted' ? oldPath : newPath;

  // hunk 解析：`@@ -o[,n] +n[,m] @@` 头；hunk 内保持「ctx→del→add」子块顺序（VSCode 同款）
  const hunks: DiffHunk[] = [];
  let addCount = 0;
  let delCount = 0;
  let cur: DiffHunk | null = null;
  for (const line of lines) {
    const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) {
      cur = { oldStart: Number(h[1]), newStart: Number(h[2]), lines: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('\\ ')) continue; // "\ No newline at end of file" 丢弃（VSCode 亦忽略）
    if (line.startsWith('+')) { cur.lines.push({ kind: 'add', text: line.slice(1) }); addCount++; }
    else if (line.startsWith('-')) { cur.lines.push({ kind: 'del', text: line.slice(1) }); delCount++; }
    else if (line.startsWith(' ')) { cur.lines.push({ kind: 'ctx', text: line.slice(1) }); }
  }

  return {
    path,
    status,
    ...(status === 'renamed' && oldPath !== newPath ? { oldPath } : {}),
    addCount,
    delCount,
    hunks,
  };
}

/** 构建行内文档：正文不带 diff 前缀（前缀只体现在状态栏 + 颜色）；返回每行 kind 与新文件行号（del = null）。三数组对齐。 */
export function buildInlineDoc(file: DiffFile): { doc: string; kinds: DiffLine['kind'][]; numbers: (number | null)[] } {
  const docLines: string[] = [];
  const kinds: DiffLine['kind'][] = [];
  const numbers: (number | null)[] = [];
  for (const hunk of file.hunks) {
    let newLine = hunk.newStart; // 每个 hunk 各自起编号（hunk 间有省略内容）
    for (const l of hunk.lines) {
      docLines.push(l.text);
      kinds.push(l.kind);
      if (l.kind === 'del') { numbers.push(null); continue; }
      numbers.push(newLine++); // ctx/add = 新文件行号自增
    }
  }
  return { doc: docLines.join('\n'), kinds, numbers };
}
```

- [ ] **Step 4: 跑测试确认通过** — `node --experimental-transform-types --test web/src/views/diff-model.test.ts`
  Expected: 全部 PASS（9 个）。

- [ ] **Step 5: 提交**

```bash
git add web/src/views/diff-model.ts web/src/views/diff-model.test.ts
git commit -m "feat(diff): parseUnifiedDiff/buildInlineDoc 纯函数 + 单测"
```

---

### Task 3: 行内 diff 编辑器（inline-diff.ts）+ package.json 直接依赖

**Files:**
- Create: `web/src/editor/inline-diff.ts`
- Modify: `package.json`（补 `@codemirror/view` + `@codemirror/commands` 直接依赖声明，**不跑 npm install、lockfile 不变**）

**Interfaces:**
- Consumes:
  - `buildInlineDoc`, `DiffFile`（Task 2）；
  - `EditorHandle`（`web/src/editor/index.ts` 既有，只读门控 `EditorState.readOnly` + `EditorView.editable` 双 facet 模式）。
- Produces（Task 4/9 依赖）：

```ts
export type DiffHandle = EditorHandle;   // 复用既有 EditorHandle 接口
export function createInlineDiffEditor(container: HTMLElement, file: DiffFile): DiffHandle;
```

**原理（spec §4.3）：** 专用 CM6 扩展自组，**不走 `createEditor`/`basicSetup`**（需替换默认行号为自定义双 gutter）。只读静态文档，`Decoration.line` 红绿背景一次构建 RangeSet，无增量更新。保留视口按需渲染/搜索/主题字号缩放跟随。

- [ ] **Step 1: package.json 直接依赖声明** — 在 `dependencies` 中补两项（已传递安装，仅声明；顺序保持字母序）：

```json
"@codemirror/commands": "^6.10.4",
"@codemirror/language-data": "^6.5.2",
...
"@codemirror/state": "^6.7.1",
"@codemirror/view": "^6.43.8",
```

> 注意：版本号取 `node_modules` 实际安装版本（6.10.4 / 6.43.8）。**不要运行 `npm install`**——改完直接验证，lockfile 必须无 diff。

- [ ] **Step 2: 实现** — 创建 `web/src/editor/inline-diff.ts`（完整内容）：

```ts
// web/src/editor/inline-diff.ts
// 行内 diff 专用 CM6 编辑器：双 gutter（状态栏 + 新文件行号）+ 行级红绿背景。
// 不走 createEditor/basicSetup —— 需替换默认行号；只读静态文档，装饰一次构建，无增量更新。
import { EditorState, type Range } from '@codemirror/state';
import {
  EditorView, Decoration, GutterMarker, gutter, keymap,
  highlightSpecialChars, drawSelection, dropCursor,
} from '@codemirror/view';
import { defaultKeymap, history } from '@codemirror/commands';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { buildInlineDoc, type DiffFile } from '../views/diff-model.ts';
import type { EditorHandle } from './index.ts';

export type DiffHandle = EditorHandle; // 复用既有 EditorHandle 接口

class DiffMarker extends GutterMarker {
  constructor(private text: string, private cls = '') {
    super();
  }
  toDOM() {
    const el = document.createElement('span');
    el.textContent = this.text;
    if (this.cls) el.className = this.cls;
    return el;
  }
}

/** 行内 diff 编辑器：状态栏（+/−/空）+ 新文件行号双 gutter + 行级红绿背景。返回 EditorHandle（只读无操作 + 搜索）。 */
export function createInlineDiffEditor(container: HTMLElement, file: DiffFile): DiffHandle {
  const { doc, kinds, numbers } = buildInlineDoc(file);
  const lineCount = doc === '' ? 0 : doc.split('\n').length;

  // 最左状态栏：+（add，绿）/ −（del，红）/ 空（ctx）
  const statusGutter = gutter({
    class: 'cm-diff-status',
    lineMarker(_view, line) {
      const kind = kinds[line.number - 1] ?? 'ctx';
      if (kind === 'add') return new DiffMarker('+', 'diff-status-add');
      if (kind === 'del') return new DiffMarker('−', 'diff-status-del');
      return new DiffMarker('');
    },
    initialSpacer: () => new DiffMarker('+'),
  });

  // 行号栏：ctx/add 显示新文件行号；del 行空。spacer 按最大行号定宽（右对齐）
  const maxNum = numbers.reduce((m, n) => (n != null ? Math.max(m, n) : m), 1);
  const numberGutter = gutter({
    class: 'cm-diff-numbers',
    lineMarker(_view, line) {
      const n = numbers[line.number - 1];
      return n == null ? new DiffMarker('') : new DiffMarker(String(n));
    },
    initialSpacer: () => new DiffMarker('9'.repeat(String(maxNum).length)),
  });

  // 行级红绿背景：静态文档，一次构建 RangeSet（Decoration.line 锚行首）
  const ranges: Range<Decoration>[] = [];
  {
    let from = 0;
    for (let i = 0; i < lineCount; i++) {
      const kind = kinds[i];
      if (kind === 'del' || kind === 'add') {
        ranges.push(Decoration.line({ class: kind === 'del' ? 'diff-del' : 'diff-add' }).range(from));
      }
      const nl = doc.indexOf('\n', from);
      from = nl === -1 ? doc.length : nl + 1;
    }
  }

  const view = new EditorView({
    parent: container,
    state: EditorState.create({
      doc,
      extensions: [
        // 编辑无关能力：特殊字符/选区/拖拽光标/历史/按键（readOnly 下无副作用）+ 搜索
        highlightSpecialChars(),
        drawSelection(),
        dropCursor(),
        history(),
        keymap.of([...defaultKeymap, ...searchKeymap]),
        search(),
        statusGutter,
        numberGutter,
        Decoration.set(ranges, true),
        // 只读双 facet 门控（对齐 editor/index.ts）：readOnly 挡命令，editable 挡视觉/输入
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
      ],
    }),
  });

  return {
    setReadOnly() {},
    setDoc() {},
    setLanguage() {},
    openSearch() { openSearchPanel(view); },
    gotoLine() {},
    destroy() { view.destroy(); },
  };
}
```

- [ ] **Step 3: 验证（typecheck + build）**

Run: `npm run typecheck` → 0 错误（确认所有 import 源正确：`defaultKeymap`/`history` 来自 `@codemirror/commands`，`Decoration`/`gutter`/`keymap` 来自 `@codemirror/view`）。再 `npm run build` → 成功。
同时确认 `git diff package.json` 后 **lockfile 无变化**（`git status` 中 `package-lock.json` 干净）。

- [ ] **Step 4: 提交**

```bash
git add package.json web/src/editor/inline-diff.ts
git commit -m "feat(diff): 行内 diff 编辑器（双 gutter + 行级红绿）+ @codemirror/view/commands 直接依赖声明"
```

---

### Task 4: CommitView 多文件堆叠 + GitDiffView 行内化 + 删旧编辑器

**Files:**
- Modify: `web/src/views/commit.tsx`（整体重写）
- Modify: `web/src/views/git-diff.tsx`（整体重写）
- Delete: `web/src/editor/diff.ts`
- Delete: `web/src/editor/diff.test.ts`

**Interfaces:**
- Consumes: `createInlineDiffEditor`/`DiffHandle`（Task 3）、`parseUnifiedDiff`/`DiffFile`（Task 2）、`commitTimeLabel`（`history-model.ts` 既有）、`openTab`（stores.ts 既有）、`t`。
- Produces: `CommitView(props: { commit: string })`（GitHub PR 式多文件堆叠）；`GitDiffView(props: { path: string })`（单文件行内）。

**行为约定：** 二进制文件 → 标题行 + `git.binary` 占位（无编辑器）；空 diff（无 hunks 非 binary）→ 空编辑器 + 无状态栏；`props.commit`/`props.path` 变化 → cancelled 守卫 + 逐个 destroy 旧 handle。

- [ ] **Step 1: 重写 CommitView** — `web/src/views/commit.tsx`（完整内容，含本地 FileCard 子组件，每个文件卡自持编辑器生命周期）：

```tsx
// web/src/views/commit.tsx
// git-commit 标签视图：元信息头 + 该提交多文件 diff，GitHub PR「code changes」式堆叠。
// 每文件一个卡片：路径（rename 显示 a → b）+ `+N −M` 计数 + 行内 diff 编辑器；二进制占位。
import { createEffect, createSignal, Show, For, onCleanup } from 'solid-js';
import { api, type GitCommit } from '../api.ts';
import { createInlineDiffEditor, type DiffHandle } from '../editor/inline-diff.ts';
import { parseUnifiedDiff, type DiffFile } from './diff-model.ts';
import { commitTimeLabel } from './history-model.ts';
import { t } from '../i18n.ts';

// 单个文件卡：路径头 + 增减计数 + 行内编辑器（每卡自持 handle，onCleanup 逐个 destroy）
function FileCard(props: { file: DiffFile }) {
  let editorEl: HTMLDivElement | undefined;
  createEffect(() => {
    let handle: DiffHandle | undefined;
    onCleanup(() => handle?.destroy());
    if (props.file.status === 'binary' || !editorEl) return;
    handle = createInlineDiffEditor(editorEl, props.file);
  });
  return (
    <div class="git-commit-file">
      <div class="git-commit-file-head">
        <span class="git-commit-file-path">
          {props.file.oldPath ? `${props.file.oldPath} → ${props.file.path}` : props.file.path}
        </span>
        <span class="git-commit-file-count">
          <span class="diff-count-add">+{props.file.addCount}</span>
          <span class="diff-count-del">−{props.file.delCount}</span>
        </span>
      </div>
      <Show when={props.file.status === 'binary'} fallback={<div ref={editorEl} class="git-diff-editor" />}>
        <div class="git-commit-binary">{t('git.binary')}</div>
      </Show>
    </div>
  );
}

export function CommitView(props: { commit: string }) {
  const [meta, setMeta] = createSignal<GitCommit | null>(null);
  const [files, setFiles] = createSignal<DiffFile[]>([]);
  const [error, setError] = createSignal<string | null>(null);

  // props.commit 变化 → 清状态 → 拉 show → parse 多文件（cancelled 竞态守卫，同既有模板）
  createEffect(() => {
    const commit = props.commit;
    let cancelled = false;
    setError(null);
    setMeta(null);
    setFiles([]);
    void (async () => {
      try {
        const { commit: c, diff } = await api.git.show(commit);
        if (cancelled) return;
        setMeta(c);
        setFiles(parseUnifiedDiff(diff));
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
      }
    })();
    onCleanup(() => { cancelled = true; });
  });

  return (
    <div class="git-diff-view">
      <Show when={meta()}>
        <div class="git-commit-header">
          <span class="git-commit-meta">{meta()!.shortHash} · {meta()!.author} · {commitTimeLabel(meta()!)}</span>
          <span class="git-commit-subject">{meta()!.subject}</span>
        </div>
      </Show>
      <Show when={error()}>
        <div class="error-banner">{error()}</div>
      </Show>
      <div class="git-commit-files">
        <For each={files()}>{(file) => <FileCard file={file} />}</For>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 重写 GitDiffView** — `web/src/views/git-diff.tsx`（完整内容；头部「路径 + ✎ 打开编辑器」保留）：

```tsx
// web/src/views/git-diff.tsx
// git-diff 标签视图：单文件行内 diff（红绿块 + 状态栏 + 新文件行号）。顶部「用编辑器打开」按钮不变。
import { createEffect, createSignal, Show, onCleanup } from 'solid-js';
import { api } from '../api.ts';
import { createInlineDiffEditor, type DiffHandle } from '../editor/inline-diff.ts';
import { parseUnifiedDiff, type DiffFile } from './diff-model.ts';
import { openTab } from '../stores.ts';
import { t } from '../i18n.ts';

export function GitDiffView(props: { path: string }) {
  let container: HTMLDivElement | undefined;
  const [error, setError] = createSignal<string | null>(null);
  const [file, setFile] = createSignal<DiffFile | null>(null);

  // props.path 变化 → 整个 effect 重跑：清状态再拉新 diff → parse 单文件
  createEffect(() => {
    const path = props.path;
    let cancelled = false;
    setError(null);
    setFile(null);
    void (async () => {
      try {
        const { diff } = await api.git.diff(path);
        if (cancelled) return;
        setFile(parseUnifiedDiff(diff)[0] ?? null);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
      }
    })();
    onCleanup(() => { cancelled = true; });
  });

  // file 就绪后创建行内编辑器（container 随渲染绑定；二进制 → 占位无编辑器）
  createEffect(() => {
    const f = file();
    let handle: DiffHandle | undefined;
    onCleanup(() => handle?.destroy());
    if (!f || f.status === 'binary' || !container) return;
    handle = createInlineDiffEditor(container, f);
  });

  return (
    <div class="git-diff-view">
      <div class="git-diff-header">
        <span class="git-diff-path">{props.path}</span>
        <button class="icon-btn" onClick={() => void openTab(props.path)} title={t('git.openInEditor')}>
          ✎
        </button>
      </div>
      <Show when={error()}>
        <div class="error-banner">{error()}</div>
      </Show>
      <Show when={file()?.status === 'binary'} fallback={<div ref={container} class="git-diff-editor" />}>
        <div class="git-commit-binary">{t('git.binary')}</div>
      </Show>
    </div>
  );
}
```

- [ ] **Step 3: 删旧纯文本 diff 编辑器**

```bash
rm web/src/editor/diff.ts web/src/editor/diff.test.ts
```

> `@codemirror/legacy-modes` 依赖不可删（`@codemirror/language-data` 直接依赖它），仅删这两个死代码文件。

- [ ] **Step 4: 验证（typecheck + build + 回归）**

Run: `npm run typecheck` → 0 错误；`npm run build` → 成功；`npm test` → 全绿（183 pass，diff.test.ts 已删）。

- [ ] **Step 5: 提交**

```bash
git add web/src/views/commit.tsx web/src/views/git-diff.tsx
git rm web/src/editor/diff.ts web/src/editor/diff.test.ts
git commit -m "feat(diff): 提交视图多文件堆叠 + git-diff 行内化，删旧纯文本 diff 编辑器"
```

---

### Task 5: Phase 1 i18n + 样式

**Files:**
- Modify: `web/src/i18n.ts`（en/zh 各加 `git.binary`）
- Modify: `web/src/styles.css`（diff 行级背景/双 gutter/文件卡样式）

**Interfaces:**
- Consumes: Task 3/4 使用的类名——`cm-diff-status`/`cm-diff-numbers`/`diff-status-add`/`diff-status-del`/`diff-add`/`diff-del`/`git-commit-files`/`git-commit-file`/`git-commit-file-head`/`git-commit-file-path`/`git-commit-file-count`/`diff-count-add`/`diff-count-del`/`git-commit-binary`。
- Produces: 行内 diff 视觉（CSS 变量跟随浅/深主题）+ `t('git.binary')`。

- [ ] **Step 1: i18n 加键** — `web/src/i18n.ts`：en git 键块（约 49-74 行）内加一行；zh git 键块（约 115-141 行）内加一行：

```ts
// en
'git.binary': 'Binary file',
// zh
'git.binary': '二进制文件',
```

- [ ] **Step 2: 样式** — `web/src/styles.css` 末尾追加（独立 `:root` 块合法，与既有块级联；放 `.git-diff-editor`/commit 样式区之后）：

```css
/* 行内 diff（2026-08-10）：双 gutter + 行级红绿 + 文件卡 */
:root {
  --diff-add-bg: #e6ffed;
  --diff-del-bg: #ffeef0;
  --diff-status-add: #1a7f37;
  --diff-status-del: #cf222e;
}
:root[data-theme='dark'] {
  --diff-add-bg: rgba(46, 160, 67, .18);
  --diff-del-bg: rgba(248, 81, 73, .18);
  --diff-status-add: #3fb950;
  --diff-status-del: #f85149;
}
.cm-diff-status { width: 1.6em; }
.cm-diff-status .cm-gutterElement { padding: 0; text-align: center; font-weight: 700; }
.diff-status-add { color: var(--diff-status-add); }
.diff-status-del { color: var(--diff-status-del); }
.cm-diff-numbers .cm-gutterElement { padding: 0 6px 0 2px; text-align: right; color: var(--muted); }
.diff-add { background: var(--diff-add-bg); box-shadow: inset 3px 0 0 var(--diff-status-add); }
.diff-del { background: var(--diff-del-bg); box-shadow: inset 3px 0 0 var(--diff-status-del); }

.git-commit-files { flex: 1; min-height: 0; overflow-y: auto; }
.git-commit-file { border-bottom: 1px solid var(--border); }
.git-commit-file-head {
  display: flex; align-items: center; gap: 6px; padding: 6px 10px;
  background: var(--row-hover);
}
.git-commit-file-path {
  flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px;
}
.git-commit-file-count { flex: 0 0 auto; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.diff-count-add { color: var(--diff-status-add); }
.diff-count-del { color: var(--diff-status-del); margin-left: 4px; }
.git-commit-file .git-diff-editor { max-height: 50vh; overflow: hidden; }
.git-commit-binary { padding: 10px; color: var(--muted); font-size: 13px; }
```

- [ ] **Step 3: 验证**

Run: `npm run typecheck` → 0 错误；`npm run build` → 成功。

- [ ] **Step 4: 提交**

```bash
git add web/src/i18n.ts web/src/styles.css
git commit -m "feat(diff): 行内 diff 样式（双 gutter/红绿/CSS 变量）+ git.binary i18n"
```

---

## Phase 2 — 历史图

### Task 6: 服务端 log() 图数据（topo + parents + limit 1000）

**Files:**
- Modify: `server/git.ts`（`GitCommit.parents`、`COMMIT_FORMAT %P`、`--topo-order`、limit 上限 1000）
- Modify: `server/git.test.ts`（`101→1001`；parents/topo/limit 测试）
- Modify: `server/routes/git.test.ts`（`?limit=999→1001`）
- Modify: `web/src/api.ts:66`（`GitCommit` 增 `parents`）

**Interfaces:**
- Consumes: `Git.log(branch: string | null, limit: number, skip: number): Promise<GitLog>` 现有签名不变。
- Produces:

```ts
export type GitCommit = { hash: string; shortHash: string; subject: string; author: string; time: number; decorations: string; parents: string[] };
```

`log()` 输出 **topo 序**（子先父后，`--graph` 同款）、`parents` 按 %P 空格拆、limit 上限 1000。普通 log 的 skip 翻页语义保留（图一次拉 1000 不翻页）。

**依赖测试改动（语义变更的必然结果，非回归）：** `server/git.test.ts:164` `git.log(null, 101, 0)` → `1001`；`server/routes/git.test.ts:104` `?limit=999` → `1001`。`1.5`/`-1` 仍 400。

- [ ] **Step 1: 写失败测试** — `server/git.test.ts` 追加（并改既有 limit 断言）：

```ts
test('log：parents 解析（线性单父 / merge 双父 / 根空数组）+ topo 序', async () => {
  await gitCmd(['checkout', '-qb', 'dev']);
  await writeFile(path.join(repoDir, 'dev.txt'), 'dev\n');
  await gitCmd(['add', '.']);
  await gitCmd(['commit', '-qm', 'dev work']);
  await gitCmd(['checkout', 'main']);
  await writeFile(path.join(repoDir, 'main.txt'), 'main\n');
  await gitCmd(['add', '.']);
  await gitCmd(['commit', '-qm', 'main work']);
  await gitCmd(['merge', '--no-ff', '-m', 'merge dev', 'dev']);
  const log = await git.log(null, 50, 0);
  const bySubject = Object.fromEntries(log.commits.map((c) => [c.subject, c]));
  assert.equal(bySubject['merge dev'].parents.length, 2);   // merge：双父
  assert.equal(bySubject['main work'].parents.length, 1);   // 线性：单父
  assert.equal(bySubject['dev work'].parents.length, 1);
  assert.deepEqual(bySubject['init'].parents, []);          // 根：空数组
  const subjects = log.commits.map((c) => c.subject);
  assert.ok(subjects.indexOf('merge dev') < subjects.indexOf('main work')); // topo：子先父后
  assert.ok(subjects.indexOf('merge dev') < subjects.indexOf('dev work'));
  assert.ok(subjects.indexOf('main work') < subjects.indexOf('init'));
});

test('log：limit 上限放宽到 1000（1001 越界 → 400）', async () => {
  await assert.rejects(() => git.log(null, 1001, 0), (e: unknown) => (e as HttpError).status === 400);
  const ok = await git.log(null, 1000, 0);
  assert.equal(ok.isRepo, true);
  assert.equal(ok.commits.length, 1); // 当前仓库只有 init
});
```

同时改既有用例（第 163-167 行）：`await assert.rejects(() => git.log(null, 101, 0), ...)` 的 **`101` → `1001`**。并改 `server/routes/git.test.ts:104`：`?limit=999` → `?limit=1001`。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --experimental-transform-types --test server/git.test.ts server/routes/git.test.ts`
Expected: parents/topo 用例 FAIL（`bySubject['merge dev'].parents` 为 `undefined`——服务端还没输出 `%P`）；`git.log(null, 1001, 0)` 因 400 断言失败（当前上限 100 就拒绝）；`?limit=1001` 同样 400（红线）。

- [ ] **Step 3: 实现服务端** — `server/git.ts` 三处：

```ts
// 第 13 行：类型加 parents
export type GitCommit = { hash: string; shortHash: string; subject: string; author: string; time: number; decorations: string; parents: string[] };

// 第 20 行：COMMIT_FORMAT 追加 %P（父提交 hash 空格分隔，根提交空）
const COMMIT_FORMAT = '%H%x00%h%x00%s%x00%an%x00%at%x00%D%x00%P';

// parseCommitRecord（第 22-27 行）：解出 parents
function parseCommitRecord(line: string): GitCommit | null {
  const [hash, shortHash, subject, author, time, decorations, parents] = line.split('\0');
  if (!hash || !shortHash || !subject || !author || !time) return null;
  // %at 是 epoch 秒，前端按 Date.now()（epoch 毫秒）比较 → 统一转毫秒（1970 bug 修复约定）
  return {
    hash, shortHash, subject, author,
    time: Number(time) * 1000,
    decorations: decorations ?? '',
    parents: parents ? parents.split(' ').filter(Boolean) : [], // 根提交 %P 空 → []
  };
}
```

`log()`（第 156-179 行）两处：

```ts
// 第 157 行：limit 上限 100 → 1000
if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new HttpError(400, 'invalid limit');
// 第 167-169 行：加 --topo-order（子先父后，lane 布局前提；线性历史下与时间倒序一致）
const { stdout } = await this.execGit([
  'log', '--topo-order', ref, `--pretty=format:${COMMIT_FORMAT}`, `--skip=${skip}`, '-n', String(limit),
]);
```

- [ ] **Step 4: 前端类型同步** — `web/src/api.ts:66`：

```ts
export type GitCommit = { hash: string; shortHash: string; subject: string; author: string; time: number; decorations: string; parents: string[] };
```

- [ ] **Step 5: 跑测试确认通过 + 回归**

Run: `node --experimental-transform-types --test server/git.test.ts server/routes/git.test.ts` → 新用例 PASS；`npm test` → 全绿；`npm run typecheck` → 0 错误。

- [ ] **Step 6: 提交**

```bash
git add server/git.ts server/git.test.ts server/routes/git.test.ts web/src/api.ts
git commit -m "feat(git): log 输出 topo 序 + parents（%P）+ limit 上限 1000，api 类型同步"
```

---

### Task 7: 图布局纯函数（graph-model.ts）

**Files:**
- Create: `web/src/views/graph-model.ts`
- Create: `web/src/views/graph-model.test.ts`

**Interfaces:**
- Consumes: `GitCommit`（含 `parents: string[]`，Task 6）。
- Produces（Task 8 依赖）：

```ts
export type GraphSeg = { a: number; b: number };              // 段：行顶泳道 → 行底泳道（a===b 竖线，否则斜线）
export type GraphRow = { col: number; segs: GraphSeg[] };     // col = 提交点泳道
export function layoutGraph(commits: GitCommit[]): GraphRow[];  // 入参 = 服务端 topo 序
export function parseDecorations(dec: string): { branches: string[]; tags: string[] };  // %D → 徽标
```

**算法（spec §5.2）：** lane-tracing——每提交沿第一父延续泳道；后续父开新泳道；多个泳道线头指向同一提交时收拢（斜线汇入该提交所在列）。渲染端按 `col % 6` 上色。

- [ ] **Step 1: 写失败测试** — 创建 `web/src/views/graph-model.test.ts`（完整内容）：

```ts
// web/src/views/graph-model.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GitCommit } from '../api.ts';
import { layoutGraph, parseDecorations, type GraphRow } from './graph-model.ts';

const mk = (hash: string, parents: string[]): GitCommit =>
  ({ hash, shortHash: hash.slice(0, 7), subject: '', author: '', time: 0, decorations: '', parents });

test('layoutGraph：线性历史 → 单泳道竖线', () => {
  const r: GraphRow[] = layoutGraph([mk('c', ['b']), mk('b', ['a']), mk('a', [])]);
  assert.deepEqual(r, [
    { col: 0, segs: [{ a: 0, b: 0 }] },
    { col: 0, segs: [{ a: 0, b: 0 }] },
    { col: 0, segs: [] },
  ]);
});

test('layoutGraph：一岔一合（merge 双父 → 新泳道 → 收拢回主线）', () => {
  // topo 序：M(merge) → D1(dev tip) → P1(main) → B(分岔点) → A(根)
  const r = layoutGraph([
    mk('M', ['P1', 'D1']),
    mk('D1', ['B']),
    mk('P1', ['B']),
    mk('B', ['A']),
    mk('A', []),
  ]);
  assert.deepEqual(r, [
    { col: 0, segs: [{ a: 0, b: 0 }, { a: 0, b: 1 }] },   // 合并点：主线向下 + 开新泳道
    { col: 1, segs: [{ a: 0, b: 0 }, { a: 1, b: 1 }] },   // dev tip：主线贯穿 + 自身竖线
    { col: 0, segs: [{ a: 1, b: 1 }, { a: 0, b: 0 }] },   // main：dev 泳道贯穿 + 自身竖线
    { col: 0, segs: [{ a: 1, b: 0 }, { a: 0, b: 0 }] },   // 收拢：dev 泳道斜线汇入主线
    { col: 0, segs: [] },                                 // 根：无线段
  ]);
});

test('layoutGraph：合并提交父连回主线（合并点本身处于泳道 0）', () => {
  // topo 序：M → P1(main tip) → D1(dev tip) → B → A
  const r = layoutGraph([
    mk('M', ['P1', 'D1']),
    mk('P1', ['B']),
    mk('D1', ['B']),
    mk('B', ['A']),
    mk('A', []),
  ]);
  assert.deepEqual(r, [
    { col: 0, segs: [{ a: 0, b: 0 }, { a: 0, b: 1 }] },
    { col: 0, segs: [{ a: 1, b: 1 }, { a: 0, b: 0 }] },
    { col: 1, segs: [{ a: 0, b: 0 }, { a: 1, b: 1 }] },
    { col: 0, segs: [{ a: 1, b: 0 }, { a: 0, b: 0 }] },
    { col: 0, segs: [] },
  ]);
});

test('layoutGraph：双岔双合（dev 两次合并进主线）', () => {
  // topo 序：M2 → C2 → M1 → D2 → C1 → D1 → B → A
  const r = layoutGraph([
    mk('M2', ['C2', 'D2']),
    mk('C2', ['M1']),
    mk('M1', ['C1', 'D1']),
    mk('D2', ['D1']),
    mk('C1', ['B']),
    mk('D1', ['B']),
    mk('B', ['A']),
    mk('A', []),
  ]);
  assert.deepEqual(r, [
    { col: 0, segs: [{ a: 0, b: 0 }, { a: 0, b: 1 }] },   // M2：主线向下 + 开新泳道
    { col: 0, segs: [{ a: 1, b: 1 }, { a: 0, b: 0 }] },   // C2
    { col: 0, segs: [{ a: 1, b: 1 }, { a: 0, b: 0 }, { a: 0, b: 2 }] }, // M1：再开第二岔
    { col: 1, segs: [{ a: 0, b: 0 }, { a: 2, b: 2 }, { a: 1, b: 1 }] }, // D2
    { col: 0, segs: [{ a: 1, b: 1 }, { a: 2, b: 2 }, { a: 0, b: 0 }] }, // C1
    { col: 1, segs: [{ a: 0, b: 0 }, { a: 2, b: 1 }, { a: 1, b: 1 }] }, // D1：col2 收拢进 col1
    { col: 0, segs: [{ a: 1, b: 0 }, { a: 0, b: 0 }] },   // B：dev 泳道收拢回主线
    { col: 0, segs: [] },                                 // A：根
  ]);
});

test('layoutGraph：根提交无父 → 行内无竖线', () => {
  assert.deepEqual(layoutGraph([mk('a', [])]), [{ col: 0, segs: [] }]);
});

test('layoutGraph：空仓库 → 空数组', () => {
  assert.deepEqual(layoutGraph([]), []);
});

test('parseDecorations：HEAD 指针 / tag / 远端分支拆解', () => {
  assert.deepEqual(parseDecorations('HEAD -> main, origin/main, tag: v1.0'), {
    branches: ['main', 'origin/main'],
    tags: ['v1.0'],
  });
});

test('parseDecorations：空串 / 纯 HEAD / 纯 tag', () => {
  assert.deepEqual(parseDecorations(''), { branches: [], tags: [] });
  assert.deepEqual(parseDecorations('HEAD'), { branches: [], tags: [] });
  assert.deepEqual(parseDecorations('tag: v1, tag: v2'), { branches: [], tags: ['v1', 'v2'] });
});
```

- [ ] **Step 2: 跑测试确认失败** — `node --experimental-transform-types --test web/src/views/graph-model.test.ts`
  Expected: FAIL——`ERR_MODULE_NOT_FOUND`（`./graph-model.ts` 不存在）。

- [ ] **Step 3: 实现** — 创建 `web/src/views/graph-model.ts`（完整内容）：

```ts
// web/src/views/graph-model.ts
// 历史图纯函数：lane-tracing 布局 + %D 徽标解析。独立 .ts 模块 → node --test 直接导入可测。
// 渲染端按 col % 6 上色；徽标只保留分支名（tag 暂不做徽标，用户选定）。
import type { GitCommit } from '../api.ts';

/** 线段：行顶泳道 a → 行底泳道 b（a===b 竖线；否则斜线）。 */
export type GraphSeg = { a: number; b: number };
/** 一行：提交点所在泳道 col + 贯穿本行的线段。 */
export type GraphRow = { col: number; segs: GraphSeg[] };

/**
 * 按 topo 序（子先父后）提交列表 → 每行布局。lane-tracing：
 * - 每提交沿第一父延续泳道（本列线头 → 第一父）
 * - 合并提交的其余父 → 开新列
 * - 多个泳道线头指向同一提交 → 收拢（斜线汇入该提交所在列，后续父线结束）
 */
export function layoutGraph(commits: GitCommit[]): GraphRow[] {
  const rows: GraphRow[] = [];
  const cols: (string | null)[] = []; // cols[i] = 列 i 线头所指提交；null = 空闲
  const free: number[] = [];

  const alloc = (head: string): number => {
    const i = free.pop();
    if (i !== undefined) { cols[i] = head; return i; }
    cols.push(head);
    return cols.length - 1;
  };

  for (const c of commits) {
    let col = -1;
    for (let i = 0; i < cols.length; i++) if (cols[i] === c.hash) { col = i; break; }
    if (col === -1) col = alloc(c.hash);

    const segs: GraphSeg[] = [];
    for (let i = 0; i < cols.length; i++) {
      if (i === col || cols[i] === null) continue;
      if (cols[i] === c.hash) { // 收拢：该列线头是本提交 → 斜线汇入并结束该列
        segs.push({ a: i, b: col });
        cols[i] = null;
        free.push(i);
      } else { // 其他活跃列：竖线贯穿
        segs.push({ a: i, b: i });
      }
    }
    if (c.parents.length > 0) segs.push({ a: col, b: col }); // 本列向下延续

    cols[col] = c.parents[0] ?? null; // 本列 → 第一父
    if (cols[col] === null) free.push(col);
    for (let p = 1; p < c.parents.length; p++) {
      const ph = c.parents[p];
      let target = -1;
      for (let i = 0; i < cols.length; i++) if (cols[i] === ph) { target = i; break; }
      if (target === -1) target = alloc(ph);
      if (target !== col) segs.push({ a: col, b: target }); // 本行补斜线：本列 → 新父列
    }

    rows.push({ col, segs });
  }
  return rows;
}

/** %D 装饰拆解：去 HEAD 指针；分支名保留（tag 单独解析，界面暂不做徽标）。 */
export function parseDecorations(dec: string): { branches: string[]; tags: string[] } {
  const branches: string[] = [];
  const tags: string[] = [];
  if (!dec) return { branches, tags };
  for (const raw of dec.split(',')) {
    const part = raw.trim();
    if (!part || part === 'HEAD') continue;
    if (part.startsWith('HEAD -> ')) { branches.push(part.slice('HEAD -> '.length)); continue; }
    if (part.startsWith('tag: ')) { tags.push(part.slice('tag: '.length)); continue; }
    branches.push(part);
  }
  return { branches, tags };
}
```

- [ ] **Step 4: 跑测试确认通过** — `node --experimental-transform-types --test web/src/views/graph-model.test.ts`
  Expected: 全部 PASS（9 个）。

- [ ] **Step 5: 提交**

```bash
git add web/src/views/graph-model.ts web/src/views/graph-model.test.ts
git commit -m "feat(graph): layoutGraph/parseDecorations 纯函数 + 单测"
```

---

### Task 8: HistoryView 图改造 + i18n + 样式

**Files:**
- Modify: `web/src/views/history.tsx`（整体重写）
- Modify: `web/src/views/history-model.ts`（删 `logParams`，保留 `formatCommitTime`/`commitTimeLabel`）
- Modify: `web/src/views/history-model.test.ts`（删 logParams 测试，保留 formatCommitTime 测试）
- Modify: `web/src/i18n.ts`（加 `git.graphTruncated`、删 `git.loadMore`）
- Modify: `web/src/styles.css`（泳道配色/徽标/行 flex/截断提示）

**Interfaces:**
- Consumes: `layoutGraph`/`parseDecorations`/`GraphRow`（Task 7）、`GitCommit.parents`/`decorations`（Task 6）、`api.git.log`、`commitTimeLabel`（既有）、`gitRefreshTick`/`openGitCommit`（stores.ts 既有）。
- Produces: 图成为历史视图本身（spec §5.3）——每行 = 图形列 + 提交信息 + 分支徽标，整行点击区 → `openGitCommit`；移除加载更多/skip；超 1000 截断提示。

- [ ] **Step 1: 删 logParams（纯函数 + 测试）** — `web/src/views/history-model.ts` 删第 27-36 行 `logParams` 函数（保留 `formatCommitTime`/`commitTimeLabel`）；`web/src/views/history-model.test.ts` 删第 17-22 行 logParams 测试（保留 formatCommitTime 测试）。

- [ ] **Step 2: i18n** — `web/src/i18n.ts`：删 en `'git.loadMore': 'Load more',` 与 zh `'git.loadMore': '加载更多',`；en/zh git 键块各加：

```ts
// en
'git.graphTruncated': 'Showing first 1000 commits',
// zh
'git.graphTruncated': '已显示前 1000 条提交',
```

- [ ] **Step 3: 重写 HistoryView** — `web/src/views/history.tsx`（完整内容）：

```tsx
// web/src/views/history.tsx
// 历史视图（图）：分支选择器 + 提交图（泳道岔线/合并菱形）+ 分支徽标。
// 图取代扁平列表（spec §5.3）：log 一次拉 1000 条 topo 序 → layoutGraph 逐行渲染。
// 每行整条是点击区 → openGitCommit(shortHash)；超 1000 截断提示。
import { createEffect, createSignal, Show, For, onCleanup } from 'solid-js';
import { api, type GitBranches, type GitCommit } from '../api.ts';
import { gitRefreshTick, openGitCommit } from '../stores.ts';
import { commitTimeLabel } from './history-model.ts';
import { layoutGraph, parseDecorations, type GraphRow } from './graph-model.ts';
import { t } from '../i18n.ts';

const LIMIT = 1000;  // 图一次拉全（lane 不可跨页）
const LANE_W = 16;   // 每泳道宽
const ROW_H = 20;    // 每行 SVG 高

export function HistoryView() {
  const [branches, setBranches] = createSignal<GitBranches | null>(null);
  const [branch, setBranch] = createSignal<string | null>(null);
  const [commits, setCommits] = createSignal<GitCommit[]>([]);
  const [rows, setRows] = createSignal<GraphRow[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  // 分支列表 + 默认选中当前分支（gitRefreshTick 变化 → 刷新）
  createEffect(() => {
    gitRefreshTick();
    void (async () => {
      try {
        const b = await api.git.branches();
        setBranches(b);
        if (b.current && !b.branches.some((x) => x.name === branch())) setBranch(b.current);
      } catch { /* 静默，错误条由 log effect 承担 */ }
    })();
  });

  // 首屏 / 切分支 / 刷新：拉 1000 条 → layoutGraph（cancelled 竞态守卫沿用）
  createEffect(() => {
    const b = branch();
    gitRefreshTick();
    setLoading(true);
    setCommits([]);
    setRows([]);
    let cancelled = false;
    void (async () => {
      try {
        if (branches()?.isRepo === false) {
          setError(null);
          return;
        }
        const res = await api.git.log({ branch: b ?? undefined, limit: LIMIT, skip: 0 });
        if (cancelled) return;
        setCommits(res.commits);
        setRows(layoutGraph(res.commits));
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    onCleanup(() => { cancelled = true; });
  });

  return (
    <div class="history-view">
      <div class="history-bar">
        <select
          class="history-select"
          value={branch() ?? ''}
          onInput={(e) => setBranch(e.currentTarget.value || null)}
          disabled={!branches()?.isRepo}
        >
          <For each={branches()?.branches ?? []}>
            {(b) => <option value={b.name}>{b.name}</option>}
          </For>
        </select>
      </div>
      <Show when={error()}>
        <div class="error-banner">{error()}</div>
      </Show>
      <Show when={!loading() && !branches()?.isRepo}>
        <div class="view-placeholder">{t('git.notRepo')}</div>
      </Show>
      <Show when={!loading() && branches()?.isRepo && commits().length === 0}>
        <div class="view-placeholder">{t('git.emptyHistory')}</div>
      </Show>
      <Show when={loading()}>
        <div class="view-placeholder">{t('loading')}</div>
      </Show>
      <Show when={commits().length >= LIMIT}>
        <div class="history-truncated">{t('git.graphTruncated')}</div>
      </Show>
      <ul class="history-list">
        <For each={rows()}>
          {(row, i) => {
            const c = commits()[i]; // rows 与 commits 并行（layoutGraph 一行一提交）
            const { branches: decs } = parseDecorations(c.decorations);
            const laneCount = Math.max(row.col, ...row.segs.map((s) => Math.max(s.a, s.b))) + 1;
            return (
              <li>
                <button class="history-row" onClick={() => openGitCommit(c.shortHash)}>
                  <span class="history-graph">
                    <svg width={laneCount * LANE_W} height={ROW_H} class="graph-svg">
                      {row.segs.map((s) => (
                        <line
                          x1={(s.a + 0.5) * LANE_W} y1={0}
                          x2={(s.b + 0.5) * LANE_W} y2={ROW_H}
                          class={`graph-line lane-${s.a % 6}`}
                        />
                      ))}
                      {c.parents.length > 1 ? (
                        // 合并提交：实心菱形 + 双入线
                        <path
                          d={`M ${(row.col + 0.5) * LANE_W} ${ROW_H / 2 - 4}
                              L ${(row.col + 0.5) * LANE_W + 4} ${ROW_H / 2}
                              L ${(row.col + 0.5) * LANE_W} ${ROW_H / 2 + 4}
                              L ${(row.col + 0.5) * LANE_W - 4} ${ROW_H / 2} Z`}
                          class={`graph-dot lane-${row.col % 6}`}
                        />
                      ) : (
                        <circle cx={(row.col + 0.5) * LANE_W} cy={ROW_H / 2} r={3.5} class={`graph-dot lane-${row.col % 6}`} />
                      )}
                    </svg>
                  </span>
                  <span class="history-main">
                    <span class="history-subject">{c.subject}</span>
                    <span class="history-meta">{c.author} · {commitTimeLabel(c)}</span>
                  </span>
                  <span class="history-badges">
                    <For each={decs}>{(d) => <span class="git-branch-badge">{d}</span>}</For>
                  </span>
                </button>
              </li>
            );
          }}
        </For>
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: 样式** — `web/src/styles.css` 末尾追加（`.lane-N` 必须在 `.graph-line`/`.graph-dot` 之后，覆盖底色；`.history-row` 改 flex）：

```css
/* 历史图（2026-08-10）：泳道配色 + 徽标 + 行布局 + 截断提示 */
:root {
  --graph-lane-0: #3b82f6; --graph-lane-1: #16a34a; --graph-lane-2: #d97706;
  --graph-lane-3: #7c3aed; --graph-lane-4: #dc2626; --graph-lane-5: #0891b2;
}
:root[data-theme='dark'] {
  --graph-lane-0: #60a5fa; --graph-lane-1: #4ade80; --graph-lane-2: #fbbf24;
  --graph-lane-3: #a78bfa; --graph-lane-4: #f87171; --graph-lane-5: #22d3ee;
}
.history-row { display: flex; align-items: center; gap: 6px; }
.history-graph { flex: 0 0 auto; display: flex; }
.graph-svg { display: block; }
.graph-line { stroke: var(--graph-lane-0); stroke-width: 2; fill: none; }
.graph-dot { fill: var(--graph-lane-0); }
.lane-0 { stroke: var(--graph-lane-0); fill: var(--graph-lane-0); }
.lane-1 { stroke: var(--graph-lane-1); fill: var(--graph-lane-1); }
.lane-2 { stroke: var(--graph-lane-2); fill: var(--graph-lane-2); }
.lane-3 { stroke: var(--graph-lane-3); fill: var(--graph-lane-3); }
.lane-4 { stroke: var(--graph-lane-4); fill: var(--graph-lane-4); }
.lane-5 { stroke: var(--graph-lane-5); fill: var(--graph-lane-5); }
.history-main { flex: 1; min-width: 0; }
.history-badges { flex: 0 0 auto; display: flex; gap: 4px; }
.git-branch-badge {
  padding: 1px 6px; border-radius: 4px;
  background: var(--accent); color: #fff; font-size: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.history-truncated { padding: 6px 10px; color: var(--muted); font-size: 12px; }
```

- [ ] **Step 5: 验证（typecheck + build + 回归）**

Run: `npm run typecheck` → 0 错误；`npm run build` → 成功；`npm test` → 全绿（历史图相关 `.ts` 模块测试均过）。

- [ ] **Step 6: 提交**

```bash
git add web/src/views/history.tsx web/src/views/history-model.ts web/src/views/history-model.test.ts web/src/i18n.ts web/src/styles.css
git commit -m "feat(graph): 历史视图改提交图（泳道/合并菱形/分支徽标/截断提示），删加载更多"
```

---

### Task 9: 全量验证

**Files:**
- 无代码改动（验证任务）。

- [ ] **Step 1: 测试全绿**

Run: `npm test` → 全绿。计数：此前 183 + 新增（Task 1:1、Task 2:9、Task 6:2、Task 7:9 = +21）− 删除（`diff.test.ts` 1 个 + `logParams` 测试 1 个 = −2）→ 约 202 pass。任何失败即停下修。

- [ ] **Step 2: typecheck + build**

Run: `npm run typecheck` → 0 错误；`npm run build` → 成功（仅既有 >500kB chunk 警告可忽略）。

- [ ] **Step 3: 手动冒烟（真机，用户环境）** — 启动 `server/cli.ts`（按既有 smoke 方式，用精确 PID 管理进程、不碰 port 3000），在浏览器核验：

- [ ] 普通提交 commit 视图：多文件堆叠 + 每文件红绿块 + 状态栏（+/−/空）+ 新文件行号
- [ ] 合并提交 commit 视图：显示主线改动（`--first-parent`），非 `diff --cc`
- [ ] 二进制文件：标题行 + 「二进制文件」占位，无编辑器
- [ ] GitDiffView（工作区 diff）：单文件行内渲染 + ✎ 打开编辑器
- [ ] 大 diff：滚动流畅（视口按需渲染）
- [ ] 历史视图：分支选择器 + 泳道图（一岔一合/多岔多合正确、合并菱形 + 双入线）
- [ ] 分支徽标：有分支指向的提交显示分支名；HEAD 指针不显示
- [ ] 点提交行 → 开 commit 标签；切分支 → 图刷新；🔄 → 图刷新
- [ ] 深/浅主题切换：红绿背景、泳道色随主题
- [ ] 仓库 > 1000 提交（可选）→ 底部截断提示

- [ ] **Step 4: 汇总验证报告** — 若全绿，按项目 ledger 惯例（`.superpowers/sdd/2026-08-10-inline-diff-graph/progress.md`）记录任务清单 + 验证结论；无需再提交代码。

---

## Self-Review（执行计划前已自查）

- **Spec 覆盖**：§4.1 show() 首父（T1）；§4.2 解析/内联文档（T2）；§4.3 行内编辑器（T3）；§4.4 提交视图堆叠 + git-diff 行内（T4）；§4.5 测试（T1/T2/T9）；§5.1 log 增强 + 依赖测试改动（T6）；§5.2 图布局纯函数（T7）；§5.3 HistoryView 改造（T8）；§5.4 测试（T6/T7/T9）；§6 边界（合并提交 T1、二进制/空 diff T4、根提交/空仓库 T7、截断 T8、并发守卫 T4/T8）；§7 i18n（T5/T8）。
- **类型一致性**：`parseUnifiedDiff` 的 `DiffFile`（T2）＝ `createInlineDiffEditor` 参数（T3）；`buildInlineDoc` 的 `{doc, kinds, numbers}` 对齐 T3 双 gutter；`GitCommit.parents` 自服务端（T6）→ api.ts（T6）→ graph-model（T7）→ history.tsx（T8）贯通。
- **占位符**：全部步骤含完整代码/命令，无 TBD/TODO。
