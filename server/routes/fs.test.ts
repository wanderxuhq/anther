// server/routes/fs.test.ts
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HttpServer } from '../http.ts';
import { FileStore } from '../files.ts';
import { WriteGate } from '../write-gate.ts';
import { registerFsRoutes } from './fs.ts';

let root: string;
let server: HttpServer;
let base: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'anther-http-'));
  await writeFile(path.join(root, 'a.txt'), 'hello');
  server = new HttpServer({ staticDir: '' });
  registerFsRoutes(server, new FileStore(root), new WriteGate(false)); // 只读
  await server.listen(0, '127.0.0.1');
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

test('list 返回 JSON', async () => {
  const res = await fetch(`${base}/api/list?path=.`);
  assert.equal(res.status, 200);
  const body = await res.json() as { entries: { name: string }[] };
  assert.ok(body.entries.some((e) => e.name === 'a.txt'));
});

test('read 返回内容', async () => {
  const res = await fetch(`${base}/api/file?path=a.txt`);
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { content: string }).content, 'hello');
});

test('只读模式下 write 返回 403', async () => {
  const res = await fetch(`${base}/api/file?path=a.txt&ro=0`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'x' }),
  });
  assert.equal(res.status, 403);
});

test('目录穿越返回 400', async () => {
  const res = await fetch(`${base}/api/file?path=..%2F..%2Fetc%2Fpasswd`);
  assert.equal(res.status, 400);
});

test('未知 API 返回 404 JSON', async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  assert.ok((await res.json()).error);
});

// spec §5.4：--rw 启动下写操作需携带 ro=0（mkdir/rename/delete 与 PUT /api/file 同裁决）
test('--rw 模式下 mkdir 无 ro 返回 403，ro=0 创建成功', async () => {
  const rw = new HttpServer({ staticDir: '' });
  registerFsRoutes(rw, new FileStore(root), new WriteGate(true)); // --rw
  await rw.listen(0, '127.0.0.1');
  const addr = rw.address() as { port: number };
  const rwBase = `http://127.0.0.1:${addr.port}`;
  try {
    const noRo = await fetch(`${rwBase}/api/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'sub' }),
    });
    assert.equal(noRo.status, 403);
    assert.ok((await noRo.json()).error);

    const ok = await fetch(`${rwBase}/api/mkdir?ro=0`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'sub' }),
    });
    assert.equal(ok.status, 200);
    assert.ok((await stat(path.join(root, 'sub'))).isDirectory());
  } finally {
    await rw.close();
  }
});
