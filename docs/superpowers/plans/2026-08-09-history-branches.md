# 历史 + 分支 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 git MVP（status/diff/commit）之上实现 roadmap §7：commit 历史日志（可切换分支查看、点提交看该次 diff）+ 本地分支管理（列出/切换/新建）+ git 标签上下文工具栏 + 切换分支保护。

**Architecture:** 服务端 `server/git.ts` 加 5 个方法（`branches/log/checkout/createBranch/show`）全走既有 `execGit`（execFile 数组参数 + 白名单校验）；`server/routes/git.ts` 加 5 条 REST 路由；前端 `api.ts` 加对应客户端方法，`tab-model.ts` 加 3 个标签 kind（git-history 单例 / git-branch 单例 / git-commit 去重），`stores.ts` 加 `currentBranch`/`gitRefreshTick` 信号与 open*/createBranch，App.tsx 做工具栏两态 + `checkoutBranch` 保护流程，新增 HistoryView/BranchView/CommitView 三个视图（CommitView 复用 git-diff 的只读 CodeMirror 渲染）。

**Tech Stack:** 既有栈（SolidJS + node http + execFile），零新增依赖。`formatCommitTime`/`logParams` 纯函数放独立 `.ts` 模块（node --test 可直接 ESM 导入，规避 `.tsx` 加载限制）。

## Global Constraints

- **提交策略**：直接提交 main（用户授权）；**中文提交信息，不加 Co-Authored-By**。
- **零新增依赖**：全部复用现有模块与 CSS 变量，不引入 node-gyp 依赖。
- **git 只在服务端跑**：`execFile('git', ['-C', root, ...])` 数组参数不走 shell；参数一律白名单校验（spec §4.3：log.branch/checkout.name 必须 ∈ branches() 列表、createBranch 用 `check-ref-format` 原生校验、show.commit 必须 `/^[0-9a-f]{4,64}$/i`、limit/skip 整数区间钳制）。
- **.tsx 测试约束**：node `--experimental-transform-types` 无法加载 `.tsx`（ERR_UNKNOWN_FILE_EXTENSION，已复现）。本计划需要测试的纯函数（`formatCommitTime`/`logParams`）**放 `.ts` 模块**直接 ESM 导入；若后续必须测 `.tsx` 纯函数，沿用既有 source-extraction 工作方式（`extractFunction` + `stripTypeScriptTypes` + `new Function`，函数必须无模块闭包依赖、无不平衡括号）。
- **移动端触控**：所有主要点击目标 ≥ 40px（新增 history-row / branch-row / history-more .link-btn 同规则）。
- **i18n**：新增用户可见文案一律走 `web/src/i18n.ts` 字典（en/zh 双语），不硬编码中文。
- **git 标签不写 URL**：openGitHistory/Branch/Commit 走 pushState 但 path/term 均 null → URL 回 `/`（沿用 git/git-diff 约定）。

---

## File Structure Map

**创建：**
- `server/` — 无新文件（方法追加到 `server/git.ts`、路由追加到 `server/routes/git.ts`）
- `web/src/views/history-model.ts` — 纯函数：`formatCommitTime` / `commitTimeLabel` / `logParams`（独立 `.ts`，直接可测）
- `web/src/views/history.tsx` — HistoryView（分支选择器 + 提交列表 + 加载更多）
- `web/src/views/branch.tsx` — BranchView（内联新建 + 列表 + 切换确认 dialog）
- `web/src/views/commit.tsx` — CommitView（提交元信息头 + 只读 diff）
- `web/src/views/history-model.test.ts` — formatCommitTime / logParams 单测
- `docs/superpowers/specs/2026-08-09-history-branches-design.md` — 已存在（e1bba67），本计划依据

**修改：**
- `server/git.ts` — 5 方法 + 5 类型 + COMMIT_FORMAT 常量
- `server/git.test.ts` — 追加方法测试
- `server/routes/git.ts` — 5 路由
- `server/routes/git.test.ts` — 追加路由测试
- `web/src/api.ts` — `api.git` 加 branches/log/show/checkout/createBranch + 5 类型
- `web/src/tab-model.ts` — TabItem 联合加 3 kind + GIT_HISTORY_TAB_ID/GIT_BRANCH_TAB_ID + 3 add 函数 + gitCommitTabId
- `web/src/tab-model.test.ts` — 追加 3 个测试
- `web/src/stores.ts` — currentBranch / gitRefreshTick / refreshGitMeta / openGitHistory / openGitBranch / openGitCommit / createBranch；startSync 尾部调 refreshGitMeta
- `web/src/App.tsx` — isGitKind / activeCommitHash / handleEditorChange 只读 guard / checkoutBranch / 新建分支 dialog / 工具栏两态 / 主区域 3 Show
- `web/src/views/git.tsx` — onMount → createEffect 依赖 gitRefreshTick
- `web/src/views/tabs.tsx` — tabIcon/tabName/tabTitle 加 3 kind
- `web/src/i18n.ts` — 约 18 个新 key（en/zh）
- `web/src/styles.css` — 历史/分支/提交视图 + git 工具栏按钮样式

---

### Task 1: 服务端 git 执行器扩展（branches/log/checkout/createBranch/show）

**Files:**
- Modify: `server/git.ts`（append 类型 + 方法，复用 execGit / HttpError）
- Test: `server/git.test.ts`（append 用例，复用既有 fixture）

**Interfaces:**
- Consumes: `Git.execGit(args, okCodes=[0], failStatus=500)`、`HttpError`、既有 `isRepo:false` 识别模式（ENOENT / `/not a git repository|ambiguous argument/i`）
- Produces:
  ```ts
  type GitCommit = { hash: string; shortHash: string; subject: string; author: string; time: number; decorations: string };
  type GitBranch = { name: string; current: boolean; tip: string };
  type GitBranches = { isRepo: boolean; current: string | null; branches: GitBranch[] };
  type GitLog = { isRepo: boolean; commits: GitCommit[] };
  type GitShow = { commit: GitCommit; diff: string };
  class Git {
    branches(): Promise<GitBranches>;
    log(branch: string | null, limit: number, skip: number): Promise<GitLog>;
    checkout(name: string): Promise<void>;
    createBranch(name: string): Promise<void>;
    show(commit: string): Promise<GitShow>;
  }
  ```

- [ ] **Step 1: 写失败测试**（追加到 `server/git.test.ts` 末尾，全部用既有 fixture 与 `gitCmd` helper）

