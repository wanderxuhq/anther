// 用浏览器版 Solid 和实际 App/CodeMirror 验证 URL ↔ UI；网络在内存中模拟。
import { before, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'vite';
import solid from 'vite-plugin-solid';
import { JSDOM } from 'jsdom';

let code: string;
before(async () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const entry = path.join(root, 'src/__url_test_entry.tsx');
  const result = await build({
    configFile: false, root, logLevel: 'silent',
    plugins: [{ name: 'url-test-entry', resolveId: (id) => id === entry ? entry : null,
      load: (id) => id === entry ? `
        import { render } from 'solid-js/web';
        import { App } from '${path.join(import.meta.dirname, 'App.tsx')}';
        import * as stores from '${path.join(import.meta.dirname, 'stores.ts')}';
        import { EditorView } from '@codemirror/view';
        window.harness = { stores, EditorView, mount: () => render(() => <App />, document.getElementById('root')) };
      ` : null }, solid()],
    build: { write: false, minify: false,
      rollupOptions: { input: entry, output: { format: 'iife', inlineDynamicImports: true } } },
  });
  const output = Array.isArray(result) ? result[0].output : result.output;
  code = output.find((x) => x.type === 'chunk')!.code;
});

const tick = (ms = 10) => new Promise<void>((r) => setTimeout(r, ms));
async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) { if (check()) return; await tick(); }
  assert.ok(check(), 'state did not settle');
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
type Hook = (url: URL, init: RequestInit) => Promise<Response | undefined> | Response | undefined;

async function setup(t: TestContext, url: string, opts: { hook?: Hook; mount?: boolean; narrow?: boolean; duringStart?: (stores: any, window: any) => Promise<void> } = {}) {
  const dom = new JSDOM('<div id="root"></div>', {
    url: `http://localhost${url}`, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window;
  w.matchMedia = (q: string) => ({ matches: !!opts.narrow && q.includes('599px'), addEventListener() {}, removeEventListener() {} });
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.Range.prototype.getClientRects = () => [];
  w.Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });
  const calls: { url: URL; init: RequestInit }[] = [];
  const docs = new Map([['a.txt', 'one\ntwo\nthree\nfour'], ['b.txt', 'B\nsecond'], ['README.md', '# Title\n\nMarkdown']]);
  w.fetch = async (input: string, init: RequestInit = {}) => {
    const u = new URL(input, 'http://localhost');
    calls.push({ url: u, init });
    const override = await opts.hook?.(u, init);
    if (override) return override;
    const file = u.searchParams.get('path')!;
    if (u.pathname === '/api/file') {
      if (init.method === 'PUT') { docs.set(file, JSON.parse(String(init.body)).content); return json({ ok: true }); }
      return docs.has(file) ? json({ content: docs.get(file), utf8: true }) : json({ error: 'not found' }, 404);
    }
    if (u.pathname === '/api/list') return json({ entries: [] });
    if (u.pathname === '/api/tabs') return json({ tabs: [] });
    if (u.pathname === '/api/tabs/restore') return json({ restored: true });
    if (u.pathname === '/api/terminals') return json({ terminals: [] });
    if (u.pathname === '/api/git/branches') return json({ isRepo: true, current: 'main', branches: [
      { name: 'main', current: true, tip: 'abc1234' }, { name: 'feature/test', current: false, tip: 'def5678' },
    ] });
    if (u.pathname === '/api/git/log') return json({ isRepo: true, commits: [] });
    if (u.pathname === '/api/git/status') return json({ isRepo: true, changes: [] });
    if (u.pathname === '/api/git/diff') return json({ diff: '' });
    if (u.pathname === '/api/git/show') return json({ commit: { hash: u.searchParams.get('commit'), shortHash: 'abc1234', subject: 'Test', author: 'A', time: 1, decorations: '', parents: [] }, diff: '' });
    if (u.pathname === '/api/search') return new Response('data: {"type":"done","truncated":false,"fileCount":0,"matchCount":0}\n\n');
    return json({ ok: true });
  };
  w.eval(code);
  const s = w.harness.stores;
  const started = s.startSync();
  const dispose = opts.mount === false ? () => {} : w.harness.mount();
  t.after(() => { dispose(); dom.window.close(); });
  await opts.duringStart?.(s, w);
  await started;
  const editor = () => w.harness.EditorView.findFromDOM(w.document.querySelector('.cm-editor'));
  const history = async (direction: 'back' | 'forward') => {
    const event = new Promise<void>((r) => w.addEventListener('popstate', () => r(), { once: true }));
    w.history[direction]();
    await event;
    await tick();
  };
  return { w, s, calls, docs, editor, history };
}

