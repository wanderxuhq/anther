import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('');
Object.assign(globalThis, { window: dom.window });
const { extractMarkdownBlock, extractMarkdownSection, isMarkdownFile, renderMarkdown, parseMarkdownDocument } = await import('./markdown.ts');
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


test('未启用 Obsidian 时保持现有 GFM 行为', () => {
  const html = renderMarkdown('[[Note]]\n\n==hi==\n\n> [!note] title');
  assert.match(html, /\[\[Note\]\]/);
  assert.match(html, /==hi==/);
  assert.doesNotMatch(html, /obsidian-/);
});

test('Obsidian 模式识别 frontmatter、wikilink、highlight、注释、tag 和 callout', () => {
  const html = renderMarkdown([
    '---', 'title: x', '---', '',
    '# Head', '',
    '[[Note|Alias]] ![[pic.png]] #tag #1984 ==hi== %%hidden%%', '',
    '> [!warning]- Folded', '> body **bold**',
  ].join('\n'), 'docs/README.md', undefined, true, true);
  assert.match(html, /<div class="obsidian-properties">/);
  assert.match(html, /<span class="obsidian-property-key">title<\/span>/);
  assert.doesNotMatch(html, /title: x/);
  assert.match(html, /<h1 data-md-heading="0">Head<\/h1>/);
  assert.match(html, /<span class="obsidian-wikilink"[^>]*data-obsidian-link="Note">Alias<\/span>/);
  assert.match(html, /<img class="obsidian-embed-image" src="\/api\/image\?path=docs%2Fpic\.png"/);
  assert.match(html, /<span class="obsidian-tag"[^>]*data-obsidian-tag="tag">#tag<\/span>/);
  assert.doesNotMatch(html, /#1984<\/span>/);
  assert.match(html, /<mark>hi<\/mark>/);
  assert.doesNotMatch(html, /hidden/);
  assert.match(html, /<details class="obsidian-callout obsidian-callout-warning"/);
  assert.match(html, /<summary class="obsidian-callout-title">Folded<\/summary>/);
  assert.doesNotMatch(html, /<details[^>]* open/);
  assert.match(html, /<strong>bold<\/strong>/);
});

test('Obsidian properties 面板显示普通值、列表、tag 和 wikilink', () => {
  const html = renderMarkdown([
    '---',
    'title: Hello',
    'tags:',
    '  - one',
    '  - two',
    'aliases: [A, B]',
    'draft: false',
    'link: "[[Note]]"',
    '---',
    '',
    '# Head',
  ].join('\n'), 'docs/a.md', undefined, true, true);
  const doc = new dom.window.DOMParser().parseFromString(html, 'text/html');
  assert.ok(doc.querySelector('.obsidian-properties'));
  assert.deepEqual([...doc.querySelectorAll('.obsidian-property-key')].map((node) => node.textContent),
    ['title', 'tags', 'aliases', 'draft', 'link']);
  assert.equal(doc.querySelectorAll('[data-obsidian-tag]').length, 2);
  assert.equal(doc.querySelector('[data-obsidian-link="Note"]')?.textContent, 'Note');
});

test('Obsidian 模式渲染脚注并把定义移到文末', () => {
  const html = renderMarkdown('Text[^1] and ^[inline]\n\n[^1]: note **bold**', undefined, undefined, true, true);
  assert.match(html, /class="obsidian-footnote-ref" data-footnote="1"/);
  assert.match(html, /class="obsidian-footnote-ref" data-footnote="2"/);
  assert.match(html, /<section class="obsidian-footnotes">/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.doesNotMatch(html, /href="note"/);
});

test('Obsidian 脚注按首次引用顺序编号，而不是定义顺序', () => {
  const html = renderMarkdown('A[^x] B[^y]\n\n[^y]: y note\n[^x]: x note', undefined, undefined, true, true);
  assert.match(html, /A\s*<sup class="obsidian-footnote-ref" data-footnote="1">1<\/sup>/);
  assert.match(html, /B<sup class="obsidian-footnote-ref" data-footnote="2">2<\/sup>/);
  assert.match(html, /<li id="fn-1"><p>x note<\/p>/);
  assert.match(html, /<li id="fn-2"><p>y note<\/p>/);
});

test('Obsidian 扩展不进入代码块和行内代码', () => {
  const html = renderMarkdown('`[[Note]] ==x== %%c%% #tag`\n\n```\n[[Note]] ==x==\n> [!note] nope\n%%c%%\n```', undefined, undefined, true, true);
  assert.doesNotMatch(html, /obsidian-wikilink|obsidian-tag|obsidian-callout|<mark>/);
  assert.match(html, /\[\[Note\]\] ==x==/);
});

test('Obsidian 笔记嵌入生成块占位，图片嵌入仍走图片路径', () => {
  const html = renderMarkdown('![[Note]]\n\n![[pic.png]]', 'docs/README.md', undefined, true, true);
  assert.match(html, /<div class="obsidian-embed-note" data-obsidian-embed="Note" data-obsidian-from="docs\/README.md">/);
  assert.match(html, /<img class="obsidian-embed-image"/);
});

test('Obsidian 嵌入渲染可以关闭 outline 锚点', () => {
  const html = renderMarkdown('# Embedded\n\n## Sub', 'Note.md', undefined, true, true, false);
  assert.match(html, /<h1>Embedded<\/h1>/);
  assert.match(html, /<h2>Sub<\/h2>/);
  assert.doesNotMatch(html, /data-md-heading/);
});

test('Obsidian 数学只匹配合法行内/块公式，不误伤货币和代码', () => {
  const inline = renderMarkdown('Inline $x^2$ and $5 and $10', undefined, undefined, true, true);
  assert.match(inline, /class="obsidian-math" data-math="x%5E2"/);
  assert.doesNotMatch(inline, /data-math="5/);
  const block = renderMarkdown('$$\nx^2 + y\n$$', undefined, undefined, true, true);
  assert.match(block, /class="obsidian-math-block" data-math="x%5E2%20%2B%20y" data-math-display="1"/);
  const code = renderMarkdown('`$x$`\n\n```\n$$\ny\n$$\n```', undefined, undefined, true, true);
  assert.doesNotMatch(code, /data-math=/);
});

test('Obsidian Mermaid 代码块生成可水合的图表占位', () => {
  const html = renderMarkdown('```mermaid\ngraph TD\nA --> B\n```', undefined, undefined, true, true);
  const doc = new dom.window.DOMParser().parseFromString(html, 'text/html');
  const node = doc.querySelector('.obsidian-mermaid');
  assert.ok(node);
  assert.equal(decodeURIComponent(node.getAttribute('data-mermaid')!), 'graph TD\nA --> B');
  assert.ok(doc.querySelector('.obsidian-mermaid-source'));
  assert.equal(doc.querySelector('.language-mermaid'), null);
});

test('Obsidian 虚拟文件不生成可点击的 wikilink', () => {
  const html = renderMarkdown('[[Note|Alias]]', 'README.md', undefined, false, true);
  assert.match(html, /<span class="obsidian-wikilink">Alias<\/span>/);
  assert.doesNotMatch(html, /data-obsidian-link/);
});

test('Obsidian 模式隐藏 block id 但保留锚点，表格内转义竖线的 wikilink 正常解析', () => {
  const html = renderMarkdown('A paragraph ^block-id\n\n^my-list\n\n| Col |\n| --- |\n| [[Note\\|Alias]] |', undefined, undefined, true, true);
  assert.match(html, /id="\^block-id"/);
  assert.match(html, /id="\^my-list"/);
  assert.doesNotMatch(html, />\s*(?:block-id|my-list)\s*</);
  assert.match(html, /<td><span class="obsidian-wikilink"[^>]*data-obsidian-link="Note">Alias<\/span><\/td>/);
});

test('Obsidian outline keeps source lines after hidden frontmatter', () => {
  const parsed = parseMarkdownDocument('---\ntitle: x\n---\n\n# Body\n\n## Sub', undefined, undefined, true, true);
  assert.deepEqual([...parsed.lines], [['0', 4], ['1', 6]]);
  assert.deepEqual(parsed.outline.map((item) => item.title), ['Body']);
  assert.deepEqual(parsed.outline[0].children.map((item) => item.title), ['Sub']);
});

test('extractMarkdownSection 按标题层级截取并跳过代码围栏中的伪标题', () => {
  const source = '# One\n\nA\n\n## Two\n\nB\n\n```md\n# Hidden\n```\n\n# Three\n\nC';
  assert.equal(extractMarkdownSection(source, 'Two')?.trimEnd(), '## Two\n\nB\n\n```md\n# Hidden\n```');
  assert.equal(extractMarkdownSection(source, 'One')?.trimEnd(), '# One\n\nA\n\n## Two\n\nB\n\n```md\n# Hidden\n```');
  assert.equal(extractMarkdownSection(source, 'Missing'), null);
  const setext = 'Title\n=====\n\nBody\n\nSub\n---\n\nMore';
  assert.equal(extractMarkdownSection(setext, 'Title')?.trimEnd(), setext);
  assert.equal(extractMarkdownSection(setext, 'Sub')?.trimEnd(), 'Sub\n---\n\nMore');
  assert.equal(extractMarkdownSection('---\ntitle: x\n---\n\n# H\n\nBody', 'H')?.trimEnd(), '# H\n\nBody');
});

test('extractMarkdownBlock 截取 block id 所在的段落', () => {
  assert.equal(extractMarkdownBlock('A paragraph ^block-id\n\nAnother', 'block-id'), 'A paragraph');
  assert.equal(extractMarkdownBlock('Before\n\n^block-id\n\nAfter', 'block-id'), 'Before');
  assert.equal(extractMarkdownBlock('A paragraph ^block-id\n\nAnother', 'missing'), null);
});

test('Markdown outline follows heading depth, ignores fenced code and assigns distinct destinations to duplicate titles', () => {
  const source = '# **Title**\r\n\r\n```md\r\n# Hidden\r\n```\r\n\r\n### [Same](https://example.com)\r\n\r\n## Same\r\n\r\nLast\r\n====\r\n';
  const parsed = parseMarkdownDocument(source);
  assert.deepEqual(parsed.outline, [
    { id: '0', title: 'Title', navigable: true, children: [
      { id: '1', title: 'Same', navigable: true, children: [] },
      { id: '2', title: 'Same', navigable: true, children: [] },
    ] },
    { id: '3', title: 'Last', navigable: true, children: [] },
  ]);
  assert.deepEqual([...parsed.lines], [['0', 0], ['1', 6], ['2', 8], ['3', 10]]);
  const doc = new dom.window.DOMParser().parseFromString(parsed.html, 'text/html');
  assert.deepEqual([...doc.querySelectorAll('[data-md-heading]')].map((node) => node.getAttribute('data-md-heading')), ['0', '1', '2', '3']);
});
