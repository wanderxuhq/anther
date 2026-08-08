// server/files.test.ts
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readdir, symlink } from 'node:fs/promises';
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

test('create 新建文件：存在且内容为空', async () => {
  await store.create('new.txt');
  assert.equal((await store.read('new.txt')).content, '');
});

test('create 同名 → 409 且原内容未被清空（独占创建）', async () => {
  await store.write('dup.txt', 'original');
  await assert.rejects(store.create('dup.txt'), (e: HttpError) => e.status === 409);
  assert.equal((await store.read('dup.txt')).content, 'original'); // 未被清空
});

test('rename 目标越界拒绝', async () => {
  await assert.rejects(store.rename('a.txt', '../evil.txt'), (e: HttpError) => e.status === 400);
});

test('符号链接逃逸被拒', async () => {
  await symlink('/etc', path.join(root, 'evil'));
  await assert.rejects(store.read('evil/passwd'), (e: HttpError) => e.status === 400);
});

test('符号链接逃逸写入被拒', async () => {
  await symlink('/etc', path.join(root, 'evil'));
  await assert.rejects(store.write('evil/x', 'x'), (e: HttpError) => e.status === 400);
});

test('悬空符号链接写入被拒', async () => {
  await symlink('/nonexistent-xyz-dir', path.join(root, 'evil2'));
  await assert.rejects(store.write('evil2/x.txt', 'x'), (e: HttpError) => e.status === 400);
});

test('指向根内的符号链接可读', async () => {
  await symlink('../a.txt', path.join(root, 'sub', 'ok'));
  assert.equal((await store.read('sub/ok')).content, 'hello');
});

test('list 含悬空链接仍可列出其余条目', async () => {
  await symlink('/nonexistent-xyz', path.join(root, 'dangling'));
  const entries = await store.list('.');
  assert.deepEqual(entries.map(e => e.name).sort(), ['a.txt', 'dangling', 'sub']);
});

test('list 中符号链接条目标为 link', async () => {
  await symlink('../a.txt', path.join(root, 'ok'));
  const entries = await store.list('.');
  const ok = entries.find(e => e.name === 'ok')!;
  assert.equal(ok.type, 'link');
});

test('del 拒绝根路径：抛 400 且目录仍在', async () => {
  await assert.rejects(store.del('.'), (e: HttpError) => e.status === 400);
  assert.equal((await readdir(root)).sort().join(','), 'a.txt,sub'); // 未被递归删除
});

test('rename 拒绝根路径：抛 400 且目录名未变', async () => {
  await assert.rejects(store.rename('.', 'x'), (e: HttpError) => e.status === 400);
  assert.equal((await store.read('a.txt')).content, 'hello'); // 根目录未被改名，内容可读
});

test("root='/' 时 resolve 正常（修复 '//' 前缀全 400 缺陷）", () => {
  const rootStore = new FileStore('/');
  assert.equal(rootStore.resolve('etc/hosts'), '/etc/hosts');
  assert.equal(rootStore.resolve('/'), '/');
  assert.doesNotThrow(() => rootStore.resolve('..')); // path.resolve('/', '..') 归一化为根自身
});

test('del 拒绝词法变体根路径 sub/..：抛 400 且根目录仍在', async () => {
  await assert.rejects(store.del('sub/..'), (e: HttpError) => e.status === 400);
  assert.equal((await readdir(root)).sort().join(','), 'a.txt,sub'); // 未被递归删除
});

test('del 拒绝 "./"：抛 400 且根目录仍在', async () => {
  await assert.rejects(store.del('./'), (e: HttpError) => e.status === 400);
  assert.equal((await readdir(root)).sort().join(','), 'a.txt,sub');
});

test('rename 拒绝词法变体根路径 sub/..：抛 400 且根未改名', async () => {
  await assert.rejects(store.rename('sub/..', 'x'), (e: HttpError) => e.status === 400);
  assert.equal((await store.read('a.txt')).content, 'hello'); // 根目录未被改名，内容可读
});

test('rename 目标为词法变体根路径 sub/..：抛 400', async () => {
  await assert.rejects(store.rename('a.txt', 'sub/..'), (e: HttpError) => e.status === 400);
});