test('无标签快照的文件深链恢复选区、语言、主题和字号；浏览历史恢复关闭过的标签', async (t) => {
  const { w, s, editor, history } = await setup(t, '/a.txt?theme=dark&fs=110&lang=zh&line=2-3');
  await until(() => s.docLoadedPath() === 'a.txt');
  assert.equal(s.currentFile(), 'a.txt');
  assert.equal(w.document.documentElement.lang, 'zh-CN');
  assert.equal(w.document.documentElement.dataset.theme, 'dark');
  assert.equal(w.document.documentElement.style.fontSize, '110%');
  assert.equal(editor().state.sliceDoc(editor().state.selection.main.from, editor().state.selection.main.to), 'two\nthree');
  const firstUrl = w.location.href;
  const initialLength = w.history.length;
  await s.openTab('b.txt');
  await until(() => s.docLoadedPath() === 'b.txt');
  assert.equal(w.history.length, initialLength + 1);
  assert.match(w.location.search, /lang=zh/);
  await s.closeTab('a.txt'); // 关掉后台标签，不新增 URL 历史。
  await history('back');
  await until(() => s.docLoadedPath() === 'a.txt');
  assert.equal(w.location.href, firstUrl);
  assert.equal(s.currentFile(), 'a.txt');
  assert.equal(editor().state.selection.main.from, 4);
  await history('forward');
  await until(() => s.docLoadedPath() === 'b.txt');
  assert.equal(s.currentFile(), 'b.txt');
});

test('用户选区写入 URL，连续移动不增加历史；搜索行号跳转可后退', async (t) => {
  const { w, s, editor, history } = await setup(t, '/a.txt');
  await until(() => s.docLoadedPath() === 'a.txt');
  const length = w.history.length;
  editor().dispatch({ selection: { anchor: 4, head: 13 }, userEvent: 'select' });
  assert.equal(w.location.search, '?line=2-3');
  editor().dispatch({ selection: { anchor: 0 }, userEvent: 'select' });
  assert.equal(w.location.search, '?line=1');
  assert.equal(w.history.length, length);
  s.gotoLine0('a.txt', 2);
  assert.equal(w.location.search, '?line=3');
  assert.equal(w.history.length, length + 1);
  assert.equal(editor().state.selection.main.from, 8);
  await history('back');
  assert.equal(editor().state.selection.main.from, 0);
});

test('同文件后退到无行号 URL 时回到开头；Markdown 默认预览仍保持', async (t) => {
  const { w, s, editor, history } = await setup(t, '/a.txt');
  await until(() => s.docLoadedPath() === 'a.txt');
  s.gotoLine0('a.txt', 2);
  assert.equal(editor().state.selection.main.from, 8);
  await history('back');
  assert.equal(w.location.search, '');
  assert.equal(editor().state.selection.main.from, 0);
  await s.openTab('README.md');
  await until(() => s.docLoadedPath() === 'README.md');
  assert.ok(w.document.querySelector('.markdown-preview'));
});

test('Git 主视图、diff、历史、分支管理和提交均可由 URL 独立恢复', async (t) => {
  for (const [url, kind] of [
    ['/-/git', 'git'], ['/-/git/diff/a.txt', 'git-diff'],
    ['/-/git/history?branch=feature%2Ftest', 'git-history'],
    ['/-/git/branches', 'git-branch'], ['/-/git/commit/abc1234', 'git-commit'],
  ]) {
    const { s, calls } = await setup(t, url);
    assert.equal(s.activeTab().kind, kind);
    await tick();
    if (kind === 'git-history') {
      assert.equal(s.historyBranch(), 'feature/test');
      assert.ok(calls.some((c) => c.url.pathname === '/api/git/log' && c.url.searchParams.get('branch') === 'feature/test'));
    }
    assert.ok(!calls.some((c) => c.url.pathname === '/api/git/checkout'));
  }
});

