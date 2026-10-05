import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readEpubBook, epubLink, parseEpubXml } from './readers/epub-data.ts';

const dom = new JSDOM('<!doctype html>');
Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser });
const { prepareEpubChapter } = await import('./readers/epub-content.ts');
after(() => dom.window.close());
const container = '<container><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
const opf = `<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Book</dc:title><dc:language>zh</dc:language></metadata><manifest>
<item id="one" href="chapters/one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="chapters/二%20章.xhtml" media-type="application/xhtml+xml"/>
<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/><item id="css" href="style.css" media-type="text/css"/>
<item id="image" href="image.png" media-type="image/png"/>
</manifest><spine><itemref idref="nav" linear="no"/><itemref idref="one"/><itemref idref="two"/></spine></package>`;
const nav = '<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="chapters/one.xhtml#start">First</a><ol><li><a href="chapters/二%20章.xhtml#end">Second</a></li></ol></li></ol></nav></body></html>';
function fixture() { return new Map([
  ['META-INF/container.xml', container], ['OPS/book.opf', opf], ['OPS/nav.xhtml', nav],
  ['OPS/chapters/one.xhtml', '<html><head><link rel="stylesheet" href="../style.css"/></head><body><h1 id="start">First</h1><img src="../image.png"/><a href="二%20章.xhtml#end">Next</a></body></html>'],
  ['OPS/chapters/二 章.xhtml', '<html><body><h1 id="end">Second</h1></body></html>'],
  ['OPS/style.css', 'p { color: red; background-image: url(image.png) }'], ['OPS/image.png', 'image'],
]); }
const book = (files: Map<string, string>) => readEpubBook(async (path) => { assert(files.has(path), path); return files.get(path)!; }, new Set(files.keys()));

test('EPUB 3 metadata/TOC resolve relative Unicode targets without loading chapters', async () => {
  const files = fixture(), reads: string[] = [];
  const value = await readEpubBook(async path => { reads.push(path); return files.get(path)!; }, new Set(files.keys()));
  assert.equal(value.title, 'Book'); assert.equal(value.language, 'zh');
  assert.equal(value.spine.length, 3);
  assert.deepEqual(value.spine.map(item => item.linear), [false, true, true]);
  assert.deepEqual(reads, ['META-INF/container.xml', 'OPS/book.opf', 'OPS/nav.xhtml']);
  const child = value.outline[0].children[0];
  assert.equal(child.title, 'Second');
  assert.deepEqual(value.destinations.get(child.id), { path: 'OPS/chapters/二 章.xhtml', fragment: 'end' });
});
test('EPUB 2 NCX and ordinary XHTML doctypes are supported; missing TOC falls back to spine', async () => {
  const files = fixture();
  files.set('OPS/book.opf', opf.replace('properties="nav" media-type="application/xhtml+xml"', 'media-type="application/x-dtbncx+xml"').replace('<spine>', '<spine toc="nav">').replace('<itemref idref="nav" linear="no"/>', ''));
  files.set('OPS/nav.xhtml', '<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd"><ncx><navMap><navPoint><navLabel><text>First</text></navLabel><content src="chapters/one.xhtml#start"/></navPoint></navMap></ncx>');
  assert.equal((await book(files)).outline[0].title, 'First');
  files.set('OPS/book.opf', opf.replace('properties="nav"', ''));
  assert.equal((await book(files)).outline.length, 2);
});
test('EPUB does not resolve remote/protocol URLs or XML entity declarations', () => {
  for (const url of ['https://evil.test/one', '//evil.test/a', 'javascript:alert(1)', 'data:text/html,x']) assert.equal(epubLink(url, 'OPS/book.opf'), null);
  assert.throws(() => parseEpubXml('<!DOCTYPE x [<!ENTITY leak SYSTEM "file:///etc/passwd">]><x>&leak;</x>'));
});
test('EPUB reports unsupported DRM/fixed layouts; obfuscated fonts may fall back', async () => {
  const files = fixture(); files.set('OPS/book.opf', opf.replace('<metadata>', '<metadata><meta property="rendition:layout">pre-paginated</meta>'));
  await assert.rejects(book(files), /Unsupported/);
  files.set('OPS/book.opf', opf);
  files.set('META-INF/encryption.xml', '<encryption><EncryptedData><EncryptionMethod Algorithm="DRM"/></EncryptedData></encryption>');
  await assert.rejects(book(files), /Unsupported/);
  files.set('META-INF/encryption.xml', '<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><CipherReference URI="OPS/font.otf"/></EncryptedData></encryption>');
  assert((await book(files)).hiddenResources.has('OPS/font.otf'));
});
test('EPUB chapter styles/images are local leased resources, chapter links stay internal, and active markup is removed', async () => {
  const files = fixture();
  files.set('OPS/chapters/one.xhtml', files.get('OPS/chapters/one.xhtml')!.replace('</body>', '<script>evil()</script><iframe src="https://evil.test"></iframe><img src="https://evil.test/a" onerror="evil()"/><form><input/></form></body>'));
  const value = await book(files), reads: string[] = [];
  const chapter = await prepareEpubChapter(value, 1, async path => { reads.push(path); return new TextEncoder().encode(files.get(path)!); });
  const doc = new dom.window.DOMParser().parseFromString(chapter.html, 'text/html');
  assert.equal(doc.querySelectorAll('script,iframe,form,input,[onerror]').length, 0);
  assert.match(doc.querySelector('meta')!.content, /script-src 'none'/);
  const image = doc.querySelector('img')!.getAttribute('src')!;
  assert.match(image, /^blob:/);
  assert.equal(await (await fetch(image)).text(), 'image');
  assert.equal(doc.querySelectorAll('img[src]').length, 1);
  assert.match(doc.querySelector('a')!.getAttribute('data-epub-link')!, /二 章/);
  assert(!reads.includes('OPS/chapters/二 章.xhtml'));
  chapter.release(); await assert.rejects(fetch(image));
});
test('Recursive CSS imports terminate and resources are released when loading fails', async () => {
  const files = fixture(); files.set('OPS/style.css', '@import "style.css"; p { background: url(image.png) }');
  const chapter = await prepareEpubChapter(await book(files), 1, async path => new TextEncoder().encode(files.get(path)!));
  chapter.release();
  await assert.rejects(prepareEpubChapter(await book(files), 1, async path => { if (path.endsWith('image.png')) throw new Error('read failed'); return new TextEncoder().encode(files.get(path)!); }), /read failed/);
});

