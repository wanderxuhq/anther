# git 功能设计文档

日期：2026-08-09
状态：已与用户逐节确认

## 1. 概述

为 anther 增加 Git 功能。**MVP 范围（A）**：状态（status）+ 差异（diff）+ 提交（commit）。不做分支管理、历史日志、stash、撤销——这些进 roadmap（见 §7）。

**核心交互形态**：Git 是**主区域的一个独立标签**（`kind: 'git'`，单例），点活动栏 git 按钮：有 git 标签就切过去（复用），没有才新建。面板顶部是提交区（消息输入 + 提交按钮 + 全选/取消全选），下方是改动列表。点某文件行 → **打开一个 git-diff 新标签**，主区域显示该文件的 diff（复用只读 CodeMirror 渲染 unified diff 文本，一行一个 diff 行，不是左右对比）。

## 2. 设计原则（与主 spec 一致）

- **无状态**：服务端不落盘，git 状态读自真实仓库；进程重启 = 回到起点
- **git 只在服务端跑**：浏览器永远看不到 git，所有 git 操作经由服务端 API
- **diff 计算给 git，渲染给编辑器**：服务端跑真实 `git diff` 拿 unified diff 文本，前端用只读 CodeMirror 渲染——各干各擅长的
- **移动优先**：单列列表 + 标签查看（点文件行开 diff 标签），触控友好

## 3. 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| git 执行 | 服务端 `child_process.execFile('git', args)` | 真实 git 兜底（重命名/二进制/换行差异/冲突状态全对齐 CLI）；`execFile` 数组参数不走 shell，从根上防注入 |
| diff 渲染 | 复用 `createEditor` 适配层 + 只读模式 | 白赚虚拟滚动、主题跟随、字号缩放、搜索 |
| diff 高亮 | `@codemirror/legacy-modes` 的 diff 模式，经 `StreamLanguage.define(diff)` | 官方维护（作者本人），`6.5.3` 活跃版本；CM6 原生无 diff 模式，这是标准接入方式；纯正则词法，兼容层性能损失可忽略 |
| 新增依赖 | 仅 `@codemirror/legacy-modes`（已是 `@codemirror/language-data` 的传递依赖） | 实现时显式加进 package.json 声明，避免上游变动；纯 JS，无 node-gyp，符合项目约束 |

**明确排除**：纯 JS git 实现（isomorphic-git）——重依赖、与真实 git 语义存在偏差风险。分支/历史/stash 等不做（roadmap）。

## 4. 后端设计

### 4.1 新增 `server/git.ts` —— 薄 git 执行器

- `execGit(args)`：`execFile('git', args, { cwd: root })` → `{ code, stdout, stderr }`；只对 `code > 1` 抛错（`git diff` 正常返回 1 表示"有差异"，不能当错误）
- 所有命令在**项目根目录**下执行；路径参数全部限定在根内（延续 files.ts 的边界原则）
- 环境依赖：系统有 `git`（Termux/WSL/桌面都有）。服务端零新依赖（`node:child_process`）

### 4.2 API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/git/status` | `git status --porcelain=v1 -z` → `{ isRepo, changes: [{ path, status }] }`。`isRepo:false` 表示非 git 仓库/git 缺失（前端显示空态）。`-z` NUL 分隔，空格/特殊字符文件名安全 |
| GET | `/api/git/diff?path=` | `git diff HEAD -- <path>` 返回 unified diff 文本；未跟踪文件走 `git diff --no-index /dev/null <path>`（整文件全 `+`） |
| POST | `/api/git/commit` | body `{ paths, message }`。对每个勾选路径 `git add -- <path>`，再 `git commit -m <msg> -- <paths>` |

**两个语义要点**：

1. **commit 不接 ro 门控**：✎ 编辑按钮**只控制"浏览器内编辑文件"**，不影响、不限制其他操作。git 是仓库写入，按用户决策 MVP 不做 ro 校验；服务端去掉 ro 校验（write-gate 收紧）进 roadmap（§7）。
2. **diff 语义**：显示「工作区 vs HEAD」(`git diff HEAD`)。提交流程是全量 add 勾选文件再 commit，对用户来说"提交后仓库会变成什么样"等价于这个 diff。

**status 解析**：`-z` NUL 分隔；重命名（R/C）取新路径；每个文件一个显示状态字母（`M`/`A`/`D`/`??`），前端着色。

**错误处理**：commit 失败（无改动、消息空、冲突未解决）→ 服务端返回 `{ error }`，前端 Toast 展示 git 原始错误。

## 5. 前端设计

### 5.1 git-diff 标签视图（`web/src/views/git-diff.tsx` + `web/src/editor/diff.ts`）

