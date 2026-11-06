import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMarkdownRows } from './markdown-blocks.ts';

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
