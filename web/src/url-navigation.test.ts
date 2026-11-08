import { parseFragment } from './url-fragment.ts';
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
    // PDF rendering and workers require a real browser; this suite checks App routing only.
    plugins: [{ name: 'pdf-test-stub', enforce: 'pre',
      load: (id) => {
        if (id.endsWith('/database/file-source.ts')) return `export function createDatabaseSource(target) {
          const pending = new Set();
          async function request(body, signal) {
            const controller = new AbortController(); pending.add(controller);
            const cancel = () => controller.abort();
            signal?.addEventListener('abort', cancel, { once: true });
            try { return await window.queryTestDatabase(target, body, controller.signal); }
            finally { pending.delete(controller); signal?.removeEventListener('abort', cancel); }
          }
          return { listObjects: (signal) => request({action:'objects'}, signal),
            describe: (object, signal) => request({action:'describe',object}, signal),
            readRows: (input, signal) => request({action:'rows',request:input}, signal),
            dispose() { for (const c of pending) c.abort(); } };
        }`;
        if (id.endsWith('/readers/pdf-source.ts')) return `export function acquirePdfSource(url) {
          window.outlineLoads = (window.outlineLoads || 0) + 1;
          let active = true;
          return { subscribe(listener) {
            listener({ outline: [], outlineStatus: 'loading', password: null });
            queueMicrotask(() => { if (active) listener({ outlineStatus: 'ready', password: null, outline: [
              { id: '0', title: 'Chapter <one>', navigable: false, children: [
                { id: '0.0', title: 'Section two', navigable: true, children: [] }
              ] }
            ] }); });
            return () => { active = false; };
          }, release() { window.outlineReleases = (window.outlineReleases || 0) + 1; } };
        }`;
        if (id.endsWith('/archive-client.ts')) return `export class ArchiveClient {
          async request(request) {
            const files = { 'docs/a.txt': 'archive A', 'docs/b.txt': 'archive B', 'deep.txt': 'nested text',
              'README.md': '# Inside\\n\\n**Archive**', 'data.csv': 'name,value\\na,1', 'code.ts': 'const value: number = 1;',
              'image.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>', 'manual.pdf': '%PDF-', 'song.mp3': 'audio', 'binary.bin': '\\0', 'app.db': 'SQLite format 3\\0binary', 'inner.zip': 'nested-archive' };
            const entries = Object.keys(files).map((path, id) => ({ id, path, size: files[path].length, directory: false, encrypted: false, link: false }));
            return request.action === 'open' ? { entries } : { blob: new Blob([Object.values(files)[request.entry]]) };
          }
          close() {}
        }`;
        return /\/pdf-preview\.tsx$/.test(id) ? `export default function PreviewStub(props) { const el = document.createElement('div'); el.className = '${id.endsWith('/pdf-preview.tsx') ? 'pdf-preview' : 'archive-tree'}'; el.dataset.url = props.url; return el; }` : null;
      },
    }, { name: 'url-test-entry', resolveId: (id) => id === entry ? entry : null,
      load: (id) => id === entry ? `
        import { render } from 'solid-js/web';
        import { App } from '${path.join(import.meta.dirname, 'App.tsx')}';
        import * as stores from '${path.join(import.meta.dirname, 'stores.ts')}';
        import { EditorView } from '@codemirror/view';
        import { createSignal, Show } from 'solid-js';
        import { fileTargetKey } from '${path.join(import.meta.dirname, 'file-target.ts')}';
        import * as downloads from '${path.join(import.meta.dirname, 'download.ts')}';
        import { registerReaderNavigation, cancelReaderNavigation } from '${path.join(import.meta.dirname, 'readers/navigation.ts')}';
        import { InstancesPage } from '${path.join(import.meta.dirname, 'views/instances.tsx')}';
        import { DocumentReader } from '${path.join(import.meta.dirname, 'components/document-reader.tsx')}';
        import { ArchiveFeedback } from '${path.join(import.meta.dirname, 'components/archive-feedback.tsx')}';
        import { setArchiveSession } from '${path.join(import.meta.dirname, 'archive-sessions.ts')}';
        import { archiveKey } from '${path.join(import.meta.dirname, 'archive.ts')}';
        window.harness = { setArchiveSession: (key, ...args) => args.length === 1 ? setArchiveSession(key, { ...args[0] }) : setArchiveSession(key, ...args), archiveKey,
          mountArchiveFeedback: (retry) => {
            const [reader, setReader] = createSignal(true);
            const dispose = render(() => <>
              <ArchiveFeedback path="bundle.zip"/>
              <ArchiveFeedback path="bundle.zip" entry="a.db" priority={20} retry={() => retry('a')}/>
              <ArchiveFeedback path="bundle.zip" entry="b.db" priority={20} retry={() => retry('b')}/>
              <ArchiveFeedback path="bundle.zip" chain={['inner.zip']}/>
              <Show when={reader()}><div class="reader-feedback"><ArchiveFeedback path="bundle.zip" entry="a.db" priority={30} retry={() => retry('reader')}/></div></Show>
            </>, document.getElementById('root'));
            return { dispose, setReader };
          }, stores, EditorView, downloads, fileTargetKey, registerReaderNavigation, cancelReaderNavigation, mount: () => render(() => <App />, document.getElementById('root')),
          mountReader: (factory, host = document.getElementById('root')) => {
            const [url, setUrl] = createSignal('first-document');
            const dispose = render(() => <DocumentReader url={url()} path="document" createReader={factory}/>, host);
            return { setUrl, dispose };
          },
          mountInstances: () => render(() => <InstancesPage />, document.getElementById('root')),
        };
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

async function setup(t: TestContext, url: string, opts: { hook?: Hook; mount?: boolean; narrow?: boolean; start?: boolean; duringStart?: (stores: any, window: any) => Promise<void> } = {}) {
  const dom = new JSDOM('<div id="root"></div>', {
    url: `http://localhost${url}`, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window;
  w.matchMedia = (q: string) => ({ matches: !!opts.narrow && q.includes('599px'), addEventListener() {}, removeEventListener() {} });
  w.Blob = Blob;
  w.TextDecoder = TextDecoder;
  w.URL.createObjectURL = () => 'blob:http://localhost/test';
  w.URL.revokeObjectURL = () => {};
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.HTMLMediaElement.prototype.pause = () => {};
  w.HTMLMediaElement.prototype.load = () => {};
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
    if (u.pathname === '/api/file-info') return json({ kind: 'text', size: docs.get(file)?.length ?? 0, modified: '2026-10-01T00:00:00Z', mime: 'text/plain' });
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
  (w as any).queryTestDatabase = async (target: any, request: unknown, signal: AbortSignal) => {
    const url = new URL('/__test/sqlite', w.location.origin);
    url.search = new URLSearchParams({ path: target.path, entry: target.archive?.entry ?? '', inside: JSON.stringify(target.archive?.chain ?? []), request: JSON.stringify(request) }).toString();
    const response = await opts.hook?.(url, { signal });
    return response ? response.json() : { objects: [], truncated: false };
  };
  w.eval(code);
  const s = w.harness.stores;
  const started = opts.start === false ? Promise.resolve() : s.startSync();
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
  const { w, s, editor, history } = await setup(t, '/a.txt?theme=dark&fs=110&lang=zh#line:2-3');
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
  assert.equal(w.location.hash, '#line:2-3');
  editor().dispatch({ selection: { anchor: 0 }, userEvent: 'select' });
  assert.equal(w.location.hash, '#line:1');
  assert.equal(w.history.length, length);
  s.gotoLine0('a.txt', 2);
  assert.equal(w.location.hash, '#line:3');
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
    ['/_/git', 'git'], ['/_/git/diff/a.txt', 'git-diff'],
    ['/_/git/history?branch=feature%2Ftest', 'git-history'],
    ['/_/git/branches', 'git-branch'], ['/_/git/commit/abc1234', 'git-commit'],
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
    ['/_/file/-/git/history', '-/git/history'],
    ['/_/file/-/file/a.txt', '-/file/a.txt'],
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
    assert.equal(w.location.pathname, '/_/git');
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
  const { w, s, history } = await setup(t, '/_/git/history?branch=feature%2Ftest&lang=en');
  s.selectHistoryBranch('main');
  assert.match(w.location.search, /branch=main/);
  await history('back');
  assert.equal(s.historyBranch(), 'feature/test');
  assert.equal(w.document.querySelector('.history-select').value, 'feature/test');
  s.openGitCommit('abc1234');
  assert.equal(w.location.pathname, '/_/git/commit/abc1234');
  await history('back');
  assert.equal(s.activeTab().kind, 'git-history');
  s.openGitDiff('a.txt');
  assert.equal(w.location.pathname, '/_/git/diff/a.txt');
  s.openGitBranch();
  assert.equal(w.location.pathname, '/_/git/branches');
});

