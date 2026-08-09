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
  await gitCmd(['init', '-q']);
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
