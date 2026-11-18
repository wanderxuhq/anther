// web/src/markdown-obsidian.ts
// Obsidian Flavored Markdown extensions layered on marked.
//
// The extensions are intentionally opt-in: `parseMarkdownDocument(..., obsidian)`
// only creates this parser when the workspace root contains `.obsidian`. Keeping
// the markers additive means ordinary GFM documents keep their current output.
import {
  Marked,
  type RendererThis,
  type Token,
  type TokenizerThis,
  type Tokens,
} from 'marked';
import { isImageFile } from './image.ts';

export type FootnoteDefinition = { label: string; tokens: Token[] };

export type ObsidianContext = {
  documentPath?: string;
  allowRelativeLinks: boolean;
  footnotes: FootnoteDefinition[];
  footnoteLabels: Set<string>;
  /** Numbers follow first reference order, as in Obsidian, not definition order. */
  footnoteNumbers: Map<string, number>;
  /** True while footnote definitions are rendered; suppresses outline anchors. */
  inFootnotes: boolean;
};

export function createObsidianContext(
  documentPath: string | undefined,
  allowRelativeLinks: boolean,
): ObsidianContext {
  return {
    documentPath,
    allowRelativeLinks,
    footnotes: [],
    footnoteLabels: new Set(),
    footnoteNumbers: new Map(),
    inFootnotes: false,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const found = (index: number): number | undefined => index >= 0 ? index : undefined;

function blockStart(src: string, starts: (value: string) => number, midline: string): number | undefined {
  if (starts(src)) return 0;
  const index = src.indexOf(midline);
  return found(index);
}

function stripYamlQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function splitYamlList(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const char of value) {
    if (quote) {
      if (char === quote) quote = null;
      current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === ',') {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

type PropertyValue = string | string[];
type Property = { key: string; value: PropertyValue };

function parsePropertyValue(value: string): PropertyValue {
  const trimmed = value.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return splitYamlList(trimmed.slice(1, -1)).map(stripYamlQuotes).filter(Boolean);
  }
  return stripYamlQuotes(trimmed);
}

/** Parse the top-level YAML keys Obsidian shows in the properties panel. */
function parseProperties(raw: string): Property[] {
  const lines = raw.split('\n');
  if (lines[0]?.trim() !== '---') return [];
  let end = lines.length;
  for (let i = lines.length - 1; i >= 1; i--) {
    if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[i])) { end = i; break; }
  }
  const properties: Property[] = [];
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^([^:\s][^:]*):[ \t]*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].trim();
    const rest = match[2].trim();
    if (rest) {
      properties.push({ key, value: parsePropertyValue(rest) });
      continue;
    }
    const values: string[] = [];
    let j = i + 1;
    for (; j < end; j++) {
      const itemLine = lines[j];
      if (!itemLine.trim() || !/^[ \t]/.test(itemLine)) break;
      const item = /^[ \t]*-[ \t]*(.*?)[ \t]*$/.exec(itemLine);
      values.push(item ? stripYamlQuotes(item[1]) : itemLine.trim());
    }
    properties.push({ key, value: values.length ? values : '' });
    i = j - 1;
  }
  return properties;
}

