// web/src/url-state.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STATE, parseUrl, serializeUrl } from './url-state.ts';

test('parseUrl 根路径：无文件，默认值', () => {
  const s = parseUrl('http://host/');
  assert.deepEqual(s, { ...DEFAULT_STATE, path: null, term: null, ro: true, theme: 'auto', fs: 100 });
});

test('parseUrl 文件路径 + 全参数', () => {
  const s = parseUrl('http://host/src/index.ts?ro=0&theme=dark&fs=110');
  assert.deepEqual(s, { ...DEFAULT_STATE, path: 'src/index.ts', term: null, ro: false, theme: 'dark', fs: 110 });
});

test('parseUrl 路径特殊字符解码（%20 空格）', () => {
  const s = parseUrl('http://host/my%20dir/a.ts');
  assert.equal(s.path, 'my dir/a.ts');
});

test('parseUrl 未知参数忽略、非法 fs 钳制', () => {
  const s = parseUrl('http://host/a.ts?ro=1&fs=999&view=unknown&theme=x');
  assert.deepEqual(s, { ...DEFAULT_STATE, path: 'a.ts', term: null, ro: true, theme: 'auto', fs: 130 });
});

test('parseUrl 畸形编码不抛：path 取 null，其余字段正常解析', () => {
  const s = parseUrl('http://x/a%zz?ro=0');
  assert.equal(s.path, null);
  assert.equal(s.ro, false);
});

test('serializeUrl 最简形态：默认值全部省略', () => {
  assert.equal(serializeUrl({ ...DEFAULT_STATE, path: 'a.ts', term: null, ro: true, theme: 'auto', fs: 100 }), '/a.ts');
});

test('serializeUrl 非默认值写入参数', () => {
  assert.equal(
    serializeUrl({ ...DEFAULT_STATE, path: 'a.ts', term: null, ro: false, theme: 'dark', fs: 110 }),
    '/a.ts?ro=0&theme=dark&fs=110',
  );
});

test('serializeUrl 无文件 + 非默认参数', () => {
  assert.equal(serializeUrl({ ...DEFAULT_STATE, path: null, term: null, ro: false, theme: 'light', fs: 100 }), '/?ro=0&theme=light');
});

test('serializeUrl 空格编码，斜杠保留', () => {
  assert.equal(serializeUrl({ ...DEFAULT_STATE, path: 'my dir/a.ts', term: null, ro: true, theme: 'auto', fs: 100 }), '/my%20dir/a.ts');
});

