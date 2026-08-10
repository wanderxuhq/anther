# 行内 diff + 历史图 设计文档

日期：2026-08-10
状态：已与用户逐节确认（含修订：历史图取代扁平列表，无 graph 参数）

## 1. 概述

在 git 功能（status/diff/commit + 历史/分支，HEAD b1ed394）之上，实现用户的两个诉求：

1. **行内 diff**（Phase 1，先做）：diff 在编辑器层面体现修改——去掉 `@@ ++ --` 纯文本样式，改为**行级红绿着色 + 状态标记 + 新文件行号**（VSCode 内联 diff 形态）。提交视图多文件按 GitHub PR「code changes」样式**堆叠展示**（每文件一个卡片：路径 + `+N −M` + 行内 diff）。
2. **历史图**（Phase 2）：VSCode 式历史视图——分支岔线/合并记录以**图**呈现，某个提交若被分支指向则**显示分支名徽标**。

用户修订：**图取代现有的扁平列表成为历史视图本身**（图信息量严格 ⊇ 列表，不做列表/图切换，无 `graph=1` 参数）。`log` 接口直接返回图所需数据。

另：会话早期已修复用户报告的「历史时间全 1970」bug（`server/git.ts` `%at` 秒→毫秒，commit b1ed394，回归测试已加），本 spec 不再重复，但相关字段说明含该约定。

## 2. 设计原则（延续历史/分支 spec）

- **git 只在服务端跑**，真实 git CLI 兜底（`execFile` 数组参数，白名单校验）
- **零新增下载依赖**：inline-diff 所需的 CM6 模块（`@codemirror/view`、`@codemirror/commands`）已由 `codemirror` 传递安装（纯 JS、无 node-gyp），本 spec 仅在 `package.json` 补**直接依赖声明**（lockfile 不变、无新包下载）；历史图纯手写 SVG，不引任何库
- **纯函数独立可测**：diff 解析/内联文档构建、图布局/徽标解析全部抽 `.ts` 模块（node --test 可导入）
- **复用现有基础设施**：`createEditor` 适配层的只读门控/搜索/主题/字号缩放思路沿用；标签模型/stores/视图生命周期模式复用
- **移动优先，无浮层**；i18n 走 `web/src/i18n.ts` en/zh

## 3. 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| 合并提交 diff | `git show <commit> --format= --first-parent` | 默认 combined diff（`diff --cc`/`@@@`/双字符状态）无法清晰转行内红绿；`--first-parent` 输出标准 unified diff（「相对主线改了啥」），GitHub/VSCode 主流语义。普通提交不受影响（行为变化已与用户确认） |
| diff 解析 | 前端纯函数 `parseUnifiedDiff` | 按 `^diff --git` 拆多文件；hunk 内「ctx→del→add」子块分组；丢弃 `\ No newline at end of file`；二进制无 hunks 识别 |
| 行内渲染 | 专用 `createInlineDiffEditor`（CM6 自组扩展，不走 basicSetup） | 需要**替换**默认行号为自定义双 gutter（状态栏 + 新文件行号），行级 `Decoration.line` 红绿背景；basicSetup 的默认行号不可控 |
| 行号模型 | 单行号（新文件）+ `+`/`−`/空格状态栏 | 用户选定：简洁可靠，不做 VSCode 双行号（复杂度 2-3 倍） |
| 历史数据 | `log()` 增强：`--topo-order` + `%P` parents + limit 上限 1000 | 图取代列表 → 一次拉全 topo 序供 lane 布局；翻页会在页边界断线，故不再分页 |
| 图布局 | 前端纯函数 `layoutGraph`（lane-tracing）+ 每行微型 SVG | 与 Git Graph/VSCode 同思路：渲染可控、可单测；不解析服务端 ASCII `--graph`（脆弱、不可着色、分页断线） |
| 分支徽标 | `%D` → `parseDecorations` 纯函数 | 去 `HEAD -> `/`tag:`/`HEAD`，只留分支名（用户选定：tag 暂不做徽标） |
| 新依赖 | 声明 `@codemirror/view`、`@codemirror/commands`（已装） | 直接 import 需声明；无新包下载、无 node-gyp |

