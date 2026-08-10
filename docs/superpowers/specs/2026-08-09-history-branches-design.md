# 历史 + 分支功能设计文档

日期：2026-08-09
状态：已与用户逐节确认

## 1. 概述

在 git MVP（status/diff/commit，commit 18b619e..515237d）之上，实现 roadmap §7 的**历史日志**与**分支管理**：

- **历史日志**：commit log（顶部可切换查看某分支的历史），点一次提交 → 打开 git-commit 标签，显示该次提交的 diff（复用只读 CodeMirror）。**不做「点进提交看当时整个文件树」**——用户已确认提交 diff 即可。
- **分支管理**：列出本地分支 / 切换 / 新建（roadmap §7 全文；不做删除/重命名）。
- **工具栏上下文化**（用户明确要求）：git 相关标签（git 面板 / 历史 / 分支 / 提交）激活时，顶部工具栏从「☰ + 🔍 + 路径 + ✎」切换为「☰ + ⑂分支名 + 历史入口 + 刷新 + ➕新建分支」，隐藏 🔍 与 ✎。文件/终端标签维持现状。
- **切换保护**（用户明确规则）：切换分支前先把所有编辑器改为只读并保存；只读模式的文件不再自动保存。

## 2. 设计原则（与 git spec / 主 spec 一致）

- **git 只在服务端跑**：浏览器看不到 git，所有操作经服务端 API
- **服务端真实 git CLI 兜底**：execFile 数组参数不走 shell；分支名/commit 引用一律服务端白名单校验（见 §4.3），不信任前端
- **复用现有基础设施**：git-diff 的只读 CodeMirror（createDiffEditor + legacy-modes diff 高亮）；tab 单例/去重模式；Toast 降级；dialog 组件（分支切换确认、新建分支输入复用文件管理的 dialog-backdrop/dialog-card）
- **移动优先，无浮层**：VS Code 用 command palette / quick picker（桌面 overlay 交互），手机上没有等价物——分支列表/历史全部展开为完整视图，触控友好
- **零新增依赖**：全部复用现有模块与 CSS 变量

## 3. 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| git 执行 | 复用 `server/git.ts` 的 `execGit` / `resolveInRoot` | 既有模式，新增命令同构 |
| commit 元信息解析 | `git log --pretty=format:<%x00 分隔>` | %x00 作字段分隔符，换行作记录分隔；%s 不含换行，字段无歧义 |
| 分支列表 | `git for-each-ref` | `%(HEAD)` 标记当前分支，`%(objectname:short)` 直接给 tip 短 hash |
| 提交 diff | `git show <commit> --format=` | 单条命令给 patch 正文（含合并提交默认合并 diff 语义）；元信息另用 `git log -1` |
| 分支名校验 | `git check-ref-format --branch` | git 原生校验，不用手写 ref 规则 |
| diff 渲染 | 复用 `createDiffEditor` | 与 git-diff 标签同一套，白赚虚拟滚动/主题/字号/搜索 |
| 新依赖 | 无 | 所有能力已有 |

## 4. 后端设计

### 4.1 数据形状

```ts
type GitCommit = { hash: string; shortHash: string; subject: string; author: string; time: number; decorations: string };
// decorations = %D（如 'HEAD -> main, tag: v1'），可为空串

type GitBranch = { name: string; current: boolean; tip: string }; // tip = tip 提交短 hash
type GitBranches = { isRepo: boolean; current: string | null; branches: GitBranch[] };
type GitLog = { isRepo: boolean; commits: GitCommit[] };
type GitShow = { commit: GitCommit; diff: string };
```

### 4.2 `server/git.ts` 新增方法（全部走现有 execGit）

**`branches(): Promise<GitBranches>`**
```
git for-each-ref --format=%(HEAD)%x00%(refname:short)%x00%(objectname:short) refs/heads
```
`%(HEAD)` 为 `*` 时是当前分支；`current` 从带 `*` 的记录取，也可 `git branch --show-current` 兜底。非仓库/ENOENT → `{ isRepo:false }`（复用 status() 的识别模式）。

**`log(branch, limit, skip): Promise<GitLog>`**
```
git log <branch|HEAD> --pretty=format:%H%x00%h%x00%s%x00%an%x00%at%x00%D --skip=<skip> -n <limit>
```
按 `\n` 拆记录、`\0` 拆字段。`branch` 缺省 = 当前分支；提供了则必须在 `branches()` 列表内（400 否则）。`limit` 默认 50、上限 100；`skip` ≥ 0 整数——前端「加载更多」翻页用。

**`checkout(name): Promise<void>`**
先校验 `name` ∈ branches() 列表（防路径/flag 注入），再 `git checkout <name>`。未提交改动冲突 → 400 + git 原始 stderr（前端 Toast）。

**`createBranch(name): Promise<void>`**
`git check-ref-format --branch <name>`（okCodes [0,1]，码 1 → 400 "invalid branch name"）→ `git checkout -b <name>`。名字已存在 → 400 + stderr。

