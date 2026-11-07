// web/src/terminal/render.ts
// 把服务端下发的单元格网格渲染成 HTML。两种模式共用同一份屏幕缓存：
// - html：链接化文件路径、识别 Markdown（标题/列表/引用/代码围栏/内联样式）
// - text：经典等宽纯文字（保留 ANSI 颜色，不做链接/Markdown）
// 纯函数，便于 node:test 直接覆盖；DOM 更新在 views/terminal.tsx。

import type { ScreenCell } from '../../../shared/terminal/vt.ts';
import { splitLinks, type TermLink } from './linkify.ts';
import type { MarkdownBlock } from './markdown-blocks.ts';
import { renderMarkdownInline } from '../markdown.ts';

export type RenderMode = 'html' | 'text';

export type CursorInfo = {
  col: number;
  visible: boolean;
  shape: 'block' | 'underline' | 'bar';
  blinking?: boolean;
};

export type RenderOptions = {
  mode: RenderMode;
  /** 当前行是否启用 Markdown（活动输入行 / 全屏 TUI 关闭）。 */
  markdown?: boolean;
  /** 是否把路径/URL 变成可点击元素。 */
  linkify?: boolean;
  cursor?: CursorInfo;
  block?: MarkdownBlock;
};

type RunStyle = {
  key: string;
  classes: string[];
  color: string | null;
  background: string | null;
  underlineColor: string | null;
};

type Run = {
  text: string;
  style: RunStyle;
  url: string | null;
  cursor: boolean;
};

const ANSI_RGB = [
  '0,0,0', '128,0,0', '0,128,0', '128,128,0', '0,0,128', '128,0,128', '0,128,128', '192,192,192',
  '128,128,128', '255,0,0', '0,255,0', '255,255,0', '0,0,255', '255,0,255', '0,255,255', '255,255,255',
];
const ANSI_INDEX = new Map(ANSI_RGB.map((rgb, index) => [rgb, index]));

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function colorCss(color: { r: number; g: number; b: number } | null): string | null {
  if (!color) return null;
  const index = ANSI_INDEX.get(`${color.r},${color.g},${color.b}`);
  return index === undefined ? `rgb(${color.r}, ${color.g}, ${color.b})` : `var(--term-ansi-${index})`;
}

function safeUrl(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

function styleFor(cell: ScreenCell): RunStyle {
  const classes: string[] = [];
  const inverse = cell.inverse;
  const fg = cell.hidden ? 'transparent' : colorCss(inverse ? cell.bg : cell.fg);
  const bg = colorCss(inverse ? cell.fg : cell.bg);
  if (cell.bold) classes.push('term-bold');
  if (cell.faint) classes.push('term-faint');
  if (cell.italic) classes.push('term-italic');
  if (cell.underline !== 'none') classes.push(`term-underline-${cell.underline}`);
  if (cell.strikethrough) classes.push('term-strike');
  if (cell.overline) classes.push('term-overline');
  if (cell.blink) classes.push('term-blink');
  if (cell.hidden) classes.push('term-hidden');
  if (inverse) classes.push('term-inverse');
  const underlineColor = colorCss(cell.underlineColor);
  const key = `${classes.join(' ')}|${fg ?? ''}|${bg ?? ''}|${underlineColor ?? ''}`;
  return { key, classes, color: fg, background: bg, underlineColor };
}

function cursorColFor(cells: readonly ScreenCell[], col: number): number {
  if (cells.length === 0) return 0;
  let index = Math.max(0, Math.min(col, cells.length - 1));
  while (index > 0 && cells[index]?.char === '') index--;
  return index;
}

function buildRuns(cells: readonly ScreenCell[], cursor?: CursorInfo): Run[] {
  const runs: Run[] = [];
  const cursorAtEnd = !!cursor?.visible && cursor.col >= cells.length;
  const cursorCol = cursor?.visible && !cursorAtEnd ? cursorColFor(cells, cursor.col) : -1;
  const push = (run: Run) => {
    const previous = runs[runs.length - 1];
    if (previous && !previous.cursor && !run.cursor && previous.style.key === run.style.key && previous.url === run.url) {
      previous.text += run.text;
    } else {
      runs.push(run);
    }
  };

  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index];
    if (cell.char === '') continue; // 宽字符的占位单元格
    const style = styleFor(cell);
    const url = safeUrl(cell.url);
    if (index === cursorCol) {
      push({ text: cell.char || ' ', style, url, cursor: true });
    } else {
      push({ text: cell.char, style, url, cursor: false });
    }
  }
  if (cursorAtEnd) {
    const last = cells[cells.length - 1];
    const style = last ? styleFor(last) : { key: '', classes: [], color: null, background: null, underlineColor: null };
    push({ text: ' ', style, url: null, cursor: true });
  }

  // 去掉末尾没有背景色/光标的空白，避免每行都铺满整屏空格。
  while (runs.length > 0) {
    const last = runs[runs.length - 1];
    if (last.cursor || last.text.trim() !== '' || last.style.background || last.style.classes.includes('term-inverse')) break;
    runs.pop();
  }
  return runs;
}