## 4. Phase 1 — 行内 diff

### 4.1 服务端（唯一改动）

`server/git.ts` `show()`：
```
git show <commit> --format= --first-parent
```
合并提交输出从 combined diff 变标准 unified diff（相对第一父）。普通提交/根提交输出不变。`show()` 的 meta 解析与 `log()` 共用 `COMMIT_FORMAT`，Phase 2 该格式追加 `%P` 后 `GitCommit` 增 `parents` 字段，两处类型同步。

### 4.2 diff 解析与内联文档（纯函数）

**`web/src/views/diff-model.ts`**：

```ts
type DiffLine = { kind: 'ctx' | 'del' | 'add'; text: string };   // text = 去 `-`/`+`/空格 前缀后的原始内容
type DiffHunk = { oldStart: number; newStart: number; lines: DiffLine[] };
type DiffFile = {
  path: string;                            // 显示路径（b/ 侧；删除文件取 a/ 侧）
  status: 'added' | 'deleted' | 'modified' | 'renamed' | 'binary';
  oldPath?: string;                        // rename 时显示 a → b
  addCount: number; delCount: number;      // 文件头 `+N −M` 用
  hunks: DiffHunk[];                       // binary → []
};
function parseUnifiedDiff(text: string): DiffFile[];
function buildInlineDoc(file: DiffFile): { doc: string; kinds: DiffLine['kind'][]; numbers: (number | null)[] };
```

关键行为：
- 按 `^diff --git` 拆多文件（commit 视图一个 `show()` 请求 → 每文件一节，GitHub 式堆叠的前提）
- hunk 内 `-a,+b,-c,+d` 交替时按「ctx → del 块 → add 块」逐段排（VSCode 同款），不合并成全部删再全部增
- `\ No newline at end of file` 标记行丢弃（VSCode 亦忽略）
- 二进制文件：无 hunks，`binary: true`，界面显示「二进制文件」占位
- `buildInlineDoc`：正文**不带 diff 前缀**（前缀只在状态栏 + 颜色体现），返回每行 kind 与新文件行号（ctx/add = 新编号自增，del = null）；同一 `doc`/`kinds`/`numbers` 对齐数组，供装饰与行号一次性构建

### 4.3 行内编辑器（`web/src/editor/inline-diff.ts`）

```
createInlineDiffEditor(container, file: DiffFile): DiffHandle   // 复用 EditorHandle 接口
```

- 自组 CM6 扩展（**不走 createEditor/basicSetup**，需替换默认行号）：
  - 只读：`EditorState.readOnly.of(true)` + `EditorView.editable.of(false)`（对齐 index.ts 双 facet 门控）
  - 编辑无关能力：`highlightSpecialChars`、`drawSelection`、`dropCursor`、`defaultKeymap` + `searchKeymap` + `search` + `history`（只读下 history 无副作用）
  - **双 gutter**（替代默认 `lineNumbers()`）：
    - 最左状态栏（~1ch）：`+`（add，绿）/ `−`（del，红）/ 空（ctx）
    - 行号栏：ctx/add 显示**新文件行号**，del 空
  - **行级装饰**：静态 `Decoration.line({ class: 'diff-del' | 'diff-add' })` RangeSet → 整行背景红/绿（CSS 变量，浅/深主题跟随）。只读静态文档，装饰一次构建，无增量更新
- 保留优点：视口按需渲染（大 diff 虚拟滚动）、搜索、主题/字号缩放（经 CSS 变量跟随全局）
- 空 diff（无 hunks 但非 binary）→ 空编辑器 + 无状态栏

