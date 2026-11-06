// server/git.test.ts
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { Git } from './git.ts';
import { HttpError } from './http-error.ts';

const execFileP = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let repoDir: string;
let git: Git;

function gitCmd(args: string[]) {
  return execFileP('git', args, { cwd: repoDir });
}

beforeEach(async () => {
  repoDir = await mkdtemp(path.join(os.tmpdir(), 'anther-git-'));
  await gitCmd(['init', '-qb', 'main']); // 强制初始分支名 main（环境 init.defaultBranch 未配置时默认 master）
  await gitCmd(['config', 'user.email', 't@t']);
  await gitCmd(['config', 'user.name', 't']);
  await writeFile(path.join(repoDir, 'tracked.txt'), 'line1\n');
  await writeFile(path.join(repoDir, 'gone.txt'), 'delete me\n');
  await gitCmd(['add', '.']);
  await gitCmd(['commit', '-qm', 'init']);
  git = new Git(repoDir);
});

afterEach(async () => { await rm(repoDir, { recursive: true, force: true }); });

test('status：未跟踪 ?? / 修改 M / 删除 D 解析为显示状态字母', async () => {
  await writeFile(path.join(repoDir, 'tracked.txt'), 'line1\nline2\n');
  await writeFile(path.join(repoDir, 'new.txt'), 'brand new\n');
  await rm(path.join(repoDir, 'gone.txt'));
  const st = await git.status();
  assert.equal(st.isRepo, true);
  const byPath = Object.fromEntries(st.changes.map((c) => [c.path, c.status]));
  assert.equal(byPath['tracked.txt'], 'M');
  assert.equal(byPath['new.txt'], '??');
  assert.equal(byPath['gone.txt'], 'D');
});

test('diff：已跟踪修改 → unified diff（@@ 头 + 增删行）', async () => {
  await writeFile(path.join(repoDir, 'tracked.txt'), 'line1\nline2\n');
  const d = await git.diff('tracked.txt');
  assert.match(d, /^diff --git/);
  assert.match(d, /@@/);
  assert.match(d, /\+line2/);
});

test('diff：未跟踪文件 → 整文件新增（new file mode + 全 + 行）', async () => {
  await writeFile(path.join(repoDir, 'new.txt'), 'brand new\n');
  const d = await git.diff('new.txt');
  assert.match(d, /new file mode/);
  assert.match(d, /^\+brand new$/m);
});

test('commit：add + commit 勾选路径，之后 status 清空', async () => {
  await writeFile(path.join(repoDir, 'tracked.txt'), 'line1\nline2\n');
  await writeFile(path.join(repoDir, 'new.txt'), 'x\n');
  await git.commit(['tracked.txt', 'new.txt'], 'update a, add new');
  const st = await git.status();
  assert.equal(st.isRepo, true);
  assert.deepEqual(st.changes, []);
});

test('非仓库 / git 缺失 → isRepo:false', async () => {
  const plainDir = await mkdtemp(path.join(os.tmpdir(), 'anther-plain-'));
  try {
    const g = new Git(plainDir);
    const st = await g.status();
    assert.equal(st.isRepo, false);
    assert.deepEqual(st.changes, []);
  } finally {
    await rm(plainDir, { recursive: true, force: true });
  }
});

test('路径逃逸 → 400', async () => {
  await assert.rejects(() => git.diff('../outside.txt'), (e: unknown) => (e as HttpError).status === 400);
});

test('commit：空消息 / 空路径 → 400', async () => {
  await assert.rejects(() => git.commit(['tracked.txt'], '   '), (e: unknown) => (e as HttpError).status === 400);
  await assert.rejects(() => git.commit([], 'msg'), (e: unknown) => (e as HttpError).status === 400);
});

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
  await sleep(1100); // 同一秒内两次提交 → %at 相同，> 断言必挂；等 1.1s 保证 author 时间戳严格递增
  await gitCmd(['add', '.']);
  await gitCmd(['commit', '-qm', 'second']);
  const log = await git.log(null, 50, 0);
  assert.equal(log.isRepo, true);
  assert.equal(log.commits.length, 2);
  assert.equal(log.commits[0].subject, 'second');
  assert.equal(log.commits[1].subject, 'init');
  assert.match(log.commits[0].shortHash, /^[0-9a-f]{7}$/);
  assert.ok(log.commits[0].time > log.commits[1].time);
  // %at 是 epoch 秒，接口统一转毫秒：时间戳应接近 Date.now()（若按秒原样透传会差 ~1.7e12）
  assert.ok(Math.abs(Date.now() - log.commits[0].time) < 60_000);
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
  await assert.rejects(() => git.log(null, 1001, 0), (e: unknown) => (e as HttpError).status === 400);
  await assert.rejects(() => git.log(null, 1.5, 0), (e: unknown) => (e as HttpError).status === 400);
  await assert.rejects(() => git.log(null, 50, -1), (e: unknown) => (e as HttpError).status === 400);
});

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