test('Git URL 恢复时清理无关路径和参数；不新增历史且保留分支与侧栏状态', async (t) => {
  const { w, s, history } = await setup(t,
    '/_/git/history/?view=diff&branch=feature%2Ftest&commit=abc1234&panel=tabs#line:3', { narrow: true });
  assert.equal(w.location.pathname + w.location.search, '/_/git/history?branch=feature%2Ftest&panel=tabs');
  assert.equal(w.history.length, 1);
  assert.equal(s.activeTab().kind, 'git-history');
  assert.equal(s.historyBranch(), 'feature/test');
  s.openGitCommit('abc1234');
  assert.equal(w.location.pathname + w.location.search, '/_/git/commit/abc1234?panel=tabs');
  s.openGitDiff('目录/a #?%.ts');
  assert.equal(decodeURIComponent(w.location.pathname), '/_/git/diff/目录/a #?%.ts');
  assert.equal(w.location.search, '?panel=tabs');
  await history('back');
  assert.equal(s.activeTab().commit, 'abc1234');
  await history('back');
  assert.equal(s.historyBranch(), 'feature/test');
  assert.equal(w.location.pathname, '/_/git/history');
  w.history.pushState(null, '', '/_/git/commit/invalid?branch=main#line:2');
  s.openGitBranch();
  const length = w.history.length;
  await history('back');
  assert.equal(s.activeTab().kind, 'git');
  assert.equal(w.location.pathname + w.location.search, '/_/git');
  assert.equal(w.history.length, length);
  await history('forward');
  assert.equal(s.activeTab().kind, 'git-branch');
});