### 4.4 视图改造

**CommitView（`web/src/views/commit.tsx`）** — 从「单个整 diff 编辑器」改 GitHub PR 式多文件堆叠：

```
a1b2c3 · wanderxuhq · 3 天前 · 修复 x      ← 元信息头（保留）
──────────────────────────────
▸ src/a.ts            +12 −4              ← 文件卡：路径（rename 显示 a→b）+ 增减计数
  ┌─ 行内 diff 编辑器（红绿块 + 状态栏 + 行号）┐
▸ src/b.ts            +1  −1
  └─ ...┘
▸ package.json        +3  −3
  └─ ...┘
```

- effect 生命周期沿用现有模式：`props.commit` 变化 → cancelled 守卫 + 每文件 handle 数组，onCleanup 逐个 destroy
- 二进制文件 → 标题行 + 「二进制文件」占位（无编辑器）

**GitDiffView（`web/src/views/git-diff.tsx`）** — 同一渲染器：`api.git.diff(path)` → parse → 内联渲染，头部「路径 + ✎ 打开编辑器」保留。两处 diff 视图统一走 inline。

### 4.5 Phase 1 测试

| 层 | 内容 |
|---|---|
| `web/src/views/diff-model.test.ts`（新增） | 多文件拆分 / hunk 子块分组（删删增增交替）/ 行号（del 为 null）/ 增减计数 / rename oldPath / 二进制识别 / `\ No newline` 丢弃 / 空 diff |
| `server/git.test.ts`（追加） | 合并提交 `show()` 输出含 `--first-parent` 语义（构造 merge 后断言输出为 `diff --git` 而非 `diff --cc`） |
| 手动（真机） | 普通提交红绿块、合并提交显示为主线改动、commit 视图多文件堆叠、二进制占位、大 diff 滚动流畅 |

## 5. Phase 2 — 历史图

### 5.1 服务端：`log()` 增强（无参数开关）

```
git log <branch|HEAD> --topo-order --pretty=format:%H%x00%h%x00%s%x00%an%x00%at%x00%D%x00%P --skip=<skip> -n <limit>
```

- `COMMIT_FORMAT` 追加 `%P`（父提交 hash 空格分隔，根提交空）→ `GitCommit` 增 `parents: string[]`
- **`--topo-order`**：子在前父在后（`git log --graph` 同款），lane 布局的前提；线性历史下与时间倒序一致
- **`limit` 上限放宽 100 → 1000**（普通 log 的 skip 翻页语义保留，前端图一次拉 1000）
- 不新增 `graph` 参数：图取代列表后，log 的默认语义即图所需数据

**依赖测试改动**（语义变更的必然结果，非回归）：
- `server/git.test.ts` `log：limit 越界`：`101`（现已合法）→ `1001`；`1.5`/`-1` 仍 400
- `server/routes/git.test.ts` `?limit=999` → `?limit=1001`（999 现已合法）
- 新增断言：`parents` 解析（线性提交单父、merge 提交双父、根提交空数组）

### 5.2 图布局纯函数（`web/src/views/graph-model.ts`）

```ts
type GraphSeg = { a: number; b: number };              // 段：行顶泳道 → 行底泳道（a===b 竖线，否则斜线）
type GraphRow = { col: number; segs: GraphSeg[] };     // col = 提交点泳道
function layoutGraph(commits: GitCommit[]): GraphRow[];  // 入参 = 服务端 topo 序
function parseDecorations(dec: string): { branches: string[]; tags: string[] };  // %D → 徽标
```

- **lane-tracing**：按 topo 序自上而下，每提交沿第一父延续泳道；后续父（合并岔线）开新泳道；合并提交处多条入线汇于一点。泳道 → hash 映射决定合并收拢
- 输出每行「提交点泳道列 + 若干线段（竖/斜）」→ 渲染端按列上色（`col % 6`）
- 单测钉死：线性 / 一岔一合 / 双岔双合 / 合并提交父连回主线 / 根提交无父 / 空仓库

