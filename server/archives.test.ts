import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { get } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import { HttpServer } from './http.ts';
import { FileStore } from './files.ts';
import { registerFsRoutes } from './routes/fs.ts';
import type { ArchiveOptions, ArchiveStatus } from './archives.ts';

async function setup(t: TestContext, options: ArchiveOptions = {}) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'anther-archive-test-'));
  const root = path.join(temp, 'workspace');
  const cache = path.join(temp, 'cache');
  await fs.mkdir(path.join(root, '目录', '空目录'), { recursive: true });
  await fs.writeFile(path.join(root, '目录', '说明 #%.md'), '# 原始\r\n');
  await fs.writeFile(path.join(root, '目录', 'binary'), Buffer.from([0, 255, 128, 10]));
  const http = new HttpServer({ staticDir: root });
  const files = new FileStore(root);
  const manager = registerFsRoutes(http, files, { tempDir: cache, sweepMs: 1_000_000, ...options });
  await http.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  t.after(async () => { await http.close(); await fs.rm(temp, { force: true, recursive: true }); });
  const prepare = async (rel = '目录') => {
    const response = await fetch(`${base}/api/download/prepare`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: rel }) });
    assert.equal(response.status, 200);
    return await response.json() as ArchiveStatus;
  };
  const ready = async (rel = '目录') => {
    let status = await prepare(rel);
    const deadline = Date.now() + 15_000;
    while (status.status === 'preparing' && Date.now() < deadline) {
      await delay(10);
      status = await (await fetch(`${base}/api/download/status?id=${status.id}`)).json() as ArchiveStatus;
    }
    assert.equal(status.status, 'ready', status.error);
    return status;
  };
  return { root, cache, manager, files, base, prepare, ready };
}
const bytes = async (res: Response) => Buffer.from(await res.arrayBuffer());

async function unzip(buffer: Buffer): Promise<Map<string, { data: Buffer; mode: number }>> {
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(buffer)));
  try {
    const entries = new Map<string, { data: Buffer; mode: number }>();
    for (const entry of await reader.getEntries()) {
      const data = entry.directory ? new Uint8Array() : await entry.getData(new Uint8ArrayWriter());
      entries.set(entry.filename, { data: Buffer.from(data), mode: entry.externalFileAttributes >>> 16 });
    }
    return entries;
  } finally {
    await reader.close();
  }
}

test('目录 ZIP 保留 Unicode、二进制、空目录、符号链接，单文件仍用原接口', async (t) => {
  const f = await setup(t);
  await fs.symlink('../目录', path.join(f.root, '目录', '循环'));
  await fs.symlink('/outside/not-readable', path.join(f.root, '目录', '外部链接'));
  const status = await f.ready();
  const res = await fetch(f.base + status.url);
  assert.match(res.headers.get('content-disposition')!, /filename\*=UTF-8''/);
  const zip = await unzip(await bytes(res));
  assert.equal(zip.get('目录/说明 #%.md')!.data.toString(), '# 原始\r\n');
  assert.deepEqual(zip.get('目录/binary')!.data, Buffer.from([0, 255, 128, 10]));
  assert.ok(zip.has('目录/空目录/'));
  assert.equal(zip.get('目录/循环')!.mode & 0o170000, 0o120000);
  assert.equal(zip.get('目录/外部链接')!.data.toString(), '/outside/not-readable');
  const file = await f.prepare('目录/binary');
  assert.equal(file.kind, 'file');
  assert.deepEqual(await bytes(await fetch(f.base + file.url)), zip.get('目录/binary')!.data);
});