test('刷新 history + panel=tabs 不弹出抽屉，手动展开仍选中 Tabs，后退也不弹出', async (t) => {
  const { w, s, history } = await setup(t, '/_/git/history?panel=tabs', { narrow: true });
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
  assert.equal(w.location.pathname + w.location.search, '/_/git/history?panel=tabs');
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
  assert.ok(button.nextElementSibling.querySelector('svg'));
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
  assert.equal(w.document.querySelector('button[title="查找"]'), null);
  assert.equal(w.document.querySelector('button[title="切换为编辑模式"]'), null);
  const download = w.document.querySelector('.file-download');
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

test('音视频与不支持的二进制不进入编辑器；媒体退出后停止播放，PDF 进入专用预览', async (t) => {
  const { w, s, calls } = await setup(t, '/manual.pdf?ro=0&lang=zh', { hook: (url) => {
    if (url.pathname !== '/api/file-info') return;
    const path = url.searchParams.get('path')!;
    const kind = path.endsWith('.mp3') ? 'audio' : path.endsWith('.mp4') ? 'video' : path.endsWith('.pdf') ? 'pdf' : 'binary';
    return json({ kind, size: 2 * 1024 * 1024, modified: '2026-10-01T00:00:00Z', mime: 'application/octet-stream' });
  } });
  await until(() => !!w.document.querySelector('.pdf-preview'));
  assert.equal(w.document.querySelector('iframe'), null);
  assert.equal(w.document.querySelector('button[title="切换为编辑模式"]'), null);
  await s.openTab('song.mp3');
  await until(() => !!w.document.querySelector('audio'));
  const audio = w.document.querySelector('audio');
  assert.equal(audio.controls, true);
  assert.equal(audio.autoplay, false);
  assert.equal(audio.preload, 'metadata');
  let paused = false;
  audio.pause = () => { paused = true; };
  await s.openTab('movie.mp4');
  await until(() => !!w.document.querySelector('video'));
  assert.equal(paused, true);
  assert.equal(audio.getAttribute('src'), null);
  const video = w.document.querySelector('video');
  assert.equal(video.controls, true);
  assert.equal(video.hasAttribute('playsinline'), true);
  video.dispatchEvent(new w.Event('error'));
  assert.match(w.document.querySelector('.file-preview [role="alert"]').textContent, /无法播放/);
  await s.openTab('binary.bin');
  await until(() => !!w.document.querySelector('.binary-preview'));
  assert.equal(w.document.querySelector('.file-preview-bar'), null);
  assert.match(w.document.querySelector('.toolbar-path').textContent, /binary.bin/);
  assert.equal(w.document.querySelector('.cm-editor'), null);
  assert.equal(w.document.querySelector('.complete-btn'), null);
  assert.equal(calls.some((call) => call.url.pathname === '/api/file'), false);
  const downloads: string[] = [];
  w.HTMLAnchorElement.prototype.click = function () { downloads.push(this.href); };
  w.document.querySelector('.file-download').click();
  await until(() => downloads.length === 1);
  assert.equal(new URL(downloads[0]).searchParams.get('path'), 'binary.bin');
});

test('CSV / TSV 表格显示引号字段并转义 HTML，可切源码和编辑；预览裁剪不改原文', async (t) => {
  let content = 'name,note\r\n"张,三","<script>alert(1)</script>"\r\n';
  const { w, s, editor } = await setup(t, '/report.csv?lang=zh', { hook: (url, init) => {
    if (url.pathname === '/api/file' && url.searchParams.get('path') === 'report.csv') {
      if (init.method === 'PUT') { content = JSON.parse(String(init.body)).content; return json({ ok: true }); }
      return json({ content, utf8: true });
    }
  } });
  await until(() => s.docLoadedPath() === 'report.csv');
  assert.deepEqual([...w.document.querySelectorAll('.table-preview tbody td')].map((td: any) => td.textContent), ['name', 'note', '张,三', '<script>alert(1)</script>']);
  assert.equal(w.document.querySelector('.table-preview script'), null);
  const url = w.location.href;
  w.document.querySelector('.markdown-toggle').click();
  assert.equal(w.document.querySelector('.table-preview'), null);
  assert.equal(w.location.href, url);
  assert.equal(editor().state.doc.toString(), content.replace(/\r\n/g, '\n'));
  w.document.querySelector('button[title="切换为编辑模式"]').click();
  const large = Array.from({ length: 1001 }, (_, i) => `row${i},value`).join('\n');
  editor().dispatch({ changes: { from: 0, to: editor().state.doc.length, insert: large }, userEvent: 'input' });
  w.document.querySelector('button[title="切换为只读模式"]').click();
  await until(() => content === large);
  assert.equal(w.document.querySelectorAll('.table-preview tbody tr').length, 1000);
  assert.ok(w.document.querySelector('.table-preview [role="status"]'));
  assert.equal(editor().state.doc.toString(), large);
});

test('迟到的文件信息不会覆盖新文档；后段二进制内容同样禁止文本编辑', async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let started = false;
  const { w, s } = await setup(t, '/a.txt?ro=0', { hook: async (url) => {
    if (url.pathname === '/api/file-info' && url.searchParams.get('path') === 'slow.bin') {
      started = true;
      await gate;
      return json({ kind: 'binary', size: 1, mime: 'application/octet-stream', modified: '' });
    }
    if (url.pathname === '/api/file' && url.searchParams.get('path') === 'bad.md') return json({ content: 'a'.repeat(9000) + '\0', utf8: true });
  } });
  await until(() => s.docLoadedPath() === 'a.txt');
  await s.openTab('slow.bin');
  await until(() => started);
  await s.openTab('b.txt');
  await until(() => s.docLoadedPath() === 'b.txt');
  release();
  await tick();
  assert.equal(w.document.querySelector('.file-preview'), null);
  assert.equal(s.docLoadedPath(), 'b.txt');
  s.setRoMode(true);
  await s.openTab('bad.md');
  await until(() => !!w.document.querySelector('.binary-preview'));
  assert.equal(w.document.querySelector('.markdown-preview'), null);
  assert.equal(w.document.querySelector('.cm-editor'), null);
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


test('压缩包内部文件复用真实文件标签，一次导航写入一次历史且后退恢复 entry', async (t) => {
  const { w, s, calls, history } = await setup(t, '/bundle.zip?entry=docs%2Fa.txt&lang=zh', { hook: (url) => {
    if (url.pathname === '/api/file-info') return json({ kind: 'binary', size: 1024, modified: '', mime: 'application/octet-stream' });
  } });
  await until(() => s.docLoadedPath() === 'bundle.zip');
  assert.equal(s.archiveEntry(), 'docs/a.txt');
  const length = w.history.length;
  await s.openArchiveEntry('bundle.zip', 'docs/b.txt');
  assert.equal(w.history.length, length + 1);
  assert.equal(new URL(w.location.href).searchParams.get('entry'), 'docs/b.txt');
  assert.equal(s.tabs().filter((tab: any) => tab.kind === 'file').length, 1);
  await history('back');
  assert.equal(s.archiveEntry(), 'docs/a.txt');
  await s.openArchiveEntry('bundle.zip', 'deep.txt', ['inner.zip', 'nested.7z']);
  assert.deepEqual(new URL(w.location.href).searchParams.getAll('inside'), ['inner.zip', 'nested.7z']);
  assert.deepEqual(Array.from(s.archiveChain()), ['inner.zip', 'nested.7z']);
  await history('back');
  assert.equal(s.archiveEntry(), 'docs/a.txt');
  assert.deepEqual(Array.from(s.archiveChain()), []);
  await history('forward');
  assert.equal(s.archiveEntry(), 'deep.txt');
  assert.deepEqual(Array.from(s.archiveChain()), ['inner.zip', 'nested.7z']);
  await s.openTab('bundle.zip');
  assert.equal(s.archiveEntry(), null);
  assert.deepEqual(Array.from(s.archiveChain()), []);
  assert.equal(calls.some((call) => call.url.pathname === '/api/file'), false);
});

test('压缩包内部文件复用主工具栏和查看组件，源码只读且不写入工作区', async (t) => {
  const { w, s, calls, editor } = await setup(t, '/bundle.zip?entry=README.md&ro=0&lang=zh');
  await until(() => !!w.document.querySelector('.markdown-preview h1'));
  assert.equal(w.document.querySelector('.markdown-preview h1').textContent, 'Inside');
  assert.equal(w.document.querySelectorAll('.toolbar').length, 1);
  assert.equal(w.document.querySelectorAll('.file-download').length, 1);
  assert.equal(w.document.querySelector('.archive-toolbar, .file-preview-bar, .archive-text, .archive-preview'), null);
  assert.match(w.document.querySelector('.toolbar-path').textContent, /bundle.zip.*README.md/);
  w.document.querySelector('.markdown-toggle').click();
  assert.equal(editor().state.doc.toString(), '# Inside\n\n**Archive**');
  assert.equal(editor().state.readOnly, true);
  assert.equal(w.document.querySelector('button[title="切换为编辑模式"]'), null);
  assert.equal(w.document.querySelector('.complete-btn'), null);
  const url = w.location.href;
  editor().dispatch({ selection: { anchor: 2 }, userEvent: 'select' });
  assert.equal(parseFragment(w.location.hash).get('line'), '1');
  assert.equal(new URL(w.location.href).searchParams.get('entry'), new URL(url).searchParams.get('entry'));
  const downloads: string[] = [];
  w.HTMLAnchorElement.prototype.click = function () { downloads.push(this.href); };
  w.document.querySelector('.file-download').click();
  await until(() => downloads.length === 1);
  assert.match(downloads[0], /^blob:/);

  await s.openArchiveEntry('bundle.zip', 'data.csv');
  await until(() => !!w.document.querySelector('.table-preview'));
  assert.deepEqual([...w.document.querySelectorAll('.table-preview td')].map((cell: any) => cell.textContent), ['name', 'value', 'a', '1']);
  w.document.querySelector('.markdown-toggle').click();
  assert.equal(editor().state.doc.toString(), 'name,value\na,1');
  await s.openArchiveEntry('bundle.zip', 'image.svg');
  await until(() => !!w.document.querySelector('.image-preview img'));
  assert.match(w.document.querySelector('.image-preview img').src, /^blob:/);
  await s.openArchiveEntry('bundle.zip', 'manual.pdf');
  await until(() => !!w.document.querySelector('.pdf-preview'));
  assert.match(w.document.querySelector('.pdf-preview').dataset.url, /^blob:/);
  await s.openArchiveEntry('bundle.zip', 'song.mp3');
  await until(() => !!w.document.querySelector('audio'));
  await s.openArchiveEntry('bundle.zip', 'binary.bin');
  await until(() => !!w.document.querySelector('.file-preview-binary'));
  assert.equal(w.document.querySelector('.preview-download'), null);
  assert.equal(calls.some((call) => ['/api/file', '/api/file-info', '/api/preview', '/api/image'].includes(call.url.pathname)), false);

  await s.openTab('a.txt');
  await until(() => s.docLoadedPath() === 'a.txt');
  assert.equal(editor().state.readOnly, false);
  assert.equal(w.document.querySelector('.toolbar-path').textContent, 'a.txt');
});

test('通用阅读界面只依赖适配器，切换数据源会清理并忽略旧状态', async (t) => {
  const { w } = await setup(t, '/?lang=zh', { mount: false });
  const hosts: any[] = [], actions: unknown[] = [];
  const reader = w.harness.mountReader((host: any) => {
    hosts.push(host);
    host.onState({ total: 8, position: 2, busy: false, canZoom: false, canFitWidth: false });
    return {
      goTo: (position: number) => actions.push(['goTo', position]),
      zoomTo: (scale: number) => actions.push(['zoomTo', scale]),
      fitWidth: () => actions.push(['fitWidth']),
      unlock: (password: string) => actions.push(['unlock', password]),
      destroy: () => actions.push(['destroy', host.url]),
    };
  });
  t.after(() => reader.dispose());
  assert.equal(w.document.querySelector('.reader-page-count').textContent, '/ 8');
  assert.equal(w.document.querySelector('.pdfViewer'), null);
  assert.equal(w.document.querySelector('[title="放大"]'), null);
  w.document.querySelector('[title="下一页"]').click();
  assert.deepEqual(actions, [['goTo', 3]]);
  hosts[0].onState({ position: 3, canZoom: true, canFitWidth: true, scale: 2 });
  assert.equal(w.document.querySelector('.reader-page-number').value, '3');
  w.document.querySelector('[title="放大"]').click();
  assert.deepEqual(actions.at(-1), ['zoomTo', 2.5]);
  hosts[0].onState({ password: 'required' });
  const input = w.document.querySelector('.reader-password input');
  input.value = 'secret'; input.dispatchEvent(new w.Event('input', { bubbles: true }));
  w.document.querySelector('.reader-password').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  assert.deepEqual(actions.at(-1), ['unlock', 'secret']);
  reader.setUrl('second-document');
  assert.deepEqual(actions.at(-1), ['destroy', 'first-document']);
  assert.equal(hosts.length, 2);
  hosts[0].onState({ position: 7, error: 'loadFailed' });
  assert.equal(w.document.querySelector('.reader-page-number').value, '2');
  assert.equal(w.document.querySelector('[role="alert"], .reader-password'), null);
  reader.dispose();
  assert.deepEqual(actions.at(-1), ['destroy', 'second-document']);
});

test('通用阅读器双指缩放只预览画面，松手后提交一次，并保留中心、平移和单指滚动', async (t) => {
  const { w } = await setup(t, '/?lang=zh', { mount: false });
  const zooms: { scale: number; options: any }[] = [];
  const reader = w.harness.mountReader((host: any) => {
    host.onState({ total: 10, busy: false, canZoom: true, scale: 1 });
    return { goTo() {}, fitWidth() {}, unlock() {}, destroy() {}, zoomTo(scale: number, options: any) {
      zooms.push({ scale, options }); host.onState({ scale });
    } };
  });
  t.after(() => reader.dispose());
  const viewport = w.document.querySelector('.reader-viewport');
  const content = w.document.querySelector('.reader-stage');
  const touch = (type: string, points: number[][]) => {
    const event = new w.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: points.map(([identifier, clientX, clientY]) => ({ identifier, clientX, clientY })) });
    viewport.dispatchEvent(event); return event.defaultPrevented;
  };
  assert.equal(touch('touchstart', [[1, 100, 200]]), false);
  assert.equal(touch('touchmove', [[1, 100, 150]]), false);
  assert.equal(touch('touchstart', [[1, 100, 200], [2, 300, 200]]), true);
  assert.equal(touch('touchmove', [[1, 80, 220], [2, 380, 220]]), true);
  await until(() => content.style.transform.includes('scale(1.5)'));
  assert.equal(zooms.length, 0, 'moving fingers must not trigger document layout');
  assert.equal(viewport.style.overflow, 'hidden');
  // Pausing with fingers down must not trigger expensive redraws either.
  await tick(180);
  assert.equal(zooms.length, 0);
  touch('touchend', [[1, 80, 220]]);
  assert.equal(zooms.length, 1);
  assert.equal(zooms[0].scale, 1.5);
  assert.equal(zooms[0].options.origin.x, 200);
  assert.equal(zooms[0].options.origin.y, 200);
  assert.equal(zooms[0].options.pan.x, 30);
  assert.equal(zooms[0].options.pan.y, 20);
  assert.equal(content.style.transform, '');
  assert.equal(content.style.willChange, '');
  assert.equal(viewport.style.overflow, '');
  assert.equal(touch('touchmove', [[1, 80, 180]]), false);
  touch('touchstart', [[1, 100, 200], [2, 300, 200]]);
  touch('touchmove', [[2, 250, 200], [1, 150, 200]]); // TouchList order must not matter.
  touch('touchend', []); // Flush the last movement even before the animation frame.
  assert.equal(zooms.at(-1)!.scale, 0.75);
  touch('touchstart', [[1, 100, 200], [2, 300, 200]]);
  touch('touchmove', [[1, 50, 200], [2, 350, 200]]);
  touch('touchcancel', []);
  await tick(30);
  assert.equal(zooms.length, 2);
  assert.equal(content.style.transform, '');
  assert.equal(content.style.transformOrigin, '');
  assert.equal(viewport.style.overflow, '');
  touch('touchstart', [[1, 100, 200], [2, 300, 200]]);
  touch('touchmove', [[1, 50, 200], [2, 350, 200]]);
  reader.setUrl('second-document');
  await tick(30);
  assert.equal(zooms.length, 2);
  assert.equal(content.style.willChange, '');
  reader.dispose();
  touch('touchstart', [[1, 100, 200], [2, 300, 200]]);
  touch('touchmove', [[1, 50, 200], [2, 350, 200]]);
  await tick(30);
  assert.equal(zooms.length, 2);
});

test('阅读工具栏独立弹出目录，跳转及关闭不改变侧栏和 URL', async (t) => {
  const { w, s } = await setup(t, '/?panel=tabs&lang=zh', { narrow: true });
  const initialUrl = w.location.href;
  const host = w.document.createElement('div'); w.document.body.appendChild(host);
  const sources: any[] = [], jumps: string[] = [];
  const reader = w.harness.mountReader((source: any) => {
    sources.push(source); source.onState({ total: 2, busy: false, outlineStatus: 'loading' });
    return { goTo() {}, zoomTo() {}, fitWidth() {}, unlock() {}, destroy() {},
      goToOutline: (id: string) => { jumps.push(id); },
    };
  }, host);
  t.after(() => reader.dispose());
  const toggle = w.document.querySelector('.reader-outline-toggle');
  assert.equal(w.document.querySelector('.reader-outline-popup'), null);
  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.ok(w.document.querySelector('.outline-view [role="status"]'));
  sources[0].onState({ outlineStatus: 'ready', outline: [{ id: 'section', title: '章节', navigable: false,
    children: [{ id: 'opaque-target', title: '<img src=x onerror=alert(1)>', navigable: true, children: [] }] }] });
  assert.equal(w.document.querySelectorAll('.outline-title').length, 1);
  w.document.querySelector('.outline-arrow[aria-expanded]').click();
  assert.equal(w.document.querySelectorAll('.outline-title').length, 2);
  assert.equal(w.document.querySelector('.outline-view img'), null);
  w.document.querySelectorAll('.outline-title')[1].click();
  await tick();
  assert.deepEqual(jumps, ['opaque-target']);
  assert.equal(w.document.querySelector('.reader-outline-popup'), null);
  assert.equal(s.drawerOpen(), false);
  assert.equal(s.activePanel(), 'tabs');
  assert.equal(w.location.href, initialUrl);
  toggle.click();
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(w.document.querySelector('.reader-outline-popup'), null);
  assert.equal(w.document.activeElement, toggle);
  toggle.click();
  w.document.body.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
  assert.equal(w.document.querySelector('.reader-outline-popup'), null);
  toggle.click();
  reader.setUrl('second-document');
  assert.equal(w.document.querySelector('.reader-outline-popup'), null);
  toggle.click();
  sources[0].onState({ outlineStatus: 'ready', outline: [{ id: 'stale', title: '旧目录', navigable: true, children: [] }] });
  assert.doesNotMatch(w.document.querySelector('.outline-view').textContent, /旧目录|章节/);
  sources[1].onState({ outlineStatus: 'ready', outline: [] });
  assert.match(w.document.querySelector('.outline-view').textContent, /没有内置目录/);
  sources[1].onState({ outlineStatus: 'error' });
  assert.ok(w.document.querySelector('.outline-view [role="alert"]'));
  reader.dispose();
  assert.equal(w.document.querySelector('.reader-outline-popup'), null);
  assert.equal(s.activePanel(), 'tabs');
  assert.equal(w.location.href, initialUrl);
});

test('数据库表、结构使用独立标签，切换后保留分页排序，URL 后退恢复对象', async (test) => {
  const { w, s, calls, history } = await setup(test, '/_/database/app.db?object=users&lang=zh', {
    hook(url) {
      if (url.pathname !== '/__test/sqlite') return;
      const request = JSON.parse(url.searchParams.get('request')!);
      if (request.action === 'objects') return json({ objects: [{ name: 'users', type: 'table' }, { name: 'orders', type: 'table' }], truncated: false });
      if (request.action === 'describe') return json({ object: request.object, columns: [{ name: 'id', type: 'INTEGER', nullable: false, primaryKey: 1, defaultValue: null, generated: false }], indexes: [], foreignKeys: [], sql: 'CREATE TABLE users(id INTEGER PRIMARY KEY)' });
      const input = request.request;
      return json({ columns: [{ key: 'id', label: 'id' }], rows: [[{ type: 'integer', value: String((input.offset ?? 0) + 1) }]], offset: input.offset ?? 0, hasMore: !input.offset, nextCursor: '1', limited: false });
    },
  });
  await until(() => !!w.document.querySelector('.database-data tbody tr'));
  const usersId = s.currentTabId();
  assert.equal(s.currentFile(), null);
  w.document.querySelector('[aria-label="下一页数据"]')!.click();
  await until(() => w.document.querySelector('.database-pagination span')?.textContent === '2–2');
  w.document.querySelector('.toolbar [aria-label="结构"]')!.click();
  await until(() => !!w.document.querySelector('.database-structure pre'));
  const structureId = s.currentTabId();
  assert.notEqual(structureId, usersId);
  assert.match(w.location.search, /mode=structure/);
  s.openDatabaseTab('app.db', { object: { name: 'orders', type: 'table' }, mode: 'data' });
  await until(() => !!w.document.querySelector('.database-data tbody tr'));
  assert.equal(s.tabs().filter((tab: any) => tab.kind === 'database').length, 3);
  await s.switchTab(usersId);
  await until(() => w.document.querySelector('.database-pagination span')?.textContent === '2–2');
  w.document.querySelector('.data-grid-sort')!.click();
  await until(() => w.document.querySelector('[aria-sort="ascending"]'));
  assert.match(w.location.search, /sort=id/);
  await s.switchTab(structureId);
  await until(() => !!w.document.querySelector('.database-structure pre'));
  await history('back');
  await until(() => !!w.document.querySelector('[aria-sort="ascending"]'));
  assert.equal(s.activeTab().object.name, 'users');
  assert.equal(calls.some((call) => call.url.pathname === '/api/file'), false);
  assert.equal(calls.some((call) => call.url.pathname === '/api/tabs/open'), false);
  assert.equal(JSON.parse(w.localStorage.getItem('anther:databaseTabs')!).length, 3);
  await s.closeAnyTab(usersId);
  assert.equal(JSON.parse(w.localStorage.getItem('anther:databaseTabs')!).length, 2);
});

test('数据库树区分表和视图，同库不同表可同时打开，下载复用已有文件入口', async (test) => {
  const { w, s } = await setup(test, '/?lang=zh', { hook(url) {
    if (url.pathname === '/api/list') return json({ entries: [{ name: 'app.db', type: 'file', size: 4096, mtime: 0 }] });
    if (url.pathname !== '/__test/sqlite') return;
    const request = JSON.parse(url.searchParams.get('request')!);
    if (request.action === 'objects') return json({ objects: [{ name: 'users', type: 'table' }, { name: 'names', type: 'view' }], truncated: false });
    return json({ columns: [{ key: 'id', label: 'id' }], rows: [], offset: 0, hasMore: false, limited: false });
  } });
  await until(() => !!w.document.querySelector('[aria-label="展开或收起数据库"]'));
  w.document.querySelector('[aria-label="展开或收起数据库"]')!.click();
  await until(() => w.document.querySelectorAll('.database-group').length === 2);
  const objects = w.document.querySelectorAll('.database-object');
  objects[0].click(); await until(() => s.activeTab()?.object?.name === 'users');
  objects[1].click(); await until(() => s.activeTab()?.object?.name === 'names');
  assert.equal(s.tabs().length, 2);
  assert.equal(s.activeTab().object.type, 'view');
  assert.equal(w.document.querySelector('.file-download')!.disabled, false);
  assert.equal(w.document.querySelector('[title="切换为编辑模式"]'), null);
});

test('重命名和删除数据库时同步所有对象标签，不影响其他数据库', async (test) => {
  const { s, w } = await setup(test, '/', { mount: false });
  const target = { object: { name: 'users', type: 'table' }, mode: 'data' };
  s.openDatabaseTab('folder/app.db', target);
  s.openDatabaseTab('folder/app.db', { ...target, mode: 'structure' });
  s.openDatabaseTab('other/app.db', target);
  await s.switchTab(s.tabs()[0].id);
  s.relocateDatabaseTabs('folder', 'renamed');
  assert.equal(s.tabs().length, 3);
  assert.equal(s.activeTab().path, 'renamed/app.db');
  assert.equal(w.location.pathname, '/_/database/renamed/app.db');
  s.relocateDatabaseTabs('renamed/app.db');
  assert.equal(s.tabs().length, 1);
  assert.equal(s.activeTab().path, 'other/app.db');
});

test('CSV 共用紧凑表格：字段与整行详情同步 URL，关闭后清理参数且不改变文件', async (test) => {
  const content = 'name,note\nA,"line 1\nline 2"\nB,';
  const { w, s } = await setup(test, '/data.csv?lang=zh', { hook(url) {
    if (url.pathname === '/api/file') return json({ content, utf8: true });
  } });
  let copied = '';
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (text: string) => { copied = text; } } });
  await until(() => !!w.document.querySelector('.data-grid-compact'));
  const url = w.location.href;
  const cells = () => w.document.querySelectorAll('.data-grid-cell');
  cells()[3].click();
  await until(() => w.document.querySelector('.table-cell-popover')?.style.visibility === 'visible');
  assert.equal(w.document.querySelector('.table-cell-value pre')!.textContent, 'line 1\nline 2');
  w.document.querySelector('[aria-label="复制值"]')!.click();
  await until(() => copied === 'line 1\nline 2');
  w.document.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(w.document.querySelector('.table-cell-popover'), null);
  assert.equal(w.document.activeElement, cells()[3]);
  const rowButtons = () => w.document.querySelectorAll('.data-grid-row-button');
  rowButtons()[1].click();
  await until(() => !!w.document.querySelector('.table-row-detail'));
  assert.match(w.document.querySelector('.table-row-detail')!.textContent, /line 1\nline 2/);
  assert.equal(w.document.querySelector('.table-row-detail')!.getAttribute('aria-label'), '第 2 行');
  cells()[4].click();
  assert.equal(w.document.querySelector('.table-row-detail')!.getAttribute('aria-label'), '第 3 行');
  assert.equal(w.document.querySelector('.table-cell-popover'), null);
  assert.match(w.document.querySelector('.table-row-detail')!.textContent, /空字符串/);
  w.document.querySelector('[aria-label="展开整行详情"]')!.click();
  assert.equal(w.document.querySelector('.table-row-detail')!.classList.contains('expanded'), true);
  w.document.querySelector('[aria-label="收起整行详情"]')!.click();
  assert.equal(w.document.querySelector('.table-row-detail')!.classList.contains('expanded'), false);
  w.document.querySelector('[aria-label="关闭整行详情"]')!.click();
  assert.equal(w.document.querySelector('.table-row-detail'), null);
  assert.equal(w.document.activeElement, rowButtons()[2]);
  assert.equal(w.location.href, url);
  assert.equal(s.currentFile(), 'data.csv');
});