### 5.3 HistoryView 改造（`web/src/views/history.tsx`）

**图成为历史视图本身**，扁平列表 + 加载更多移除：

```
┌──────────────────────────────────────┐
│ [main ▾]                      (loading)│ ← 分支选择器保留
├──────────────────────────────────────┤
│ ◯   a1b2c3  feat: 加搜索     [main]    │ ← 图形列 + 短hash + subject + 分支徽标
│ │   d4e5f6  修复 x                     │
│ │   ◆  g7h8i9  合并 dev               │ ← 合并提交：菱形点 + 双入线
│ ╲╱  j1k2l3  dev 上的改动     [dev]    │ ← 岔线收拢
└──────────────────────────────────────┘
```

- 数据：`[branch, gitRefreshTick]` effect → `api.git.log({ branch, limit: 1000 })` → `layoutGraph` → 逐行渲染
- **每行 = flex 行**：左侧固定宽 SVG 单元格（`M..L..` path 线段 + 圆点/菱形点），右侧 commit 信息。行整条是点击区 → `openGitCommit`（保留现有行为）
- 泳道配色 CSS 变量 `--graph-lane-0..5`（浅/深主题各自定义），`col % 6` 循环
- 合并提交：实心菱形 + 双入线（「分支合并记录」核心诉求）
- 分支徽标：`parseDecorations` 有分支指向 → `<badge>` 渲染（tag 不做徽标，用户选定）
- 保留：分支选择器 / loading / notRepo 空态 / 错误条 / 点行开提交标签。移除：加载更多、skip 状态
- 超 1000 截断 → 底部提示「已显示前 1000 条提交」

### 5.4 Phase 2 测试

| 层 | 内容 |
|---|---|
| `server/git.test.ts`（追加/调整） | merge `parents.length===2`；topo 序（构造交叉 merge 断言子先于父）；limit 1000 边界；见 §5.1 依赖改动 |
| `web/src/views/graph-model.test.ts`（新增） | `layoutGraph` 各拓扑布局断言；`parseDecorations`（`HEAD -> main, tag: v1, origin/main` 拆解；空串） |
| 手动（真机） | 一岔一合 / 多岔多合图正确、分支徽标显示、点行开提交、截断提示 |

## 6. 错误处理 / 边界

| 场景 | 行为 |
|---|---|
| 非仓库 / git 缺失 | log 返回 `isRepo:false` → 历史视图空态（既有逻辑不变） |
| `show()`/`log()` 请求失败 | 错误条 + 保持上次状态（既有模式） |
| 历史 > 1000 条 | 顶部条提示「已显示前 1000 条提交」（不继续翻页，lane 不可跨页） |
| 合并提交 diff | `--first-parent` → 标准 unified diff（Phase 1 已处理） |
| 二进制文件 | 标题行 + 「二进制文件」占位，无编辑器 |
| 空 diff（如空提交） | 空编辑器 + 无状态栏 |
| `%P` 根提交 | parents 空数组 → 图形列无线段、仅一个点 |
| 并发 | 视图 effect cancelled 守卫沿用；切换分支竞态沿用历史 spec 的 `branch()` 捕获守卫 |

## 7. i18n 新键（en/zh）

| key | en | zh |
|---|---|---|
| `git.binary` | Binary file | 二进制文件 |
| `git.graphTruncated` | Showing first 1000 commits | 已显示前 1000 条提交 |

## 8. 后续（本次不做）

- 行内 diff 的双行号（VSCode 精确复刻，old/new 双列）——用户选定单行号方案
- tag 徽标、远端分支（`origin/*`）着色
- 图上的「提交点展开文件树 / 查看提交当时文件内容」
- diff 内单词级高亮（VSCode 的增删词着色）
- 历史图深色/浅色切换独立于全局主题