test('目录未变复用同一份 ZIP；深层修改、增删和改名产生新快照，旧链接仍可下载', async (t) => {
  const f = await setup(t);
  const first = await f.ready();
  const original = await bytes(await fetch(f.base + first.url));
  const cached = await f.ready('./目录/');
  assert.equal(cached.id, first.id);
  assert.equal(cached.url, first.url);
  const checking = await f.prepare();
  while (f.manager.status(checking.id).status === 'preparing') await delay(10);
  assert.deepEqual(await bytes(await fetch(`${f.base}/api/download/archive?id=${checking.id}`)), original);
  const file = path.join(f.root, '目录', 'binary');
  const oldStat = await fs.stat(file);
  await fs.writeFile(file, Buffer.from([4, 3, 2, 1]));
  await fs.utimes(file, oldStat.atime, oldStat.mtime);
  const changed = await f.ready();
  assert.notEqual(changed.id, first.id);
  assert.deepEqual(await bytes(await fetch(f.base + first.url)), original);
  assert.deepEqual((await unzip(await bytes(await fetch(f.base + changed.url)))).get('目录/binary')!.data, Buffer.from([4, 3, 2, 1]));
  let last = changed;
  for (const mutate of [
    () => fs.writeFile(path.join(f.root, '目录/空目录/new'), ''),
    () => fs.rename(path.join(f.root, '目录/空目录/new'), path.join(f.root, '目录/空目录/renamed')),
    () => fs.rm(path.join(f.root, '目录/空目录/renamed')),
  ]) {
    await mutate();
    const next = await f.ready();
    assert.notEqual(next.id, last.id);
    last = next;
  }
  const cacheDir = path.join(f.cache, (await fs.readdir(f.cache))[0]);
  assert.equal((await fs.readdir(cacheDir)).filter((n) => n.endsWith('.zip')).length, 5);
});

