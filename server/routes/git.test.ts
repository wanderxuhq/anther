// server/routes/git.test.ts
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { HttpServer } from '../http.ts';
import { Git } from '../git.ts';
import { registerGitRoutes } from './git.ts';

const execFileP = promisify(execFile);

let repoDir: string;
let server: HttpServer;
let base: string;

beforeEach(async () => {
  repoDir = await mkdtemp(path.join(os.tmpdir(), 'anther-git-api-'));
  await execFileP('git', ['init', '-qb', 'main'], { cwd: repoDir }); // 强制初始分支名 main（环境 init.defaultBranch 未配置时默认 master），Task 2 新测试硬编码 main
  await execFileP('git', ['config', 'user.email', 't@t'], { cwd: repoDir });
  await execFileP('git', ['config', 'user.name', 't'], { cwd: repoDir });
  await writeFile(path.join(repoDir, 'a.txt'), 'one\n');
  await execFileP('git', ['add', '.'], { cwd: repoDir });
  await execFileP('git', ['commit', '-qm', 'init'], { cwd: repoDir });
  await writeFile(path.join(repoDir, 'a.txt'), 'one\ntwo\n'); // 已跟踪修改
  await writeFile(path.join(repoDir, 'b.txt'), 'brand new\n'); // 未跟踪

  server = new HttpServer({ staticDir: '' });
  registerGitRoutes(server, new Git(repoDir));
  await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  await server.close();
  await rm(repoDir, { recursive: true, force: true });
});

async function call(method: string, p: string, body?: unknown) {
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

test('GET /api/git/status：isRepo + 显示状态字母', async () => {
  const { status, body } = await call('GET', '/api/git/status');
  assert.equal(status, 200);
  assert.equal(body.isRepo, true);
  const byPath = Object.fromEntries(body.changes.map((c: { path: string; status: string }) => [c.path, c.status]));
  assert.equal(byPath['a.txt'], 'M');
  assert.equal(byPath['b.txt'], '??');
});

test('GET /api/git/diff：已跟踪修改 → unified diff；未跟踪 → 全 + 新增', async () => {
  const mod = await call('GET', '/api/git/diff?path=' + encodeURIComponent('a.txt'));
  assert.equal(mod.status, 200);
  assert.match(mod.body.diff, /^diff --git/);
  assert.match(mod.body.diff, /\+two/);

  const untracked = await call('GET', '/api/git/diff?path=' + encodeURIComponent('b.txt'));
  assert.equal(untracked.status, 200);
  assert.match(untracked.body.diff, /new file mode/);
  assert.match(untracked.body.diff, /^\+brand new$/m);
});

test('GET /api/git/diff：缺 path / 路径逃逸 → 400', async () => {
  assert.equal((await call('GET', '/api/git/diff')).status, 400);
  assert.equal((await call('GET', '/api/git/diff?path=' + encodeURIComponent('../x'))).status, 400);
});

test('POST /api/git/commit：提交勾选路径后 status 清空', async () => {
  const { status, body } = await call('POST', '/api/git/commit', { paths: ['a.txt', 'b.txt'], message: 'update a + add b' });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  const after = await call('GET', '/api/git/status');
  assert.deepEqual(after.body.changes, []);
});

test('POST /api/git/commit：空消息 / 空路径 → 400', async () => {
  assert.equal((await call('POST', '/api/git/commit', { paths: ['a.txt'], message: '' })).status, 400);
  assert.equal((await call('POST', '/api/git/commit', { paths: [], message: 'x' })).status, 400);
});

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
