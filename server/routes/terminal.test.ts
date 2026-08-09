// server/routes/terminal.test.ts
// 终端 HTTP + WS 集成测试（真实 script PTY + 真实 ws 客户端）。
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { HttpServer } from '../http.ts';
import { TerminalManager } from '../terminal.ts';
import { registerTerminalRoutes } from './terminal.ts';

let root: string;
let server: HttpServer;
let terminals: TerminalManager;
let base: string;
let port: number;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'anther-term-'));
  server = new HttpServer({ staticDir: root });
  terminals = new TerminalManager(process.cwd());
  registerTerminalRoutes(server, terminals);
  await server.listen(0, '127.0.0.1');
  port = (server.address() as { port: number }).port;
  base = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await terminals.closeAll();
  await server.close();
  await rm(root, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn: () => boolean | Promise<boolean>, timeout = 4000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await sleep(50);
  }
  assert.fail('waitFor 超时');
}

async function call(method: string, url: string, body?: unknown, user = 'u1') {
  return fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-user-id': user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createTerminal(user = 'u1') {
  const res = await call('POST', '/api/terminals', undefined, user);
  assert.equal(res.status, 200);
  return (await res.json()) as { id: string; name: string };
}

test('POST 创建 → GET 列表（每用户隔离）', async () => {
  const info = await createTerminal('u1');
  assert.match(info.id, /^t_/);
  const mine = (await (await call('GET', '/api/terminals', undefined, 'u1')).json()).terminals;
  assert.deepEqual(mine.map((t: { id: string }) => t.id), [info.id]);
  const other = (await (await call('GET', '/api/terminals', undefined, 'u2')).json()).terminals;
  assert.deepEqual(other, []);
});

test('close 他人终端 → 404；缺 id → 400', async () => {
  const info = await createTerminal('u1');
  assert.equal((await call('POST', '/api/terminals/close', { id: info.id }, 'u2')).status, 404);
  assert.equal((await call('POST', '/api/terminals/close', {}, 'u1')).status, 400);
});

test('close 自己 → 200 且移出列表', async () => {
  const info = await createTerminal('u1');
  assert.equal((await call('POST', '/api/terminals/close', { id: info.id }, 'u1')).status, 200);
  await waitFor(async () =>
    (await (await call('GET', '/api/terminals', undefined, 'u1')).json()).terminals.length === 0);
});

test('WS 集成：历史重放 → input echo → ping/pong → exit', async () => {
  const info = await createTerminal('u1');
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/terminal?term=${info.id}&user=u1`);
  const frames: Array<{ type: string; data?: string }> = [];
  const opened = new Promise<void>((r) => ws.on('open', r));
  ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
  await opened;
  await waitFor(() => frames.some((f) => f.type === 'output')); // 首帧 = 历史重放
  ws.send(JSON.stringify({ type: 'input', data: 'echo WS-HI\n' }));
  await waitFor(() => frames.some((f) => f.type === 'output' && f.data?.includes('WS-HI')));
  ws.send(JSON.stringify({ type: 'ping' }));
  await waitFor(() => frames.some((f) => f.type === 'pong'));
  ws.send(JSON.stringify({ type: 'input', data: 'exit\n' }));
  await waitFor(() => frames.some((f) => f.type === 'exit'));
  ws.close();
});

test('WS 无效 id / 他人终端 → 拒绝（close 4404）', async () => {
  const info = await createTerminal('u1');
  const bad = new WebSocket(`ws://127.0.0.1:${port}/api/terminal?term=t_deadbeef&user=u1`);
  assert.equal(await new Promise<number>((r) => bad.on('close', (c) => r(c))), 4404);
  const other = new WebSocket(`ws://127.0.0.1:${port}/api/terminal?term=${info.id}&user=u2`);
  assert.equal(await new Promise<number>((r) => other.on('close', (c) => r(c))), 4404);
});
