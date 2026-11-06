// web/src/terminal/markdown-blocks.ts
// 终端行 → Markdown 块分类。只做“这一行看起来是什么”，不做 HTML 生成：
// HTML 由 render.ts 统一转义/链接化，避免这里成为第二个 XSS 面。
// 支持标题、列表、引用、围栏代码块、分隔线；围栏状态跨行维护。

export type MarkdownBlock =
  | { kind: 'normal' }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; prefix: string; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'fence' }
  | { kind: 'hr' };

type Fence = { char: '`' | '~'; length: number };

function fenceOpen(line: string): Fence | null {
  const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
  if (!match) return null;
  return { char: match[1][0] as '`' | '~', length: match[1].length };
}

function fenceClose(line: string, fence: Fence): boolean {
  const match = line.match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
  return !!match && match[1][0] === fence.char && match[1].length >= fence.length;
}

export function classifyMarkdownRows(rows: readonly string[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let fence: Fence | null = null;
  for (const row of rows) {
    if (fence) {
      if (fenceClose(row, fence)) { blocks.push({ kind: 'fence' }); fence = null; }
      else blocks.push({ kind: 'code', text: row });
      continue;
    }
    const open = fenceOpen(row);
    if (open) { blocks.push({ kind: 'fence' }); fence = open; continue; }

    const heading = row.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] });
      continue;
    }
    if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(row)) {
      blocks.push({ kind: 'hr' });
      continue;
    }
    const quote = row.match(/^\s{0,3}>\s?(.*)$/);
    if (quote) { blocks.push({ kind: 'quote', text: quote[1] }); continue; }
    const list = row.match(/^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/);
    if (list) { blocks.push({ kind: 'list', prefix: list[1], text: list[2] }); continue; }
    blocks.push({ kind: 'normal' });
  }
  return blocks;
}

/** 该行是否值得进入 Markdown 渲染（普通行也允许内联 Markdown）。 */
export function isMarkdownBlock(block: MarkdownBlock): boolean {
  return block.kind !== 'normal';
}