test('字段浮层可点外部关闭，数据源变化或切换文件后清理详情', async (test) => {
  const { w, s } = await setup(test, '/_/database/app.db?object=users&lang=zh', { hook(url) {
    if (url.pathname !== '/__test/sqlite') return;
    const request = JSON.parse(url.searchParams.get('request')!);
    if (request.action === 'objects') return json({ objects: [], truncated: false });
    return json({ columns: [{ key: 'body', label: 'body' }, { key: 'blob', label: 'blob' }], rows: [
      [{ type: 'text', value: '<b>preview</b>', truncated: true }, { type: 'blob', value: '00FF', bytes: 1000, truncated: true }],
    ], offset: 0, hasMore: false, limited: false });
  } });
  await until(() => !!w.document.querySelector('.data-grid-cell'));
  w.document.querySelector('.data-grid-cell')!.click();
  await until(() => !!w.document.querySelector('.table-cell-popover'));
  assert.equal(w.document.querySelector('.table-cell-value b'), null);
  assert.equal(w.document.querySelector('.table-cell-value pre')!.textContent, '<b>preview</b>');
  assert.match(w.document.querySelector('.table-detail-notice')!.textContent, /不是完整值/);
  assert.ok(w.document.querySelector('[aria-label="复制预览内容"]'));
  w.document.body.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  assert.equal(w.document.querySelector('.table-cell-popover'), null);
  w.document.querySelector('.data-grid-row-button')!.click();
  assert.match(w.document.querySelector('.table-row-detail')!.textContent, /BLOB · 1000 B · HEX/);
  assert.match(w.document.querySelector('.table-row-detail')!.textContent, /00FF/);
  w.document.querySelector('.data-grid-sort')!.click();
  await until(() => !!w.document.querySelector('[aria-sort="ascending"]'));
  assert.equal(w.document.querySelector('.table-row-detail'), null);
  w.document.querySelector('.data-grid-cell')!.click();
  await s.openTab('a.txt');
  await until(() => s.docLoadedPath() === 'a.txt');
  assert.equal(w.document.querySelector('.table-cell-popover'), null);
  assert.equal(w.document.querySelector('.table-row-detail'), null);
});