test('parseUrl 终端前台：?term= 生效，path 置 null', () => {
  assert.deepEqual(parseUrl('http://host/?term=t_7f3a&ro=0&theme=dark&fs=110'), {
    ...DEFAULT_STATE, path: null, term: 't_7f3a', ro: false, theme: 'dark', fs: 110,
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
    serializeUrl({ ...DEFAULT_STATE, path: null, term: 't_7f3a', ro: false, theme: 'dark', fs: 110 }),
    '/?term=t_7f3a&ro=0&theme=dark&fs=110',
  );
});

test('serializeUrl path 与 term 并存：term 优先（防御）', () => {
  assert.equal(serializeUrl({ ...DEFAULT_STATE, path: 'a.ts', term: 't_1', ro: true, theme: 'auto', fs: 100 }), '/?term=t_1');
});

test('新增状态可往返：Git 各视图、文件 diff、历史分支及提交', () => {
  for (const url of [
    '/-/git', '/-/git/branches', '/-/git/history',
    '/-/git/history?branch=feature%2F%E4%B8%AD%E6%96%87',
    '/-/git/diff/src/a%20%23.ts', '/-/git/commit/abc1234',
  ]) {
    const state = parseUrl(`http://host${url}`);
    assert.equal(serializeUrl(state), url);
    assert.deepEqual(parseUrl(`http://host${serializeUrl(state)}`), state);
  }
});

test('行号/选区支持单行和范围；非法、反向、溢出行号忽略', () => {
  assert.deepEqual(parseUrl('http://host/a.ts?line=42').line, { start: 42, end: 42 });
  const range = parseUrl('http://host/a.ts?line=42-50');
  assert.deepEqual(range.line, { start: 42, end: 50 });
  assert.equal(serializeUrl(range), '/a.ts?line=42-50');
  for (const line of ['0', '-1', '4-2', '1.5', 'abc', '1-2-3', '9007199254740992']) {
    assert.equal(parseUrl(`http://host/a.ts?line=${line}`).line, null);
  }
});

test('搜索条件包含空排除条件，特殊字符完整往返，语言覆盖保留', () => {
  const state = { ...DEFAULT_STATE, path: '你好 #?.ts', panel: 'search' as const,
    query: 'TODO & 中文 + #?', caseSensitive: true, exclude: '', lang: 'zh' as const };
  const url = serializeUrl(state);
  assert.match(url, /exclude=/);
  assert.match(url, /lang=zh/);
  assert.deepEqual(parseUrl(`http://host${url}`), state);
  assert.equal(parseUrl('http://host/?panel=tabs').panel, 'tabs');
});

test('资源互斥：终端优先；普通 Git 视图不携带文件和行号', () => {
  const term = parseUrl('http://host/-/git/commit/abc1234?term=t_1&line=4&branch=main');
  assert.equal(serializeUrl(term), '/?term=t_1');
  const git = parseUrl('http://host/-/git?line=4&branch=main&commit=abc1234');
  assert.equal(serializeUrl(git), '/-/git');
  assert.equal(parseUrl('http://host/-/git/diff/').view, 'git');
  for (const commit of ['', 'HEAD', '../etc', 'not-a-sha']) {
    assert.equal(parseUrl(`http://host/-/git/commit/${commit}`).view, 'git');
  }
});

test('无关与未知参数不进入 URL，Markdown 源码/预览不保存', () => {
  const state = parseUrl('http://host/README.md?md=source&panel=invalid&lang=xx&q=unused&line=2&branch=main');
  assert.equal(serializeUrl(state), '/README.md?line=2');
  assert.equal(state.panel, 'files');
  assert.equal(state.lang, null);
});

test('Git 独立路径不占用普通文件路径；保留命名空间中的真实文件显式转义', () => {
  for (const path of ['git', 'git/history', 'git/commit/abc1234', '-/git', '-/git/history',
    '-/file/a.txt', '-/file/-/git/history', '-/目录/a #?%.ts']) {
    const state = { ...DEFAULT_STATE, path };
    const url = serializeUrl(state);
    assert.deepEqual(parseUrl(`http://host${url}`), state);
    assert.equal(url.startsWith('/-/file/'), path.startsWith('-/'));
  }
  assert.equal(serializeUrl({ ...DEFAULT_STATE, path: '-/git/history' }), '/-/file/-/git/history');
  assert.equal(parseUrl('http://host/git/history').view, 'file');
  assert.equal(parseUrl('http://host/-/git/history').view, 'history');
});

test('diff 路由内的特殊字符和保留路径仅解码一次', () => {
  for (const path of ['src/你好 #?%25.ts', '-/git/history', '-/file/a.txt', 'a%2Fb.ts']) {
    const state = { ...DEFAULT_STATE, view: 'diff' as const, path };
    assert.deepEqual(parseUrl(`http://host${serializeUrl(state)}`), state);
  }
});

test('不再解析旧 Git 查询参数；显式路由优先且清理无关参数', () => {
  assert.equal(serializeUrl(parseUrl('http://host/?view=history&branch=main')), '/');
  assert.equal(serializeUrl(parseUrl('http://host/a.ts?view=diff')), '/a.ts');
  assert.equal(serializeUrl(parseUrl('http://host/-/git/history?view=commit&commit=abc1234&branch=main&line=2')),
    '/-/git/history?branch=main');
  assert.equal(serializeUrl(parseUrl('http://host/-/file/-/git/history?view=commit&commit=abc1234')),
    '/-/file/-/git/history');
});