test('普通路径和保留路径中的真实文件可刷新、切换 Git 并后退恢复', async (t) => {
  for (const [url, path] of [
    ['/git', 'git'], ['/git/history', 'git/history'],
    ['/-/file/-/git/history', '-/git/history'],
    ['/-/file/-/file/a.txt', '-/file/a.txt'],
  ]) {
    const { w, s, history } = await setup(t, url, { hook: (u, init) => {
      if (u.pathname === '/api/file' && u.searchParams.get('path') === path && init.method !== 'PUT') {
        return json({ content: 'file content', utf8: true });
      }
    } });
    await until(() => s.docLoadedPath() === path);
    assert.equal(s.activeTab().kind, 'file');
    assert.equal(s.currentFile(), path);
    s.openGit();
    assert.equal(s.activeTab().kind, 'git');
    assert.equal(w.location.pathname, '/-/git');
    await history('back');
    await until(() => s.docLoadedPath() === path);
    assert.equal(s.currentFile(), path);
    assert.equal(w.location.pathname, url);
    await history('forward');
    assert.equal(s.activeTab().kind, 'git');
    await s.openTab(path);
    assert.equal(w.location.pathname, url);
    assert.equal(s.currentFile(), path);
  }
});

test('Git 导航与分支筛选形成历史，后退恢复筛选；文件 diff 保留路径', async (t) => {
  const { w, s, history } = await setup(t, '/-/git/history?branch=feature%2Ftest&lang=en');
  s.selectHistoryBranch('main');
  assert.match(w.location.search, /branch=main/);
  await history('back');
  assert.equal(s.historyBranch(), 'feature/test');
  assert.equal(w.document.querySelector('.history-select').value, 'feature/test');
  s.openGitCommit('abc1234');
  assert.equal(w.location.pathname, '/-/git/commit/abc1234');
  await history('back');
  assert.equal(s.activeTab().kind, 'git-history');
  s.openGitDiff('a.txt');
  assert.equal(w.location.pathname, '/-/git/diff/a.txt');
  s.openGitBranch();
  assert.equal(w.location.pathname, '/-/git/branches');
});

test('Git URL 恢复时清理无关路径和参数；不新增历史且保留分支与侧栏状态', async (t) => {
  const { w, s, history } = await setup(t,
    '/-/git/history/?view=diff&line=3&branch=feature%2Ftest&commit=abc1234&panel=tabs', { narrow: true });
  assert.equal(w.location.pathname + w.location.search, '/-/git/history?branch=feature%2Ftest&panel=tabs');
  assert.equal(w.history.length, 1);
  assert.equal(s.activeTab().kind, 'git-history');
  assert.equal(s.historyBranch(), 'feature/test');
  s.openGitCommit('abc1234');
  assert.equal(w.location.pathname + w.location.search, '/-/git/commit/abc1234?panel=tabs');
  s.openGitDiff('目录/a #?%.ts');
  assert.equal(decodeURIComponent(w.location.pathname), '/-/git/diff/目录/a #?%.ts');
  assert.equal(w.location.search, '?panel=tabs');
  await history('back');
  assert.equal(s.activeTab().commit, 'abc1234');
  await history('back');
  assert.equal(s.historyBranch(), 'feature/test');
  assert.equal(w.location.pathname, '/-/git/history');
  w.history.pushState(null, '', '/-/git/commit/invalid?branch=main&line=2');
  s.openGitBranch();
  const length = w.history.length;
  await history('back');
  assert.equal(s.activeTab().kind, 'git');
  assert.equal(w.location.pathname + w.location.search, '/-/git');
  assert.equal(w.history.length, length);
  await history('forward');
  assert.equal(s.activeTab().kind, 'git-branch');
});