test('HEAD、续传、多区间、八连接分段共用稳定 ETag，拼接后 ZIP 完整', async (t) => {
  const f = await setup(t);
  const status = await f.ready();
  const url = f.base + status.url;
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.headers.get('accept-ranges'), 'bytes');
  assert.equal(Number(head.headers.get('content-length')), status.size);
  const etag = head.headers.get('etag')!;
  const parts = await Promise.all(Array.from({ length: 8 }, async (_, i) => {
    const start = Math.floor(status.size! * i / 8), end = Math.floor(status.size! * (i + 1) / 8) - 1;
    const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}`, 'If-Range': etag } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('etag'), etag);
    return bytes(res);
  }));
  const zip = Buffer.concat(parts);
  assert.equal((await unzip(zip)).get('目录/说明 #%.md')!.data.toString(), '# 原始\r\n');
  const resumed = await fetch(url, { headers: { Range: 'bytes=100-', 'If-Range': etag } });
  assert.deepEqual(await bytes(resumed), zip.subarray(100));
  const multi = await fetch(url, { headers: { Range: 'bytes=0-9,20-29' } });
  assert.equal(multi.status, 206);
  assert.match(multi.headers.get('content-type')!, /multipart\/byteranges/);
  await multi.arrayBuffer();
});

test('完成后宽限清理；HEAD 和部分下载仅按闲置过期；清理后重新生成', async (t) => {
  const f = await setup(t, { completeMs: 30, idleMs: 250 });
  let status = await f.ready();
  await fetch(f.base + status.url, { method: 'HEAD' });
  await bytes(await fetch(f.base + status.url, { headers: { Range: 'bytes=0-9' } }));
  await delay(50);
  await f.manager.sweep();
  assert.equal(f.manager.status(status.id).status, 'ready');
  await bytes(await fetch(f.base + status.url, { headers: { Range: 'bytes=10-' } }));
  await delay(50);
  await f.manager.sweep();
  assert.equal((await fetch(f.base + status.url)).status, 410);
  const cacheDir = path.join(f.cache, (await fs.readdir(f.cache))[0]);
  assert.deepEqual(await fs.readdir(cacheDir), ['owner.json']);
  const next = await f.ready();
  assert.notEqual(status.id, next.id);
  status = next;
  await delay(280);
  await f.manager.sweep();
  assert.equal((await fetch(f.base + status.url)).status, 410);
});

test('活动连接不被清理，取消后可续传', async (t) => {
  const f = await setup(t, { completeMs: 10, idleMs: 20 });
  await fs.writeFile(path.join(f.root, '目录/large'), randomBytes(12 * 1024 * 1024));
  const status = await f.ready();
  const url = f.base + status.url;
  const req = get(url);
  t.after(() => req.destroy());
  const res = await new Promise<import('node:http').IncomingMessage>((resolve) => req.once('response', resolve));
  res.pause();
  await delay(60);
  await f.manager.sweep();
  assert.equal(f.manager.status(status.id).status, 'ready');
  req.destroy();
  await delay(10);
  const resumed = await fetch(url, { headers: { Range: 'bytes=1000-1999', 'If-Range': res.headers.etag! } });
  assert.equal(resumed.status, 206);
  assert.equal((await bytes(resumed)).length, 1000);
});

test('工作区根目录、目录链接可归档；ZIP64 可正常解压', async (t) => {
  const f = await setup(t, { forceZip64: true });
  await fs.symlink('目录', path.join(f.root, 'alias'));
  const status = await f.ready('.');
  const zip = await bytes(await fetch(f.base + status.url));
  assert.ok(zip.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06])));
  assert.ok((await unzip(zip)).has('workspace/目录/binary'));
  const linked = await f.ready('alias');
  assert.ok((await unzip(await bytes(await fetch(f.base + linked.url)))).has('alias/binary'));
});

test('磁盘空间不足准备失败，清理残留，路径越界被拒绝', async (t) => {
  const f = await setup(t, { reserveBytes: Number.MAX_SAFE_INTEGER });
  let status = await f.prepare();
  while (status.status === 'preparing') { await delay(10); status = f.manager.status(status.id); }
  assert.equal(status.status, 'failed');
  assert.match(status.error!, /disk space/);
  const cacheDir = path.join(f.cache, (await fs.readdir(f.cache))[0]);
  assert.deepEqual(await fs.readdir(cacheDir), ['owner.json']);
  for (const p of ['../cache', '/etc']) {
    const res = await fetch(`${f.base}/api/download/prepare`, { method: 'POST', body: JSON.stringify({ path: p }) });
    assert.equal(res.status, 400);
  }
});

test('构建期间源文件被修改会失败，删除半成品 ZIP 后可重试', async (t) => {
  const f = await setup(t);
  const open = f.files.openDownload.bind(f.files);
  f.files.openDownload = async (rel) => {
    const opened = await open(rel);
    await fs.writeFile(f.files.resolve(rel), 'changed while packing');
    return opened;
  };
  let status = await f.prepare();
  const deadline = Date.now() + 5000;
  while (status.status === 'preparing' && Date.now() < deadline) {
    await delay(10);
    status = f.manager.status(status.id);
  }
  assert.equal(status.status, 'failed');
  assert.match(status.error!, /changed during preparation/);
  const cacheDir = path.join(f.cache, (await fs.readdir(f.cache))[0]);
  assert.deepEqual(await fs.readdir(cacheDir), ['owner.json']);
  f.files.openDownload = open;
  assert.equal((await f.ready()).status, 'ready');
});

test('清理已退出进程的归档缓存，保留无关目录，关闭时删除自身缓存', async (t) => {
  const f = await setup(t, { idleMs: 50 });
  await f.ready();
  const pid = 2_000_000;
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  const orphan = path.join(f.cache, `anther-archives-${pid}-orphan`);
  const unrelated = path.join(f.cache, `anther-archives-${pid}-unrelated`);
  for (const dir of [orphan, unrelated]) {
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'owner.json'), JSON.stringify({ app: dir === orphan ? 'anther-archives' : 'other', pid }));
    await fs.utimes(dir, new Date(0), new Date(0));
  }
  await f.manager.sweep();
  await assert.rejects(fs.stat(orphan), { code: 'ENOENT' });
  assert.ok((await fs.stat(unrelated)).isDirectory());
  await f.manager.dispose();
  assert.deepEqual(await fs.readdir(f.cache), [path.basename(unrelated)]);
});
