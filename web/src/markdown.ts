import { marked, Renderer, type TokensList } from 'marked';
import type { ReaderOutlineItem } from './readers/types.ts';
import DOMPurify from 'dompurify';
import { resolveImageSource } from './image.ts';
import { appendObsidianFootnotes, createObsidianContext, createObsidianMarked } from './markdown-obsidian.ts';

export function isMarkdownFile(path: string | null): boolean {
  return path !== null && /\.(md|markdown|mdown|mkdn|mkd)$/i.test(path);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 统一的 Markdown 清洗（复用文件预览同一套 DOMPurify 配置）。 */
function sanitizeMarkdown(
  html: string,
  allowRelativeLinks: boolean,
  documentPath?: string,
  imageVersion?: string,
): HTMLElement {
  const body = DOMPurify.sanitize(html, {
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
  return body;
}

export type InlineMarkdownOptions = {
  documentPath?: string;
  imageVersion?: string;
  allowRelativeLinks?: boolean;
  /** 自定义链接输出（终端把相对路径变成预览按钮）；返回 null 表示只保留文本。 */
  linkRenderer?: (href: string, labelHtml: string) => string | null;
};

/**
 * 行内 Markdown（终端逐行渲染复用）：marked 负责强调/删除线/代码/链接，
 * DOMPurify 负责清洗；原始 HTML 一律按文本显示，避免终端输出注入。
 */
export function renderMarkdownInline(source: string, options: InlineMarkdownOptions = {}): string {
  const renderer = new Renderer();
  renderer.html = ({ text }) => escapeHtml(text);
  if (options.linkRenderer) {
    renderer.link = function ({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      return options.linkRenderer!(href, label) ?? label;
    };
  }
  const html = marked.parseInline(source, { gfm: true, renderer }) as string;
  return sanitizeMarkdown(
    html,
    options.allowRelativeLinks !== false,
    options.documentPath,
    options.imageVersion,
  ).innerHTML;
}

function normalizeHeadingText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) => alias ?? target)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Slice the Markdown section headed by `heading` (used by Obsidian heading embeds). */
export function extractMarkdownSection(source: string, heading: string): string | null {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let start = 0;
  if (lines[0]?.trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[i])) { start = i + 1; break; }
    }
  }
  type Heading = { line: number; level: number; text: string };
  const headings: Heading[] = [];
  let fence: { char: string; size: number } | null = null;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.char && fenceMatch[1].length >= fence.size) fence = null;
      continue;
    }
    if (fenceMatch) { fence = { char: fenceMatch[1][0], size: fenceMatch[1].length }; continue; }
    const atx = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    if (atx) {
      headings.push({ line: i, level: atx[1].length, text: atx[2] });
      continue;
    }
    if (i > start && /^ {0,3}(=+|-+)[ \t]*$/.test(line) && lines[i - 1].trim() !== '') {
      headings.push({ line: i - 1, level: line.trim()[0] === '=' ? 1 : 2, text: lines[i - 1] });
      i++;
    }
  }
  if (headings.length === 0) return null;
  const parts = heading.split('#').map(normalizeHeadingText).filter(Boolean);
  if (parts.length === 0) return null;
  const full = parts.join('#');
  const last = parts.at(-1)!;
  const match = headings.find((item) => {
    const text = normalizeHeadingText(item.text);
    return text === full || text === last;
  });
  if (!match) return null;
  const end = headings.find((item) => item.line > match.line && item.level <= match.level)?.line ?? lines.length;
  return lines.slice(match.line, end).join('\n');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Slice the block carrying `^id` (used by Obsidian block embeds). */
export function extractMarkdownBlock(source: string, block: string): string | null {
  const id = block.trim();
  if (!id) return null;
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const inline = new RegExp(`[ \\t]\\^${escapeRegExp(id)}[ \\t]*$`);
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (inline.test(lines[i]) || lines[i].trim() === `^${id}`) { index = i; break; }
  }
  if (index < 0) return null;
  const standalone = lines[index].trim() === `^${id}`;
  const end = standalone ? index - 1 : index;
  if (end < 0) return null;
  let start = end;
  while (start > 0 && lines[start - 1].trim() !== '') start--;
  let stop = end + 1;
  while (stop < lines.length && lines[stop].trim() !== '') stop++;
  const blockLines = lines.slice(start, stop);
  if (standalone && blockLines.at(-1)?.trim() === `^${id}`) blockLines.pop();
  else if (blockLines.length) blockLines[blockLines.length - 1] = blockLines[blockLines.length - 1].replace(inline, '');
  const result = blockLines.join('\n').trimEnd();
  return result || null;
}

export function parseMarkdownDocument(
  source: string,
  documentPath?: string,
  imageVersion?: string,
  allowRelativeLinks = true,
  obsidian = false,
  withOutline = true,
) {
  source = source.replace(/\r\n?/g, '\n');
  const headingLines: number[] = [];
  let line = 0;
  let index = 0;
  let tokens: TokensList;
  let html: string;

  if (obsidian) {
    const context = createObsidianContext(documentPath, allowRelativeLinks);
    const md = createObsidianMarked(context);
    md.use({
      renderer: {
        heading({ depth, tokens }) {
          const content = this.parser.parseInline(tokens);
          return context.inFootnotes || !withOutline
            ? `<h${depth}>${content}</h${depth}>\n`
            : `<h${depth} data-md-heading="${index++}">${content}</h${depth}>\n`;
        },
      },
    });
    tokens = md.lexer(source);
    for (const token of tokens) {
      // Nested headings navigate to their containing source block when editing.
      md.walkTokens([token], (child) => { if (child.type === 'heading') headingLines.push(line); });
      line += token.raw.split('\n').length - 1;
    }
    html = md.parser(tokens) + appendObsidianFootnotes(md, context);
  } else {
    tokens = marked.lexer(source, { gfm: true });
    for (const token of tokens) {
      // Nested headings navigate to their containing source block when editing.
      marked.walkTokens([token], (child) => { if (child.type === 'heading') headingLines.push(line); });
      line += token.raw.split('\n').length - 1;
    }
    const renderer = new Renderer();
    renderer.heading = function ({ depth, tokens }) {
      return `<h${depth} data-md-heading="${index++}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    };
    html = marked.parser(tokens, { renderer, gfm: true });
  }

  const body = sanitizeMarkdown(html, allowRelativeLinks, documentPath, imageVersion);
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

export function renderMarkdown(
  source: string,
  documentPath?: string,
  imageVersion?: string,
  allowRelativeLinks = true,
  obsidian = false,
  withOutline = true,
): string {
  return parseMarkdownDocument(source, documentPath, imageVersion, allowRelativeLinks, obsidian, withOutline).html;
}
