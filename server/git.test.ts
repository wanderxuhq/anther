// server/git.test.ts
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
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
