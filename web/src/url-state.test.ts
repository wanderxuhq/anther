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

test('压缩包 entry 支持大小写扩展名、特殊路径往返，并优先于行号', () => {
  for (const archive of ['a.zip', 'a.JAR', 'a.war', 'a.apk', 'a.xpi', 'a.cbz', 'a.7z', 'a.rar',
    'a.tar', 'a.gz', 'a.tgz', 'a.bz2', 'a.tbz', 'a.tbz2', 'a.xz', 'a.txz']) {
    const url = `http://host/${archive}?entry=${encodeURIComponent('目录/a #%.txt')}&line=8`;
    const state = parseUrl(url);
    assert.equal(state.entry, '目录/a #%.txt', archive);
    assert.equal(state.line, null, archive);
    const serialized = serializeUrl(state);
    assert.match(serialized, /entry=/, archive);
    assert.doesNotMatch(serialized, /line=/, archive);
    assert.deepEqual(parseUrl(`http://host${serialized}`), state);
  }
});

test('压缩包 entry 拒绝绝对路径、上级段和控制符', () => {
  for (const entry of ['/etc/passwd', '\\\\server\\share', 'C:\\outside', '../secret', 'dir/../secret',
    'dir\\..\\secret', 'bad\u0000name', 'bad\u001fname', 'bad\u007fname', 'bad\u0085name']) {
    const state = parseUrl(`http://host/archive.zip?entry=${encodeURIComponent(entry)}&line=4`);
    assert.equal(state.entry, null, JSON.stringify(entry));
    assert.equal(state.line?.start, 4, JSON.stringify(entry));
    assert.doesNotMatch(serializeUrl(state), /entry=/, JSON.stringify(entry));
  }
});

test('非压缩包和非文件视图忽略 entry', () => {
  const text = parseUrl('http://host/readme.txt?entry=folder%2Fitem.txt&line=2');
  assert.equal(text.entry, null);
  assert.equal(serializeUrl(text), '/readme.txt?line=2');
  const git = parseUrl('http://host/-/git/history?entry=folder%2Fitem.txt');
  assert.equal(git.entry, null);
  assert.equal(serializeUrl(git), '/-/git/history');
});

test('嵌套压缩包 inside 多层往返，entry 可省略表示内层压缩包根目录', () => {
  const source = 'http://host/bundles.zip?inside=inner.zip&inside=docs%2Fdeep.7z&entry=dir%2Fa.txt&line=4';
  const state = parseUrl(source);
  assert.deepEqual(state.inside, ['inner.zip', 'docs/deep.7z']);
  assert.equal(state.entry, 'dir/a.txt');
  assert.equal(state.line, null);
  const serialized = serializeUrl(state);
  assert.deepEqual(new URLSearchParams(serialized.split('?')[1]).getAll('inside'), state.inside);
  assert.deepEqual(parseUrl(`http://host${serialized}`), state);

  const innerRoot = parseUrl('http://host/bundles.zip?inside=inner.zip&inside=docs%2Fdeep.7z');
  assert.deepEqual(innerRoot.inside, ['inner.zip', 'docs/deep.7z']);
  assert.equal(innerRoot.entry, null);
  assert.equal(serializeUrl(innerRoot), '/bundles.zip?inside=inner.zip&inside=docs%2Fdeep.7z');
});

test('非法 inside 链会整体清理，且普通文件和 Git 视图忽略 inside', () => {
  for (const inside of ['readme.txt', '../inner.zip', '/absolute.zip', 'C:\\inner.zip', 'bad\u0000.zip']) {
    const state = parseUrl(`http://host/bundles.zip?inside=${encodeURIComponent(inside)}&entry=ok.txt&line=9`);
    assert.deepEqual(state.inside, [], inside);
    assert.equal(state.entry, 'ok.txt'); // inside 与最外层 entry 独立
    assert.equal(state.line, null);
    assert.doesNotMatch(serializeUrl(state), /inside=/, inside);
  }

  const plain = parseUrl('http://host/readme.txt?inside=inner.zip&entry=item.txt&line=2');
  assert.deepEqual(plain.inside, []);
  assert.equal(plain.entry, null);
  assert.equal(serializeUrl(plain), '/readme.txt?line=2');
  const git = parseUrl('http://host/-/git/history?inside=inner.zip&entry=item.txt');
  assert.deepEqual(git.inside, []);
  assert.equal(git.entry, null);
  assert.equal(serializeUrl(git), '/-/git/history');
});

test('不再解析旧 Git 查询参数；显式路由优先且清理无关参数', () => {
  assert.equal(serializeUrl(parseUrl('http://host/?view=history&branch=main')), '/');
  assert.equal(serializeUrl(parseUrl('http://host/a.ts?view=diff')), '/a.ts');
  assert.equal(serializeUrl(parseUrl('http://host/-/git/history?view=commit&commit=abc1234&branch=main&line=2')),
    '/-/git/history?branch=main');
  assert.equal(serializeUrl(parseUrl('http://host/-/file/-/git/history?view=commit&commit=abc1234')),
    '/-/file/-/git/history');
});
