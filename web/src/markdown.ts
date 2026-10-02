import { marked, Renderer } from 'marked';
import type { ReaderOutlineItem } from './readers/types.ts';
import DOMPurify from 'dompurify';
import { resolveImageSource } from './image.ts';

export function isMarkdownFile(path: string | null): boolean {
  return path !== null && /\.(md|markdown|mdown|mkdn|mkd)$/i.test(path);
}

export function parseMarkdownDocument(source: string, documentPath?: string, imageVersion?: string, allowRelativeLinks = true) {
  source = source.replace(/\r\n?/g, '\n');
  const tokens = marked.lexer(source, { gfm: true });
  const headingLines: number[] = [];
  let line = 0;
  for (const token of tokens) {
    // Nested headings navigate to their containing source block when editing.
    marked.walkTokens([token], (child) => { if (child.type === 'heading') headingLines.push(line); });
    line += token.raw.split('\n').length - 1;
  }
  let index = 0;
  const renderer = new Renderer();
  renderer.heading = function ({ depth, tokens }) {
    return `<h${depth} data-md-heading="${index++}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
  };
  const body = DOMPurify.sanitize(marked.parser(tokens, { renderer, gfm: true }), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form'],
    FORBID_ATTR: ['style'],
    RETURN_DOM: true,
  }) as HTMLElement;
  // Virtual archive paths must never resolve to unrelated workspace files.
  if (!allowRelativeLinks) for (const element of body.querySelectorAll('img[src],a[href]')) {
    const attribute = element.tagName === 'IMG' ? 'src' : 'href';
    if (!/^(?:https?:|data:|#)/i.test(element.getAttribute(attribute) ?? '')) element.removeAttribute(attribute);
  }
  if (allowRelativeLinks && documentPath) for (const img of body.querySelectorAll('img[src]')) {
    img.setAttribute('src', resolveImageSource(img.getAttribute('src')!, documentPath, imageVersion));
  }
  const outline: ReaderOutlineItem[] = [], lines = new Map<string, number>();
  const parents: { depth: number; item: ReaderOutlineItem }[] = [];
  for (const heading of body.querySelectorAll<HTMLElement>('h1[data-md-heading],h2[data-md-heading],h3[data-md-heading],h4[data-md-heading],h5[data-md-heading],h6[data-md-heading]')) {
    const id = heading.dataset.mdHeading!, depth = Number(heading.tagName[1]);
    const item: ReaderOutlineItem = { id, title: heading.textContent ?? '', navigable: true, children: [] };
    while (parents.length && parents.at(-1)!.depth >= depth) parents.pop();
    (parents.at(-1)?.item.children ?? outline).push(item);
    parents.push({ depth, item });
    lines.set(id, headingLines[Number(id)] ?? 0);
  }
  return { html: body.innerHTML, outline, lines };
}

export function renderMarkdown(source: string, documentPath?: string, imageVersion?: string, allowRelativeLinks = true): string {
  return parseMarkdownDocument(source, documentPath, imageVersion, allowRelativeLinks).html;
}