```ts
test('branches：列出本地分支，current 标记 + tip 短 hash', async () => {
  await gitCmd(['checkout', '-qb', 'dev']);
  await writeFile(path.join(repoDir, 'dev.txt'), 'dev\n');
  await gitCmd(['add', '.']);
  await gitCmd(['commit', '-qm', 'dev work']);
  const b = await git.branches();
  assert.equal(b.isRepo, true);
  assert.equal(b.current, 'dev');
  const dev = b.branches.find((x) => x.name === 'dev');
  assert.equal(dev?.current, true);
  assert.match(dev?.tip ?? '', /^[0-9a-f]{7}$/);
  const main = b.branches.find((x) => x.name === 'main');
  assert.equal(main?.current, false);
});

test('branches：非仓库 → isRepo:false', async () => {
  const plainDir = await mkdtemp(path.join(os.tmpdir(), 'anther-plain-'));
  try {
    const b = await new Git(plainDir).branches();
    assert.equal(b.isRepo, false);
    assert.equal(b.current, null);
    assert.deepEqual(b.branches, []);
  } finally {
    await rm(plainDir, { recursive: true, force: true });
  }
});

test('log：字段解析 + 时间倒序', async () => {
  await writeFile(path.join(repoDir, 'tracked.txt'), 'line1\nline2\n');
  await gitCmd(['add', '.']);
  await gitCmd(['commit', '-qm', 'second']);
  const log = await git.log(null, 50, 0);
  assert.equal(log.isRepo, true);
  assert.equal(log.commits.length, 2);
  assert.equal(log.commits[0].subject, 'second');
  assert.equal(log.commits[1].subject, 'init');
  assert.match(log.commits[0].shortHash, /^[0-9a-f]{7}$/);
  assert.ok(log.commits[0].time > log.commits[1].time);
});

test('log：skip/limit 翻页不重复', async () => {
  for (let i = 0; i < 3; i++) {
    await writeFile(path.join(repoDir, 'tracked.txt'), `line1\nline2\n${i}\n`);
    await gitCmd(['add', '.']);
    await gitCmd(['commit', '-qm', `c${i}`]);
  }
  const page1 = await git.log(null, 2, 0);
  const page2 = await git.log(null, 2, 2);
  assert.equal(page1.commits.length, 2);
  assert.equal(page2.commits.length, 2);
  const ids = new Set([...page1.commits, ...page2.commits].map((c) => c.shortHash));
  assert.equal(ids.size, 4); // 两页无重复
});

test('log：branch 过滤历史 + 非法 branch → 400', async () => {
  await gitCmd(['checkout', '-qb', 'dev']);
  await writeFile(path.join(repoDir, 'dev.txt'), 'dev\n');
  await gitCmd(['add', '.']);
  await gitCmd(['commit', '-qm', 'dev work']);
  const devLog = await git.log('dev', 50, 0);
  assert.ok(devLog.commits.some((c) => c.subject === 'dev work'));
  const mainLog = await git.log('main', 50, 0);
  assert.ok(!mainLog.commits.some((c) => c.subject === 'dev work'));
  await assert.rejects(() => git.log('nope', 50, 0), (e: unknown) => (e as HttpError).status === 400);
  await assert.rejects(() => git.log('../evil', 50, 0), (e: unknown) => (e as HttpError).status === 400);
});

test('log：limit 越界 / 非整数 / skip 负数 → 400', async () => {
  await assert.rejects(() => git.log(null, 101, 0), (e: unknown) => (e as HttpError).status === 400);
  await assert.rejects(() => git.log(null, 1.5, 0), (e: unknown) => (e as HttpError).status === 400);
  await assert.rejects(() => git.log(null, 50, -1), (e: unknown) => (e as HttpError).status === 400);
});

test('log：空仓库（unborn）→ isRepo:true + 空 commits', async () => {
  const emptyDir = await mkdtemp(path.join(os.tmpdir(), 'anther-empty-'));
  try {
    await gitCmd(['init', '-q']);
    const g = new Git(emptyDir);
    const log = await g.log(null, 50, 0);
    assert.equal(log.isRepo, true);
    assert.deepEqual(log.commits, []);
  } finally {
    await rm(emptyDir, { recursive: true, force: true });
  }
});

test('checkout：切换到本地分支', async () => {
  await gitCmd(['checkout', '-qb', 'dev']);
  await gitCmd(['checkout', 'main']);
  await git.checkout('dev');
  const { current } = await git.branches();
  assert.equal(current, 'dev');
});

test('checkout：未提交改动冲突 → 400', async () => {
  await gitCmd(['checkout', '-qb', 'dev']);
  await gitCmd(['checkout', 'main']);
  await writeFile(path.join(repoDir, 'conflict.txt'), 'main\n');
  await gitCmd(['add', '.']);
  await gitCmd(['commit', '-qm', 'main conflict file']);
  await gitCmd(['checkout', '-q', 'dev']);
  await writeFile(path.join(repoDir, 'conflict.txt'), 'dev\n');
  await assert.rejects(() => git.checkout('main'), (e: unknown) => (e as HttpError).status === 400);
});

test('checkout：非本地分支名 → 400', async () => {
  await assert.rejects(() => git.checkout('nope'), (e: unknown) => (e as HttpError).status === 400);
});

test('createBranch：成功创建并切到新分支', async () => {
  await git.createBranch('feat/one');
  const b = await git.branches();
  assert.equal(b.current, 'feat/one');
  assert.ok(b.branches.some((x) => x.name === 'feat/one'));
});

test('createBranch：非法名 / 已存在 → 400', async () => {
  await assert.rejects(() => git.createBranch('bad name with space'), (e: unknown) => (e as HttpError).status === 400);
  await assert.rejects(() => git.createBranch('..'), (e: unknown) => (e as HttpError).status === 400);
  await assert.rejects(() => git.createBranch('main'), (e: unknown) => (e as HttpError).status === 400);
});

test('show：元信息 + diff 正文', async () => {
  await writeFile(path.join(repoDir, 'tracked.txt'), 'line1\nline2\n');
  await gitCmd(['add', '.']);
  await gitCmd(['commit', '-qm', 'second']);
  const { commit, diff } = await git.show('HEAD');
  assert.equal(commit.subject, 'second');
  assert.match(diff, /^diff --git/);
  assert.match(diff, /\+line2/);
});

test('show：非 hex → 400', async () => {
  await assert.rejects(() => git.show('../x'), (e: unknown) => (e as HttpError).status === 400);
  await assert.rejects(() => git.show('HEAD'), (e: unknown) => (e as HttpError).status === 400);
});
```

注意 `git.log('../evil', ...)` 也断言 400：`../evil` 不在 branches 列表 → 白名单拦截（`branches()` 返回的是 ref 短名，天然不含 `../`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --experimental-transform-types server/git.test.ts`
Expected: 既有 9 个用例过；新用例 FAIL（TypeError: git.branches is not a function）

- [ ] **Step 3: 最小实现**（追加到 `server/git.ts`）

在类型区加：

```ts
export type GitCommit = { hash: string; shortHash: string; subject: string; author: string; time: number; decorations: string };
export type GitBranch = { name: string; current: boolean; tip: string };
export type GitBranches = { isRepo: boolean; current: string | null; branches: GitBranch[] };
export type GitLog = { isRepo: boolean; commits: GitCommit[] };
export type GitShow = { commit: GitCommit; diff: string };

/** log/show 元信息统一 format：%x00 分隔字段（%s 不含换行 → 记录按 \n 拆无歧义；%D 可空串作尾字段） */
const COMMIT_FORMAT = '%H%x00%h%x00%s%x00%an%x00%at%x00%D';

function parseCommitRecord(line: string): GitCommit | null {
  const [hash, shortHash, subject, author, time, decorations] = line.split('\0');
  if (!hash || !shortHash || !subject || !author || !time) return null;
  return { hash, shortHash, subject, author, time: Number(time), decorations: decorations ?? '' };
}
```

在 `class Git` 末尾追加：

```ts
  /** 本地分支列表：for-each-ref 一次取 HEAD 标记 / 短名 / tip 短 hash。非仓库 → isRepo:false。 */
  async branches(): Promise<GitBranches> {
    try {
      const { stdout } = await this.execGit([
        'for-each-ref', '--format=%(HEAD)%x00%(refname:short)%x00%(objectname:short)', 'refs/heads',
      ]);
      const list: GitBranch[] = stdout.split('\n').filter(Boolean).map((line) => {
        const [head, name, tip] = line.split('\0');
        return { name, current: head === '*', tip };
      });
      const current = list.find((b) => b.current)?.name ?? null;
      return { isRepo: true, current, branches: list };
    } catch (e) {
      if ((e as { code?: string }).code === 'ENOENT') return { isRepo: false, current: null, branches: [] };
      if (e instanceof HttpError && /not a git repository|ambiguous argument/i.test(e.message)) {
        return { isRepo: false, current: null, branches: [] };
      }
      throw e;
    }
  }

  /** 提交日志：branch 缺省(null)=当前分支；提供则必须 ∈ branches()（白名单，防注入）。limit∈[1,100]、skip≥0 整数。 */
  async log(branch: string | null, limit: number, skip: number): Promise<GitLog> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'invalid limit');
    if (!Number.isInteger(skip) || skip < 0) throw new HttpError(400, 'invalid skip');
    let ref = 'HEAD';
    if (branch != null) {
      const b = await this.branches();
      if (!b.isRepo) throw new HttpError(400, 'not a git repository');
      if (!b.branches.some((x) => x.name === branch)) throw new HttpError(400, 'unknown branch');
      ref = branch;
    }
    try {
      const { stdout } = await this.execGit([
        'log', ref, `--pretty=format:${COMMIT_FORMAT}`, `--skip=${skip}`, '-n', String(limit),
      ]);
      const commits = stdout.split('\n').filter(Boolean).map(parseCommitRecord).filter((c): c is GitCommit => c !== null);
      return { isRepo: true, commits };
    } catch (e) {
      // 空仓库（unborn，零提交）：git log 报 "does not have any commits yet" → 空列表而非 500
      if (e instanceof HttpError && /does not have any commits yet/i.test(e.message)) {
        return { isRepo: true, commits: [] };
      }
      throw e;
    }
  }

  /** 切换分支：name 必须 ∈ branches()。未提交改动冲突 → 400 带 git 原始 stderr（前端 Toast）。 */
  async checkout(name: string): Promise<void> {
    const b = await this.branches();
    if (!b.isRepo) throw new HttpError(400, 'not a git repository');
    if (!b.branches.some((x) => x.name === name)) throw new HttpError(400, 'unknown branch');
    await this.execGit(['checkout', name], [0], 400);
  }

  /** 新建分支并切过去（checkout -b）。名字先过 git check-ref-format 原生校验（非法名 exit 1 → 400）。 */
  async createBranch(name: string): Promise<void> {
    if (typeof name !== 'string' || name === '') throw new HttpError(400, 'invalid branch name');
    await this.execGit(['check-ref-format', '--branch', name], [0], 400);
    await this.execGit(['checkout', '-b', name], [0], 400); // 已存在/冲突 → 400 + stderr
  }

  /** 单次提交的元信息 + diff 正文。commit 只接受 log 返回的 hex（短/全 hash），白名单收紧。 */
  async show(commit: string): Promise<GitShow> {
    if (typeof commit !== 'string' || !/^[0-9a-f]{4,64}$/i.test(commit)) throw new HttpError(400, 'invalid commit');
    const { stdout: metaOut } = await this.execGit(['log', '-1', commit, `--pretty=format:${COMMIT_FORMAT}`]);
    const parsed = parseCommitRecord(metaOut.split('\n')[0]);
    if (!parsed) throw new HttpError(400, 'invalid commit');
    const { stdout: diffOut } = await this.execGit(['show', commit, '--format=']);
    return { commit: parsed, diff: diffOut.replace(/^\n+/, '') }; // 去掉 --format= 留下的头部空行
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test --experimental-transform-types server/git.test.ts`
Expected: 全部 PASS（既有 9 + 新 12）

- [ ] **Step 5: Commit**

```bash
git add server/git.ts server/git.test.ts
git commit -m "feat(git): 服务端 branches/log/checkout/create-branch/show + 测试"
```

---

### Task 2: git REST 路由（branches/log/show/checkout/create-branch）

**Files:**
- Modify: `server/routes/git.ts`
- Test: `server/routes/git.test.ts`（append）

**Interfaces:**
- Consumes: Task 1 的 `git.branches/log/show/checkout/createBranch` + `GitBranches.current`
- Produces:
  - GET `/api/git/branches` → `GitBranches`
  - GET `/api/git/log?branch=&limit=&skip=` → `GitLog`（缺省 branch/limit=50/skip=0）
  - GET `/api/git/show?commit=` → `GitShow`
  - POST `/api/git/checkout` body `{name}` → `{current}`
  - POST `/api/git/create-branch` body `{name}` → `{current}`
  - 非法参数 → 400 `{error}`

- [ ] **Step 1: 写失败测试**（追加到 `server/routes/git.test.ts`）

```ts
test('GET /api/git/branches：isRepo + current + 列表', async () => {
  const { status, body } = await call('GET', '/api/git/branches');
  assert.equal(status, 200);
  assert.equal(body.isRepo, true);
  assert.equal(body.current, 'main');
  assert.ok(body.branches.some((x: { name: string }) => x.name === 'main'));
});

test('GET /api/git/log：字段解析 + 非法 branch / limit 越界 → 400', async () => {
  const ok = await call('GET', '/api/git/log');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.isRepo, true);
  assert.ok(ok.body.commits.length >= 1);
  assert.match(ok.body.commits[0].shortHash, /^[0-9a-f]{7}$/);
  assert.equal((await call('GET', '/api/git/log?branch=nope')).status, 400);
  assert.equal((await call('GET', '/api/git/log?limit=999')).status, 400);
});

