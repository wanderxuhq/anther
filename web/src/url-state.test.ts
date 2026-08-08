// web/src/url-state.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUrl, serializeUrl } from './url-state.ts';

test('parseUrl 根路径：无文件，默认值', () => {
  const s = parseUrl('http://host/');
  assert.deepEqual(s, { path: null, ro: true, theme: 'auto', fs: 100 });
});

test('parseUrl 文件路径 + 全参数', () => {
  const s = parseUrl('http://host/src/index.ts?ro=0&theme=dark&fs=110');
  assert.deepEqual(s, { path: 'src/index.ts', ro: false, theme: 'dark', fs: 110 });
});

test('parseUrl 路径特殊字符解码（%20 空格）', () => {
  const s = parseUrl('http://host/my%20dir/a.ts');
  assert.equal(s.path, 'my dir/a.ts');
});

test('parseUrl 未知参数忽略、非法 fs 钳制', () => {
  const s = parseUrl('http://host/a.ts?ro=1&fs=999&view=git&theme=x');
  assert.deepEqual(s, { path: 'a.ts', ro: true, theme: 'auto', fs: 130 });
});

test('serializeUrl 最简形态：默认值全部省略', () => {
  assert.equal(serializeUrl({ path: 'a.ts', ro: true, theme: 'auto', fs: 100 }), '/a.ts');
});

test('serializeUrl 非默认值写入参数', () => {
  assert.equal(
    serializeUrl({ path: 'a.ts', ro: false, theme: 'dark', fs: 110 }),
    '/a.ts?ro=0&theme=dark&fs=110',
  );
});

test('serializeUrl 无文件 + 非默认参数', () => {
  assert.equal(serializeUrl({ path: null, ro: false, theme: 'light', fs: 100 }), '/?ro=0&theme=light');
});

test('serializeUrl 空格编码，斜杠保留', () => {
  assert.equal(serializeUrl({ path: 'my dir/a.ts', ro: true, theme: 'auto', fs: 100 }), '/my%20dir/a.ts');
});