test('log：空仓库（unborn）→ isRepo:true + 空 commits', async () => {
  const emptyDir = await mkdtemp(path.join(os.tmpdir(), 'anther-empty-'));
  try {
    await execFileP('git', ['init', '-q'], { cwd: emptyDir });
    const g = new Git(emptyDir);
    const log = await g.log(null, 50, 0);
    assert.equal(log.isRepo, true);
    assert.deepEqual(log.commits, []);
  } finally {
    await rm(emptyDir, { recursive: true, force: true });
  }
});

test('log：非仓库 → isRepo:false + 空 commits（不再 500）', async () => {
  const plainDir = await mkdtemp(path.join(os.tmpdir(), 'anther-plain-'));
  try {
    const log = await new Git(plainDir).log(null, 50, 0);
    assert.equal(log.isRepo, false);
    assert.deepEqual(log.commits, []);
    // 非仓库下指定 branch 同样返回 isRepo:false（白名单前先判 isRepo，spec §6.1）
    const named = await new Git(plainDir).log('dev', 50, 0);
    assert.equal(named.isRepo, false);
    assert.deepEqual(named.commits, []);
  } finally {
    await rm(plainDir, { recursive: true, force: true });
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
  const head = (await gitCmd(['rev-parse', '--short', 'HEAD'])).stdout.trim();
  const { commit, diff } = await git.show(head);
  assert.equal(commit.subject, 'second');
  assert.match(diff, /^diff --git/);
  assert.match(diff, /\+line2/);
});

test('show：非 hex → 400', async () => {
  await assert.rejects(() => git.show('../x'), (e: unknown) => (e as HttpError).status === 400);
  await assert.rejects(() => git.show('HEAD'), (e: unknown) => (e as HttpError).status === 400);
});

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
  assert.match(diff, /diff --git a\/dev\.txt/);     // 标准 unified（相对第一父 = 合并引入的 dev 改动）
  assert.doesNotMatch(diff, /diff --cc|diff --combined/); // 非 combined
  assert.match(diff, /\+dev/);                     // 含合并引入的 dev 侧新增
  assert.doesNotMatch(diff, /main\.txt/);          // 第一父（main）已有 main.txt → 不出现（第一父语义）
});

test('status：XY 两列、staged、分支与上游/领先落后字段', async () => {
  await writeFile(path.join(repoDir, 'tracked.txt'), 'line1\nline2\n');
  await gitCmd(['add', 'tracked.txt']);
  await writeFile(path.join(repoDir, 'tracked.txt'), 'line1\nline2\nline3\n');
  await writeFile(path.join(repoDir, 'new.txt'), 'x\n');
  const st = await git.status();
  assert.equal(st.branch, 'main');
  assert.equal(st.hasCommits, true);
  assert.equal(st.upstream, null);
  assert.equal(st.ahead, 0);
  assert.equal(st.behind, 0);
  const tracked = st.changes.find((c) => c.path === 'tracked.txt')!;
  assert.equal(tracked.index, 'M');
  assert.equal(tracked.worktree, 'M');
  assert.equal(tracked.staged, true);
  const untracked = st.changes.find((c) => c.path === 'new.txt')!;
  assert.equal(untracked.status, '??');
  assert.equal(untracked.index, '?');
  assert.equal(untracked.staged, false);
});

test('stage/unstage：修改 + 新增进入/退出暂存区', async () => {
  await writeFile(path.join(repoDir, 'tracked.txt'), 'line1\nline2\n');
  await writeFile(path.join(repoDir, 'new.txt'), 'x\n');
  await git.stage(['tracked.txt', 'new.txt']);
  let st = await git.status();
  assert.equal(st.changes.find((c) => c.path === 'tracked.txt')!.index, 'M');
  assert.equal(st.changes.find((c) => c.path === 'new.txt')!.index, 'A');

  await git.unstage(['tracked.txt', 'new.txt']);
  st = await git.status();
  assert.equal(st.changes.find((c) => c.path === 'tracked.txt')!.index, ' ');
  assert.equal(st.changes.find((c) => c.path === 'new.txt')!.status, '??');
});

test('stage：删除也进入暂存区', async () => {
  await rm(path.join(repoDir, 'gone.txt'));
  await git.stage(['gone.txt']);
  const change = (await git.status()).changes.find((c) => c.path === 'gone.txt')!;
  assert.equal(change.index, 'D');
});

test('discard：恢复已跟踪修改/删除，并清理未跟踪文件与目录', async () => {
  await writeFile(path.join(repoDir, 'tracked.txt'), 'changed\n');
  await rm(path.join(repoDir, 'gone.txt'));
  await writeFile(path.join(repoDir, 'new.txt'), 'x\n');
  await mkdir(path.join(repoDir, 'dir'));
  await writeFile(path.join(repoDir, 'dir', 'inner.txt'), 'y\n');

  await git.discard(['tracked.txt', 'gone.txt', 'new.txt', 'dir/']);

  assert.equal(await readFile(path.join(repoDir, 'tracked.txt'), 'utf8'), 'line1\n');
  assert.equal(await readFile(path.join(repoDir, 'gone.txt'), 'utf8'), 'delete me\n');
  await assert.rejects(() => readFile(path.join(repoDir, 'new.txt')));
  await assert.rejects(() => readFile(path.join(repoDir, 'dir', 'inner.txt')));
  assert.deepEqual((await git.status()).changes, []);
});