test('整行详情替换分页栏，逐条切换同步高亮并跨页，加载图标保留固定槽位', async (test) => {
  let release: (() => void) | undefined;
  const { w } = await setup(test, '/_/database/app.db?object=users&lang=zh', { async hook(url) {
    if (url.pathname !== '/__test/sqlite') return;
    const request = JSON.parse(url.searchParams.get('request')!);
    if (request.action === 'objects') return json({ objects: [], truncated: false });
    const offset = request.request.offset ?? 0;
    if (offset) await new Promise<void>((resolve) => { release = resolve; });
    return json({ columns: [{ key: 'id', label: 'id' }], rows: [1, 2].map((id) => [{ type: 'integer', value: String(offset + id) }]), offset, hasMore: !offset, limited: false });
  } });
  await until(() => !!w.document.querySelector('.data-grid-row-button'));
  const spinnerSlot = w.document.querySelector('.database-loading-slot');
  assert.ok(spinnerSlot);
  assert.equal(w.document.querySelector('.database-loading.active'), null);
  w.document.querySelector('.data-grid-row-button')!.click();
  const detail = () => w.document.querySelector('.table-row-detail');
  const selected = () => w.document.querySelector('.data-grid-row-button[aria-expanded="true"]')?.textContent;
  assert.equal(w.document.querySelector('.database-pagination'), null);
  assert.equal(w.document.querySelector('[aria-label="上一条"]')!.disabled, true);
  w.document.querySelector('[aria-label="下一条"]')!.click();
  assert.equal(detail()?.getAttribute('aria-label'), '第 2 行');
  assert.equal(selected(), '2');
  w.document.querySelector('[aria-label="下一条"]')!.click();
  await until(() => !!release);
  assert.equal(w.document.querySelector('.database-loading-slot'), spinnerSlot);
  assert.ok(w.document.querySelector('.database-loading.active'));
  assert.equal(w.document.querySelector('.database-status'), null);
  assert.equal(detail()?.getAttribute('aria-label'), '第 2 行');
  assert.equal(w.document.querySelector('[aria-label="下一条"]')!.disabled, true);
  release!();
  await until(() => detail()?.getAttribute('aria-label') === '第 3 行');
  assert.equal(selected(), '3');
  assert.equal(w.document.querySelector('.database-pagination'), null);
  w.document.querySelector('[aria-label="展开整行详情"]')!.click();
  w.document.querySelector('[aria-label="上一条"]')!.click();
  await until(() => detail()?.getAttribute('aria-label') === '第 2 行');
  assert.equal(selected(), '2');
  assert.ok(detail()?.classList.contains('expanded'));
  w.document.querySelector('[aria-label="上一条"]')!.click();
  assert.equal(selected(), '1');
  w.document.querySelector('[aria-label="关闭整行详情"]')!.click();
  assert.equal(w.document.querySelector('.database-pagination span')?.textContent, '1–2');
  assert.equal(w.document.querySelector('.table-record-nav'), null);
});

test('文件树按需展开文档大纲，章节打开对应文件并向阅读器传递跳转，不创建虚拟文件标签', async (test) => {
  const { w, s, calls } = await setup(test, '/a.txt?lang=zh', { hook(url) {
    if (url.pathname === '/api/list') return json({ entries: [
      { name: 'a.txt', type: 'file' }, { name: 'manual.pdf', type: 'file' },
    ] });
    if (url.pathname === '/api/file-info' && url.searchParams.get('path') === 'manual.pdf') return json({ kind: 'pdf', size: 100, modified: 'v1', mime: 'application/pdf' });
  } });
  await until(() => !!w.document.querySelector('[aria-label="展开文档大纲"]'));
  assert.equal(w.outlineLoads, undefined);
  w.document.querySelector('[aria-label="展开文档大纲"]')!.click();
  await until(() => !!w.document.querySelector('.document-outline-title'));
  assert.equal(s.currentFile(), 'a.txt');
  assert.equal(w.outlineLoads, 1);
  assert.equal(w.outlineReleases, 1);
  assert.equal(w.document.querySelector('.document-outline-tree one'), null);
  assert.equal(w.document.querySelectorAll('.document-outline-title').length, 1);
  w.document.querySelector('.document-outline-title')!.click();
  assert.equal(w.document.querySelectorAll('.document-outline-title').length, 2);
  w.document.querySelectorAll('.document-outline-title')[1].click();
  await until(() => s.currentFile() === 'manual.pdf' && !!w.document.querySelector('.pdf-preview'));
  await tick();
  const jumps: string[] = [];
  const release = w.harness.registerReaderNavigation('manual.pdf', { goToOutline(id: string) { jumps.push(id); } });
  test.after(release);
  await until(() => jumps.length === 1);
  assert.deepEqual(jumps, ['0.0']);
  assert.equal(s.tabs().filter((tab: any) => tab.path === 'manual.pdf').length, 1);
  assert.equal(w.location.pathname, '/manual.pdf');
  assert.equal(calls.some((call) => call.url.pathname === '/api/file' && call.url.searchParams.get('path') === 'Section two'), false);
  assert.equal(w.document.querySelector('[aria-current="location"]')?.textContent, 'Section two');
  w.document.querySelector('[aria-label="展开文档大纲"]')!.click();
  assert.equal(w.document.querySelector('.document-outline-tree'), null);
  assert.equal(s.currentFile(), 'manual.pdf');
});