test('刷新 history + panel=tabs 不弹出抽屉，手动展开仍选中 Tabs，后退也不弹出', async (t) => {
  const { w, s, history } = await setup(t, '/-/git/history?panel=tabs', { narrow: true });
  assert.equal(s.activeTab().kind, 'git-history');
  assert.equal(s.activePanel(), 'tabs');
  assert.equal(s.drawerOpen(), false);
  assert.equal(w.document.querySelector('.drawer'), null);
  assert.ok(w.document.querySelector('.history-view'));
  const length = w.history.length;
  w.document.querySelector('.toolbar button').click();
  assert.ok(w.document.querySelector('.drawer'));
  assert.equal(s.activePanel(), 'tabs');
  w.document.querySelector('.drawer-backdrop').click();
  assert.equal(w.document.querySelector('.drawer'), null);
  assert.equal(w.history.length, length);
  assert.equal(w.location.pathname + w.location.search, '/-/git/history?panel=tabs');
  s.openGitCommit('abc1234');
  await history('back');
  assert.equal(s.activeTab().kind, 'git-history');
  assert.equal(s.activePanel(), 'tabs');
  assert.equal(s.drawerOpen(), false);
  assert.equal(w.document.querySelector('.drawer'), null);
});

test('移动端搜索深链恢复选中项与过滤条件但不展开；输入替换当前历史，后退重新执行搜索', async (t) => {
  const { w, s, calls, history } = await setup(t, '/a.txt?panel=search&q=TODO&case=1&exclude=&lang=zh', { narrow: true });
  assert.equal(s.activePanel(), 'search');
  assert.equal(w.document.querySelector('.drawer'), null);
  w.document.querySelector('button[title="菜单"]').click();
  assert.ok(w.document.querySelector('.drawer'));
  assert.equal(w.document.querySelector('.search-query').value, 'TODO');
  assert.equal(w.document.querySelector('.search-exclude').value, '');
  assert.equal(w.document.querySelector('.search-toggle input').checked, true);
  await until(() => calls.some((c) => c.url.pathname === '/api/search'));
  const initialLength = w.history.length;
  const input = w.document.querySelector('.search-query');
  input.value = 'Hello & 中文';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(new URL(w.location.href).searchParams.get('q'), 'Hello & 中文');
  assert.equal(w.history.length, initialLength);
  s.selectPanel('tabs');
  assert.equal(w.document.querySelector('.search-query'), null);
  assert.equal(new URL(w.location.href).searchParams.get('panel'), 'tabs');
  await history('back');
  assert.equal(w.document.querySelector('.search-query').value, 'Hello & 中文');
  await until(() => calls.some((c) => c.url.pathname === '/api/search' && c.url.searchParams.get('q') === 'Hello & 中文'));
});

test('下载先保存编辑器的最新修改，再使用原文件的下载地址', async (t) => {
  const { w, s, docs, editor } = await setup(t, '/README.md?ro=0&lang=zh');
  await until(() => s.docLoadedPath() === 'README.md');
  const downloads: string[] = [];
  w.HTMLAnchorElement.prototype.click = function () { downloads.push(this.href); };
  editor().dispatch({ changes: { from: 0, to: editor().state.doc.length, insert: '# 最新修改' }, userEvent: 'input' });
  const button = w.document.querySelector('.file-download');
  assert.equal(button.nextElementSibling.textContent.trim(), '✎');
  button.click();
  await until(() => downloads.length === 1);
  assert.equal(docs.get('README.md'), '# 最新修改');
  const url = new URL(downloads[0]);
  assert.equal(url.pathname, '/api/download');
  assert.equal(url.searchParams.get('path'), 'README.md');
  assert.equal(w.location.pathname, '/README.md');
});

