import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMarkdownRows, joinWrappedRows } from './markdown-blocks.ts';

test('classifyMarkdownRows：标题/列表/引用/分隔线', () => {
  const blocks = classifyMarkdownRows(['# Title', 'plain', '- item', '> quote', '---']);
  assert.deepEqual(blocks, [
    { kind: 'heading', level: 1, text: 'Title' },
    { kind: 'normal' },
    { kind: 'list', prefix: '- ', text: 'item' },
    { kind: 'quote', text: 'quote' },
    { kind: 'hr' },
  ]);
});

test('classifyMarkdownRows：围栏代码块跨行，未闭合时持续为 code', () => {
  const blocks = classifyMarkdownRows(['```ts', 'const x = 1;', '```', 'after']);
  assert.deepEqual(blocks, [
    { kind: 'fence' },
    { kind: 'code', text: 'const x = 1;' },
    { kind: 'fence' },
    { kind: 'normal' },
  ]);
  assert.deepEqual(classifyMarkdownRows(['~~~', 'still code']), [
    { kind: 'fence' },
    { kind: 'code', text: 'still code' },
  ]);
});

test('classifyMarkdownRows：标题最多 6 级，缩进列表保留前缀', () => {
  const blocks = classifyMarkdownRows(['####### not heading', '  - nested', '1. first']);
  assert.deepEqual(blocks, [
    { kind: 'normal' },
    { kind: 'list', prefix: '  - ', text: 'nested' },
    { kind: 'list', prefix: '1. ', text: 'first' },
  ]);
});

test('joinWrappedRows：按自动换行标记拼回逻辑行', () => {
  const { texts, starts } = joinWrappedRows(
    ['| A | B |', '| --- |', '| 1 | 2 |', 'tail', 'more'],
    (index) => index === 1 || index === 4,
  );
  assert.deepEqual(texts, ['| A | B || --- |', '| 1 | 2 |', 'tailmore']);
  assert.deepEqual(starts, [0, 2, 3]);
});

test('classifyMarkdownRows：GFM 表格跨行，首行带完整 source', () => {
  const blocks = classifyMarkdownRows([
    'before',
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
    'after',
  ]);
  assert.deepEqual(blocks, [
    { kind: 'normal' },
    {
      kind: 'table', role: 'start',
      source: '| A | B |\n| --- | --- |\n| 1 | 2 |',
      start: 1, end: 4,
    },
    { kind: 'table', role: 'body', start: 1, end: 4 },
    { kind: 'table', role: 'body', start: 1, end: 4 },
    { kind: 'normal' },
  ]);
});

test('classifyMarkdownRows：表格遇到空行/新块停止，代码围栏里的表格不识别', () => {
  const blocks = classifyMarkdownRows([
    'A | B',
    '--- | ---',
    '1 | 2',
    '',
    '# next',
    '```',
    '| X | Y |',
    '| --- | --- |',
    '```',
  ]);
  assert.equal(blocks[0].kind, 'table');
  assert.deepEqual(blocks[0], {
    kind: 'table', role: 'start',
    source: 'A | B\n--- | ---\n1 | 2',
    start: 0, end: 3,
  });
  assert.deepEqual(blocks.slice(1, 4), [
    { kind: 'table', role: 'body', start: 0, end: 3 },
    { kind: 'table', role: 'body', start: 0, end: 3 },
    { kind: 'normal' },
  ]);
  assert.deepEqual(blocks.slice(4), [
    { kind: 'heading', level: 1, text: 'next' },
    { kind: 'fence' },
    { kind: 'code', text: '| X | Y |' },
    { kind: 'code', text: '| --- | --- |' },
    { kind: 'fence' },
  ]);
});