test('GET /api/git/show：元信息 + diff 正文；缺 commit / 非 hex → 400', async () => {
  const log = await call('GET', '/api/git/log?limit=1');
  const hash = log.body.commits[0].shortHash as string;
  const show = await call('GET', `/api/git/show?commit=${hash}`);
  assert.equal(show.status, 200);
  assert.equal(show.body.commit.subject, 'init');
  assert.match(show.body.diff, /^diff --git/);
  assert.equal((await call('GET', '/api/git/show')).status, 400);
  assert.equal((await call('GET', '/api/git/show?commit=HEAD')).status, 400); // HEAD 非 hex
});

test('POST /api/git/checkout：切到本地分支 → current 更新；未知分支 400', async () => {
  await execFileP('git', ['checkout', '-qb', 'dev'], { cwd: repoDir });
  await execFileP('git', ['checkout', 'main'], { cwd: repoDir });
  const { status, body } = await call('POST', '/api/git/checkout', { name: 'dev' });
  assert.equal(status, 200);
  assert.equal(body.current, 'dev');
  assert.equal((await call('POST', '/api/git/checkout', { name: 'nope' })).status, 400);
});

test('POST /api/git/create-branch：创建 + 切新分支；非法名 / 已存在 → 400', async () => {
  const { status, body } = await call('POST', '/api/git/create-branch', { name: 'feat/x' });
  assert.equal(status, 200);
  assert.equal(body.current, 'feat/x');
  assert.equal((await call('POST', '/api/git/create-branch', { name: 'bad name' })).status, 400);
  assert.equal((await call('POST', '/api/git/create-branch', { name: 'main' })).status, 400);
});
```

fixture 里 `a.txt` 有已跟踪修改、`b.txt` 未跟踪——checkout dev（dev 与 main 的 a.txt 同内容）会带着未提交改动成功切过去，不冲突（git 原生语义），happy-path 成立。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --experimental-transform-types server/routes/git.test.ts`
Expected: 既有 4 个过；新 5 个 FAIL（404 或 500）

- [ ] **Step 3: 最小实现**（追加到 `registerGitRoutes` 末尾）

```ts
  http.get('/api/git/branches', async () => git.branches());

  http.get('/api/git/log', async (_req, _body, query) => {
    const branch = query.get('branch');
    const limitRaw = query.get('limit');
    const skipRaw = query.get('skip');
    return git.log(branch, limitRaw === null ? 50 : Number(limitRaw), skipRaw === null ? 0 : Number(skipRaw));
  });

  http.get('/api/git/show', async (_req, _body, query) => {
    const c = query.get('commit');
    if (!c) throw new HttpError(400, 'missing commit');
    return git.show(c);
  });

  http.post('/api/git/checkout', async (_req, body) => {
    const b = (typeof body === 'object' && body !== null ? body : {}) as { name?: unknown };
    if (typeof b.name !== 'string') throw new HttpError(400, 'invalid name');
    await git.checkout(b.name);
    const { current } = await git.branches();
    return { current };
  });

  http.post('/api/git/create-branch', async (_req, body) => {
    const b = (typeof body === 'object' && body !== null ? body : {}) as { name?: unknown };
    if (typeof b.name !== 'string') throw new HttpError(400, 'invalid name');
    await git.createBranch(b.name);
    const { current } = await git.branches();
    return { current };
  });
```

（`Number('abc')` → NaN → Task 1 的 `Number.isInteger` 校验 → 400；`Number('')` → 0 → limit 0 → 400。缺参走默认值，手填空串会被正确拒绝。）

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test --experimental-transform-types server/routes/git.test.ts`
Expected: 全部 PASS（既有 4 + 新 5）

- [ ] **Step 5: Commit**

```bash
git add server/routes/git.ts server/routes/git.test.ts
git commit -m "feat(git): 历史/分支 REST 路由 + 测试"
```

---

### Task 3: 前端 API 客户端 + 标签模型三新 kind

**Files:**
- Modify: `web/src/api.ts`（git 段 + 类型）
- Modify: `web/src/tab-model.ts`（TabItem 联合 + 常量 + add 函数）
- Test: `web/src/tab-model.test.ts`（append）

**Interfaces:**
- Consumes: `request<T>()`、既有 `api.git` 段、既有 add 函数模式
- Produces:
  ```ts
  // api.ts
  type GitCommit = { hash: string; shortHash: string; subject: string; author: string; time: number; decorations: string };
  type GitBranch = { name: string; current: boolean; tip: string };
  type GitBranches = { isRepo: boolean; current: string | null; branches: GitBranch[] };
  type GitLog = { isRepo: boolean; commits: GitCommit[] };
  type GitShow = { commit: GitCommit; diff: string };
  api.git.branches: () => Promise<GitBranches>
  api.git.log: (params: { branch?: string; limit?: number; skip?: number }) => Promise<GitLog>
  api.git.show: (commit: string) => Promise<GitShow>
  api.git.checkout: (name: string) => Promise<{ current: string }>
  api.git.createBranch: (name: string) => Promise<{ current: string }>

  // tab-model.ts
  export const GIT_HISTORY_TAB_ID = 'git-history';
  export const GIT_BRANCH_TAB_ID = 'git-branch';
  TabItem 联合加：
    | { kind: 'git-history'; id: 'git-history' }
    | { kind: 'git-branch'; id: 'git-branch' }
    | { kind: 'git-commit'; id: string; commit: string }
  gitCommitTabId(hash: string): string            // `git-commit:${hash}`
  addGitHistoryTab(tabs: TabItem[]): TabItem[]    // 单例
  addGitBranchTab(tabs: TabItem[]): TabItem[]     // 单例
  addGitCommitTab(tabs: TabItem[], hash: string): TabItem[]  // 同 hash 去重
  ```

- [ ] **Step 1: 写失败测试**（追加到 `web/src/tab-model.test.ts`）

```ts
const historyTab: TabItem = { kind: 'git-history', id: GIT_HISTORY_TAB_ID };
const branchTab: TabItem = { kind: 'git-branch', id: GIT_BRANCH_TAB_ID };
const commitA: TabItem = { kind: 'git-commit', id: 'git-commit:a1b2c3', commit: 'a1b2c3' };

test('addGitHistoryTab / addGitBranchTab：单例不重复', () => {
  assert.deepEqual(addGitHistoryTab([fileA, historyTab]), [fileA, historyTab]);
  assert.deepEqual(addGitBranchTab([fileA, branchTab]), [fileA, branchTab]);
  const withHist = addGitHistoryTab([fileA]);
  assert.equal(withHist[1].id, GIT_HISTORY_TAB_ID);
  const withBranch = addGitBranchTab([fileA]);
  assert.equal(withBranch[1].id, GIT_BRANCH_TAB_ID);
});

