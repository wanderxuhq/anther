import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('');
Object.assign(globalThis, { window: dom.window });
const { isMarkdownFile, renderMarkdown } = await import('./markdown.ts');
after(() => { dom.window.close(); delete (globalThis as Record<string, unknown>).window; });

test('Markdown 文件识别支持常见扩展名和大小写，不误判普通文件', () => {
  for (const path of ['README.md', 'docs/guide.MD', 'notes.markdown', 'a.mdown', 'a.mkdn', 'a.mkd']) {
    assert.equal(isMarkdownFile(path), true);
  }
  for (const path of [null, 'main.ts', 'readme.md.txt', 'docs.md/file.txt']) {
    assert.equal(isMarkdownFile(path), false);
  }
});

test('marked 渲染标题、列表、代码块、表格和任务列表', () => {
  const html = renderMarkdown('# 标题\n\n- **重点**\n\n```js\nconst x = 1;\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- [x] 完成');
  const doc = new dom.window.DOMParser().parseFromString(html, 'text/html');
  assert.equal(doc.querySelector('h1')?.textContent, '标题');
  assert.equal(doc.querySelector('li strong')?.textContent, '重点');
  assert.match(doc.querySelector('pre code')?.textContent ?? '', /const x = 1;/);
  assert.equal(doc.querySelectorAll('table td').length, 2);
  assert.ok(doc.querySelector('input[type="checkbox"][checked][disabled]'));
});

test('预览保留普通链接和图片，移除脚本、事件处理器、危险 URL 和全局样式', () => {
  const html = renderMarkdown(`
[文档](https://example.com/docs)
![图片](https://example.com/image.png)
<script>alert(1)</script>
<img src="x" onerror="alert(1)">
<a href="javascript:alert(1)">危险链接</a>
<style>body { display:none }</style>
<div style="position:fixed" onclick="alert(1)">正文</div>
`);
  const doc = new dom.window.DOMParser().parseFromString(html, 'text/html');
  assert.ok(doc.querySelector('a[href="https://example.com/docs"]'));
  assert.ok(doc.querySelector('img[src="https://example.com/image.png"]'));
  assert.equal(doc.querySelector('script, style, [onerror], [onclick], [style], [href^="javascript:"]'), null);
  assert.match(doc.body.textContent ?? '', /正文/);
});

test('空 Markdown 正常渲染，代码块里的 HTML 保持为文本', () => {
  assert.equal(renderMarkdown(''), '');
  const html = renderMarkdown('```html\n<script>alert(1)</script>\n```');
  const doc = new dom.window.DOMParser().parseFromString(html, 'text/html');
  assert.equal(doc.querySelector('script'), null);
  assert.match(doc.querySelector('code')?.textContent ?? '', /<script>alert\(1\)<\/script>/);
});

test('本地 Markdown 图片使用图片接口，外链保持原样，改写后仍无事件处理器', () => {
  const html = renderMarkdown('![本地](../images/pic.png)\n\n<img src="/logo.svg" onload="alert(1)">\n\n![外链](https://example.com/a.png)', 'docs/README.md');
  const doc = new dom.window.DOMParser().parseFromString(html, 'text/html');
  assert.deepEqual([...doc.querySelectorAll('img')].map((img) => img.getAttribute('src')), [
    '/api/image?path=images%2Fpic.png', '/api/image?path=logo.svg', 'https://example.com/a.png',
  ]);
  assert.equal(doc.querySelector('[onload]'), null);
});

test('虚拟文件复用 Markdown 渲染，但相对地址不会访问工作区文件', () => {
  const html = renderMarkdown('![内部](pic.png)\n\n[内部](other.md)\n\n[外部](https://example.com)\n\n[锚点](#title)', 'README.md', undefined, false);
  const doc = new dom.window.DOMParser().parseFromString(html, 'text/html');
  assert.equal(doc.querySelector('img')?.hasAttribute('src'), false);
  assert.equal(doc.querySelector('a')?.hasAttribute('href'), false);
  assert.equal(doc.querySelectorAll('a[href]').length, 2);
  assert.equal(doc.querySelector('[src^="/api/"]'), null);
});
