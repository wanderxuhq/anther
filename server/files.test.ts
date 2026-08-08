// server/files.test.ts
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileStore } from './files.ts';
import { HttpError } from './http-error.ts';

let root: string;
let store: FileStore;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'anther-test-'));
  store = new FileStore(root);
  await mkdir(path.join(root, 'sub'));
  await writeFile(path.join(root, 'a.txt'), 'hello');
  await writeFile(path.join(root, 'sub', 'b.txt'), 'world');
});

afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test('resolve 拒绝目录穿越', () => {
  assert.throws(() => store.resolve('../outside'), (e: HttpError) => e.status === 400);
  assert.throws(() => store.resolve('/etc/passwd'), (e: HttpError) => e.status === 400);
  assert.throws(() => store.resolve('sub/../../x'), (e: HttpError) => e.status === 400);
  assert.equal(store.resolve('a.txt'), path.join(root, 'a.txt'));
});

test('list 返回目录条目', async () => {
  const entries = await store.list('.');
  assert.deepEqual(entries.map(e => e.name).sort(), ['a.txt', 'sub']);
  const file = entries.find(e => e.name === 'a.txt')!;
  assert.equal(file.type, 'file');
  assert.equal(file.size, 5);
});

test('read/write 往返', async () => {
  assert.equal((await store.read('a.txt')).content, 'hello');
  await store.write('sub/b.txt', '你好');
  assert.equal((await store.read('sub/b.txt')).content, '你好');
});

test('read 不存在的文件抛 404', async () => {
  await assert.rejects(store.read('nope.txt'), (e: HttpError) => e.status === 404);
});

test('mkdir/rename/del 生效', async () => {
  await store.mkdir('newdir');
  assert.ok((await readdir(path.join(root, 'newdir'))).length === 0);
  await store.rename('a.txt', 'renamed.txt');
  assert.equal((await store.read('renamed.txt')).content, 'hello');
  await store.del('renamed.txt');
  await assert.rejects(store.read('renamed.txt'));
});

test('rename 目标越界拒绝', async () => {
  await assert.rejects(store.rename('a.txt', '../evil.txt'), (e: HttpError) => e.status === 400);
});