**`show(commit): Promise<GitShow>`**
`commit` 必须匹配 `/^[0-9a-f]{4,64}$/i`（前端只传 log 拿到的 hash）。元信息 `git log -1 <commit> <同款 format>`；diff 正文 `git show <commit> --format=`，服务端 trim 头部空行。

### 4.3 注入防护（白名单原则）

| 参数 | 校验 |
|---|---|
| `log.branch` | 必须 ∈ branches() 名字列表 |
| `checkout.name` | 必须 ∈ branches() 名字列表 |
| `createBranch.name` | `git check-ref-format --branch` 原生校验 |
| `show.commit` | `/^[0-9a-f]{4,64}$/i` |
| `limit`/`skip` | `Number.isInteger` + 区间钳制 |

### 4.4 路由（`server/routes/git.ts` 追加）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/git/branches` | `{ isRepo, current, branches }` |
| GET | `/api/git/log?branch=&limit=&skip=` | `{ isRepo, commits }` |
| GET | `/api/git/show?commit=` | `{ commit, diff }` |
| POST | `/api/git/checkout` | body `{ name }` → `{ current }` |
| POST | `/api/git/create-branch` | body `{ name }` → `{ current }`（checkout -b 后当前分支即新分支） |

## 5. 前端设计

### 5.1 标签模型 + stores

**tab-model.ts** 的 TabItem 联合类型加三种（均不写 URL，沿用 git 标签约定）：

| kind | id | 说明 |
|---|---|---|
| `git-history` | `'git-history'` | 单例，提交日志 |
| `git-branch` | `'git-branch'` | 单例，分支管理 |
| `git-commit` | `git-commit:<shortHash>` | 去重（同提交点第二次复用） |

**stores.ts** 新增：
- `currentBranch` 信号：应用启动时（或首次打开 git 视图时）`api.git.branches()` 初始化；checkout/create 成功后由返回的 `current` 更新
- `openGitHistory()` / `openGitBranch()` / `openGitCommit(shortHash)`：add 标签 + setCurrentTabId + pushState（null → URL 保持 `/`）
- `gitRefreshTick` 信号：工具栏刷新按钮 bump；git 面板 / 历史 / 分支视图的加载 effect 依赖它 → 统一重拉（commit 成功后 git 面板也用它刷新）
- `checkoutBranch(name)`：见 §5.4 保护流程

### 5.2 工具栏上下文化（App.tsx）

当前 `toolbarPathLabel()` 按 `activeTab().kind` 分支。扩展为整条工具栏两态：

```
文件/终端标签：  [☰] [🔍]  路径文案            [✎]
git 相关标签：   [☰] [⑂ main] [📜] [🔄] [➕]
```

- **⑂ main**：显示 `currentBranch`（非仓库显示「—」），点击 `openGitBranch()` → 分支标签
- **📜 历史入口**：点击 `openGitHistory()`
- **🔄 刷新**：bump `gitRefreshTick`
- **➕ 新建分支**：直接弹新建分支 dialog（复用 dialog 组件，输入名字 → `createBranch`），快捷入口
- git 相关 = kind ∈ { git, git-history, git-branch, git-commit }；此时隐藏 🔍 与 ✎（分支/提交标签没有"编辑当前文件"语义）
- 工具栏两态用 Solid `<Show>` 切换，分支名按钮最小 40px 触控

### 5.3 视图

**HistoryView（`web/src/views/history.tsx`）**
```
┌──────────────────────────────┐
│ [分支 ▾] main        (loading) │  ← 顶部分支选择器：仅切换"看哪条分支的历史"，不切分支
├──────────────────────────────┤
│ ● a1b2c3  修复 x 的一处问题    │  ← 行：短 hash + 主题
│           wanderxuhq · 3 天前  │     次行：作者 · 相对时间 + HEAD/引用 chip
│ ● d4e5f6  feat: 加搜索         │
│ ...                           │
│          [加载更多]            │  ← 底部按钮，skip 累加 50
└──────────────────────────────┘
```
- 加载 effect 依赖 `[分支选择, gitRefreshTick]`，重拉追加/替换
- 点行 → `openGitCommit(shortHash)` 打开提交标签
- 相对时间纯函数 `formatCommitTime(ts)`（<1min「刚刚」/分/时/天/日期），独立可测
- 非仓库 → 空态提示；加载失败 → Toast + 列表保持

**BranchView（`web/src/views/branch.tsx`）**
```
┌──────────────────────────────┐
│ [新分支名输入]  [新建]         │  ← 顶部内联新建区（与 git 面板提交区同款）
├──────────────────────────────┤
│ ✓ main    a1b2c3             │  ← 当前分支 ✓ + tip 短 hash
│   dev     f0e1d2             │  ← 点行 → 确认 dialog → checkout
│   feat/xx d9c8b7             │
└──────────────────────────────┘
```
- 新建：输入非空 → `createBranch` → 成功刷新列表 + currentBranch + Toast；失败 Toast git 错误
- 切换：点行 → `dialog`「切换到 xxx？」确认 → `checkoutBranch` → 成功后刷新；已是当前分支的行点击无操作
- 加载 effect 依赖 `gitRefreshTick`