test('gitCommitTabId / addGitCommitTab：同提交去重', () => {
  assert.equal(gitCommitTabId('a1b2c3'), 'git-commit:a1b2c3');
  assert.deepEqual(addGitCommitTab([fileA], 'a1b2c3'), [fileA, commitA]);
  assert.deepEqual(addGitCommitTab([fileA, commitA], 'a1b2c3'), [fileA, commitA]); // 已存在 → 原样
});
```

同时更新 import 行（把 `GIT_HISTORY_TAB_ID, GIT_BRANCH_TAB_ID, gitCommitTabId, addGitHistoryTab, addGitBranchTab, addGitCommitTab` 加入导入）。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --experimental-transform-types web/src/tab-model.test.ts`
Expected: FAIL（GIT_HISTORY_TAB_ID is not exported）

- [ ] **Step 3a: 实现 tab-model.ts**

```ts
export type TabItem =
  | { kind: 'file'; id: string; path: string }
  | { kind: 'terminal'; id: string; name: string }
  | { kind: 'git'; id: 'git' }
  | { kind: 'git-diff'; id: string; path: string }
  | { kind: 'git-history'; id: 'git-history' }
  | { kind: 'git-branch'; id: 'git-branch' }
  | { kind: 'git-commit'; id: string; commit: string };
```

文件末尾追加：

```ts
export const GIT_HISTORY_TAB_ID = 'git-history';
export const GIT_BRANCH_TAB_ID = 'git-branch';

export function gitCommitTabId(hash: string): string {
  return `git-commit:${hash}`;
}

export function addGitHistoryTab(tabs: TabItem[]): TabItem[] {
  if (tabs.some((t) => t.kind === 'git-history')) return tabs;
  return [...tabs, { kind: 'git-history', id: GIT_HISTORY_TAB_ID }];
}

export function addGitBranchTab(tabs: TabItem[]): TabItem[] {
  if (tabs.some((t) => t.kind === 'git-branch')) return tabs;
  return [...tabs, { kind: 'git-branch', id: GIT_BRANCH_TAB_ID }];
}

export function addGitCommitTab(tabs: TabItem[], hash: string): TabItem[] {
  const id = gitCommitTabId(hash);
  if (tabs.some((t) => t.id === id)) return tabs;
  return [...tabs, { kind: 'git-commit', id, commit: hash }];
}
```

- [ ] **Step 3b: 实现 api.ts**

在 `export type GitStatus = ...` 之后、`export const api` 之前加类型：

```ts
export type GitCommit = { hash: string; shortHash: string; subject: string; author: string; time: number; decorations: string };
export type GitBranch = { name: string; current: boolean; tip: string };
export type GitBranches = { isRepo: boolean; current: string | null; branches: GitBranch[] };
export type GitLog = { isRepo: boolean; commits: GitCommit[] };
export type GitShow = { commit: GitCommit; diff: string };
```

`api.git` 段追加：

```ts
    branches: () => request<GitBranches>('GET', '/api/git/branches'),
    log: (params: { branch?: string; limit?: number; skip?: number }) => {
      const q = new URLSearchParams();
      if (params.branch) q.set('branch', params.branch);
      q.set('limit', String(params.limit ?? 50));
      q.set('skip', String(params.skip ?? 0));
      return request<GitLog>('GET', `/api/git/log?${q}`);
    },
    show: (commit: string) => request<GitShow>('GET', `/api/git/show?commit=${encodeURIComponent(commit)}`),
    checkout: (name: string) => request<{ current: string }>('POST', '/api/git/checkout', { name }),
    createBranch: (name: string) => request<{ current: string }>('POST', '/api/git/create-branch', { name }),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test --experimental-transform-types web/src/tab-model.test.ts`
Expected: 全部 PASS（既有 8 + 新 2）

- [ ] **Step 5: Commit**

```bash
git add web/src/api.ts web/src/tab-model.ts web/src/tab-model.test.ts
git commit -m "feat(git): 前端 API 客户端 + 标签模型三新 kind + 测试"
```

---

### Task 4: stores 扩展（currentBranch / gitRefreshTick / open* / createBranch）

**Files:**
- Modify: `web/src/stores.ts`

**Interfaces:**
- Consumes: Task 3 的 `api.git.branches/createBranch`、tab-model 的 `addGitHistoryTab/addGitBranchTab/addGitCommitTab/gitCommitTabId`、既有 `pushState`/`setTabs`/`setCurrentTabId`
- Produces:
  ```ts
  export const [currentBranch, setCurrentBranch]: Signal<string | null>
  export const [gitRefreshTick, setGitRefreshTick]: Signal<number>
  export async function refreshGitMeta(): Promise<void>   // 启动时拉 currentBranch（失败保持 null）
  export function openGitHistory(): void                   // 单例标签 + 前台 + pushState
  export function openGitBranch(): void
  export function openGitCommit(hash: string): void        // 去重标签 + 前台 + pushState
  export async function createBranch(name: string): Promise<void>  // 成功 → currentBranch + bump tick；失败抛错
  ```
- **注意**：`checkoutBranch` **不放 stores**（spec §5.1 原文写 stores，但流程需要 App 局部的 `flushSave`/`setRoMode` 闭包，计划以 App.tsx 实现为准，见 Task 8）。

- [ ] **Step 1: 修改 stores.ts**

追加 import（tab-model 行尾补）：`addGitHistoryTab, addGitBranchTab, addGitCommitTab, gitCommitTabId, GIT_HISTORY_TAB_ID, GIT_BRANCH_TAB_ID`。

在 `editorHandle` 信号之后加：

```ts
// git 元信息：currentBranch 供工具栏分支名显示（非仓库 → null → 显示 '—'）；
// gitRefreshTick 是 git 相关视图的统一刷新信号（checkout/commit/新建分支/工具栏 🔄 后 bump → 视图重拉）
export const [currentBranch, setCurrentBranch] = createSignal<string | null>(null);
export const [gitRefreshTick, setGitRefreshTick] = createSignal(0);
```

在 `openGitDiff` / `closeGitTab` 之后追加：

```ts
/** 拉分支元信息（启动时一次）：currentBranch 失败/非仓库保持 null。checkout/createBranch 成功后各自直接 set。 */
export async function refreshGitMeta(): Promise<void> {
  try {
    const b = await api.git.branches();
    setCurrentBranch(b.current);
  } catch { /* 服务器不可达/非仓库：保持 null，工具栏显示 '—' */ }
}

/** 打开/复用历史标签（单例，对齐 openGit 模式；git 标签不写 URL） */
export function openGitHistory(): void {
  setTabs((prev) => addGitHistoryTab(prev));
  setCurrentTabId(GIT_HISTORY_TAB_ID);
  pushState();
}

/** 打开/复用分支标签（单例） */
export function openGitBranch(): void {
  setTabs((prev) => addGitBranchTab(prev));
  setCurrentTabId(GIT_BRANCH_TAB_ID);
  pushState();
}

/** 打开/复用某提交的 diff 标签（id git-commit:<hash>，同提交去重） */
export function openGitCommit(hash: string): void {
  setTabs((prev) => addGitCommitTab(prev, hash));
  setCurrentTabId(gitCommitTabId(hash));
  pushState();
}

/**
 * 新建分支（checkout -b）。成功后当前分支即新分支 → 更新 currentBranch + bump gitRefreshTick
 * （分支视图列表 / 工具栏 ⑂ 名自动刷新）。不涉及工作区改动，无需切换保护（spec §5.4 只保护切换已有分支）。
 * 失败抛错，调用方 Toast / 错误条。
 */
export async function createBranch(name: string): Promise<void> {
  const { current } = await api.git.createBranch(name);
  setCurrentBranch(current);
  setGitRefreshTick((x) => x + 1);
}
```

在 `startSync` 的 `setCurrentTabId(s.path)`（第 104 行附近）之后加一行：

```ts
  void refreshGitMeta(); // 工具栏分支名初始化（非阻塞）
```

- [ ] **Step 2: 验证（本任务无单测，靠类型与既有测试不回归）**

Run: `npm run typecheck`
Expected: 0 errors

Run: `node --test --experimental-transform-types web/src/tab-model.test.ts`
Expected: 全 PASS（stores 只是接线，不动 tab-model）

- [ ] **Step 3: Commit**

```bash
git add web/src/stores.ts
git commit -m "feat(git): stores currentBranch/gitRefreshTick + openHistory/openBranch/openCommit + createBranch"
```

---

### Task 5: 历史视图（history-model 纯函数 + HistoryView）

**Files:**
- Create: `web/src/views/history-model.ts`
- Create: `web/src/views/history.tsx`
- Test: `web/src/views/history-model.test.ts`

