// server/http.test.ts
// 集成测试：/api/state 端点、PUT 无 body → 400、%zz 畸形路径 → 400。
// 静态目录用临时目录（不测静态分支），仅锁动态路由与 serveStatic 的错误分支。
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HttpServer } from './http.ts';
import { FileStore } from './files.ts';
import { WriteGate } from './write-gate.ts';
import { TabStore } from './tab-store.ts';
import { registerFsRoutes } from './routes/fs.ts';
import { registerTabsRoutes } from './routes/tabs.ts';

let root: string;
let server: HttpServer;
let base: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'anther-http-'));
  await writeFile(path.join(root, 'a.txt'), 'hello');
  server = new HttpServer({ staticDir: root });
  registerFsRoutes(server, new FileStore(root), new WriteGate(false)); // 只读
  registerTabsRoutes(server, new TabStore());
  await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('GET /api/state 返回服务器运行模式', async () => {
  const { status, body } = await call('GET', '/api/state');
  assert.equal(status, 200);
  assert.deepEqual(body, { allowWrites: false });
});

test('PUT /api/file 无 body → 400（而非 500）', async () => {
  const { status } = await call('PUT', '/api/file?path=a.txt');
  assert.equal(status, 400);
  assert.equal((await call('GET', '/api/file?path=a.txt')).body.content, 'hello'); // 未被误写
});

test('PUT /api/tabs/open 无 body → 400（而非 500）', async () => {
  const { status, body } = await call('PUT', '/api/tabs/open');
  assert.equal(status, 400);
  assert.ok(body.error);
});

test('GET /%zz 畸形编码 → 400（而非 500）', async () => {
  const { status, body } = await call('GET', '/%zz');
  assert.equal(status, 400);
  assert.ok(body.error);
});

test('PUT /api/file 带 body 但无 path → 400（已有逻辑回归确认）', async () => {
  const { status } = await call('PUT', '/api/file', { content: 'x' });
  assert.equal(status, 400);
});

test('POST /api/create 无 body → 400（而非 500）', async () => {
  const { status, body } = await call('POST', '/api/create');
  assert.equal(status, 400);
  assert.ok(body.error);
});

test('POST /api/create 带 ro=1 → 403（只读服务端）', async () => {
  const { status, body } = await call('POST', '/api/create?ro=1', { path: 'x.txt' });
  assert.equal(status, 403);
  assert.ok(body.error);
});