test('nonlinear EPUB chapters keep their spine coordinates and support lazy footnote/backlink navigation', async () => {
  const files = fixture();
  files.set('OPS/book.opf', opf.replace('<itemref idref="two"/>', '<itemref idref="two" linear="no"/>'));
  files.set('OPS/chapters/二 章.xhtml', '<html><body><p id="end">Footnote</p><a href="one.xhtml#start">Back</a></body></html>');
  const metadata = await book(files);
  assert.deepEqual(metadata.spine.map(item => item.linear), [false, true, false]);
  assert.equal(metadata.outline[0].children[0].navigable, true);
  const reads: string[] = [];
  const read = async (path: string) => { reads.push(path); return new TextEncoder().encode(files.get(path)!); };
  const chapter = await prepareEpubChapter(metadata, 1, read);
  const chapterDoc = new DOMParser().parseFromString(chapter.html, 'text/html');
  assert.deepEqual(JSON.parse(chapterDoc.querySelector('a')!.getAttribute('data-epub-link')!), { path: 'OPS/chapters/二 章.xhtml', fragment: 'end' });
  assert(!reads.includes('OPS/chapters/二 章.xhtml'));
  const note = await prepareEpubChapter(metadata, 2, read);
  const noteDoc = new DOMParser().parseFromString(note.html, 'text/html');
  assert.deepEqual(JSON.parse(noteDoc.querySelector('a')!.getAttribute('data-epub-link')!), { path: 'OPS/chapters/one.xhtml', fragment: 'start' });
  chapter.release(); note.release();
});

