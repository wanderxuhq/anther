// web/src/views/search-view.test.ts
// splitByQuery：把行文本按关键词切成 [普通段, 匹配段] 交替序列（SearchView 高亮用），
// 纯函数便于 node 直接测试。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitByQuery } from './search-util.ts';

test('基本命中：切分交替段', () => {
  assert.deepEqual(splitByQuery('aaa hello bbb hello', 'hello', false), [
    { text: 'aaa ', match: false },
    { text: 'hello', match: true },
    { text: ' bbb ', match: false },
    { text: 'hello', match: true },
  ]);
});

test('无命中：整段普通', () => {
  assert.deepEqual(splitByQuery('abc def', 'xyz', false), [{ text: 'abc def', match: false }]);
});

test('大小写：默认不敏感，caseSensitive 敏感', () => {
  assert.deepEqual(splitByQuery('Hello', 'hello', false), [{ text: 'Hello', match: true }]);
  assert.deepEqual(splitByQuery('Hello', 'hello', true), [{ text: 'Hello', match: false }]);
});

test('空关键词 → 整段普通', () => {
  assert.deepEqual(splitByQuery('abc', '', false), [{ text: 'abc', match: false }]);
});

test('匹配段长度用原文（大小写不敏感时保留原始大小写）', () => {
  const parts = splitByQuery('xx HELLO yy', 'hello', false);
  assert.deepEqual(parts, [
    { text: 'xx ', match: false },
    { text: 'HELLO', match: true },
    { text: ' yy', match: false },
  ]);
});
