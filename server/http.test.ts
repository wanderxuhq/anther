// server/http.test.ts
// 集成测试：/api/state 端点、PUT 无 body → 400、%zz 畸形路径 → 400。
// 静态目录用临时目录（不测静态分支），仅锁动态路由与 serveStatic 的错误分支。
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { HttpServer } from './http.ts';
import { FileStore } from './files.ts';
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
  registerFsRoutes(server, new FileStore(root));
  registerTabsRoutes(server, new TabStore());
  server.ws('/api/echo', (ws) => {
    ws.on('message', (raw) => ws.send(raw));
  });
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

test('GET /api/state 返回服务器运行模式（写入恒可用，由前端 ro 裁决）', async () => {
  const { status, body } = await call('GET', '/api/state');
  assert.equal(status, 200);
  assert.deepEqual(body, { allowWrites: true });
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

test('取消上传大小限制后，普通 JSON 请求仍保留原限制', async () => {
  const { status } = await call('PUT', '/api/file?path=a.txt', { content: 'x'.repeat(1_000_001) });
  assert.equal(status, 413);
  assert.equal((await call('GET', '/api/file?path=a.txt')).body.content, 'hello');
});

test('POST /api/create 不带 ro 参数 → 200（只读由前端编辑器控制，服务端不裁决）', async () => {
  const ok = await call('POST', '/api/create', { path: 'x.txt' });
  assert.equal(ok.status, 200);
});

test('静态 SPA fallback：未知扩展名的不存在路径返回 index.html 且 Content-Type 为 text/html（不触发下载）', async () => {
  await writeFile(path.join(root, 'index.html'), '<!doctype html><p>app</p>');
  const res = await fetch(base + '/web/src/ro-mode-effect.test.ts');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8'); // 修前为 application/octet-stream → 浏览器下载
  assert.equal(await res.text(), '<!doctype html><p>app</p>');
});

test('HEAD 请求：静态服务与 GET 同头但不含 body（curl -I、链接预览工具可用）', async () => {
  await writeFile(path.join(root, 'index.html'), '<!doctype html><p>app</p>');
  const res = await fetch(base + '/web/src/x.test.ts', { method: 'HEAD' });
  assert.equal(res.status, 200); // 修前 404
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(res.headers.get('content-length'), String(Buffer.byteLength('<!doctype html><p>app</p>')));
  assert.equal(await res.text(), '');
});

test('ws 路由：echo 往返', async () => {
  const port = (server.address() as { port: number }).port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/echo`);
  const msg = await new Promise<string>((resolve, reject) => {
    ws.on('open', () => ws.send('hello'));
    ws.on('message', (d) => resolve(d.toString()));
    ws.on('error', reject);
  });
  assert.equal(msg, 'hello');
  ws.close();
});

test('ws 未注册路径：连接被拒（server destroy，非正常 1000）', async () => {
  const port = (server.address() as { port: number }).port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/nope`);
  const code = await new Promise<number>((resolve) => {
    ws.on('close', (c) => resolve(c));
    ws.on('error', () => resolve(1006)); // 握手期失败可能只发 error，close 不触发
  });
  assert.notEqual(code, 1000);
});