test('Markdown 文件树标题复用渲染目标，只读源码可切回预览，编辑模式跳转源码且不改只读状态', async (test) => {
  const content = '# First\n\ntext\n\n## Second\n\nlast';
  const { w, s, editor } = await setup(test, '/a.txt?lang=zh', { hook(url) {
    if (url.pathname === '/api/list') return json({ entries: [{ name: 'guide.md', type: 'file' }] });
    if (url.pathname === '/api/file' && url.searchParams.get('path') === 'guide.md') return json({ content, utf8: true });
  } });
  w.document.querySelector('[aria-label="展开文档大纲"]')!.click();
  await until(() => !!w.document.querySelector('.document-outline-title'));
  assert.equal(w.outlineLoads, undefined, 'Markdown must not acquire a PDF parser');
  assert.equal(s.currentFile(), 'a.txt');
  w.document.querySelector('.document-outline-row [aria-expanded]')!.click();
  w.document.querySelectorAll('.document-outline-title')[1].click();
  await until(() => s.currentFile() === 'guide.md' && !!w.document.querySelector('[data-md-heading="1"]'));
  await until(() => w.document.activeElement?.classList.contains('markdown-preview'));
  assert.equal(s.roMode(), true);
  w.document.querySelector('.markdown-toggle')!.click();
  await until(() => w.document.querySelector('.markdown-preview') === null);
  w.document.querySelectorAll('.document-outline-title')[1].click();
  await until(() => w.document.activeElement?.classList.contains('markdown-preview'));
  s.setRoMode(false);
  await until(() => !!w.document.querySelector('.cm-editor') && !w.document.querySelector('.markdown-preview'));
  w.document.querySelectorAll('.document-outline-title')[1].click();
  await until(() => editor().state.doc.lineAt(editor().state.selection.main.from).number === 5);
  assert.equal(s.roMode(), false);
  assert.equal(w.document.querySelector('.markdown-preview'), null);
  assert.equal(s.tabs().filter((tab: any) => tab.path === 'guide.md').length, 1);
});

test('目录下载展示压缩与校验进度，状态请求超时后解除等待且重试能下载已有 ZIP', async (test) => {
  let stall = false, statusCalls = 0, retried = false;
  const { w } = await setup(test, '/a.txt?lang=zh', { hook(url, init) {
    const job = { kind: 'archive', id: 'job', filename: 'example.zip', status: 'preparing', phase: 'packing',
      progress: { entries: 5, totalBytes: 10485760, readBytes: 2097152, writtenBytes: 1048576, checkedEntries: 0 } };
    if (url.pathname === '/api/download/prepare') return json(retried ? { ...job, status: 'ready', url: '/api/download/archive?id=job' } : job);
    if (url.pathname === '/api/download/status') {
      statusCalls++;
      if (stall) return new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      stall = true;
      return json({ ...job, phase: 'verifying', progress: { ...job.progress, checkedEntries: 3 } });
    }
  } });
  const originalTimeout = w.setTimeout.bind(w);
  w.setTimeout = ((handler: TimerHandler, delay?: number, ...args: any[]) => originalTimeout(handler, delay === 30_000 ? 100 : delay, ...args)) as any;
  const downloads: string[] = [];
  w.HTMLAnchorElement.prototype.click = function () { downloads.push(this.href); };
  const result = w.harness.downloads.startDownload('example', true).then(() => null, (error: Error) => error);
  await until(() => w.harness.downloads.downloadProgressText().includes('2.0 / 10.0 MiB'));
  await until(() => w.harness.downloads.downloadProgressText().includes('3 / 5'));
  const error = await result;
  assert.match(error.message, /状态查询超时/);
  assert.equal(statusCalls, 2);
  assert.equal(w.harness.downloads.preparingDownload(), false);
  assert.equal(downloads.length, 0);
  retried = true;
  await w.harness.downloads.startDownload('example', true);
  assert.equal(downloads.length, 1);
  assert.equal(new URL(downloads[0]).searchParams.get('id'), 'job');
  assert.equal(w.harness.downloads.preparingDownload(), false);
});

test('压缩包内的 PDF 和 Markdown 复用文件树大纲，跳转包含嵌套路径，SQLite 复用数据库视图且不上传', async (test) => {
  const { w, s, calls } = await setup(test, '/bundle.zip?inside=inner.zip&lang=zh', { hook(url) {
    if (url.pathname === '/api/list') return json({ entries: [{ name: 'bundle.zip', type: 'file' }] });
    if (url.pathname === '/__test/sqlite') return json({ objects: [{ name: 'users', type: 'table' }], truncated: false });
  } });
  await until(() => w.document.querySelectorAll('.archive-node .tree-row[title="bundle.zip › manual.pdf"]').length === 2);
  const nested = () => w.document.querySelector('.tree-row[title="bundle.zip › inner.zip"]')!.parentElement!.querySelector(':scope > .archive-tree')!;
  const target = (name: string) => nested().querySelectorAll(`.archive-node .tree-row[title="bundle.zip › ${name}"]`);
  const row = () => [...target('manual.pdf')].at(-1) as any;
  row().querySelector('[aria-label="展开文档大纲"]').click();
  await until(() => !!row().parentElement.querySelector('.document-outline-title'));
  const tree = () => row().parentElement.querySelector('.document-outline-tree');
  tree().querySelector('.document-outline-title').click();
  tree().querySelectorAll('.document-outline-title')[1].click();
  await until(() => s.archiveEntry() === 'manual.pdf' && !!w.document.querySelector('.pdf-preview'));
  const jumps: string[] = [];
  const key = w.harness.fileTargetKey({ path: 'bundle.zip', archive: { entry: 'manual.pdf', chain: ['inner.zip'] } });
  const disconnect = w.harness.registerReaderNavigation(key, { goToOutline: (id: string) => { jumps.push(id); } });
  test.after(disconnect);
  await until(() => jumps.length === 1);
  assert.deepEqual(jumps, ['0.0']);
  assert.deepEqual(Array.from(s.archiveChain()), ['inner.zip']);
  const markdown = [...target('README.md')].at(-1) as any;
  markdown.querySelector('[aria-label="展开文档大纲"]').click();
  await until(() => !!markdown.parentElement.querySelector('.document-outline-title'));
  markdown.parentElement.querySelector('.document-outline-title').click();
  await until(() => s.archiveEntry() === 'README.md' && w.document.activeElement?.classList.contains('markdown-preview'));
  assert.match(w.location.search, /inside=inner.zip/);
  assert.equal(w.document.querySelectorAll('.toolbar').length, 1);
  await s.openArchiveEntry('bundle.zip', 'app.db', ['inner.zip']);
  await until(() => !!w.document.querySelector('.database-object-list button'));
  assert.equal(s.activeTab().archive.entry, 'app.db');
  assert.deepEqual(Array.from(s.activeTab().archive.chain), ['inner.zip']);
  assert.match(w.location.pathname, /database\/bundle.zip/);
  assert.match(w.location.search, /entry=app.db/);
  assert.equal(w.document.querySelector('.file-download').disabled, false);
  assert.equal(calls.some((call) => call.url.pathname.startsWith('/api/database') || call.url.pathname === '/api/upload'), false);
});

test('包内数据库的嵌套身份贯穿文件树、独立标签、历史和重命名', async (test) => {
  const { w, s, history, calls } = await setup(test, '/_/database/bundle.zip?inside=inner.zip&entry=app.db&object=users&lang=zh', { hook(url) {
    if (url.pathname === '/api/list') return json({ entries: [{ name: 'bundle.zip', type: 'file' }] });
    if (url.pathname !== '/__test/sqlite') return;
    const request = JSON.parse(url.searchParams.get('request')!);
    if (request.action === 'objects') return json({ objects: [{ name: 'users', type: 'table' }, { name: 'names', type: 'view' }], truncated: false });
    if (request.action === 'describe') return json({ object: request.object, columns: [], indexes: [], foreignKeys: [], sql: 'CREATE TABLE users(id)' });
    return json({ columns: [{ key: 'location', label: 'location' }], rows: [[{ type: 'text', value: url.searchParams.get('inside') }]], offset: 0, hasMore: false, limited: false });
  } });
  await until(() => !!w.document.querySelector('.database-data tbody tr'));
  const nestedId = s.currentTabId();
  assert.match(w.document.querySelector('.database-data')!.textContent!, /inner.zip/);
  await until(() => !!w.document.querySelector('.archive-node .database-object[title="users"]'));
  w.document.querySelector('.toolbar [aria-label="结构"]')!.click();
  await until(() => !!w.document.querySelector('.database-structure pre'));
  assert.deepEqual(Array.from(s.activeTab().archive.chain), ['inner.zip']);
  s.openDatabaseTab('bundle.zip', { archive: { entry: 'app.db', chain: [] }, object: { name: 'users', type: 'table' }, mode: 'data' });
  await until(() => !!w.document.querySelector('.database-data tbody tr'));
  assert.notEqual(s.currentTabId(), nestedId);
  assert.equal(w.location.search.includes('inside='), false);
  await history('back');
  await until(() => !!w.document.querySelector('.database-structure pre'));
  assert.match(w.location.search, /inside=inner.zip/);
  await s.switchTab(nestedId);
  await until(() => !!w.document.querySelector('.database-data tbody tr'));
  assert.match(w.document.querySelector('.database-data')!.textContent!, /inner.zip/);
  const saved = JSON.parse(w.localStorage.getItem('anther:databaseTabs')!);
  assert.equal(saved.filter((tab: any) => tab.archive?.entry === 'app.db').length, 3);
  assert.equal(new Set(saved.map((tab: any) => tab.id)).size, 3);
  s.relocateDatabaseTabs('bundle.zip', 'renamed.zip');
  assert.equal(s.tabs().filter((tab: any) => tab.kind === 'database').every((tab: any) => tab.path === 'renamed.zip'), true);
  assert.match(w.location.pathname, /database\/renamed.zip/);
  assert.match(w.location.search, /inside=inner.zip/);
  assert.equal(calls.some((call) => call.url.pathname === '/api/upload' || call.url.pathname === '/api/database'), false);
});