**CommitView（`web/src/views/commit.tsx`）**
```
┌──────────────────────────────┐
│ a1b2c3 · wanderxuhq · 3 天前  │  ← 元信息头：短 hash / 作者 / 相对时间
│ 修复 x 的一处问题              │
├──────────────────────────────┤
│        (unified diff 正文)    │  ← createDiffEditor 只读渲染
└──────────────────────────────┘
```
- 结构与 GitDiffView 同构：props.commit → effect → `api.git.show(commit)` → createDiffEditor；onCleanup 取消 + destroy；错误 Toast
- diff 正文不设行数上限（虚拟滚动兜底）

**tabs.tsx**：tabIcon/tabName/tabTitle 加三 kind（git-history📜/git-branch⑂/git-commit↔ 短 hash 作名）；close 走 `closeGitTab`（视图级，不写 URL）。

### 5.4 切换分支保护流程（用户规则）

`checkoutBranch(name)` 执行顺序：

1. `flushSave()`——立即保存防抖中的待写内容（此刻 roMode 仍 false，ro=0 放行）
2. `setRoMode(true)` → 编辑器转只读。**同时 `handleEditorChange` 加只读 guard：`roMode()` 时直接 return，不再触发 scheduleSave**（满足「只读模式的文件不要自动保存」，纵深防御）
3. `api.git.checkout(name)`
4. **成功** → `currentBranch` 更新；bump `gitRefreshTick`（git 面板 status / 历史 / 分支列表全部重拉，因为工作区文件已变）
   - 已打开的文件标签**不关闭**（用户要求）：主区域当前是 git 标签、编辑器隐藏、内存中文档仍旧分支内容但不可见；用户切回文件标签时 `currentFile` 变化 → 现有 loadDoc effect 自动从新分支重读，无需额外逻辑
   - 编辑器保持只读（用户规则），用户回到文件标签按 ✎ 可自行切回可写
5. **失败** → Toast 显示 git 原始 stderr；分支不变；编辑器保持「已保存 + 只读」（flushSave 已把防抖内容落盘到旧分支，改动不丢），用户去 git 面板自行处理未提交改动
   - 若 flushSave 写入的改动与目标分支无冲突，git checkout 会带着未提交改动切过去（git 原生语义），同样安全

## 6. 错误处理 / 边界 / 测试

### 6.1 错误处理

| 场景 | 行为 |
|---|---|
| 非 git 仓库 / git 缺失 | branches/log 返回 `isRepo:false` → 历史/分支视图空态提示；工具栏分支名显示「—」 |
| checkout 冲突（未提交改动） | 400 + git 原始 stderr → Toast；编辑器保持已保存+只读 |
| createBranch 名字无效/已存在 | 400 + git stderr → Toast（或 dialog 内联错误） |
| log/show/checkout 请求失败 | Toast + 列表保持上次状态 |
| 切到已是当前的分支 | 行点击无操作（✓ 分支行不触发确认） |

### 6.2 边界

- 提交 hash 只传服务端 log 返回的短 hash，服务端 `/^[0-9a-f]{4,64}$/i` 收紧
- 合并提交的 diff：`git show` 默认合并 diff（combined diff），正文渲染同普通提交，无需特判
- 超长日志：`-n 50` 翻页加载更多，不一次全拉
- 并发 checkout：`checkoutBranch` 执行期间禁止再触发（按钮中态），一次一个切换
- 空分支历史（新分支零提交）：log 返回空 commits → 空态文案

### 6.3 测试

| 层 | 内容 |
|---|---|
| `server/git.test.ts`（追加） | 临时仓库 fixture：branches 解析（current 标记 / tip hash）、log 解析（字段 / skip/limit 翻页 / 非法 branch 400）、checkout（成功切分支 / 冲突改动 400 / 非本地分支名 400）、createBranch（成功 / 非法名 400 / 已存在 400）、show（元信息 + diff 正文 / 非 hex 400） |
| `server/routes/git.test.ts`（追加） | 新路由状态码、`{ error }` 结构、缺参 400 |
| `web/src/views/history.test.ts` | 纯函数：`formatCommitTime`、日志查询参数构建；source-extraction 工作方式（.tsx 纯函数提取，同 git.test.ts 既有模式） |
| `web/src/tab-model.test.ts`（追加） | `addGitCommitTab` 去重 / `addGitHistoryTab` 单例 |
| 手动清单（真机） | 见 §7 前：开历史→点提交看 diff、切分支确认编辑器只读+已保存、新建分支、工具栏两态切换、刷新按钮 |

## 7. 后续（本次不做）

- 删除 / 重命名本地分支
- 提交 diff 里点文件 → 看该文件在那次提交的完整内容（本次只要提交级 diff）
- 远程分支（fetch / push / pull / 远端跟踪）
- 相对时间 vs 绝对时间的切换设置