test('图片深链直接预览并可下载，不解码为文本；加载失败有提示，切换图片重置状态', async (t) => {
  const name = '图片 #%.PNG';
  const { w, s, calls } = await setup(t, `/${encodeURIComponent(name)}?ro=0&lang=zh`);
  await until(() => !!w.document.querySelector('.image-preview img'));
  const img = w.document.querySelector('.image-preview img');
  assert.equal(new URL(img.src).searchParams.get('path'), name);
  assert.equal(img.alt, name);
  assert.equal(s.docLoadedPath(), null);
  assert.equal(s.editorHandle(), null);
  assert.equal(w.document.querySelector('.cm-editor'), null);
  assert.equal(w.document.querySelector('.complete-btn'), null);
  assert.equal(w.document.querySelector('button[title="查找"]').disabled, true);
  const download = w.document.querySelector('.file-download');
  assert.equal(download.nextElementSibling.disabled, true);
  assert.equal(download.disabled, false);
  assert.equal(calls.some((call) => call.url.pathname === '/api/file'), false);
  const downloads: string[] = [];
  w.HTMLAnchorElement.prototype.click = function () { downloads.push(this.href); };
  download.click();
  await until(() => downloads.length === 1);
  assert.equal(new URL(downloads[0]).searchParams.get('path'), name);
  img.dispatchEvent(new w.Event('error'));
  assert.ok(w.document.querySelector('.image-preview [role="alert"]'));
  await s.openTab('next.gif');
  await until(() => w.document.querySelector('.image-preview img')?.alt === 'next.gif');
  assert.equal(w.document.querySelector('.image-preview [role="alert"]'), null);
  assert.ok(w.document.querySelector('.image-preview [role="status"]'));
  w.document.querySelector('.image-preview img').dispatchEvent(new w.Event('load'));
  assert.equal(w.document.querySelector('.image-preview [role="status"]'), null);
});

test('文本切到图片前保存修改，返回可继续编辑；SVG 切换源码和预览时先保存', async (t) => {
  const { w, s, docs, editor, history } = await setup(t, '/a.txt?ro=0&lang=zh');
  await until(() => s.docLoadedPath() === 'a.txt');
  editor().dispatch({ changes: { from: 0, to: editor().state.doc.length, insert: 'saved before image' }, userEvent: 'input' });
  await s.openTab('photo.webp');
  await until(() => !!w.document.querySelector('.image-preview img'));
  assert.equal(docs.get('a.txt'), 'saved before image');
  assert.equal(s.editorHandle(), null);
  await history('back');
  await until(() => s.docLoadedPath() === 'a.txt');
  assert.equal(editor().state.doc.toString(), 'saved before image');
  assert.equal(w.document.querySelector('.image-preview'), null);
  docs.set('icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  s.setRoMode(true);
  await s.openTab('icon.svg');
  await until(() => !!w.document.querySelector('.image-preview img'));
  const originalImageUrl = w.document.querySelector('.image-preview img').src;
  w.document.querySelector('button[title="切换为编辑模式"]').click();
  await until(() => s.docLoadedPath() === 'icon.svg');
  const modified = '<svg xmlns="http://www.w3.org/2000/svg" width="200"/>';
  editor().dispatch({ changes: { from: 0, to: editor().state.doc.length, insert: modified }, userEvent: 'input' });
  w.document.querySelector('button[title="切换为只读模式"]').click();
  await until(() => !!w.document.querySelector('.image-preview img'));
  assert.equal(docs.get('icon.svg'), modified);
  assert.notEqual(w.document.querySelector('.image-preview img').src, originalImageUrl);
  assert.equal(s.docLoadedPath(), null);
});

test('图片支持按钮、键盘、滚轮缩放和拖动，双指缩放后切换图片恢复适应窗口', async (t) => {
  const { w, s } = await setup(t, '/photo.png?lang=zh');
  await until(() => !!w.document.querySelector('.image-preview img'));
  const prepareImage = () => {
    const img = w.document.querySelector('.image-preview img');
    const viewport = w.document.querySelector('.image-preview-viewport');
    Object.defineProperties(img, { naturalWidth: { value: 1600 }, naturalHeight: { value: 1200 } });
    Object.defineProperties(viewport, { clientWidth: { value: 400 }, clientHeight: { value: 300 } });
    img.dispatchEvent(new w.Event('load'));
    return viewport;
  };
  const viewport = prepareImage();
  const level = () => w.document.querySelector('.image-preview-scale').textContent;
  const button = (name: string) => w.document.querySelector(`.image-preview button[title="${name}"]`);
  assert.equal(level(), '25%');
  button('放大').click();
  assert.equal(level(), '31.3%');
  button('缩小').click();
  assert.equal(level(), '25%');
  button('原始尺寸').click();
  assert.equal(level(), '100%');
  assert.equal(viewport.scrollLeft, 600);
  const pointer = (type: string, id: number, x: number, y: number) => {
    const event = new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: id });
    viewport.dispatchEvent(event);
  };
  pointer('pointerdown', 1, 100, 100);
  pointer('pointermove', 1, 70, 80);
  pointer('pointerup', 1, 70, 80);
  assert.equal(viewport.scrollLeft, 630);
  assert.equal(viewport.scrollTop, 470);
  viewport.dispatchEvent(new w.KeyboardEvent('keydown', { key: '0', bubbles: true }));
  assert.equal(level(), '25%');
  pointer('pointerdown', 1, 100, 150);
  pointer('pointerdown', 2, 300, 150);
  pointer('pointermove', 1, 50, 150);
  pointer('pointermove', 2, 350, 150);
  assert.equal(level(), '37.5%');
  pointer('pointercancel', 1, 50, 150);
  pointer('pointercancel', 2, 350, 150);
  assert.equal(viewport.classList.contains('image-preview-dragging'), false);
  viewport.dispatchEvent(new w.WheelEvent('wheel', { deltaY: -200, clientX: 200, clientY: 150, cancelable: true }));
  assert.ok(parseFloat(level()) > 37.5);
  for (let i = 0; i < 30; i++) button('放大').click();
  assert.equal(level(), '800%');
  assert.equal(button('放大').disabled, true);
  for (let i = 0; i < 30; i++) button('缩小').click();
  assert.equal(level(), '5%');
  assert.equal(button('缩小').disabled, true);
  await s.openTab('other.webp');
  await until(() => w.document.querySelector('.image-preview img')?.alt === 'other.webp');
  prepareImage();
  assert.equal(level(), '25%');
  assert.equal(button('适应窗口').getAttribute('aria-pressed'), 'true');
});

