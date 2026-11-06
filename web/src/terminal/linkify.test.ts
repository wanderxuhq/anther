import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikePath, splitLinks } from './linkify.ts';

function compact(text: string) {
  return splitLinks(text).map((part) => 'link' in part ? { link: part.link, label: part.label } : { text: part.text });
}

test('splitLinks：斜杠路径、行号、标点保留', () => {
  assert.deepEqual(compact('see src/foo.ts, world'), [
    { text: 'see ' },
    { link: { kind: 'path', path: 'src/foo.ts' }, label: 'src/foo.ts' },
    { text: ', world' },
  ]);
  assert.deepEqual(compact('foo.ts:12:3'), [
    { link: { kind: 'path', path: 'foo.ts', line: 12, column: 3 }, label: 'foo.ts:12:3' },
  ]);
  assert.deepEqual(compact('see README.md.'), [
    { text: 'see ' },
    { link: { kind: 'path', path: 'README.md' }, label: 'README.md' },
    { text: '.' },
  ]);
});

test('splitLinks：URL 优先于路径，且不把域名当文件', () => {
  assert.deepEqual(compact('https://example.com/src/foo.ts'), [
    { link: { kind: 'url', url: 'https://example.com/src/foo.ts' }, label: 'https://example.com/src/foo.ts' },
  ]);
  assert.deepEqual(compact('example.com'), [{ text: 'example.com' }]);
  assert.deepEqual(compact('v1.2.3'), [{ text: 'v1.2.3' }]);
  assert.deepEqual(compact('1/2'), [{ text: '1/2' }]);
});

test('splitLinks：中文标点不吞进路径', () => {
  assert.deepEqual(compact('查看 src/foo.ts。'), [
    { text: '查看 ' },
    { link: { kind: 'path', path: 'src/foo.ts' }, label: 'src/foo.ts' },
    { text: '。' },
  ]);
  assert.deepEqual(compact('（src/foo.ts）'), [
    { text: '（' },
    { link: { kind: 'path', path: 'src/foo.ts' }, label: 'src/foo.ts' },
    { text: '）' },
  ]);
});

test('splitLinks：括号、引号、等号前缀', () => {
  assert.deepEqual(compact('(src/foo.ts)'), [
    { text: '(' },
    { link: { kind: 'path', path: 'src/foo.ts' }, label: 'src/foo.ts' },
    { text: ')' },
  ]);
  assert.deepEqual(compact('"src/foo bar.ts"'), [
    { text: '"' },
    { link: { kind: 'path', path: 'src/foo bar.ts' }, label: 'src/foo bar.ts' },
    { text: '"' },
  ]);
  assert.deepEqual(compact('--file=src/foo.ts'), [
    { text: '--file=' },
    { link: { kind: 'path', path: 'src/foo.ts' }, label: 'src/foo.ts' },
  ]);
  assert.deepEqual(compact('**src/foo.ts**'), [
    { text: '**' },
    { link: { kind: 'path', path: 'src/foo.ts' }, label: 'src/foo.ts' },
    { text: '**' },
  ]);
});

test('looksLikePath：已知文件名/扩展名与常见误报', () => {
  assert.equal(looksLikePath('Makefile'), true);
  assert.equal(looksLikePath('.gitignore'), true);
  assert.equal(looksLikePath('package.json'), true);
  assert.equal(looksLikePath('src/components'), true);
  assert.equal(looksLikePath('src/components/'), true);
  assert.equal(looksLikePath('node_modules/@types/node/index.d.ts'), true);
  assert.equal(looksLikePath('foo.unknown-ext'), false);
  assert.equal(looksLikePath('foo.ts:b.ts'), false);
});
