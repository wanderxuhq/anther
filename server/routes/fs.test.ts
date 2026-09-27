// server/routes/fs.test.ts
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, stat, mkdir, symlink } from 'node:fs/promises';
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

// 只读仅由前端编辑器控制（用户决策 2026-08-11）：服务端不校验 ro，写请求始终放行
test('write 不带 ro 参数始终放行', async () => {
  const ok = await fetch(`${base}/api/file?path=a.txt`, {
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

// 写操作与 PUT /api/file 同裁决：服务端始终放行，无需启动参数
test('mkdir 不带 ro 参数创建成功', async () => {
  const ok = await fetch(`${base}/api/mkdir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'sub' }),
  });
  assert.equal(ok.status, 200);
  assert.ok((await stat(path.join(root, 'sub'))).isDirectory());
});

// ---- 文件上传 ----
function upload(filePath: string, body: Uint8Array = new Uint8Array()) {
  return fetch(`${base}/api/upload?path=${encodeURIComponent(filePath)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Blob([new Uint8Array(body)]),
  });
}

test('upload 支持超过原 50 MiB 限制的文件，保留二进制字节、子目录和中文文件名', async () => {
  await mkdir(path.join(root, 'sub'));
  const bytes = Buffer.alloc(50 * 1024 * 1024 + 1, 0xff);
  bytes[0] = 0;
  const res = await upload('sub/图片 #1.bin', bytes);
  assert.equal(res.status, 200);
  assert.deepEqual(await readFile(path.join(root, 'sub/图片 #1.bin')), bytes);
});

test('upload 支持空文件', async () => {
  assert.equal((await upload('empty.txt')).status, 200);
  assert.equal((await stat(path.join(root, 'empty.txt'))).size, 0);
});

test('upload 不限制文件类型，支持任意扩展名及无扩展名文件', async () => {
  const bytes = Buffer.from([0, 255, 128, 42]);
  for (const name of ['photo.png', 'archive.zip', 'program.exe', 'custom.unknown', 'no-extension']) {
    assert.equal((await upload(name, bytes)).status, 200);
    assert.deepEqual(await readFile(path.join(root, name)), bytes);
  }
});

test('upload 同名文件返回 409 且不覆盖原内容', async () => {
  assert.equal((await upload('a.txt', Buffer.from('replacement'))).status, 409);
  assert.equal(await readFile(path.join(root, 'a.txt'), 'utf8'), 'hello');
});

test('upload 拒绝缺失路径、根目录和目录穿越', async () => {
  for (const p of ['', '.', '../outside.bin']) {
    assert.equal((await upload(p)).status, 400);
  }
});

test('upload 拒绝符号链接逃逸', async () => {
  const outside = await mkdtemp(path.join(tmpdir(), 'anther-upload-outside-'));
  try {
    await symlink(outside, path.join(root, 'link'));
    assert.equal((await upload('link/new.bin')).status, 400);
    await assert.rejects(stat(path.join(outside, 'new.bin')), { code: 'ENOENT' });
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

// ---- 原始文件下载 ----
test('download 保留原始字节、中文和特殊字符文件名，支持空文件', async () => {
  const name = "原文 #%'(1).md";
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf, 0, 255, 128]), Buffer.from('# 标题\r\n')]);
  await writeFile(path.join(root, name), bytes);
  const response = await fetch(`${base}/api/download?path=${encodeURIComponent(name)}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.equal(response.headers.get('content-length'), String(bytes.length));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const disposition = response.headers.get('content-disposition')!;
  assert.match(disposition, /^attachment;/);
  assert.equal(decodeURIComponent(disposition.split("filename*=UTF-8''")[1]), name);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  await writeFile(path.join(root, 'empty'), '');
  const empty = await fetch(`${base}/api/download?path=empty`);
  assert.equal(empty.status, 200);
  assert.equal((await empty.arrayBuffer()).byteLength, 0);
});

test('download 拒绝缺失路径、目录、穿越和符号链接逃逸；不存在返回 404', async () => {
  for (const p of ['', '.', '../outside']) {
    const response = await fetch(`${base}/api/download?path=${encodeURIComponent(p)}`);
    assert.equal(response.status, 400);
    assert.ok((await response.json()).error);
  }
  const missing = await fetch(`${base}/api/download?path=missing.txt`);
  assert.equal(missing.status, 404);
  const outside = await mkdtemp(path.join(tmpdir(), 'anther-download-outside-'));
  try {
    await writeFile(path.join(outside, 'secret'), 'outside');
    await symlink(path.join(outside, 'secret'), path.join(root, 'link'));
    assert.equal((await fetch(`${base}/api/download?path=link`)).status, 400);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test('取消流式下载后服务器仍可正常处理请求', async () => {
  await writeFile(path.join(root, 'large.bin'), Buffer.alloc(8 * 1024 * 1024, 0xff));
  const response = await fetch(`${base}/api/download?path=large.bin`);
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  assert.equal((await reader.read()).done, false);
  await reader.cancel();
  const next = await fetch(`${base}/api/download?path=a.txt`);
  assert.equal(await next.text(), 'hello');
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