function linkHtmlRaw(link: TermLink, labelHtml: string): string {
  if (link.kind === 'url') {
    return `<a class="term-url" href="${escapeAttr(link.url)}" target="_blank" rel="noopener noreferrer">${labelHtml}</a>`;
  }
  const line = link.line ? ` data-term-line="${link.line}"` : '';
  const column = link.column ? ` data-term-column="${link.column}"` : '';
  return `<button type="button" class="term-link" title="${escapeAttr(link.path)}" data-term-path="${escapeAttr(link.path)}"${line}${column}>${labelHtml}</button>`;
}

function linkHtml(link: TermLink, label: string): string {
  return linkHtmlRaw(link, escapeHtml(label));
}

/** 纯文本 + 链接（无 Markdown）。 */
export function plainWithLinks(text: string, linkify: boolean): string {
  if (!linkify) return escapeHtml(text);
  return splitLinks(text).map((part) => 'link' in part ? linkHtml(part.link, part.label) : escapeHtml(part.text)).join('');
}

// 私有区字符做占位符：marked 会原样保留，DOMPurify 也不会吞掉。
const PLACEHOLDER = /\uE000(\d+)\uE001/g;

function placeholder(index: number): string {
  return `\uE000${index}\uE001`;
}

function restorePlaceholders(html: string, placeholders: string[]): string {
  return html.replace(PLACEHOLDER, (_, index: string) => placeholders[Number(index)] ?? '');
}

function linkifySegment(text: string, linkify: boolean, placeholders: string[]): string {
  if (!linkify) return text;
  return splitLinks(text).map((part) => {
    if ('link' in part) return placeholder(placeholders.push(linkHtml(part.link, part.label)) - 1);
    return part.text;
  }).join('');
}

/** 保留已有占位符，只对纯文本段做路径链接化。 */
function linkifyPlaceholders(work: string, linkify: boolean, placeholders: string[]): string {
  let out = '';
  let last = 0;
  for (const match of work.matchAll(PLACEHOLDER)) {
    const index = match.index ?? 0;
    if (index > last) out += linkifySegment(work.slice(last, index), linkify, placeholders);
    out += match[0];
    last = index + match[0].length;
  }
  if (last < work.length) out += linkifySegment(work.slice(last), linkify, placeholders);
  return out;
}

/**
 * 行内 Markdown：复用项目 markdown.ts 的 marked + DOMPurify；
 * 终端只额外做两件事：保护代码/链接占位符，以及把路径变成预览按钮。
 */
