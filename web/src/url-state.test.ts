// web/src/url-state.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUrl, serializeUrl } from './url-state.ts';

test('parseUrl 根路径：无文件，默认值', () => {
  const s = parseUrl('http://host/');
  assert.deepEqual(s, { path: null, term: null, ro: true, theme: 'auto', fs: 100 });
});

test('parseUrl 文件路径 + 全参数', () => {
  const s = parseUrl('http://host/src/index.ts?ro=0&theme=dark&fs=110');
  assert.deepEqual(s, { path: 'src/index.ts', term: null, ro: false, theme: 'dark', fs: 110 });
});

test('parseUrl 路径特殊字符解码（%20 空格）', () => {
  const s = parseUrl('http://host/my%20dir/a.ts');
  assert.equal(s.path, 'my dir/a.ts');
});

test('parseUrl 未知参数忽略、非法 fs 钳制', () => {
  const s = parseUrl('http://host/a.ts?ro=1&fs=999&view=git&theme=x');
  assert.deepEqual(s, { path: 'a.ts', term: null, ro: true, theme: 'auto', fs: 130 });
});

test('parseUrl 畸形编码不抛：path 取 null，其余字段正常解析', () => {
  const s = parseUrl('http://x/a%zz?ro=0');
  assert.equal(s.path, null);
  assert.equal(s.ro, false);
});

test('serializeUrl 最简形态：默认值全部省略', () => {
  assert.equal(serializeUrl({ path: 'a.ts', term: null, ro: true, theme: 'auto', fs: 100 }), '/a.ts');
});

test('serializeUrl 非默认值写入参数', () => {
  assert.equal(
    serializeUrl({ path: 'a.ts', term: null, ro: false, theme: 'dark', fs: 110 }),
    '/a.ts?ro=0&theme=dark&fs=110',
  );
});

test('serializeUrl 无文件 + 非默认参数', () => {
  assert.equal(serializeUrl({ path: null, term: null, ro: false, theme: 'light', fs: 100 }), '/?ro=0&theme=light');
});

test('serializeUrl 空格编码，斜杠保留', () => {
  assert.equal(serializeUrl({ path: 'my dir/a.ts', term: null, ro: true, theme: 'auto', fs: 100 }), '/my%20dir/a.ts');
});

test('parseUrl 终端前台：?term= 生效，path 置 null', () => {
  assert.deepEqual(parseUrl('http://host/?term=t_7f3a&ro=0&theme=dark&fs=110'), {
    path: null, term: 't_7f3a', ro: false, theme: 'dark', fs: 110,
  });
});

test('parseUrl term 与 path 并存：term 优先，path 忽略', () => {
  const s = parseUrl('http://host/a.ts?term=t_7f3a');
  assert.equal(s.path, null);
  assert.equal(s.term, 't_7f3a');
});

test('parseUrl 非法 term：忽略，按普通路径解析', () => {
  assert.equal(parseUrl('http://host/?term=nota_term').term, null);
  assert.equal(parseUrl('http://host/a.ts?term=nota_term').path, 'a.ts');
});

test('serializeUrl 终端前台：输出 ?term=，无 path', () => {
  assert.equal(
    serializeUrl({ path: null, term: 't_7f3a', ro: false, theme: 'dark', fs: 110 }),
    '/?term=t_7f3a&ro=0&theme=dark&fs=110',
  );
});

test('serializeUrl path 与 term 并存：term 优先（防御）', () => {
  assert.equal(serializeUrl({ path: 'a.ts', term: 't_1', ro: true, theme: 'auto', fs: 100 }), '/?term=t_1');
});
