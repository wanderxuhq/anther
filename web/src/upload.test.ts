// web/src/upload.test.ts
// 上传路径纯逻辑：目录归一化、父子路径拼接、需创建目录去重排序、FileList 转换。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  directoriesFor, entriesFromFiles, joinUploadPath, normalizeRelativePath, type UploadEntry,
} from './upload.ts';

test('normalizeRelativePath：统一分隔符、去掉空段与 ./', () => {
  assert.equal(normalizeRelativePath('folder\\sub/a.txt'), 'folder/sub/a.txt');
  assert.equal(normalizeRelativePath('./a//b/'), 'a/b');
  assert.equal(normalizeRelativePath('././a.txt'), 'a.txt');
  assert.equal(normalizeRelativePath(''), '');
});

test('joinUploadPath：根目录不产生 ./ 前缀', () => {
  assert.equal(joinUploadPath('.', 'a.txt'), 'a.txt');
  assert.equal(joinUploadPath('', 'a.txt'), 'a.txt');
  assert.equal(joinUploadPath('src', 'a.txt'), 'src/a.txt');
});

test('directoriesFor：按深度升序、去重、不包含文件名本身', () => {
  const entries: UploadEntry[] = [
    { file: {} as File, relativePath: 'x/y/z.txt' },
    { file: {} as File, relativePath: 'a.txt' },
    { file: {} as File, relativePath: 'x/y/q.txt' },
    { file: {} as File, relativePath: 'x/top.txt' },
  ];
  assert.deepEqual(directoriesFor(entries), ['x', 'x/y']);
  assert.deepEqual(directoriesFor([]), []);
});

test('entriesFromFiles：普通多选与文件夹相对路径都保留', () => {
  const plain = new File(['a'], 'a.txt', { type: 'text/plain' });
  const nested = new File(['b'], 'b.txt', { type: 'text/plain' });
  Object.defineProperty(nested, 'webkitRelativePath', { value: 'folder\\sub/b.txt' });

  const entries = entriesFromFiles([plain, nested]);
  assert.deepEqual(entries.map((e) => e.relativePath), ['a.txt', 'folder/sub/b.txt']);
  assert.equal(entries[0].file, plain);
  assert.equal(entries[1].file, nested);
});
