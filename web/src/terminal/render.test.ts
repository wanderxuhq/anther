import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createTerminalScreen, type ScreenCell } from '../../../shared/terminal/vt.ts';

const dom = new JSDOM('');
Object.assign(globalThis, { window: dom.window });
const { renderRow, rowClass, rowText } = await import('./render.ts');
after(() => { dom.window.close(); delete (globalThis as Record<string, unknown>).window; });

function cells(text: string, cols = 80): ScreenCell[] {
  const screen = createTerminalScreen({ cols, rows: 1 });
  screen.process(text);
  return screen.getRow(0);
}

test('text 模式：保留文本与 ANSI 颜色，不生成链接/Markdown', () => {
  const html = renderRow(cells('\x1b[31msee src/foo.ts **bold**\x1b[0m'), { mode: 'text' });
  assert.match(html, /see src\/foo\.ts \*\*bold\*\*/);
  assert.match(html, /color:var\(--term-ansi-1\)/);
  assert.doesNotMatch(html, /term-link/);
  assert.doesNotMatch(html, /<strong>/);
});

test('html 模式：文件路径可点击、URL 是新窗口链接', () => {
  const html = renderRow(cells('see src/foo.ts and https://example.com/a'), { mode: 'html', linkify: true });
  assert.match(html, /class="term-link"[^>]*data-term-path="src\/foo\.ts"/);
  assert.match(html, /class="term-url"[^>]*href="https:\/\/example\.com\/a"/);
});

test('html 模式：行内 Markdown 与代码', () => {
  const html = renderRow(cells('**bold** `code` ~~gone~~'), { mode: 'html', markdown: true, linkify: true });
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<del>gone<\/del>/);
});

test('html 模式：行内代码里的路径也可点击', () => {
  const html = renderRow(cells('see `src/foo.ts` now'), { mode: 'html', markdown: true, linkify: true });
  assert.match(html, /<code><button[^>]*data-term-path="src\/foo\.ts"[^>]*>src\/foo\.ts<\/button><\/code>/);
});

test('html 模式：标题块与围栏代码块', () => {
  const heading = renderRow(cells('# Hello'), {
    mode: 'html', markdown: true, linkify: true, block: { kind: 'heading', level: 1, text: 'Hello' },
  });
  assert.match(heading, /term-md-heading term-md-h1/);
  assert.match(heading, />Hello</);
  assert.equal(rowClass({ kind: 'heading', level: 2, text: 'x' }, { mode: 'html', markdown: true }), 'term-row term-row-md term-row-md-h2');
  assert.equal(renderRow(cells('```'), { mode: 'html', block: { kind: 'fence' } }), '');
  assert.equal(rowClass({ kind: 'fence' }, { mode: 'html' }), 'term-row term-row-md term-row-md-fence');
});

test('光标：块状光标包住当前位置字符', () => {
  const html = renderRow(cells('abc'), {
    mode: 'text', cursor: { col: 1, visible: true, shape: 'block' },
  });
  assert.match(html, /class="term-cursor term-cursor-block">b<\/span>/);
});

test('rowText：宽字符与末尾空白', () => {
  assert.equal(rowText(cells('a中b    ')), 'a中b');
});

test('html 模式：活动行关闭 Markdown 但保留链接', () => {
  const html = renderRow(cells('**not bold** src/foo.ts'), {
    mode: 'html', markdown: false, linkify: true,
  });
  assert.match(html, /\*\*not bold\*\*/);
  assert.match(html, /data-term-path="src\/foo\.ts"/);
  assert.doesNotMatch(html, /<strong>/);
});