export function inlineMarkdown(text: string, linkify: boolean): string {
  // 绝大多数终端行没有 Markdown 标记：跳过 marked/DOMPurify，直接转义+链接化。
  if (!/[*_`[<~]/.test(text)) return plainWithLinks(text, linkify);
  const placeholders: string[] = [];
  const store = (html: string) => placeholder(placeholders.push(html) - 1);

  let work = text.replace(/`([^`\n]+)`/g, (_, code: string) => {
    // 行内代码里如果整个内容就是一个路径，也让它可点（agent 常用 `src/foo.ts`）。
    const parts = splitLinks(code);
    if (parts.length === 1 && 'link' in parts[0]) return store(`<code>${linkHtml(parts[0].link, parts[0].label)}</code>`);
    return store(`<code>${escapeHtml(code)}</code>`);
  });
  work = work.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole, label: string, target: string) => {
    const parts = splitLinks(target);
    if (parts.length === 1 && 'link' in parts[0]) return store(linkHtml(parts[0].link, label));
    return whole;
  });
  work = linkifyPlaceholders(work, linkify, placeholders);

  const html = renderMarkdownInline(work, {
    linkRenderer: (href, labelHtml) => {
      const parts = splitLinks(href);
      if (parts.length !== 1 || !('link' in parts[0])) return null;
      return linkHtmlRaw(parts[0].link, labelHtml);
    },
  });
  return restorePlaceholders(html, placeholders);
}

function gridRow(cells: readonly ScreenCell[], options: RenderOptions): string {
  const runs = buildRuns(cells, options.cursor);
  return runs.map((run) => {
    let inner: string;
    if (run.url) {
      inner = `<a class="term-url term-osc-url" href="${escapeAttr(run.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(run.text)}</a>`;
    } else if (options.markdown) {
      inner = inlineMarkdown(run.text, options.linkify === true);
    } else {
      inner = plainWithLinks(run.text, options.linkify === true);
    }
    if (run.cursor) {
      const shape = options.cursor?.shape ?? 'block';
      const blink = options.cursor?.blinking ? ' term-cursor-blink' : '';
      inner = `<span class="term-cursor term-cursor-${shape}${blink}">${inner || ' '}</span>`;
    }
    if (run.style.classes.length === 0 && !run.style.color && !run.style.background && !run.style.underlineColor) return inner;
    const style: string[] = [];
    if (run.style.color) style.push(`color:${run.style.color}`);
    if (run.style.background) style.push(`background-color:${run.style.background}`);
    if (run.style.underlineColor) style.push(`text-decoration-color:${run.style.underlineColor}`);
    return `<span class="${run.style.classes.join(' ')}"${style.length ? ` style="${style.join(';')}"` : ''}>${inner}</span>`;
  }).join('');
}

function markdownRow(block: MarkdownBlock, options: RenderOptions): string {
  const linkify = options.linkify === true;
  switch (block.kind) {
    case 'heading':
      return `<span class="term-md-heading term-md-h${block.level}">${inlineMarkdown(block.text, linkify)}</span>`;
    case 'list':
      return `<span class="term-md-bullet">${escapeHtml(block.prefix)}</span>${inlineMarkdown(block.text, linkify)}`;
    case 'quote':
      return `<span class="term-md-quote-text">${inlineMarkdown(block.text, linkify)}</span>`;
    case 'code':
      return plainWithLinks(block.text, linkify);
    case 'hr':
      return '<hr class="term-md-hr" />';
    case 'fence':
      return '';
    default:
      return '';
  }
}

/** 一行的 HTML。活动输入行/TUI 行由调用方传 markdown:false。 */
export function renderRow(cells: readonly ScreenCell[], options: RenderOptions): string {
  if (options.mode === 'text') return gridRow(cells, { ...options, markdown: false, linkify: false });
  const block = options.block ?? { kind: 'normal' };
  // 代码块保留 ANSI 语法高亮，只做链接化；其余 Markdown 块交给 marked。
  if (block.kind === 'code') return gridRow(cells, { ...options, markdown: false });
  if (block.kind !== 'normal') return markdownRow(block, options);
  return gridRow(cells, options);
}

/** 行容器的 class：决定 pre / pre-wrap、Markdown 块样式。 */
export function rowClass(block: MarkdownBlock, options: RenderOptions): string {
  if (options.mode === 'text') return 'term-row term-row-text';
  switch (block.kind) {
    case 'heading': return `term-row term-row-md term-row-md-h${block.level}`;
    case 'list': return 'term-row term-row-md term-row-md-list';
    case 'quote': return 'term-row term-row-md term-row-md-quote';
    case 'code': return 'term-row term-row-md term-row-md-code';
    case 'fence': return 'term-row term-row-md term-row-md-fence';
    case 'hr': return 'term-row term-row-md term-row-md-hr';
    default: return `term-row ${options.markdown ? 'term-row-html' : 'term-row-grid'}`;
  }
}

/** 单元格行 → 纯文本（去掉末尾空白），供 Markdown 分类。 */
export function rowText(cells: readonly ScreenCell[]): string {
  let end = cells.length;
  while (end > 0 && (cells[end - 1].char === '' || cells[end - 1].char === ' ')) end--;
  let text = '';
  for (let index = 0; index < end; index++) {
    const cell = cells[index];
    if (cell.char !== '') text += cell.char;
  }
  return text;
}