- 数据：`GET /api/git/diff?path=` 返回 unified diff 文本
- 渲染：把 diff 文本当作文档，喂进**只读** CodeMirror（`createEditor(el, { readOnly: true, onChange: noop })`）
- 高亮：`handle.setLanguage(StreamLanguage.define(diff))`——legacy-modes 的 diff 模式返回的就是标准 CM6 Extension，经现有 `languageCompartment` 注入，**与编辑器其他语言同一套机制，无语法不一致**
- 未跟踪新文件：服务端返回 `git diff --no-index /dev/null <file>`（整文件全 `+`），显示为"整文件新增"；顶部放「用编辑器打开」按钮（跳到该文件的文件标签）
- git-diff 标签关闭（×）→ 回退到下一个标签（git 面板或上次的文件），见 §5.2

### 5.2 标签整合

- `tab-model.ts` 的 TabItem 联合类型加两种标签：
  - `{ kind: 'git', id: 'git' }` —— git 面板，id 固定 `'git'`（单例）
  - `{ kind: 'git-diff', id, path }` —— 单文件 diff，id 固定 `diff:<path>`（同文件点第二次复用）
- 标签栏 git / git-diff 标签同终端可关、可切换、× 关掉
- **× 只关视图不杀进程**（git 无进程）
- **git / git-diff 标签不写 URL**：`pushState` 保持现状（URL 的 term 参数只服务终端），刷新不恢复，回文件树/上次打开的文件

### 5.3 活动栏按钮

- 抽屉 `nav` 加 git 按钮，点击 `openGit()`：有 git 标签 → `setCurrentTabId('git')` 切过去（复用）；没有 → 创建标签并设前台。**完全对齐 `openTerminal` 的模式**

### 5.4 面板布局（`web/src/views/git.tsx`）

```
┌────────────────────────────┐
│ [消息输入框] [提交按钮]      │  ← 顶部提交区
│ [全选] [取消全选]            │
├────────────────────────────┤
│ ☑ file-a.ts    M   [diff]   │  ← 改动列表：点主体=勾选，行尾按钮=看diff
│ ☑ file-b.ts    ??  [diff]   │
│ ☐ file-c.ts    D   [diff]   │
└────────────────────────────┘
```

- **状态**：status 返回 → 列表行，每行 `☑` 复选框 + 文件名 + 状态字母
- **勾选（触控优先）**：**点行主体（左侧大块）= 勾选/取消勾选**；**行尾独立「查看 diff」按钮 = 打开该文件 diff**（两个点击目标分离，避免误触）
- **全选/取消全选**：顶部按钮批量切换
- **提交**：点提交 → 只 add 勾选文件 → commit → 成功后**刷新 status** + Toast 成功
- **查看 diff**：`openDiffTab(path)` 打开 git-diff 标签（复用 `diff:<path>`），主区域显示该文件 diff（见 §5.1）
- **空态**：`isRepo:false` → 面板显示提示（"不是 git 仓库"），不崩

## 6. 错误处理 / 边界 / 测试

### 6.1 错误处理（Toast + 降级，不弹窗）

| 场景 | 行为 |
|---|---|
| 非 git 仓库 / git 缺失 | `isRepo:false` → 面板空态提示，不崩 |
| status/diff 请求失败 | Toast + 列表保持上次状态 |
| commit 失败 | 服务端返回 `{ error }` → Toast 展示 git 原始错误 |
| 提交空消息 | 前端禁用提交按钮（不发出请求） |
| 面板刷新期间点提交 | 提交按钮中态，避免并发 commit |

### 6.2 边界

- diff/commit 路径：只处理 status 返回的路径；服务端 `execFile` 数组参数（不走 shell）+ 根目录边界
- 大 diff：CodeMirror 虚拟滚动兜底，不设行数上限
- 并发 commit：一次只允许一个 commit 进行中（按钮中态），成功后刷新 status

### 6.3 测试

| 层 | 内容 |
|---|---|
| `server/git.test.ts` | 临时 git 仓库 fixture：init + 文件变更 → 验证 status 解析、diff 语义（未跟踪全 `+`）、commit 后 status 清空 |
| `server/routes/git.test.ts` | API 层：状态码、`{ error }` 结构、路径处理 |
| `web/src/editor/diff.test.ts` | diff.ts 对给定 unified diff 文本 → 语言注入正确、只读 |
| `web/src/views/git.test.ts` | 勾选/全选/取消全选、提交成功刷新 status、点行主体勾选 vs 行尾按钮开 diff（两目标分离） |

**手动清单**（真机验证，独立于主 spec 附录 A）：手机上开 git 面板 → 改文件 → 勾选提交 → 看 diff 着色 → 验证 commit 生效。

## 7. Roadmap（MVP 之后，本设计不做）

- **服务端去掉 ro 校验**：✎ 编辑按钮只控制浏览器内编辑文件，不影响、不限制其他操作；后期服务端去掉 write-gate 的 ro 校验（ro 仅剩前端语义——控制编辑器可编辑性）
- 分支管理：列出 / 切换 / 新建
- 历史日志：commit log + 点进某次提交看当时内容
- 单文件暂存（stage）操作：`git add` / `git reset` 单个文件
- stash / 撤销 / 忽略文件