**Interfaces:**
- Consumes: Task 3 `api.git.branches/log` + `GitBranches/GitCommit` 类型；Task 4 `gitRefreshTick`/`openGitCommit`；`t()`
- Produces:
  ```ts
  // history-model.ts（纯函数 + 共享文案，独立 .ts → node --test 直接 ESM 导入可测）
  export type CommitTime = { kind: 'justNow' | 'minute' | 'hour' | 'day' | 'date'; n: number };
  export function formatCommitTime(ts: number, now: number): CommitTime
  export function commitTimeLabel(c: { time: number }): string     // 本地化文案（历史/提交视图共用）
  export function logParams(branch: string | null, limit: number, skip: number): { branch?: string; limit: number; skip: number }
  // history.tsx
  export function HistoryView(): JSX   // 分支选择器 + 提交列表 + 加载更多；点行 → openGitCommit(shortHash)
  ```
- 纯函数放 `.ts` 模块是**刻意偏离** git.test.ts 的 source-extraction 模式（Progress.md 记录的约束只针对必须驻留 `.tsx` 的函数；`.ts` 可直接 import，更稳）。

- [ ] **Step 1: 写失败测试**（新建 `web/src/views/history-model.test.ts`）

```ts
// web/src/views/history-model.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCommitTime, logParams } from './history-model.ts';

const NOW = 1_700_000_000_000;

test('formatCommitTime：刚刚/分/时/天/日期 分桶', () => {
  assert.deepEqual(formatCommitTime(NOW, NOW), { kind: 'justNow', n: 0 });
  assert.deepEqual(formatCommitTime(NOW - 30_000, NOW), { kind: 'justNow', n: 0 });
  assert.deepEqual(formatCommitTime(NOW - 5 * 60_000, NOW), { kind: 'minute', n: 5 });
  assert.deepEqual(formatCommitTime(NOW - 3 * 3_600_000, NOW), { kind: 'hour', n: 3 });
  assert.deepEqual(formatCommitTime(NOW - 2 * 86_400_000, NOW), { kind: 'day', n: 2 });
  assert.deepEqual(formatCommitTime(NOW - 30 * 86_400_000, NOW), { kind: 'date', n: 0 });
});

test('logParams：缺省分支省略 / limit 钳制 [1,100] / skip 非负', () => {
  assert.deepEqual(logParams(null, 50, 0), { limit: 50, skip: 0 });
  assert.deepEqual(logParams('dev', 50, 0), { branch: 'dev', limit: 50, skip: 0 });
  assert.deepEqual(logParams('main', 999, -5), { branch: 'main', limit: 100, skip: 0 });
  assert.deepEqual(logParams(null, 0, 0), { limit: 1, skip: 0 });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --experimental-transform-types web/src/views/history-model.test.ts`
Expected: FAIL（Cannot find module './history-model.ts'）

- [ ] **Step 3a: 实现 history-model.ts**

```ts
// web/src/views/history-model.ts
// 历史视图的纯函数 + 共享文案：相对时间分桶 / 日志查询参数。独立 .ts 模块 → node --test 直接导入可测。
import { t } from '../i18n.ts';

export type CommitTime = { kind: 'justNow' | 'minute' | 'hour' | 'day' | 'date'; n: number };

/** 相对时间分桶：<1min 刚刚 / <1h 分钟 / <24h 小时 / <7d 天 / 更早 → 日期。now 显式入参保证可测。 */
export function formatCommitTime(ts: number, now: number): CommitTime {
  const diff = now - ts;
  if (diff < 60_000) return { kind: 'justNow', n: 0 };
  if (diff < 3_600_000) return { kind: 'minute', n: Math.floor(diff / 60_000) };
  if (diff < 86_400_000) return { kind: 'hour', n: Math.floor(diff / 3_600_000) };
  if (diff < 7 * 86_400_000) return { kind: 'day', n: Math.floor(diff / 86_400_000) };
  return { kind: 'date', n: 0 };
}

/** 本地化相对时间文案（历史/提交视图共用）；date 桶直接按浏览器区域格式化日期。 */
export function commitTimeLabel(c: { time: number }): string {
  const { kind, n } = formatCommitTime(c.time, Date.now());
  if (kind === 'justNow') return t('git.time.justNow');
  if (kind === 'minute') return t('git.time.minute', { n });
  if (kind === 'hour') return t('git.time.hour', { n });
  if (kind === 'day') return t('git.time.day', { n });
  return new Date(c.time).toLocaleDateString();
}

/** 日志查询参数：branch 缺省(null)=当前分支（不传）；limit 钳制 [1,100] 缺省 50；skip ≥ 0。防御性钳制，服务端仍白名单校验。 */
export function logParams(
  branch: string | null,
  limit: number,
  skip: number,
): { branch?: string; limit: number; skip: number } {
  const l = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 100) : 50;
  const s = Number.isFinite(skip) ? Math.max(Math.trunc(skip), 0) : 0;
  return branch ? { branch, limit: l, skip: s } : { limit: l, skip: s };
}
```

- [ ] **Step 3b: 实现 history.tsx**

```tsx
// web/src/views/history.tsx
// 历史日志视图：顶部分支选择器（仅切换"看哪条分支的历史"，不切换工作分支）+ 提交列表 + 加载更多。
// 点一行 → openGitCommit(shortHash) 打开该次提交的 diff 标签。
import { createEffect, createSignal, Show, For, onCleanup } from 'solid-js';
import { api, type GitBranches, type GitCommit } from '../api.ts';
import { gitRefreshTick, openGitCommit } from '../stores.ts';
import { commitTimeLabel, logParams } from './history-model.ts';
import { t } from '../i18n.ts';

const LIMIT = 50;

export function HistoryView() {
  const [branches, setBranches] = createSignal<GitBranches | null>(null);
  const [branch, setBranch] = createSignal<string | null>(null); // null = 当前分支
  const [commits, setCommits] = createSignal<GitCommit[]>([]);
  const [skip, setSkip] = createSignal(0);
  const [loading, setLoading] = createSignal(true);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // 分支选择器数据：挂载 + gitRefreshTick（checkout/新建分支后刷新；默认跟随当前分支）
  createEffect(() => {
    gitRefreshTick();
    void (async () => {
      try {
        const b = await api.git.branches();
        setBranches(b);
        if (b.current && !b.branches.some((x) => x.name === branch())) setBranch(b.current);
      } catch { /* 静默：非仓库/失败 → 空态 */ }
    })();
  });

  // 首屏 / 切分支 / 刷新：重拉第一页（cancelled 竞态守卫，同 git-diff 模板）
  createEffect(() => {
    const b = branch();
    gitRefreshTick();
    setLoading(true);
    setCommits([]); // 换分支时先清旧列表，避免显示错分支内容
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.git.log(logParams(b, LIMIT, 0));
        if (cancelled) return;
        setCommits(res.commits);
        setSkip(LIMIT);
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

  async function loadMore(): Promise<void> {
    if (loadingMore()) return;
    setLoadingMore(true);
    try {
      const res = await api.git.log(logParams(branch(), LIMIT, skip()));
      setCommits((prev) => [...prev, ...res.commits]);
      setSkip((s) => s + LIMIT);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

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
      <ul class="history-list">
        <For each={commits()}>
          {(c) => (
            <li>
              <button class="history-row" onClick={() => openGitCommit(c.shortHash)}>
                <span class="history-subject">{c.subject}</span>
                <span class="history-meta">
                  {c.author} · {commitTimeLabel(c)}
                  {c.decorations ? <span class="history-decoration">{c.decorations}</span> : null}
                </span>
              </button>
            </li>
          )}
        </For>
      </ul>
      <Show when={commits().length > 0}>
        <div class="history-more">
          <button class="link-btn" disabled={loadingMore()} onClick={() => void loadMore()}>
            {loadingMore() ? t('loading') : t('git.loadMore')}
          </button>
        </div>
      </Show>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test --experimental-transform-types web/src/views/history-model.test.ts`
Expected: 全部 PASS（2 测试）

Run: `npm run typecheck`
Expected: 0 errors（history.tsx 在此任务即可通过类型检查；i18n 新 key 尚未加，`t('git.time.justNow')` 现回退到 key 本身，运行时文案在 Task 8 补齐——typecheck 不受影响）

- [ ] **Step 5: Commit**

```bash
git add web/src/views/history-model.ts web/src/views/history.tsx web/src/views/history-model.test.ts
git commit -m "feat(git): 历史视图 + 相对时间/日志参数纯函数 + 测试"
```

---

### Task 6: 分支视图（BranchView）

**Files:**
- Create: `web/src/views/branch.tsx`

**Interfaces:**
- Consumes: Task 3 `api.git.branches` + `GitBranches`；Task 4 `createBranch`/`gitRefreshTick`；`t()`
- Produces: `export function BranchView(props: { onCheckout: (name: string) => void }): JSX` —— `onCheckout` 由 App 传入（App 的 `checkoutBranch` 保护流程，见 Task 8）。新建/切换成功都 bump `gitRefreshTick` → 本视图 effect 自动重拉列表。

- [ ] **Step 1: 实现 branch.tsx**（本任务无可直接单测的纯函数；验证靠 typecheck + Task 9 冒烟/手动清单）