const { acquireEpubSource } = await import('./readers/epub-source.ts');
const tick = () => new Promise<void>(resolve => queueMicrotask(resolve));
class EpubWorker {
  static instances: EpubWorker[] = [];
  static hold = '';
  messages: { id: number; url?: string; path?: string }[] = [];
  onmessage?: (event: any) => void;
  onerror?: () => void;
  terminated = false;
  constructor() { EpubWorker.instances.push(this); }
  postMessage(message: { id: number; url?: string; path?: string }) {
    this.messages.push(message);
    if (EpubWorker.hold === '*' || message.path === EpubWorker.hold) return;
    queueMicrotask(() => this.reply(message));
  }
  reply(message = this.messages.at(-1)!) {
    const files = fixture();
    this.onmessage?.({ data: { id: message.id, paths: [...files.keys()], bytes: new TextEncoder().encode(files.get(message.path!) ?? '') } });
  }
  terminate() { this.terminated = true; }
}
function mockWorker(t: { after(callback: () => void): void }, hold = '') {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  EpubWorker.instances = []; EpubWorker.hold = hold;
  Object.defineProperty(globalThis, 'Worker', { value: EpubWorker, configurable: true });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'Worker', previous); else delete (globalThis as any).Worker; });
}
test('EPUB tree/reader share metadata and release the worker only after the final consumer', async t => {
  mockWorker(t);
  const tree = acquireEpubSource('shared.epub'), reader = acquireEpubSource('shared.epub');
  t.after(() => { tree.release(); reader.release(); });
  await tree.book;
  assert.equal(EpubWorker.instances.length, 1);
  const worker = EpubWorker.instances[0];
  assert(!worker.messages.some(message => message.path?.includes('chapters/')));
  tree.release(); await tick(); assert.equal(worker.terminated, false);
  const chapter = await reader.chapter(1); chapter.release();
  reader.release(); await tick(); assert.equal(worker.terminated, true);
});
test('Leaving a loading EPUB chapter stops further resources and discards its late bytes', async t => {
  mockWorker(t, 'OPS/chapters/one.xhtml');
  const source = acquireEpubSource('cancel.epub'); t.after(source.release);
  await source.book;
  const cancel = new AbortController(), pending = source.chapter(1, cancel.signal);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await tick(); await tick();
  cancel.abort(); const worker = EpubWorker.instances[0]; worker.reply();
  await rejected;
  assert(!worker.messages.some(message => message.path === 'OPS/style.css' || message.path === 'OPS/image.png'));
});
test('Releasing an EPUB during loading terminates the worker and rejects pending reads', async t => {
  mockWorker(t, '*');
  const source = acquireEpubSource('dispose.epub');
  const rejected = assert.rejects(source.book, /Cancelled/);
  source.release(); await rejected;
  assert.equal(EpubWorker.instances[0].terminated, true);
});
test('EPUB timeout reports an outline error and stops the worker instead of loading forever', async t => {
  mockWorker(t, '*'); t.mock.timers.enable({ apis: ['setTimeout'] });
  const source = acquireEpubSource('timeout.epub'); t.after(source.release);
  const states: string[] = []; source.subscribe(state => states.push(state.outlineStatus));
  const rejected = assert.rejects(source.book, /timed out/);
  t.mock.timers.tick(60_001); await rejected; await tick(); await tick();
  assert.equal(EpubWorker.instances[0].terminated, true);
  assert.equal(states.at(-1), 'error');
});

test('decoded ZIP base paths preserve reserved characters throughout package, outline and resources', async () => {
  for (const segment of ['part#1', 'part?1', 'part%20', '章节 空格']) {
    const files = new Map([...fixture()].map(([path, content]) => [path.replace('OPS/', `OPS/${segment}/`), content]));
    files.set('META-INF/container.xml', container.replace('OPS/book.opf', `OPS/${segment}/book.opf`));
    const value = await book(files);
    assert.equal(value.spine[1].path, `OPS/${segment}/chapters/one.xhtml`);
    assert.equal(value.destinations.get(value.outline[0].id)!.path, value.spine[1].path);
    const chapter = await prepareEpubChapter(value, 1, async path => {
      assert(files.has(path), path); return new TextEncoder().encode(files.get(path)!);
    });
    assert.match(chapter.html, /blob:/); chapter.release();
    assert.deepEqual(epubLink('二%20章.xhtml#end%23here', value.spine[1].path), {
      path: `OPS/${segment}/chapters/二 章.xhtml`, fragment: 'end#here',
    });
  }
});

test('EPUB viewport CSS uses a stable outer viewport without changing strings, URLs or comments', async () => {
  const { stabilizeEpubCss, setEpubViewport } = await import('./readers/epub-layout.ts');
  assert.equal(stabilizeEpubCss('body{min-height:100vh;width:90svw;padding:calc(2dvh + 1vmin);--size:1e2vmax}'),
    'body{min-height:calc(100 * var(--anther-epub-vh));width:calc(90 * var(--anther-epub-vw));padding:calc(calc(2 * var(--anther-epub-vh)) + calc(1 * var(--anther-epub-vmin)));--size:calc(1e2 * var(--anther-epub-vmax))}');
  const literal = '/* 100vh */ p{content:"100vh";background:url(20vh.png);--100vh:1}';
  assert.equal(stabilizeEpubCss(literal), literal);
  const doc = dom.window.document.implementation.createHTMLDocument();
  setEpubViewport(doc, 400, 600, 2);
  assert.equal(doc.documentElement.style.height, '300px');
  assert.equal(doc.documentElement.style.getPropertyValue('--anther-epub-vh'), '3px');
  assert.equal(doc.documentElement.style.getPropertyValue('--anther-epub-vw'), '2px');
});
