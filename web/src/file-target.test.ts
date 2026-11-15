import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileTargetKey, parseFileTargetKey, sameArchiveChain, sameFileTarget } from './file-target.ts';

test('fileTargetKey：普通路径保持原样', () => {
  assert.equal(fileTargetKey({ path: 'src/a.ts' }), 'src/a.ts');
  assert.deepEqual(parseFileTargetKey('src/a.ts'), { path: 'src/a.ts' });
});

test('fileTargetKey：归档目标编码后可无损还原', () => {
  const target = { path: 'bundle #1.zip', archive: { chain: ['inner.zip'], entry: '目录/a #%.ts' } };
  const key = fileTargetKey(target);
  assert.deepEqual(parseFileTargetKey(key), target);
});

test('parseFileTargetKey：畸形归档 key 返回 null 而不是抛错', () => {
  assert.equal(parseFileTargetKey('/_/entry/not-json'), null);
  assert.equal(parseFileTargetKey('/_/entry/["a.zip",[],"ok.txt","extra"]'), null);
  assert.equal(parseFileTargetKey('/_/entry/["a.zip",["../x"],"ok.txt"]'), null);
});

test('sameArchiveChain：按内容比较，长度和顺序都参与', () => {
  assert.equal(sameArchiveChain([], []), true);
  assert.equal(sameArchiveChain(['a.zip'], ['a.zip']), true);
  assert.equal(sameArchiveChain(['a.zip', 'b.7z'], ['a.zip', 'b.7z']), true);
  assert.equal(sameArchiveChain(['a.zip'], ['b.zip']), false);
  assert.equal(sameArchiveChain(['a.zip'], ['a.zip', 'b.7z']), false);
  assert.equal(sameArchiveChain(['a.zip', 'b.7z'], ['a.zip']), false);
});

test('sameFileTarget：普通路径与嵌套归档目标分别比较完整身份', () => {
  assert.equal(sameFileTarget({ path: 'a.ts' }, { path: 'a.ts' }), true);
  assert.equal(sameFileTarget({ path: 'a.ts' }, { path: 'b.ts' }), false);
  const a = { path: 'bundle.zip', archive: { entry: 'a.txt', chain: ['inner.zip'] } };
  assert.equal(sameFileTarget(a, { ...a, archive: { ...a.archive, chain: ['inner.zip'] } }), true);
  assert.equal(sameFileTarget(a, { ...a, archive: { ...a.archive, entry: 'b.txt' } }), false);
  assert.equal(sameFileTarget(a, { ...a, archive: { ...a.archive, chain: ['other.zip'] } }), false);
});