```tsx
// web/src/views/branch.tsx
// 分支管理视图：顶部内联新建区 + 本地分支列表（当前 ✓；点非当前行 → 确认 dialog → 调 App 传入的 onCheckout）。
// 新建（stores.createBranch）/切换（App.checkoutBranch）成功后都会 bump gitRefreshTick → 本视图 effect 重拉列表。
import { createEffect, createSignal, Show, For } from 'solid-js';
import { api, type GitBranches } from '../api.ts';
import { createBranch, gitRefreshTick } from '../stores.ts';
import { t } from '../i18n.ts';

export function BranchView(props: { onCheckout: (name: string) => void }) {
  const [data, setData] = createSignal<GitBranches | null>(null);
  const [newName, setNewName] = createSignal('');
  const [creating, setCreating] = createSignal(false);
  const [confirmName, setConfirmName] = createSignal<string | null>(null); // 待确认切换的分支
  const [error, setError] = createSignal<string | null>(null);

  // 挂载 + gitRefreshTick（checkout / createBranch 成功后重拉）
  createEffect(() => {
    gitRefreshTick();
    void (async () => {
      try {
        setData(await api.git.branches());
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  });

  async function handleCreate(): Promise<void> {
    const name = newName().trim();
    if (!name || creating()) return;
    setCreating(true);
    try {
      await createBranch(name); // 成功 → stores bump tick → 列表自动重拉
      setNewName('');
    } catch (e) {
      setError((e as Error).message); // git 原始 stderr（spec §6.1）
    } finally {
      setCreating(false);
    }
  }

  return (
    <div class="branch-view">
      <div class="branch-create-bar">
        <input
          class="branch-name-input"
          value={newName()}
          onInput={(e) => setNewName(e.currentTarget.value)}
          placeholder={t('git.newBranchPlaceholder')}
        />
        <button class="icon-btn" disabled={!newName().trim() || creating()} onClick={() => void handleCreate()}>
          {creating() ? t('loading') : t('git.create')}
        </button>
      </div>
      <Show when={error()}>
        <div class="error-banner">{error()}</div>
      </Show>
      <Show when={data() && !data()?.isRepo}>
        <div class="view-placeholder">{t('git.notRepo')}</div>
      </Show>
      <ul class="branch-list">
        <For each={data()?.branches ?? []}>
          {(b) => (
            <li>
              {/* 当前分支行禁用点击（spec §6.1：切到已是当前的分支 → 无操作） */}
              <button class="branch-row" disabled={b.current} onClick={() => setConfirmName(b.name)}>
                <span class="branch-current">{b.current ? '✓' : ''}</span>
                <span class="branch-name">{b.name}</span>
                <span class="branch-tip">{b.tip}</span>
              </button>
            </li>
          )}
        </For>
      </ul>

      {/* 切换确认 dialog（复用 dialog-backdrop/dialog-card，spec §2） */}
      <Show when={confirmName()}>
        <div class="dialog-backdrop" onClick={() => setConfirmName(null)}>
          <div class="dialog-card" onClick={(e) => e.stopPropagation()}>
            <h3 class="dialog-title">{t('git.switchTo', { branch: confirmName()! })}</h3>
            <div class="dialog-actions">
              <button class="icon-btn" onClick={() => setConfirmName(null)}>{t('cancel')}</button>
              <button
                class="icon-btn"
                onClick={() => {
                  const n = confirmName();
                  setConfirmName(null);
                  if (n) props.onCheckout(n);
                }}
              >
                {t('git.switch')}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
```

- [ ] **Step 2: 验证**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add web/src/views/branch.tsx
git commit -m "feat(git): 分支视图（内联新建 + 列表 + 切换确认 dialog）"
```

---

### Task 7: 提交 diff 标签视图（CommitView）

**Files:**
- Create: `web/src/views/commit.tsx`

**Interfaces:**
- Consumes: Task 3 `api.git.show` + `GitCommit/GitShow` 类型；`createDiffEditor`/`DiffHandle`（既有 `web/src/editor/diff.ts`）；Task 5 `commitTimeLabel`
- Produces: `export function CommitView(props: { commit: string }): JSX` —— 顶部元信息头（短 hash · 作者 · 相对时间 + subject）+ 只读 CodeMirror 渲染该提交 unified diff。
- 结构完全对齐 `git-diff.tsx` 模板（createEffect + cancelled + onCleanup destroy）。

- [ ] **Step 1: 实现 commit.tsx**

```tsx
// web/src/views/commit.tsx
// git-commit 标签视图：某次提交的元信息头 + 该提交 unified diff（只读 CodeMirror，复用 createDiffEditor）。
// 结构同 git-diff.tsx 模板：props.commit 变化 → 清旧编辑器 → 拉 show → 渲染；onCleanup 取消 + destroy。
import { createEffect, createSignal, Show, onCleanup } from 'solid-js';
import { api, type GitCommit } from '../api.ts';
import { createDiffEditor, type DiffHandle } from '../editor/diff.ts';
import { commitTimeLabel } from './history-model.ts';
import { t } from '../i18n.ts';

export function CommitView(props: { commit: string }) {
  let container: HTMLDivElement | undefined;
  const [meta, setMeta] = createSignal<GitCommit | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    const commit = props.commit;
    const el = container!;
    let handle: DiffHandle | undefined;
    let cancelled = false;
    setError(null);
    setMeta(null);
    void (async () => {
      try {
        const { commit: c, diff } = await api.git.show(commit);
        if (cancelled) return;
        setMeta(c);
        handle = createDiffEditor(el, diff);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
      }
    })();
    onCleanup(() => {
      cancelled = true;
      handle?.destroy();
    });
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
      <div ref={container} class="git-diff-editor" />
    </div>
  );
}
```

- [ ] **Step 2: 验证**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add web/src/views/commit.tsx
git commit -m "feat(git): 提交 diff 标签视图（元信息头 + 只读 diff）"
```

---

### Task 8: 集成接线（工具栏两态 + checkout 保护 + tabs + GitView 刷新 + 样式 + i18n）

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/views/git.tsx`
- Modify: `web/src/views/tabs.tsx`
- Modify: `web/src/i18n.ts`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: Task 4 `openGitHistory/openGitBranch/createBranch/currentBranch/gitRefreshTick/setGitRefreshTick`；Task 5 `HistoryView`；Task 6 `BranchView`；Task 7 `CommitView`
- Produces: 工具栏两态（git 标签 → `[⑂ 分支名] [📜] [🔄] [➕]`，隐藏 🔍 与 ✎）；`checkoutBranch(name)` 保护流程；`handleEditorChange` 只读 guard；主区域 git-history/git-branch/git-commit 三个 Show；tabs.tsx 三 kind 分派；GitView 刷新 effect；i18n 18 key；样式。

#### 8a. App.tsx —— 工具栏两态 + 主区域接线 + checkout 保护

- [ ] **Step 1: 改 App.tsx 逻辑区**

import 行追加：`openGitHistory, openGitBranch, createBranch, currentBranch, gitRefreshTick, setGitRefreshTick`（从 './stores.ts'）；`HistoryView`（'./views/history.tsx'）、`BranchView`（'./views/branch.tsx'）、`CommitView`（'./views/commit.tsx'）。

`activeGitDiffPath()` 定义之后加：

```ts
  // git 相关标签（git 面板 / 历史 / 分支 / 提交）激活 → 工具栏切 git 态（spec §1；git-diff 保持文件态）
  const isGitKind = () => {
    const k = activeTab()?.kind;
    return k === 'git' || k === 'git-history' || k === 'git-branch' || k === 'git-commit';
  };
  // git-commit 前台时其短 hash（TS 收窄：单次读 activeTab() 再分支，同 activeGitDiffPath 约定）
  const activeCommitHash = (): string | null => {
    const tab = activeTab();
    return tab?.kind === 'git-commit' ? tab.commit : null;
  };
```

`handleEditorChange` 加只读 guard（spec §5.4 纵深防御：只读模式的文件不要自动保存）：

```ts
  function handleEditorChange(doc: string) {
    const path = currentFile();
    if (!path) return;
    if (roMode()) return; // 只读模式不自动保存（checkout 前切只读后，防抖内的后续编辑不落盘）
    scheduleSave(path, doc);
  }
