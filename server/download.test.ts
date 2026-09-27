import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { HttpServer } from './http.ts';
import { FileStore } from './files.ts';
import { registerFsRoutes } from './routes/fs.ts';

let root: string;
let server: HttpServer;
let url: string;
const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'anther-ranges-'));
  await writeFile(path.join(root, 'data.bin'), bytes);
  server = new HttpServer({ staticDir: root });
  registerFsRoutes(server, new FileStore(root));
  await server.listen(0, '127.0.0.1');
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/download?path=data.bin`;
});
afterEach(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});
const body = async (response: Response) => Buffer.from(await response.arrayBuffer());

test('HEAD 提供下载器探测需要的完整元数据，忽略 Range 且无响应体', async () => {
  const head = await fetch(url, { method: 'HEAD', headers: { Range: 'bytes=1-2' } });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('accept-ranges'), 'bytes');
  assert.equal(head.headers.get('content-length'), '256');
  assert.equal(head.headers.get('content-range'), null);
  assert.match(head.headers.get('etag')!, /^"[a-f0-9]+"$/);
  assert.ok(Number.isFinite(Date.parse(head.headers.get('last-modified')!)));
  assert.equal((await body(head)).length, 0);
  const get = await fetch(url);
  assert.equal(get.headers.get('etag'), head.headers.get('etag'));
  assert.deepEqual(await body(get), bytes);
});

test('Range 支持闭合、开放、后缀区间及超大整数，响应长度和字节准确', async () => {
  for (const [range, start, end] of [
    ['bytes=0-0', 0, 0], ['bytes=20-39', 20, 39], ['bytes=250-', 250, 255],
    ['bytes=-10', 246, 255], ['bytes=250-999999999999999999999999', 250, 255],
    ['bytes=-999999999999999999999999', 0, 255],
  ] as const) {
    const res = await fetch(url, { headers: { Range: range } });
    assert.equal(res.status, 206, range);
    assert.equal(res.headers.get('content-range'), `bytes ${start}-${end}/256`);
    assert.equal(res.headers.get('content-length'), String(end - start + 1));
    assert.deepEqual(await body(res), bytes.subarray(start, end + 1));
  }
});

test('不可满足的区间返回 416；未知单位和格式错误退回 200；空文件仍可正常下载', async () => {
  for (const range of ['bytes=256-', 'bytes=999999999999999999999999-', 'bytes=-0']) {
    const res = await fetch(url, { headers: { Range: range } });
    assert.equal(res.status, 416);
    assert.equal(res.headers.get('content-range'), 'bytes */256');
    assert.equal((await body(res)).length, 0);
  }
  for (const range of ['items=0-1', 'bytes=9-2', 'bytes=bad', 'bytes=-', 'bytes=1-2,invalid']) {
    const res = await fetch(url, { headers: { Range: range } });
    assert.equal(res.status, 200, range);
    assert.deepEqual(await body(res), bytes);
  }
  await writeFile(path.join(root, 'data.bin'), '');
  assert.equal((await body(await fetch(url))).length, 0);
  const emptyRange = await fetch(url, { headers: { Range: 'bytes=0-' } });
  assert.equal(emptyRange.status, 416);
  assert.equal(emptyRange.headers.get('content-range'), 'bytes */0');
});

test('多区间 multipart 响应逐段准确且保留请求顺序，合并重叠区间', async () => {
  const res = await fetch(url, { headers: { Range: 'bytes=20-24,0-2,999-' } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), null);
  const boundary = /boundary=(\S+)/.exec(res.headers.get('content-type')!)![1];
  const data = await body(res);
  const expected = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\nContent-Range: bytes 20-24/256\r\n\r\n`),
    bytes.subarray(20, 25), Buffer.from('\r\n'),
    Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\nContent-Range: bytes 0-2/256\r\n\r\n`),
    bytes.subarray(0, 3), Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  assert.deepEqual(data, expected);
  assert.equal(Number(res.headers.get('content-length')), expected.length);
  const merged = await fetch(url, { headers: { Range: 'bytes=2-9,0-5,10-12' } });
  assert.equal(merged.headers.get('content-range'), 'bytes 0-12/256');
  assert.deepEqual(await body(merged), bytes.subarray(0, 13));
});

test('If-Range 匹配 ETag 才续传；文件同大小改写并恢复 mtime 后仍识别为新版本', async () => {
  const original = await stat(path.join(root, 'data.bin'));
  const head = await fetch(url, { method: 'HEAD' });
  const etag = head.headers.get('etag')!;
  const partial = await fetch(url, { headers: { Range: 'bytes=100-', 'If-Range': etag } });
  assert.equal(partial.status, 206);
  assert.deepEqual(await body(partial), bytes.subarray(100));
  const changed = Buffer.alloc(256, 42);
  await writeFile(path.join(root, 'data.bin'), changed);
  await utimes(path.join(root, 'data.bin'), original.atime, original.mtime);
  const resumed = await fetch(url, { headers: { Range: 'bytes=100-', 'If-Range': etag } });
  assert.equal(resumed.status, 200);
  assert.notEqual(resumed.headers.get('etag'), etag);
  assert.equal(resumed.headers.get('content-range'), null);
  assert.deepEqual(await body(resumed), changed);
});

test('If-Range 弱 ETag、秒级日期和非法值回退整文件，避免同秒改写后误续传', async () => {
  const head = await fetch(url, { method: 'HEAD' });
  const etag = head.headers.get('etag')!;
  const date = head.headers.get('last-modified')!;
  for (const value of [`W/${etag}`, '"stale"', 'invalid', date, 'Sun, 06 Nov 1994 08:49:37 GMT', 'Sun, 06 Nov 2094 08:49:37 GMT']) {
    const res = await fetch(url, { headers: { Range: 'bytes=2-4', 'If-Range': value } });
    assert.equal(res.status, 200);
    assert.deepEqual(await body(res), bytes);
  }
});

test('条件请求先于 Range，正确返回 304 / 412 并遵循 ETag 优先级', async () => {
  const head = await fetch(url, { method: 'HEAD' });
  const etag = head.headers.get('etag')!;
  const date = head.headers.get('last-modified')!;
  const failedConditions: Record<string, string>[] = [{ 'If-Match': '"stale"' }, { 'If-Match': `W/${etag}` }, { 'If-Unmodified-Since': 'Sun, 06 Nov 1994 08:49:37 GMT' }];
  for (const headers of failedConditions) {
    const res = await fetch(url, { headers: { ...headers, Range: 'bytes=0-1' } });
    assert.equal(res.status, 412);
    assert.equal((await body(res)).length, 0);
  }
  const unchangedConditions: Record<string, string>[] = [{ 'If-None-Match': `W/${etag}` }, { 'If-Modified-Since': date }];
  for (const headers of unchangedConditions) {
    const res = await fetch(url, { headers: { ...headers, Range: 'bytes=0-1' } });
    assert.equal(res.status, 304);
    assert.equal((await body(res)).length, 0);
  }
  const res = await fetch(url, { headers: {
    'If-Match': `"other", ${etag}`, 'If-Unmodified-Since': 'Sun, 06 Nov 1994 08:49:37 GMT',
    'If-None-Match': '"other"', 'If-Modified-Since': date, Range: 'bytes=0-1',
  } });
  assert.equal(res.status, 206);
  assert.deepEqual(await body(res), bytes.subarray(0, 2));
});

test('八个并发连接分段下载，拼接后的长度和 SHA-256 与原文件一致', async () => {
  const data = Buffer.alloc(2 * 1024 * 1024 + 37);
  for (let i = 0; i < data.length; i++) data[i] = i % 251;
  await writeFile(path.join(root, 'data.bin'), data);
  const head = await fetch(url, { method: 'HEAD' });
  const etag = head.headers.get('etag')!;
  const chunk = Math.ceil(data.length / 8);
  const parts = await Promise.all(Array.from({ length: 8 }, async (_, i) => {
    const start = i * chunk;
    const end = Math.min(start + chunk - 1, data.length - 1);
    const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}`, 'If-Match': etag } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), `bytes ${start}-${end}/${data.length}`);
    return body(res);
  }));
  const combined = Buffer.concat(parts);
  assert.equal(combined.length, data.length);
  const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  assert.equal(hash(combined), hash(data));
});

test('中断下载后从实际已收到的位置续传，字节无重复或丢失', async () => {
  const data = Buffer.alloc(4 * 1024 * 1024, 27);
  await writeFile(path.join(root, 'data.bin'), data);
  const res = await fetch(url);
  const etag = res.headers.get('etag')!;
  const reader = res.body!.getReader();
  const first = (await reader.read()).value!;
  await reader.cancel();
  const resumed = await fetch(url, { headers: { Range: `bytes=${first.length}-`, 'If-Range': etag } });
  assert.equal(resumed.status, 206);
  assert.deepEqual(Buffer.concat([first, await body(resumed)]), data);
});
