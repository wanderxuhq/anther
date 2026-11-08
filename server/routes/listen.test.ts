import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { HttpServer } from '../http.ts';
import { registerListenRoute } from './listen.ts';

let server: HttpServer;
let base: string;
let host = '127.0.0.1';
let port = 0;

beforeEach(async () => {
  host = '127.0.0.1';
  port = 0;
  server = new HttpServer({ staticDir: process.cwd() });
  registerListenRoute(
    server,
    () => (port ? { host, port } : null),
    async (next) => {
      host = next;
      return { host, port };
    },
  );
  await server.listen(0, host);
  port = (server.address() as { port: number }).port;
  base = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await server.close();
});

async function call(method: string, body?: unknown) {
  const res = await fetch(`${base}/api/anther/listen`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

test('GET /api/anther/listen：返回当前监听地址', async () => {
  const { status, body } = await call('GET');
  assert.equal(status, 200);
  assert.deepEqual(body, { host: '127.0.0.1', port, mode: 'local' });
});

test('POST /api/anther/listen：切换到局域网', async () => {
  const { status, body } = await call('POST', { host: '0.0.0.0' });
  assert.equal(status, 200);
  assert.deepEqual(body, { host: '0.0.0.0', port, mode: 'lan' });
  assert.deepEqual((await call('GET')).body, { host: '0.0.0.0', port, mode: 'lan' });
});

test('POST /api/anther/listen：非法 host 或缺 body → 400', async () => {
  assert.equal((await call('POST', { host: 'http://example.com' })).status, 400);
  assert.equal((await call('POST', {})).status, 400);
  assert.equal((await call('POST')).status, 400);
});
