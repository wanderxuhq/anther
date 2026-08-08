// server/routes/fs.test.ts
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HttpServer } from '../http.ts';
import { FileStore } from '../files.ts';
import { registerFsRoutes } from './fs.ts';

let root: string;
let server: HttpServer;
let base: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'anther-http-'));
  await writeFile(path.join(root, 'a.txt'), 'hello');
  server = new HttpServer({ staticDir: '' });
  registerFsRoutes(server, new FileStore(root));
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

test('ro=1（前端只读）时 write 返回 403，ro=0 放行', async () => {
  const res = await fetch(`${base}/api/file?path=a.txt&ro=1`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'x' }),
  });
  assert.equal(res.status, 403);

  const ok = await fetch(`${base}/api/file?path=a.txt&ro=0`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'x' }),
  });
  assert.equal(ok.status, 200);
  const after = (await (await fetch(`${base}/api/file?path=a.txt`)).json()) as { content: string };
  assert.equal(after.content, 'x');
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

// spec §5.4：写操作需携带 ro=0（mkdir/rename/delete 与 PUT /api/file 同裁决），无需启动参数
test('mkdir 无 ro 返回 403，ro=0 创建成功', async () => {
  const noRo = await fetch(`${base}/api/mkdir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'sub' }),
  });
  assert.equal(noRo.status, 403);
  assert.ok((await noRo.json()).error);

  const ok = await fetch(`${base}/api/mkdir?ro=0`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'sub' }),
  });
  assert.equal(ok.status, 200);
  assert.ok((await stat(path.join(root, 'sub'))).isDirectory());
});

// ---- 全局搜索 SSE（Task 17） ----
async function collectSse(url: string): Promise<{ status: number; ctype: string; events: Record<string, unknown>[] }> {
  const res = await fetch(url);
  assert.equal(res.status, 200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const events: Record<string, unknown>[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.startsWith('data:')) events.push(JSON.parse(line.slice(5).trim()) as Record<string, unknown>);
    }
  }
  return { status: res.status, ctype: res.headers.get('content-type') ?? '', events };
}

test('search SSE：file + done 事件序列', async () => {
  const { writeFile: wf, mkdir } = await import('node:fs/promises');
  await mkdir(path.join(root, 'sub'));
  await wf(path.join(root, 'sub', 'b.txt'), 'hello world');
  const { ctype, events } = await collectSse(`${base}/api/search?q=hello`);
  assert.ok(ctype.startsWith('text/event-stream'));
  const files = events.filter((e) => e.type === 'file');
  const done = events.find((e) => e.type === 'done')!;
  assert.equal(files.length, 2); // a.txt + sub/b.txt
  assert.ok(files.some((f) => f.path === 'a.txt'));
  assert.ok(files.some((f) => f.path === 'sub/b.txt'));
  assert.equal((done.matchCount as number) >= 2, true);
  assert.equal(done.truncated, false);
});

test('search q 为空 → error 事件', async () => {
  const { events } = await collectSse(`${base}/api/search?q=`);
  assert.equal(events[0].type, 'error');
});

test('search exclude 参数生效', async () => {
  const { writeFile: wf, mkdir } = await import('node:fs/promises');
  await mkdir(path.join(root, 'node_modules'));
  await wf(path.join(root, 'node_modules', 'x.js'), 'hello');
  const { events } = await collectSse(`${base}/api/search?q=hello&exclude=node_modules`);
  const files = events.filter((e) => e.type === 'file');
  assert.deepEqual(files.map((f) => f.path), ['a.txt']);
});

test('search case=1 大小写敏感', async () => {
  const { writeFile: wf, rm } = await import('node:fs/promises');
  await rm(path.join(root, 'a.txt')); // beforeEach 的 a.txt='hello' 会命中 q=hello，先移除
  await wf(path.join(root, 'case.txt'), 'HELLO');
  const { events } = await collectSse(`${base}/api/search?q=hello&case=1`);
  assert.equal(events.filter((e) => e.type === 'file').length, 0);
});

test('search 路径越界 → error 事件而非 JSON 500', async () => {
  const { events } = await collectSse(`${base}/api/search?q=hello&path=..%2F..%2Fetc`);
  assert.equal(events[0].type, 'error');
});