test('压缩包预算错误只显示一次，阅读区优先，重试仍对应出错文件', async (test) => {
  const { w } = await setup(test, '/?lang=zh', { mount: false });
  const retries: string[] = [];
  const mounted = w.harness.mountArchiveFeedback((target: string) => retries.push(target));
  test.after(mounted.dispose);
  const key = w.harness.archiveKey('bundle.zip', []);
  w.harness.setArchiveSession(key, { entry: 'a.db', error: 'Archive memory budget exceeded', limit: 'budget', entries: [] });
  w.harness.setArchiveSession(w.harness.archiveKey('bundle.zip', ['inner.zip']), { error: 'Archive memory budget exceeded', limit: 'budget', entries: [] });
  await until(() => w.document.querySelectorAll('[role="alert"]').length === 1);
  assert.match(w.document.querySelector('.reader-feedback [role="alert"]')!.textContent!, /128 MiB/);
  w.document.querySelector('[aria-label="重试"]')!.click();
  assert.deepEqual(retries, ['reader']);
  w.harness.setArchiveSession(key, 'entry', 'b.db');
  await until(() => !w.document.querySelector('.reader-feedback [role="alert"]'));
  assert.equal(w.document.querySelectorAll('[role="alert"]').length, 1);
  w.document.querySelector('[aria-label="重试"]')!.click();
  assert.deepEqual(retries, ['reader', 'b']);
  mounted.setReader(false);
  assert.equal(w.document.querySelectorAll('[role="alert"]').length, 1);
  w.harness.setArchiveSession(key, { entry: 'a.db', limit: undefined, error: 'Password required', passwordRequired: true });
  await until(() => w.document.querySelectorAll('.archive-password').length === 1);
  mounted.dispose();
  assert.equal(w.document.querySelectorAll('.archive-feedback').length, 0);
});

test('阅读位置更新替换历史，切换文件隔离坐标，前进后退恢复同一文档目标', async (test) => {
  const { w, s, history } = await setup(test, '/book.epub#lbp:2@1%2342;zoom:125', { mount: false });
  assert.equal(s.readingLocationFor('book.epub').lbp, '2@1#42');
  const length = w.history.length;
  s.updateReadingLocation('book.epub', { kind: 'epub', lbp: '2@4#30', zoom: 1.25 });
  assert.equal(w.history.length, length);
  assert.equal(parseFragment(w.location.hash).get('lbp'), '2@4#30');
  await s.openTab('other.pdf');
  s.updateReadingLocation('book.epub', { kind: 'epub', lbp: '0@#0' });
  assert.equal(w.location.pathname + w.location.search, '/other.pdf');
  s.updateReadingLocation('other.pdf', { kind: 'pdf', page: 4, x: 0, y: 500 });
  await history('back');
  assert.equal(s.readerRestoreRequest().location.lbp, '2@4#30');
  await history('forward');
  assert.equal(s.readerRestoreRequest().location.page, 4);
  w.history.pushState(null, '', '/other.pdf');
  w.dispatchEvent(new w.PopStateEvent('popstate'));
  assert.equal(s.readerRestoreRequest().location, null);
});

test('同名包内文档的阅读坐标按完整嵌套路径隔离', async (test) => {
  const { w, s, history } = await setup(test, '/bundle.zip?inside=a.zip&entry=book.epub#lbp:2@1%2342', { mount: false });
  const key = (chain: string[]) => w.harness.fileTargetKey({ path: 'bundle.zip', archive: { chain, entry: 'book.epub' } });
  assert.equal(s.readingLocationFor(key(['a.zip'])).lbp, '2@1#42');
  await s.openArchiveEntry('bundle.zip', 'book.epub', ['b.zip']);
  assert.equal(parseFragment(w.location.hash).get('lbp'), null);
  s.updateReadingLocation(key(['a.zip']), { kind: 'epub', lbp: '0@#0' });
  assert.equal(parseFragment(w.location.hash).get('lbp'), null);
  s.updateReadingLocation(key(['b.zip']), { kind: 'epub', lbp: '5@#0' });
  await history('back');
  assert.equal(s.readerRestoreRequest().key, key(['a.zip']));
  assert.equal(s.readerRestoreRequest().location.lbp, '2@1#42');
});

test('CSV 深链恢复整行详情，选择变化替换 URL，后退恢复同一表格而不是重开文件', async (test) => {
  const { w, history } = await setup(test, '/data.csv?lang=zh#row:2;expanded:1', { hook(url) {
    if (url.pathname === '/api/file') return json({ content: 'name,value\nA,one\nB,two', utf8: true });
  } });
  await until(() => !!w.document.querySelector('.table-row-detail.expanded'));
  assert.equal(w.document.querySelector('.table-row-detail')!.getAttribute('aria-label'), '第 2 行');
  const count = w.history.length;
  w.document.querySelector('[aria-label="下一条"]')!.click();
  await until(() => parseFragment(w.location.hash).get('row') === '3');
  assert.equal(w.history.length, count);
  w.history.pushState(null, '', '/data.csv?lang=zh#row:1'); w.dispatchEvent(new w.PopStateEvent('popstate'));
  await until(() => w.document.querySelector('.table-row-detail')?.getAttribute('aria-label') === '第 1 行');
  await history('back');
  await until(() => w.document.querySelector('.table-row-detail')?.getAttribute('aria-label') === '第 3 行');
  assert(w.document.querySelector('.table-row-detail.expanded'));
});

test('SQLite 深链应用筛选、分页及详情，同对象的历史恢复清空旧筛选', async (test) => {
  const queries: any[] = [];
  const { w, history } = await setup(test, '/_/database/app.db?lang=zh&object=users&filter=name&value=Alice#offset:100;row:101', { hook(url) {
    if (url.pathname !== '/__test/sqlite') return;
    const body = JSON.parse(url.searchParams.get('request')!);
    if (body.action !== 'rows') return json({ objects: [], truncated: false });
    queries.push(body.request);
    const offset = body.request.offset ?? 0;
    return json({ columns: [{ key: 'name', label: 'name' }], rows: [[{ type: 'text', value: body.request.filter?.value ?? 'all' }]], offset, hasMore: true, limited: false });
  } });
  await until(() => !!w.document.querySelector('.table-row-detail'));
  assert.equal(queries.at(-1).offset, 100); assert.equal(queries.at(-1).filter.value, 'Alice');
  assert.equal(w.document.querySelector('.database-filter input')!.value, 'Alice');
  w.history.pushState(null, '', '/_/database/app.db?lang=zh&object=users'); w.dispatchEvent(new w.PopStateEvent('popstate'));
  await until(() => w.document.querySelector('.database-data')?.textContent.includes('all'));
  assert.equal(queries.at(-1).offset, 0); assert.equal(queries.at(-1).filter, undefined);
  assert.equal(w.document.querySelector('.database-filter input')!.value, '');
  await history('back');
  await until(() => !!w.document.querySelector('.table-row-detail'));
  assert.equal(queries.at(-1).offset, 100); assert.equal(queries.at(-1).filter.value, 'Alice');
});

test('原生 hashchange 恢复行号，后退的 popstate/hashchange 只处理一次', async (test) => {
  const { w, s, editor, history, calls } = await setup(test, '/a.txt#line:2');
  await until(() => s.docLoadedPath() === 'a.txt');
  const initialCount = w.history.length;
  w.location.hash = 'line:3';
  await until(() => editor()?.state.doc.lineAt(editor().state.selection.main.head).number === 3);
  assert.equal(w.history.length, initialCount + 1);
  const before = calls.filter(({ url }) => url.pathname === '/api/tabs/front').length;
  await history('back');
  await until(() => editor()?.state.doc.lineAt(editor().state.selection.main.head).number === 2);
  await tick();
  assert.equal(calls.filter(({ url }) => url.pathname === '/api/tabs/front').length - before, 1);
  const length = w.history.length;
  s.pushState(); s.pushState();
  assert.equal(w.history.length, length, 'identical fragments must not add history entries');
});

test('片段直接切换与清空同一 CSV 的详情，不重载文件', async (test) => {
  const { w, calls } = await setup(test, '/data.csv?lang=zh#row:2', { hook(url) {
    if (url.pathname === '/api/file') return json({ content: 'name,value\nA,one\nB,two', utf8: true });
  } });
  await until(() => !!w.document.querySelector('.table-row-detail'));
  const reads = calls.filter(({ url }) => url.pathname === '/api/file').length;
  w.location.hash = 'row:3;expanded:1';
  await until(() => w.document.querySelector('.table-row-detail.expanded')?.getAttribute('aria-label') === '第 3 行');
  w.location.hash = '';
  await until(() => !w.document.querySelector('.table-row-detail'));
  assert.equal(calls.filter(({ url }) => url.pathname === '/api/file').length, reads);
  assert.equal(w.location.hash, '');
});