test('切换到图片后到达的旧文本响应不会重建编辑器', async (t) => {
  let release!: () => void;
  let started = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { w, s } = await setup(t, '/a.txt', { hook: async (url, init) => {
    if (url.pathname === '/api/file' && url.searchParams.get('path') === 'slow.txt' && init.method === 'GET') {
      started = true;
      await gate;
      return json({ content: 'late text', utf8: true });
    }
  } });
  await until(() => s.docLoadedPath() === 'a.txt');
  await s.openTab('slow.txt');
  await until(() => started);
  await s.openTab('photo.png');
  await until(() => !!w.document.querySelector('.image-preview img'));
  release();
  await tick();
  assert.equal(w.document.querySelector('.cm-editor'), null);
  assert.equal(s.currentFile(), 'photo.png');
  assert.equal(s.editorHandle(), null);
});

test('保存失败时不下载旧版本文件', async (t) => {
  const { w, s, editor } = await setup(t, '/a.txt?ro=0&lang=zh', { hook: (u, init) => {
    if (u.pathname === '/api/file' && init.method === 'PUT') return json({ error: 'cannot save' }, 500);
  } });
  await until(() => s.docLoadedPath() === 'a.txt');
  let downloads = 0;
  w.HTMLAnchorElement.prototype.click = () => { downloads++; };
  editor().dispatch({ changes: { from: 0, insert: 'modified' }, userEvent: 'input' });
  w.document.querySelector('.file-download').click();
  await tick(2200); // 保存链有两次各 1 秒的重试间隔。
  await until(() => !!w.document.querySelector('.toast')?.textContent.includes('下载失败'));
  assert.equal(downloads, 0);
});

test('语言在历史恢复时重新应用，Markdown 源码/预览切换不写入 URL', async (t) => {
  const { w, s, history } = await setup(t, '/README.md?lang=zh');
  await until(() => s.docLoadedPath() === 'README.md');
  const url = w.location.href;
  w.document.querySelector('.markdown-toggle').click();
  assert.equal(w.location.href, url);
  assert.equal(w.document.querySelector('.markdown-preview'), null);
  w.history.pushState(null, '', '/README.md?lang=en');
  w.dispatchEvent(new w.PopStateEvent('popstate'));
  assert.equal(w.document.documentElement.lang, 'en');
  await history('back');
  assert.equal(w.document.documentElement.lang, 'zh-CN');
});