/** Obsidian's default `.obsidian` config folder is a vault marker, not syntax. */
export function createObsidianMarked(context: ObsidianContext): Marked {
  const md = new Marked({ gfm: true });

  const frontmatter = {
    name: 'obsidianFrontmatter',
    level: 'block' as const,
    start(src: string) { return src.startsWith('---') ? 0 : undefined; },
    tokenizer(src: string) {
      if (!src.startsWith('---')) return;
      const lines = src.split('\n');
      if (lines[0].trim() !== '---') return;
      let end = -1;
      for (let i = 1; i < lines.length; i++) {
        if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[i])) { end = i; break; }
      }
      if (end < 0) return;
      const raw = lines.slice(0, end + 1).join('\n') + (end + 1 < lines.length ? '\n' : '');
      return { type: 'obsidianFrontmatter', raw };
    },
    renderer(token: Tokens.Generic) {
      const properties = parseProperties(String(token.raw));
      if (properties.length === 0) return '';
      const tag = (value: string): string => {
        const name = value.replace(/^#/, '');
        return context.allowRelativeLinks
          ? `<span class="obsidian-tag" role="link" tabindex="0" data-obsidian-tag="${escapeHtml(name)}">#${escapeHtml(name)}</span>`
          : `<span class="obsidian-tag">#${escapeHtml(name)}</span>`;
      };
      const text = (value: string): string => {
        let result = escapeHtml(value);
        result = result.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) => {
          const label = alias ?? target;
          return context.allowRelativeLinks
            ? `<span class="obsidian-wikilink" role="link" tabindex="0" data-obsidian-link="${target}">${label}</span>`
            : `<span class="obsidian-wikilink">${label}</span>`;
        });
        return result.replace(/(https?:\/\/[^\s<]+)/g,
          (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
      };
      const value = (key: string, input: PropertyValue): string => {
        if (key.toLowerCase() === 'tags') {
          const tags = Array.isArray(input) ? input : input ? input.split(/[,\s]+/).filter(Boolean) : [];
          return tags.map(tag).join(' ');
        }
        if (Array.isArray(input)) {
          if (input.length === 0) return '';
          return `<span class="obsidian-property-list">${input.map((item) =>
            `<span class="obsidian-property-item">${text(item)}</span>`).join('')}</span>`;
        }
        return input ? text(input) : '';
      };
      return `<div class="obsidian-properties">${properties.map((property) => {
        const content = value(property.key, property.value);
        return `<div class="obsidian-property">`
          + `<span class="obsidian-property-key">${escapeHtml(property.key)}</span>`
          + `<span class="obsidian-property-value">${content || '<span class="obsidian-property-empty">—</span>'}</span>`
          + `</div>`;
      }).join('')}</div>`;
    },
  };

  const blockComment = {
    name: 'obsidianCommentBlock',
    level: 'block' as const,
    start(src: string) {
      if (src.startsWith('%%')) return 0;
      const index = src.indexOf('\n%%');
      return index >= 0 ? index + 1 : undefined;
    },
    tokenizer(src: string) {
      if (!src.startsWith('%%')) return;
      const end = src.indexOf('%%', 2);
      if (end < 0) return;
      let raw = src.slice(0, end + 2);
      if (src[end + 2] === '\n') raw += '\n';
      return { type: 'obsidianCommentBlock', raw };
    },
    renderer() { return ''; },
  };

  const footnoteDefinition = {
    name: 'obsidianFootnoteDefinition',
    level: 'block' as const,
    start(src: string) {
      if (context.inFootnotes) return;
      return blockStart(src, (value) => value.startsWith('[^') ? 1 : 0, '\n[^');
    },
    tokenizer(this: TokenizerThis, src: string) {
      if (context.inFootnotes || !src.startsWith('[^')) return;
      const lines = src.split('\n');
      const first = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/.exec(lines[0]);
      if (!first) return;
      let end = 1;
      while (end < lines.length && /^(?:[ \t]{2,}|\t)/.test(lines[end]) && lines[end].trim() !== '') end++;
      const raw = lines.slice(0, end).join('\n') + (end < lines.length ? '\n' : '');
      const body = [first[2], ...lines.slice(1, end).map((line) => line.replace(/^(?:[ \t]{2,}|\t)/, ''))].join('\n');
      if (!context.footnoteLabels.has(first[1])) {
        context.footnoteLabels.add(first[1]);
        context.footnotes.push({ label: first[1], tokens: this.lexer.blockTokens(body) });
      }
      return { type: 'obsidianFootnoteDefinition', raw, label: first[1] };
    },
    renderer() { return ''; },
  };

  const blockId = {
    name: 'obsidianBlockId',
    level: 'block' as const,
    start(src: string) {
      if (/^\^[A-Za-z0-9-]+[ \t]*(?:\n|$)/.test(src)) return 0;
      return found(src.indexOf('\n^'));
    },
    tokenizer(src: string) {
      const match = /^\^([A-Za-z0-9-]+)[ \t]*(?:\n|$)/.exec(src);
      if (!match) return;
      return { type: 'obsidianBlockId', raw: match[0], id: match[1] };
    },
    renderer(token: Tokens.Generic) {
      return `<span id="^${escapeHtml(String(token.id))}" class="obsidian-block-ref"></span>`;
    },
  };



  const mathBlock = {
    name: 'obsidianMathBlock',
    level: 'block' as const,
    start(src: string) {
      if (src.startsWith('$$')) return 0;
      const index = src.indexOf('\n$$');
      return index >= 0 ? index + 1 : undefined;
    },
    tokenizer(src: string) {
      const multiline = /^\$\$[ \t]*\n([\s\S]*?)\n\$\$[ \t]*(?:\n|$)/.exec(src);
      const singleline = /^\$\$([^\n]*?)\$\$[ \t]*(?:\n|$)/.exec(src);
      const match = multiline ?? singleline;
      if (!match) return;
      return { type: 'obsidianMathBlock', raw: match[0], tex: match[1].trim() };
    },
    renderer(token: Tokens.Generic) {
      const tex = String(token.tex);
      return `<div class="obsidian-math-block" data-math="${escapeHtml(encodeURIComponent(tex))}" data-math-display="1">`
        + `<pre class="obsidian-math-source">${escapeHtml(tex)}</pre></div>`;
    },
  };

  const mathInline = {
    name: 'obsidianMathInline',
    level: 'inline' as const,
    start(src: string) {
      const match = /(^|[^\\$])\$(?!\$)(?=\S)/.exec(src);
      return match ? match.index + match[1].length : undefined;
    },
    tokenizer(src: string) {
      const match = /^\$(?!\$)([^\n$]*?\S)\$(?!\$)/.exec(src);
      if (!match) return;
      return { type: 'obsidianMathInline', raw: match[0], tex: match[1] };
    },
    renderer(token: Tokens.Generic) {
      const tex = String(token.tex);
      return `<span class="obsidian-math" data-math="${escapeHtml(encodeURIComponent(tex))}">`
        + `<span class="obsidian-math-source">$${escapeHtml(tex)}$</span></span>`;
    },
  };

  const noteEmbed = {
    name: 'obsidianNoteEmbed',
    level: 'block' as const,
    start(src: string) {
      const match = /^!\[\[/m.exec(src);
      return match ? match.index : undefined;
    },
    tokenizer(src: string) {
      const match = /^!\[\[([^\]\n]+?)\]\][ \t]*(?:\n|$)/.exec(src);
      if (!match) return;
      const body = match[1];
      const pipe = body.indexOf('|');
      const rawTarget = pipe >= 0 ? body.slice(0, pipe) : body;
      const target = rawTarget.replace(/\\\|/g, '|').trim();
      if (!target) return;
      const filePart = target.split('#')[0];
      if (/\.[^./]+$/.test(filePart) && !/\.(?:md|markdown|mdown|mkdn|mkd)$/i.test(filePart)) return;
      const rawLabel = pipe >= 0 ? body.slice(pipe + 1) : rawTarget;
      return {
        type: 'obsidianNoteEmbed',
        raw: match[0],
        target,
        label: rawLabel.replace(/\\\|/g, '|').trim() || target,
      };
    },
    renderer(token: Tokens.Generic) {
      const target = String(token.target);
      const label = String(token.label || token.target);
      const interactive = context.allowRelativeLinks
        ? ` role="link" tabindex="0" data-obsidian-link="${escapeHtml(target)}"`
        : '';
      return `<div class="obsidian-embed-note" data-obsidian-embed="${escapeHtml(target)}" data-obsidian-from="${escapeHtml(context.documentPath ?? '')}">`
        + `<span class="obsidian-embed"${interactive}>${escapeHtml(label)}</span></div>`;
    },
  };

  const callout = {
    name: 'obsidianCallout',
    level: 'block' as const,
    childTokens: ['tokens'],
    start(src: string) {
      const match = /^[ \t]*> \[!/m.exec(src);
      return match ? match.index : undefined;
    },
    tokenizer(this: TokenizerThis, src: string) {
      const newline = src.indexOf('\n');
      const firstLine = newline < 0 ? src : src.slice(0, newline);
      const first = /^[ \t]*> \[!([^\]]+)\]([+-]?)[ \t]*(.*)$/.exec(firstLine);
      if (!first) return;
      const lines = src.split('\n');
      let end = 1;
      while (end < lines.length && /^[ \t]*>/.test(lines[end])) end++;
      const rawLines = lines.slice(0, end);
      const body = rawLines.slice(1).map((line) => line.replace(/^[ \t]*> ?/, '')).join('\n');
      return {
        type: 'obsidianCallout',
        raw: rawLines.join('\n') + (end < lines.length ? '\n' : ''),
        calloutType: first[1].toLowerCase(),
        fold: first[2],
        titleTokens: this.lexer.inlineTokens(first[3]),
        tokens: this.lexer.blockTokens(body),
      };
    },
    renderer(this: RendererThis, token: Tokens.Generic): string {
      const type = String(token.calloutType).replace(/[^a-z0-9_-]/g, '') || 'note';
      const title = token.titleTokens?.length
        ? this.parser.parseInline(token.titleTokens as Token[])
        : escapeHtml(type.charAt(0).toUpperCase() + type.slice(1));
      const content = this.parser.parse(token.tokens as Token[]);
      if (token.fold) {
        return `<details class="obsidian-callout obsidian-callout-${type}"${token.fold === '+' ? ' open' : ''}>`
          + `<summary class="obsidian-callout-title">${title}</summary>`
          + `<div class="obsidian-callout-content">${content}</div></details>`;
      }
      return `<div class="obsidian-callout obsidian-callout-${type}">`
        + `<div class="obsidian-callout-title">${title}</div>`
        + `<div class="obsidian-callout-content">${content}</div></div>`;
    },
  };

  const inlineComment = {
    name: 'obsidianCommentInline',
    level: 'inline' as const,
    start(src: string) { return found(src.indexOf('%%')); },
    tokenizer(src: string) {
      const match = /^%%[^\n]*?%%/.exec(src);
      if (!match) return;
      return { type: 'obsidianCommentInline', raw: match[0] };
    },
    renderer() { return ''; },
  };

  const wikilink = {
    name: 'obsidianWikilink',
    level: 'inline' as const,
    start(src: string) {
      const match = /!?\[\[/.exec(src);
      return match ? match.index : undefined;
    },
    tokenizer(src: string) {
      const match = /^(!?)\[\[([^\]\n]+?)\]\]/.exec(src);
      if (!match) return;
      const body = match[2];
      const pipe = body.indexOf('|');
      const rawTarget = pipe >= 0 ? body.slice(0, pipe) : body;
      const rawLabel = pipe >= 0 ? body.slice(pipe + 1) : rawTarget;
      return {
        type: 'obsidianWikilink',
        raw: match[0],
        embed: match[1] === '!',
        target: rawTarget.replace(/\\\|/g, '|').trim(),
        label: rawLabel.replace(/\\\|/g, '|').trim(),
      };
    },
    renderer(token: Tokens.Generic) {
      const target = String(token.target);
      const label = String(token.label || token.target);
      if (token.embed) {
        const path = target.split('#')[0];
        if (context.allowRelativeLinks && context.documentPath && isImageFile(path)) {
          const size = /^(\d+)(?:x(\d+))?$/.exec(label);
          const width = size ? ` width="${size[1]}"` : '';
          const height = size?.[2] ? ` height="${size[2]}"` : '';
          const alt = path.slice(path.lastIndexOf('/') + 1);
          return `<img class="obsidian-embed-image" src="${escapeHtml(path)}" alt="${escapeHtml(alt)}"${width}${height}>`;
        }
        const interactive = context.allowRelativeLinks
          ? ` role="link" tabindex="0" data-obsidian-link="${escapeHtml(target)}"`
          : '';
        return `<span class="obsidian-embed"${interactive}>${escapeHtml(label)}</span>`;
      }
      const interactive = context.allowRelativeLinks
        ? ` role="link" tabindex="0" data-obsidian-link="${escapeHtml(target)}"`
        : '';
      return `<span class="obsidian-wikilink"${interactive}>${escapeHtml(label)}</span>`;
    },
  };

  const footnoteReference = {
    name: 'obsidianFootnoteReference',
    level: 'inline' as const,
    start(src: string) { return found(src.indexOf('[^')); },
    tokenizer(src: string) {
      const match = /^\[\^([^\]\s]+)\]/.exec(src);
      if (!match) return;
      return { type: 'obsidianFootnoteReference', raw: match[0], label: match[1] };
    },
    renderer(token: Tokens.Generic) {
      const label = String(token.label);
      let number = context.footnoteNumbers.get(label);
      if (!number) {
        if (!context.footnoteLabels.has(label)) return escapeHtml(String(token.raw));
        number = context.footnoteNumbers.size + 1;
        context.footnoteNumbers.set(label, number);
      }
      return `<sup class="obsidian-footnote-ref" data-footnote="${number}">${number}</sup>`;
    },
  };

  const inlineFootnote = {
    name: 'obsidianInlineFootnote',
    level: 'inline' as const,
    start(src: string) { return found(src.indexOf('^[')); },
    tokenizer(this: TokenizerThis, src: string) {
      const match = /^\^\[([^\]\n]*)\]/.exec(src);
      if (!match) return;
      const number = context.footnoteNumbers.size + 1;
      const label = `inline-${number}`;
      context.footnoteLabels.add(label);
      context.footnoteNumbers.set(label, number);
      context.footnotes.push({ label, tokens: this.lexer.blockTokens(match[1]) });
      return { type: 'obsidianInlineFootnote', raw: match[0], number };
    },
    renderer(token: Tokens.Generic): string {
      return `<sup class="obsidian-footnote-ref" data-footnote="${token.number}">${token.number}</sup>`;
    },
  };

  const highlight = {
    name: 'obsidianHighlight',
    level: 'inline' as const,
    start(src: string) { return found(src.indexOf('==')); },
    tokenizer(this: TokenizerThis, src: string) {
      const match = /^==(?=\S)([^\n]*?\S)==/.exec(src);
      if (!match) return;
      return { type: 'obsidianHighlight', raw: match[0], tokens: this.lexer.inlineTokens(match[1]) };
    },
    renderer(this: RendererThis, token: Tokens.Generic): string {
      return `<mark>${this.parser.parseInline(token.tokens as Token[])}</mark>`;
    },
  };

  const tag = {
    name: 'obsidianTag',
    level: 'inline' as const,
    start(src: string) {
      const match = /(?:^|[\s(])#[\p{L}\p{N}_/-]/u.exec(src);
      return match ? match.index + (match[0][0] === '#' ? 0 : 1) : undefined;
    },
    tokenizer(src: string, tokens: Token[]) {
      if (!src.startsWith('#')) return;
      const previous = tokens.at(-1);
      if (previous && (previous.type === 'text' || previous.type === 'escape') && !/[\s(]$/.test(previous.raw)) return;
      const match = /^#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/u.exec(src);
      if (!match) return;
      return { type: 'obsidianTag', raw: match[0], tag: match[1] };
    },
    renderer(token: Tokens.Generic) {
      const tag = String(token.tag);
      return context.allowRelativeLinks
        ? `<span class="obsidian-tag" role="link" tabindex="0" data-obsidian-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</span>`
        : `<span class="obsidian-tag">#${escapeHtml(tag)}</span>`;
    },
  };

  const inlineBlockId = {
    name: 'obsidianInlineBlockId',
    level: 'inline' as const,
    start(src: string) {
      const match = /[ \t]\^[A-Za-z0-9-]+(?=\n|$)/.exec(src);
      return match ? match.index : undefined;
    },
    tokenizer(src: string) {
      const match = /^[ \t]+\^([A-Za-z0-9-]+)(?=\n|$)/.exec(src);
      if (!match) return;
      return { type: 'obsidianInlineBlockId', raw: match[0], id: match[1] };
    },
    renderer(token: Tokens.Generic) {
      return `<span id="^${escapeHtml(String(token.id))}" class="obsidian-block-ref"></span>`;
    },
  };

  md.use({
    extensions: [
      frontmatter,
      blockComment,
      footnoteDefinition,
      blockId,
      mathBlock,
      mathInline,
      noteEmbed,
      callout,
      inlineComment,
      wikilink,
      footnoteReference,
      inlineFootnote,
      highlight,
      tag,
      inlineBlockId,
    ],
  });

  md.use({
    renderer: {
      code({ text, lang }) {
        if ((lang ?? '').trim().split(/\s+/)[0]?.toLowerCase() !== 'mermaid') return false;
        return `<div class="obsidian-mermaid" data-mermaid="${escapeHtml(encodeURIComponent(text))}">`
          + `<pre class="obsidian-mermaid-source"><code>${escapeHtml(text)}</code></pre></div>`;
      },
    },
  });

  return md;
}

/** Footnote definitions are removed from their source position and rendered at the end. */
export function appendObsidianFootnotes(md: Marked, context: ObsidianContext): string {
  if (context.footnotes.length === 0) return '';
  const byLabel = new Map(context.footnotes.map((footnote) => [footnote.label, footnote]));
  const ordered: FootnoteDefinition[] = [];
  const used = new Set<string>();
  for (const [label] of [...context.footnoteNumbers].sort((a, b) => a[1] - b[1])) {
    const footnote = byLabel.get(label);
    if (!footnote) continue;
    ordered.push(footnote);
    used.add(label);
  }
  for (const footnote of context.footnotes) {
    if (used.has(footnote.label)) continue;
    context.footnoteNumbers.set(footnote.label, context.footnoteNumbers.size + 1);
    ordered.push(footnote);
  }
  context.inFootnotes = true;
  try {
    const items = ordered.map((footnote, index) =>
      `<li id="fn-${index + 1}">${md.parser(footnote.tokens)}</li>`).join('');
    return `<section class="obsidian-footnotes"><ol>${items}</ol></section>`;
  } finally {
    context.inFootnotes = false;
  }
}