```

`flushSave()` 定义之后加切换保护流程与新建分支 dialog 状态：

```ts
  /**
   * 切换分支保护（spec §5.4，用户规则）：
   * 1) flushSave() 立即保存防抖中的待写内容（此刻 roMode 仍 false，ro=0 放行）
   * 2) setRoMode(true) → 编辑器转只读（handleEditorChange 的 roMode guard 同时生效 → 只读期间不自动保存）
   * 3) api.git.checkout(name)
   * 4) 成功 → currentBranch 更新 + gitRefreshTick bump（git 面板/历史/分支全部重拉）；
   *    已打开的文件标签不关闭（用户要求），切回文件标签时 currentFile 变化 → loadDoc 自动从新分支重读；
   *    编辑器保持只读（用户规则），用户回文件标签按 ✎ 可自行切回可写
   * 5) 失败 → Toast git 原始 stderr；分支不变；编辑器保持「已保存 + 只读」（flushSave 已把防抖内容落盘旧分支，改动不丢）
   */
  async function checkoutBranch(name: string): Promise<void> {
    flushSave();
    setRoMode(true);
    try {
      await api.git.checkout(name);
      setCurrentBranch(name);
      setGitRefreshTick((x) => x + 1);
      showToast(t('git.checkoutDone', { branch: name }), 'success');
    } catch (e) {
      showToast(t('git.checkoutFail', { msg: (e as Error).message }), 'error');
    }
  }

  // 工具栏 ➕ 新建分支：直接弹内联 dialog（复用 dialog-backdrop/dialog-card）
  const [branchDialogOpen, setBranchDialogOpen] = createSignal(false);
  const [newBranchName, setNewBranchName] = createSignal('');
  const [branchCreating, setBranchCreating] = createSignal(false);

  async function handleNewBranch(): Promise<void> {
    const name = newBranchName().trim();
    if (!name || branchCreating()) return;
    setBranchCreating(true);
    try {
      await createBranch(name);
      setBranchDialogOpen(false);
      setNewBranchName('');
      showToast(t('git.branchCreated', { name }), 'success');
    } catch (e) {
      showToast(t('git.branchCreateFail', { msg: (e as Error).message }), 'error');
    } finally {
      setBranchCreating(false);
    }
  }
```

- [ ] **Step 2: 改 App.tsx 工具栏 JSX**（替换现有 `<header class="toolbar">...</header>` 整块）

```tsx
      <header class="toolbar">
        <button class="icon-btn" onClick={() => setDrawerOpen(!drawerOpen())} title={t('menu')}>
          ☰
        </button>
        <Show
          when={!isGitKind()}
          fallback={
            <>
              {/* git 态：⑂ 分支名 → 分支标签；📜 历史；🔄 刷新（bump tick）；➕ 新建分支 dialog */}
              <button class="icon-btn git-branch-btn" onClick={() => openGitBranch()} title={t('git.branch')}>
                {currentBranch() ?? '—'}
              </button>
              <button class="icon-btn" onClick={() => openGitHistory()} title={t('git.history')}>
                📜
              </button>
              <button class="icon-btn" onClick={() => setGitRefreshTick((x) => x + 1)} title={t('git.refresh')}>
                🔄
              </button>
              <button class="icon-btn" onClick={() => setBranchDialogOpen(true)} title={t('git.newBranch')}>
                ➕
              </button>
            </>
          }
        >
          <button class="icon-btn" onClick={() => editorHandle()?.openSearch()} title={t('find')} disabled={!currentFile()}>
            🔍
          </button>
          <span class="toolbar-path">{toolbarPathLabel()}</span>
          <button
            class={`icon-btn ${roMode() ? '' : 'active'}`}
            onClick={() => {
              // 编辑→只读：先把防抖中的修改立即落盘（此时 roMode 仍 false，ro=0 放行）
              if (!roMode()) flushSave();
              const next = !roMode();
              setRoMode(next);
              pushState();
            }}
            title={roMode() ? t('switchEdit') : t('switchReadonly')}
          >
            ✎
          </button>
        </Show>
      </header>
```

- [ ] **Step 3: 改 App.tsx 主区域**（在既有 `<Show when={activeGitDiffPath()}>` 之后加 3 个 Show）

```tsx
        <Show when={activeKind() === 'git-history'}>
          <HistoryView />
        </Show>
        <Show when={activeKind() === 'git-branch'}>
          <BranchView onCheckout={(name) => void checkoutBranch(name)} />
        </Show>
        <Show when={activeCommitHash()}>
          <CommitView commit={activeCommitHash()!} />
        </Show>
```

在 `</main>` 之后、`<Show when={drawerOpen()...}>` 之前加新建分支 dialog：

```tsx
      {/* 工具栏 ➕ 新建分支 dialog（Enter 提交 + 点遮罩关闭） */}
      <Show when={branchDialogOpen()}>
        <div class="dialog-backdrop" onClick={() => setBranchDialogOpen(false)}>
          <div class="dialog-card" onClick={(e) => e.stopPropagation()}>
            <h3 class="dialog-title">{t('git.newBranch')}</h3>
            <input
              class="dialog-input"
              value={newBranchName()}
              onInput={(e) => setNewBranchName(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleNewBranch(); }}
              placeholder={t('git.newBranchPlaceholder')}
            />
            <div class="dialog-actions">
              <button class="icon-btn" onClick={() => setBranchDialogOpen(false)}>{t('cancel')}</button>
              <button
                class="icon-btn"
                disabled={!newBranchName().trim() || branchCreating()}
                onClick={() => void handleNewBranch()}
              >
                {branchCreating() ? t('loading') : t('git.create')}
              </button>
            </div>
          </div>
        </div>
      </Show>
```

#### 8b. GitView 刷新 effect

- [ ] **Step 4: 改 web/src/views/git.tsx**

import：`onMount` 改为 `createEffect`（同时保留 `createSignal, For, Show`）；从 '../stores.ts' 加 `gitRefreshTick`。替换：

```tsx
  onMount(() => void refresh());
```

为：

```tsx
  // 挂载 + gitRefreshTick（checkout/commit/刷新后 bump → 重拉 status；标签切走再切回即重新挂载 → 自动刷新）
  createEffect(() => {
    gitRefreshTick();
    void refresh();
  });
```

#### 8c. tabs.tsx 三 kind 分派

- [ ] **Step 5: 改 web/src/views/tabs.tsx**

```tsx
function tabIcon(tab: TabItem): string {
  if (tab.kind === 'file') return '📄';
  if (tab.kind === 'terminal') return '🖥';
  if (tab.kind === 'git') return '🕘';
  if (tab.kind === 'git-history') return '📜';
  if (tab.kind === 'git-branch') return '⑂';
  if (tab.kind === 'git-commit') return '↔';
  return '↔'; // git-diff
}

function tabName(tab: TabItem): string {
  if (tab.kind === 'file' || tab.kind === 'git-diff') return tab.path.split('/').pop() ?? tab.path;
  if (tab.kind === 'terminal') return tab.name;
  if (tab.kind === 'git-history') return t('git.history');
  if (tab.kind === 'git-branch') return t('git.branch');
  if (tab.kind === 'git-commit') return tab.commit;
  return t('view.git');
}

function tabTitle(tab: TabItem): string {
  if (tab.kind === 'file' || tab.kind === 'git-diff') return tab.path;
  if (tab.kind === 'git-history') return t('git.history');
  if (tab.kind === 'git-branch') return t('git.branch');
  if (tab.kind === 'git-commit') return tab.commit;
  return t('view.git');
}
```

（`closeTabById` 的 `else` 分支已覆盖新三 kind——`closeGitTab(id)` 按 id 关视图、不杀进程，无需改。）

#### 8d. i18n key

- [ ] **Step 6: 改 web/src/i18n.ts**

`en` 字典 `'git.openInEditor'` 之后追加：

```ts
    'git.history': 'History',
    'git.branch': 'Branches',
    'git.refresh': 'Refresh',
    'git.newBranch': 'New branch',
    'git.newBranchPlaceholder': 'Branch name',
    'git.create': 'Create',
    'git.switchTo': 'Switch to "{branch}"?',
    'git.switch': 'Switch',
    'git.emptyHistory': 'No commits yet',
    'git.loadMore': 'Load more',
    'git.checkoutDone': 'Switched to {branch}',
    'git.checkoutFail': 'Failed to switch: {msg}',
    'git.branchCreated': 'Branch {name} created',
    'git.branchCreateFail': 'Failed to create branch: {msg}',
    'git.time.justNow': 'just now',
    'git.time.minute': '{n} min ago',
    'git.time.hour': '{n} hr ago',
    'git.time.day': '{n} days ago',
```

`zh` 字典同样位置追加：

```ts
    'git.history': '历史',
    'git.branch': '分支',
    'git.refresh': '刷新',
    'git.newBranch': '新建分支',
    'git.newBranchPlaceholder': '分支名',
    'git.create': '创建',
    'git.switchTo': '切换到「{branch}」？',
    'git.switch': '切换',
    'git.emptyHistory': '暂无提交',
    'git.loadMore': '加载更多',
    'git.checkoutDone': '已切换到 {branch}',
    'git.checkoutFail': '切换失败：{msg}',
    'git.branchCreated': '已创建分支 {name}',
    'git.branchCreateFail': '创建分支失败：{msg}',
    'git.time.justNow': '刚刚',
    'git.time.minute': '{n} 分钟前',
    'git.time.hour': '{n} 小时前',
    'git.time.day': '{n} 天前',