test('慢文件响应不会覆盖后来选择的文件；切换前保存并在后退时读到最新内容', async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let slowStarted = false;
  const { w, s, docs, editor, history } = await setup(t, '/a.txt?ro=0', { hook: async (u, init) => {
    if (u.pathname === '/api/file' && u.searchParams.get('path') === 'slow.txt' && init.method === 'GET') {
      slowStarted = true;
      await gate;
      return json({ content: 'slow response', utf8: true });
    }
  } });
  await until(() => s.docLoadedPath() === 'a.txt');
  editor().dispatch({ changes: { from: 0, to: editor().state.doc.length, insert: 'saved before navigation' }, userEvent: 'input' });
  await s.openTab('b.txt');
  await until(() => s.docLoadedPath() === 'b.txt');
  assert.equal(docs.get('a.txt'), 'saved before navigation');
  await history('back');
  await until(() => s.docLoadedPath() === 'a.txt');
  assert.equal(editor().state.doc.toString(), 'saved before navigation');
  await s.openTab('slow.txt');
  await until(() => slowStarted);
  await s.openTab('b.txt');
  await until(() => s.docLoadedPath() === 'b.txt');
  release();
  await tick();
  assert.equal(s.currentFile(), 'b.txt');
  assert.equal(editor().state.doc.toString(), 'B\nsecond');
  assert.equal(w.location.pathname, '/b.txt');
});

test('终端 URL 只恢复当前用户存在的终端；失效终端降级为空态', async (t) => {
  const { s } = await setup(t, '/?term=t_valid&lang=en', { mount: false, hook: (u) => {
    if (u.pathname === '/api/terminals') return json({ terminals: [{ id: 't_valid', name: 'T' }] });
  } });
  assert.equal(s.activeTab().kind, 'terminal');
  const other = await setup(t, '/?term=t_missing', { mount: false });
  assert.equal(other.s.activeTab(), null);
});

test('不存在的文件深链降级并替换当前记录，不丢失语言和侧栏', async (t) => {
  const { w, s } = await setup(t, '/missing.txt?lang=zh&panel=tabs');
  await until(() => s.currentFile() === null);
  assert.equal(w.location.pathname, '/');
  assert.equal(w.location.search, '?lang=zh&panel=tabs');
  assert.equal(w.history.length, 1);
});

test('启动时迟到的标签列表不能覆盖用户的新导航', async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const { w, s } = await setup(t, '/a.txt?lang=en', {
    hook: async (u) => {
      if (u.pathname === '/api/tabs') { await gate; return json({ tabs: ['a.txt'] }); }
    },
    duringStart: async (stores) => {
      await stores.openTab('b.txt');
      release();
    },
  });
  await until(() => s.docLoadedPath() === 'b.txt');
  assert.equal(w.location.pathname, '/b.txt');
  assert.equal(s.currentFile(), 'b.txt');
  assert.ok(s.tabs().some((tab) => tab.path === 'a.txt'));
  assert.ok(s.tabs().some((tab) => tab.path === 'b.txt'));
});

test('终端列表尚未返回时发生历史导航，列表到达后恢复当前 URL 的终端', async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const { s } = await setup(t, '/a.txt', {
    mount: false,
    hook: async (u) => {
      if (u.pathname === '/api/terminals') {
        await gate;
        return json({ terminals: [{ id: 't_valid', name: 'T' }] });
      }
    },
    duringStart: async (_stores, w) => {
      w.history.pushState(null, '', '/?term=t_valid');
      w.dispatchEvent(new w.PopStateEvent('popstate'));
      release();
    },
  });
  assert.equal(s.activeTab().id, 't_valid');
});

test('终端加载期间更改搜索条件仍保留 URL 中的终端目标', async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const { w, s } = await setup(t, '/?term=t_valid', {
    mount: false,
    hook: async (u) => {
      if (u.pathname === '/api/terminals') {
        await gate;
        return json({ terminals: [{ id: 't_valid', name: 'T' }] });
      }
    },
    duringStart: async (stores) => {
      stores.selectPanel('search');
      stores.updateSearch({ query: 'TODO' });
      release();
    },
  });
  assert.equal(s.activeTab().id, 't_valid');
  assert.equal(new URL(w.location.href).searchParams.get('term'), 't_valid');
  assert.equal(new URL(w.location.href).searchParams.get('q'), 'TODO');
});