test('discard：已暂存的新文件取消暂存并删除', async () => {
  await writeFile(path.join(repoDir, 'new.txt'), 'x\n');
  await git.stage(['new.txt']);
  await git.discard(['new.txt']);
  await assert.rejects(() => readFile(path.join(repoDir, 'new.txt')));
  assert.deepEqual((await git.status()).changes, []);
});

test('commit：只提交已暂存内容，工作区其余改动保留', async () => {
  await writeFile(path.join(repoDir, 'tracked.txt'), 'line1\nline2\n');
  await writeFile(path.join(repoDir, 'new.txt'), 'x\n');
  await git.stage(['tracked.txt']);
  await git.commit([], 'staged change');
  const st = await git.status();
  assert.deepEqual(st.changes.map((c) => c.path), ['new.txt']);
  const log = await git.log(null, 1, 0);
  assert.equal(log.commits[0].subject, 'staged change');
});

test('commit amend：改写上一条提交且不新增提交', async () => {
  await writeFile(path.join(repoDir, 'tracked.txt'), 'line1\nline2\n');
  await git.stage(['tracked.txt']);
  await git.commit([], 'second');
  await writeFile(path.join(repoDir, 'tracked.txt'), 'line1\nline2\nline3\n');
  await git.stage(['tracked.txt']);
  await git.commit([], 'second amended', true);
  const log = await git.log(null, 10, 0);
  assert.equal(log.commits.length, 2); // init + 被改写的 second
  assert.equal(log.commits[0].subject, 'second amended');
  assert.equal((await git.status()).changes.length, 0);
});

test('commit：无暂存内容 → 400；unborn 仓库 amend → 400', async () => {
  await assert.rejects(() => git.commit([], 'nothing'), (e: unknown) => (e as HttpError).status === 400);
  const emptyDir = await mkdtemp(path.join(os.tmpdir(), 'anther-empty-'));
  try {
    await execFileP('git', ['init', '-q'], { cwd: emptyDir });
    await assert.rejects(() => new Git(emptyDir).commit([], 'amend', true), (e: unknown) => (e as HttpError).status === 400);
  } finally {
    await rm(emptyDir, { recursive: true, force: true });
  }
});

test('status/push/fetch/pull：上游领先落后与快进', async () => {
  const remoteDir = await mkdtemp(path.join(os.tmpdir(), 'anther-git-remote-'));
  const otherDir = await mkdtemp(path.join(os.tmpdir(), 'anther-git-other-'));
  try {
    await execFileP('git', ['init', '--bare', '-q', remoteDir], { cwd: repoDir });
    await execFileP('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: remoteDir });
    await gitCmd(['remote', 'add', 'origin', remoteDir]);
    await gitCmd(['push', '-q', '-u', 'origin', 'main']);

    let st = await git.status();
    assert.equal(st.upstream, 'origin/main');
    assert.equal(st.ahead, 0);
    assert.equal(st.behind, 0);

    await writeFile(path.join(repoDir, 'tracked.txt'), 'line1\nlocal\n');
    await git.commit(['tracked.txt'], 'local');
    st = await git.status();
    assert.equal(st.ahead, 1);
    const pushed = await git.push();
    assert.match(pushed.output, /main/);
    st = await git.status();
    assert.equal(st.ahead, 0);

    await execFileP('git', ['clone', '-q', remoteDir, otherDir], { cwd: repoDir });
    await execFileP('git', ['config', 'user.email', 'o@o'], { cwd: otherDir });
    await execFileP('git', ['config', 'user.name', 'o'], { cwd: otherDir });
    await writeFile(path.join(otherDir, 'tracked.txt'), 'line1\nremote\n');
    await execFileP('git', ['commit', '-qam', 'remote'], { cwd: otherDir });
    await execFileP('git', ['push', '-q', 'origin', 'main'], { cwd: otherDir });

    const fetched = await git.fetch();
    assert.equal(typeof fetched.output, 'string');
    st = await git.status();
    assert.equal(st.behind, 1);
    await git.pull();
    st = await git.status();
    assert.equal(st.behind, 0);
    assert.equal(await readFile(path.join(repoDir, 'tracked.txt'), 'utf8'), 'line1\nremote\n');
  } finally {
    await rm(remoteDir, { recursive: true, force: true });
    await rm(otherDir, { recursive: true, force: true });
  }
});

test('push/pull：没有上游 → 400', async () => {
  await assert.rejects(() => git.push(), (e: unknown) => (e as HttpError).status === 400);
  await assert.rejects(() => git.pull(), (e: unknown) => (e as HttpError).status === 400);
});
