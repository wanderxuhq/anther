// web/src/terminal/markdown-blocks.ts
// 终端行 → Markdown 块分类。只做“这一行看起来是什么”，不做 HTML 生成：
// HTML 由 render.ts 统一转义/链接化，避免这里成为第二个 XSS 面。
// 支持标题、列表、引用、围栏代码块、分隔线、GFM 表格；围栏/表格状态跨行维护。

export type MarkdownBlock =
  | { kind: 'normal' }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; prefix: string; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'fence' }
  | { kind: 'hr' }
  /** 表格首行带完整 source，其余行只占位并隐藏。 */
  | { kind: 'table'; role: 'start'; source: string; start: number; end: number }
  | { kind: 'table'; role: 'body'; start: number; end: number };

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

function isHeading(line: string): boolean {
  return /^\s{0,3}#{1,6}\s+/.test(line);
}

function isHr(line: string): boolean {
  return /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
}

function isQuote(line: string): boolean {
  return /^\s{0,3}>\s?/.test(line);
}

function isList(line: string): boolean {
  return /^\s*(?:[-*+]|\d+[.)])\s+/.test(line);
}

function startsBlock(line: string): boolean {
  return fenceOpen(line) !== null || isHeading(line) || isHr(line) || isQuote(line) || isList(line);
}

/** GFM 表格分隔行：| --- | :---: | 或 --- | ---。 */
function isTableDelimiter(line: string): boolean {
  if (!line.includes('|')) return false;
  const cells = line.split('|').map((cell) => cell.trim()).filter((cell) => cell !== '');
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function isTableRow(line: string): boolean {
  return line.includes('|') && line.trim() !== '';
}

export function classifyMarkdownRows(rows: readonly string[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let fence: Fence | null = null;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (fence) {
      if (fenceClose(row, fence)) { blocks.push({ kind: 'fence' }); fence = null; }
      else blocks.push({ kind: 'code', text: row });
      continue;
    }
    const open = fenceOpen(row);
    if (open) { blocks.push({ kind: 'fence' }); fence = open; continue; }

    if (isHeading(row)) {
      const heading = row.match(/^\s{0,3}(#{1,6})\s+(.*)$/)!;
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] });
      continue;
    }
    if (isHr(row)) {
      blocks.push({ kind: 'hr' });
      continue;
    }
    if (isQuote(row)) {
      const quote = row.match(/^\s{0,3}>\s?(.*)$/)!;
      blocks.push({ kind: 'quote', text: quote[1] });
      continue;
    }
    if (isList(row)) {
      const list = row.match(/^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/)!;
      blocks.push({ kind: 'list', prefix: list[1], text: list[2] });
      continue;
    }

    // 表格：header + 分隔行 + 连续含 | 的行。表体遇到新的块起始行就停止。
    if (isTableRow(row) && !isTableDelimiter(row) && index + 1 < rows.length && isTableDelimiter(rows[index + 1])) {
      const start = index;
      let end = index + 2;
      while (end < rows.length && isTableRow(rows[end]) && !isTableDelimiter(rows[end]) && !startsBlock(rows[end])) end++;
      const source = rows.slice(start, end).join('\n');
      blocks.push({ kind: 'table', role: 'start', source, start, end });
      for (let body = start + 1; body < end; body++) {
        blocks.push({ kind: 'table', role: 'body', start, end });
      }
      index = end - 1;
      continue;
    }

    blocks.push({ kind: 'normal' });
  }
  return blocks;
}

/** 该行是否值得进入 Markdown 渲染（普通行也允许内联 Markdown）。 */
export function isMarkdownBlock(block: MarkdownBlock): boolean {
  return block.kind !== 'normal';
}

/**
 * 按自动换行标记把终端行拼回逻辑行。返回每个逻辑行的起始终端行号，
 * 供表格块映射回要隐藏的终端行范围。
 */
export function joinWrappedRows(
  rows: readonly string[],
  wrapped: (index: number) => boolean,
): { texts: string[]; starts: number[] } {
  const texts: string[] = [];
  const starts: number[] = [];
  for (let index = 0; index < rows.length; index++) {
    if (index > 0 && wrapped(index) && texts.length > 0) {
      texts[texts.length - 1] += rows[index];
    } else {
      starts.push(index);
      texts.push(rows[index]);
    }
  }
  return { texts, starts };
}