test('Markdown source and rendered positions do not force a refreshed preview back to source', async (test) => {
  const { w, s, editor } = await setup(test, '/README.md?lang=zh#line:3');
  await until(() => s.docLoadedPath() === 'README.md' && !w.document.querySelector('.markdown-preview'));
  w.document.querySelector('[aria-label="显示 Markdown 预览"]')!.click();
  await until(() => !!w.document.querySelector('.markdown-preview'));
  assert.equal(parseFragment(w.location.hash).get('line'), null, 'switching back to preview clears even an unscrolled source position');
  s.updateReadingLocation('README.md', { kind: 'markdown', heading: '0' });
  const href = w.location.href;
  w.history.pushState(null, '', href); w.dispatchEvent(new w.PopStateEvent('popstate'));
  await tick();
  assert(w.document.querySelector('.markdown-preview'));
  assert.equal(parseFragment(w.location.hash).get('heading'), '0');
  w.document.querySelector('[aria-label="显示 Markdown 源码"]')!.click();
  editor()!.dispatch({ selection: { anchor: editor()!.state.doc.line(2).from } });
  await until(() => parseFragment(w.location.hash).get('line') === '2');
  assert.equal(parseFragment(w.location.hash).get('heading'), null);
});

test('a pending native hash navigation wins over a late position notification from the old view', async (test) => {
  const { w, s } = await setup(test, '/data.csv?lang=zh#row:2', { mount: false });
  // hashchange has not run yet; emulate the old view's queued animation/timer.
  w.location.hash = 'row:3;expanded:1';
  s.updateReadingLocation('data.csv', { kind: 'table', row: 2 });
  assert.equal(w.location.hash, '#row:3;expanded:1');
  assert.equal(s.readerRestoreRequest().location.row, 3);
  await tick();
  assert.equal(s.readingLocationFor('data.csv').row, 3);
  w.location.hash = '';
  s.updateReadingLocation('data.csv', { kind: 'table', row: 3, expanded: true });
  assert.equal(w.location.hash, '');
  assert.equal(s.readerRestoreRequest().location, null);
});

function fileMenu(w: any, path: string, text: string) {
  w.document.querySelector(`.tree-row[title="${path}"] .row-menu-btn`).click();
  [...w.document.querySelectorAll('.menu-item')].find((el: any) => el.textContent === text)!.click();
}
function submitRename(w: any, name: string) {
  const input = w.document.querySelector('.dialog-input');
  input.value = name; input.dispatchEvent(new w.Event('input', { bubbles: true }));
  w.document.querySelector('.dialog-card').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
}

test('重命名等待防抖和进行中的保存；等待期间锁定编辑，目录内标签一起迁移', async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let renames = 0;
  const h = await setup(t, '/folder/a.txt?ro=0&lang=zh', { hook: async (url, init) => {
    if (url.pathname === '/api/list') return json({ entries: [{ name: 'folder', type: 'dir' }] });
    if (url.pathname === '/api/file' && init.method !== 'PUT') return json({ content: 'original', utf8: true });
    if (url.pathname === '/api/file' && init.method === 'PUT') await gate;
    if (url.pathname === '/api/rename') {
      renames++;
      assert.match(h.docs.get('folder/a.txt')!, /changed/);
      return json({ ok: true });
    }
  } });
  await until(() => h.s.docLoadedPath() === 'folder/a.txt');
  await h.s.openTab('folder/b.txt'); await h.s.openTab('folder/a.txt');
  await until(() => h.s.docLoadedPath() === 'folder/a.txt');
  h.editor().dispatch({ changes: { from: 0, insert: 'changed ' }, userEvent: 'input' });
  await until(() => !!h.w.document.querySelector('.tree-row[title="folder"]'));
  fileMenu(h.w, 'folder', '重命名'); submitRename(h.w, 'renamed');
  await until(() => h.calls.some(c => c.url.pathname === '/api/file' && c.init.method === 'PUT'));
  assert.equal(renames, 0);
  assert.equal(h.editor().state.readOnly, true);
  release();
  await until(() => h.s.docLoadedPath() === 'renamed/a.txt');
  assert.equal(renames, 1);
  assert.equal(h.editor().state.readOnly, false);
  assert.equal(h.s.tabs().some((tab: any) => tab.path === 'renamed/b.txt'), true);
  assert.equal(h.s.tabs().some((tab: any) => tab.path.startsWith('folder/')), false);
  assert.equal(h.w.location.pathname, '/renamed/a.txt');
});

test('删除等待正在保存的内容完成，不在删除后重新创建旧文件', async (t) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let deleted = false;
  const h = await setup(t, '/a.txt?ro=0&lang=zh', { hook: async (url, init) => {
    if (url.pathname === '/api/list') return json({ entries: deleted ? [] : [{ name: 'a.txt', type: 'file' }] });
    if (url.pathname === '/api/file' && init.method === 'PUT') await gate;
    if (url.pathname === '/api/delete') { deleted = true; h.docs.delete('a.txt'); return json({ ok: true }); }
  } });
  await until(() => h.s.docLoadedPath() === 'a.txt');
  h.editor().dispatch({ changes: { from: 0, insert: 'changed ' }, userEvent: 'input' });
  await until(() => h.calls.some(c => c.url.pathname === '/api/file' && c.init.method === 'PUT'));
  fileMenu(h.w, 'a.txt', '删除');
  [...h.w.document.querySelectorAll('.menu-item')].find((el: any) => el.textContent.includes('确认删除'))!.click();
  await tick(); assert.equal(deleted, false); assert.equal(h.editor().state.readOnly, true);
  release(); await until(() => deleted && h.s.currentFile() === null);
  await tick(1100); assert.equal(h.docs.has('a.txt'), false);
});

test('侧边栏底部提供实例列表链接 /-', async (t) => {
  const h = await setup(t, '/');
  const link = h.w.document.querySelector('.drawer-view-footer a[href="/-"]');
  assert.ok(link);
  assert.ok(link!.getAttribute('title'));
  assert.ok(link!.getAttribute('aria-label'));
});

test('实例列表页 `/-`：列出宿主和所有挂载，链接使用最短地址', async (t) => {
  const mounts = [
    { name: 'anther', index: 0, workspace: '/repo/anther', base: '/-/anther/-/0', shorthand: '/-/anther', legacyRoot: true },
    { name: 'qlang', index: 0, workspace: '/repo/qlang', base: '/-/qlang/-/0', shorthand: '/-/qlang', legacyRoot: false },
    { name: 'qlang', index: 1, workspace: '/other/qlang', base: '/-/qlang/-/1', shorthand: null, legacyRoot: false },
  ];
  const h = await setup(t, '/-', { mount: false, start: false, hook: (url) => {
    if (url.pathname === '/api/anther') {
      return json({ name: 'anther', workspace: '/repo/anther', instanceId: 'x', attach: { available: true }, mounts });
    }
    if (url.pathname === '/api/anther/detach') return json({ detached: mounts[1] });
  } });
  const dispose = h.w.harness.mountInstances();
  await until(() => h.w.document.querySelectorAll('.instance-row').length === 3);

  const rows = [...h.w.document.querySelectorAll('.instance-row')] as HTMLElement[];
  const links = rows.map((row) => row.querySelector('.instance-link') as HTMLAnchorElement);
  assert.deepEqual(links.map((link) => link.getAttribute('href')), ['/', '/-/qlang/', '/-/qlang/-/1/']);
  assert.equal(rows[2].querySelector('.instance-name')!.textContent, 'qlang #1');
  assert.ok(rows[0].querySelector('.instance-badge'));

  const detachButtons = rows.map((row) => row.querySelector('.instance-detach') as HTMLButtonElement);
  assert.equal(detachButtons.length, 3);
  const detachPath = '/api/anther/detach';
  assert.equal(h.calls.filter((call) => call.url.pathname === detachPath).length, 0);
  detachButtons[1].click();
  await tick();
  assert.ok(detachButtons[1].classList.contains('armed'));
  assert.equal(h.calls.filter((call) => call.url.pathname === detachPath).length, 0);

  detachButtons[1].click();
  await until(() => h.w.document.querySelectorAll('.instance-row').length === 2);
  assert.ok(h.calls.some((call) => call.url.pathname === detachPath));
  dispose();
});

test('保存失败阻止重命名，并恢复可编辑状态', async (t) => {
  const h = await setup(t, '/a.txt?ro=0&lang=zh', { hook: (url, init) => {
    if (url.pathname === '/api/list') return json({ entries: [{ name: 'a.txt', type: 'file' }] });
    if (url.pathname === '/api/file' && init.method === 'PUT') return json({ error: 'disk full' }, 500);
  } });
  await until(() => h.s.docLoadedPath() === 'a.txt');
  h.editor().dispatch({ changes: { from: 0, insert: 'changed ' }, userEvent: 'input' });
  fileMenu(h.w, 'a.txt', '重命名'); submitRename(h.w, 'b.txt');
  await tick(2200);
  assert.equal(h.calls.some(c => c.url.pathname === '/api/rename'), false);
  assert.equal(h.s.currentFile(), 'a.txt'); assert.equal(h.editor().state.readOnly, false);
  assert.match(h.w.document.body.textContent, /请先成功保存修改后再重命名或删除/);
});
