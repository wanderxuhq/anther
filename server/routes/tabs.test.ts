// server/routes/tabs.test.ts
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { HttpServer } from '../http.ts';
import { TabStore } from '../tab-store.ts';
import { registerTabsRoutes } from './tabs.ts';

let server: HttpServer;
let base: string;

beforeEach(async () => {
  server = new HttpServer({ staticDir: '' });
  registerTabsRoutes(server, new TabStore());
  await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => { await server.close(); });

async function call(method: string, path: string, body?: unknown, userId = 'u1') {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

test('open/front/list 全流程', async () => {
  await call('PUT', '/api/tabs/open', { path: 'a.ts' }, 'u1');
  await call('PUT', '/api/tabs/front', { path: 'a.ts' }, 'u1');
  const { status, body } = await call('GET', '/api/tabs');
  assert.equal(status, 200);
  assert.deepEqual(body.tabs, ['a.ts']);
});

test('close：他人前台持有则保留', async () => {
  await call('PUT', '/api/tabs/open', { path: 'a.ts' }, 'u1');
  await call('PUT', '/api/tabs/front', { path: 'a.ts' }, 'u1');
  const { status, body } = await call('PUT', '/api/tabs/close', { path: 'a.ts' }, 'u2');
  assert.equal(status, 200);
  const list = await call('GET', '/api/tabs');
  assert.deepEqual(list.body.tabs, ['a.ts']);
});

test('restore 仅空列表时生效', async () => {
  await call('PUT', '/api/tabs/restore', { paths: ['x.ts'] });
  await call('PUT', '/api/tabs/restore', { paths: ['y.ts'] }); // 第二次应被拒
  const { body } = await call('GET', '/api/tabs');
  assert.deepEqual(body.tabs, ['x.ts']);
});

test('heartbeat 保活', async () => {
  await call('PUT', '/api/tabs/open', { path: 'a.ts' }, 'u1');
  await call('PUT', '/api/tabs/front', { path: 'a.ts' }, 'u1');
  await call('PUT', '/api/heartbeat', undefined, 'u1');
  const { body } = await call('GET', '/api/tabs');
  assert.deepEqual(body.tabs, ['a.ts']);
});