```

#### 8e. 样式

- [ ] **Step 7: 改 web/src/styles.css**（文件末尾追加）

```css
/* ---- 历史 / 分支 / 提交 视图 + git 工具栏（2026-08-09） ---- */
.git-branch-btn { min-width: 64px; max-width: 160px; padding: 6px 10px; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.history-view { font-size: 13px; display: flex; flex-direction: column; gap: 8px; height: 100%; min-height: 0; }
.history-bar { display: flex; padding: 8px; border-bottom: 1px solid var(--border); }
.history-select {
  flex: 1; min-height: 44px; font-size: 16px; padding: 0 8px;
  border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: inherit;
}
.history-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; min-height: 0; }
.history-row {
  width: 100%; background: none; border: none; text-align: left; cursor: pointer;
  border-bottom: 1px solid var(--border); padding: 6px 10px; min-height: 44px; color: inherit;
}
.history-subject { display: block; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-meta { display: block; font-size: 11px; color: var(--muted); margin-top: 2px; }
.history-decoration {
  margin-left: 6px; padding: 0 5px; border-radius: 4px; background: var(--border);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px;
}
.history-more { padding: 8px; text-align: center; }
.history-more .link-btn { min-height: 40px; display: inline-flex; align-items: center; }

.branch-view { font-size: 13px; display: flex; flex-direction: column; gap: 8px; height: 100%; min-height: 0; }
.branch-create-bar { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid var(--border); }
.branch-name-input {
  flex: 1; min-height: 44px; font-size: 16px; padding: 0 10px;
  border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: inherit;
}
.branch-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; min-height: 0; }
.branch-row {
  display: flex; align-items: center; gap: 8px; width: 100%;
  background: none; border: none; text-align: left; cursor: pointer;
  border-bottom: 1px solid var(--border); padding: 4px 10px; min-height: 44px; color: inherit;
}
.branch-row:disabled { cursor: default; opacity: 1; } /* 当前分支行不禁用变淡 */
.branch-current { flex: 0 0 auto; color: var(--accent); width: 16px; }
.branch-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.branch-tip { flex: 0 0 auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--muted); }

/* 提交标签视图：git-diff 骨架 + 元信息头 */
.git-commit-header {
  display: flex; flex-direction: column; gap: 2px;
  padding: 6px 10px; border-bottom: 1px solid var(--border);
}
.git-commit-meta { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--muted); }
.git-commit-subject { font-size: 14px; }
```

- [ ] **Step 8: 全量验证**

Run: `npm test`
Expected: 全部 PASS（既有 158 + 本计划新增约 20）

Run: `npm run typecheck`
Expected: 0 errors

Run: `npm run build`
Expected: 成功（仅既有 >500kB chunk 警告）

- [ ] **Step 9: Commit**

```bash
git add web/src/App.tsx web/src/views/git.tsx web/src/views/tabs.tsx web/src/i18n.ts web/src/styles.css
git commit -m "feat(git): 工具栏两态 + checkout 保护接线 + tabs 分派 + 样式 + i18n"
```

---

### Task 9: 全量验证（无头冒烟）

**Files:** 无代码改动（验证任务）

- [ ] **Step 1: 三闸验证**

Run: `npm test` → 全绿；`npm run typecheck` → 0 errors；`npm run build` → 成功。

- [ ] **Step 2: 无头冒烟**（临时目录 git 仓库 + 服务器真实仓库各跑一遍）

临时仓库：
```bash
TMP=$(mktemp -d) && cd "$TMP" && git init -q && git config user.email t@t && git config user.name t \
  && echo one > a.txt && git add . && git commit -qm init \
  && echo two >> a.txt && git add . && git commit -qm second \
  && git checkout -qb dev
```
起服务（选一个未被占用的端口，例如 3199）：
```bash
node --experimental-transform-types server/index.js --port 3199 --root "$TMP" &
SRV=$!
```
验证（curl 逐一断言）：
```bash
curl -s 'http://127.0.0.1:3199/api/git/branches' | grep -q '"current":"dev"'   # branches: current=dev
curl -s 'http://127.0.0.1:3199/api/git/log?limit=5' | grep -q '"isRepo":true'   # log: isRepo
curl -s 'http://127.0.0.1:3199/api/git/log?limit=5' | grep -c '"shortHash"'     # log: 2 commits
curl -s 'http://127.0.0.1:3199/api/git/log?branch=nope' | grep -q '"error"'     # 非法 branch → error
curl -s -X POST -H 'Content-Type: application/json' -d '{"name":"smoke"}' \
  'http://127.0.0.1:3199/api/git/create-branch' | grep -q '"current":"smoke"'   # 新建分支
curl -s -X POST -H 'Content-Type: application/json' -d '{"name":"main"}' \
  'http://127.0.0.1:3199/api/git/checkout' | grep -q '"current":"main"'         # 切回 main
H=$(curl -s 'http://127.0.0.1:3199/api/git/log?limit=1' | grep -o '"shortHash":"[0-9a-f]*"' | head -1 | cut -d'"' -f4)
curl -s "http://127.0.0.1:3199/api/git/show?commit=$H" | grep -q '^"diff"'       # show: diff 非空
curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3199/' | grep -q '200'  # 页面 200
```
**停止服务必须按精确 PID**（`kill $SRV`），绝不用裸 `pkill -f 'bin/anther.js'`（会误杀用户 3000 端口生产进程）。
清理：`rm -rf "$TMP"`。

真实仓库（本仓库就是 git 仓库）：另起一端口指向 `/root/projects/anther`，curl `/api/git/branches` 确认 `current:"main"`、`/api/git/log` 确认返回最近提交，同样按 PID 停止。

- [ ] **Step 3: 更新 SDD ledger**

在 `.superpowers/sdd/2026-08-09-history-branches/progress.md` 记录每个 task 完成状态、deferred minors、本冒烟结果。（首次执行时创建该文件，含 BASE 提交号。）

- [ ] **Step 4: 手动清单（真机，留给用户）**

开历史 → 切分支看历史 → 点提交看 diff；开分支 → 新建分支 → 切分支（确认编辑器先保存 + 变只读、已打开标签不关、切回文件标签内容来自新分支）；工具栏两态切换（git 标签 vs 文件标签）；刷新按钮重拉 git 面板/历史/分支；新建分支 dialog（Enter / 遮罩关闭 / 失败 Toast）。

---

## Self-Review（写完后执行，发现问题就地修）

**1. Spec 覆盖核对：**
- §4.2 五个方法 → Task 1 ✅（branches/log/checkout/createBranch/show 全有）
- §4.3 白名单：log.branch ∈ branches()、checkout.name ∈ branches()、createBranch check-ref-format、show.commit `/^[0-9a-f]{4,64}$/i`、limit/skip 整数钳制 → Task 1 全实现并测试 ✅
- §4.4 五条路由 → Task 2 ✅（含缺参 400、`{error}` 结构由既有 HttpError 管道保证）
- §5.1 标签模型 + stores → Task 3/4 ✅（currentBranch、gitRefreshTick、三个 open*、createBranch；checkoutBranch 按决议放 App.tsx，plan 权威）
- §5.2 工具栏两态 → Task 8a ✅（isGitKind 集合含 git/git-history/git-branch/git-commit，git-diff 保持文件态；⑂/📜/🔄/➕ 四按钮）
- §5.3 三视图 → Task 5/6/7 ✅（HistoryView 分支选择器 + 加载更多 + formatCommitTime；BranchView 新建 + 确认 dialog；CommitView 元信息头 + createDiffEditor）
- §5.4 切换保护五步 → Task 8a checkoutBranch ✅（flushSave → setRoMode(true) → checkout → 成功 bump tick/失败 Toast；handleEditorChange roMode guard；文件标签不关闭；编辑器保持只读）
- §6.1 错误处理 → checkout 冲突 400+Toast、createBranch 非法/已存在 400、log/show 失败 Toast、切当前分支无操作 ✅
- §6.2 边界 → 空仓库 log 空列表、合并提交 git show 默认语义、-n 50 翻页、hash 白名单 ✅
- §6.3 测试 → Task 1/2/3/5 单测 + Task 9 冒烟 + 手动清单 ✅

**2. 占位符扫描：** 无 TBD/TODO；每个代码步骤都是真实代码。

**3. 类型一致性核对：**
- `GitBranches.current: string | null` 贯穿 server（git.ts）→ routes → api.ts → stores `setCurrentBranch` → 工具栏 `currentBranch() ?? '—'` ✅
- `GitCommit.shortHash` 由 log 产出 → `openGitCommit(c.shortHash)` → tab `commit` 字段 → `api.git.show(commit)` → server `/^[0-9a-f]{4,64}$/i` ✅
- `BranchView` 的 `onCheckout` prop 与 App `checkoutBranch(name): Promise<void>` 签名一致（`(name) => void checkoutBranch(name)`）✅
- `commitTimeLabel(c: { time: number })` 被 HistoryView 与 CommitView 共用，参数形状一致 ✅
- `logParams` 返回对象直接透传给 `api.git.log(params)` 签名（`{branch?, limit?, skip?}`）✅
- tab-model：`addGitHistoryTab/addGitBranchTab/addGitCommitTab` 命名与 Task 3/4 用法一致；`gitCommitTabId` 在 stores 与测试中同一函数 ✅

**发现的问题（就地修）：**
- 无。计划中 `checkoutBranch` 放 App.tsx 与 spec §5.1「stores」措辞的偏差已在 Task 4 Interfaces 块显式标注（plan 权威，沿用 git MVP 的先例），避免实现者困惑。
