// shared/terminal/serialize.ts
// 服务端唯一终端模拟器 → 浏览器的紧凑屏幕协议。
//
// 屏幕行不直接传 ScreenCell 对象（一个单元格 16 个字段，2000 行回滚会非常大），
// 而是按“样式表 + 连续同样式的文本段（run）”传：
//   styles: [{ fg, bg, ul, underline, flags, url }]
//   row:    { runs: [[styleIndex, text], ...] }
// 浏览器用同一份 vt.ts 的字素宽度逻辑还原成 ScreenCell[]，交给现有 render.ts。
//
// 这样协议只承载“终端状态”，渲染层（HTML/Markdown/链接/块字符/光标）保持不变。
import type { Cursor, CursorShape, RGB, ScreenCell, TerminalScreen, UnderlineStyle } from './vt.ts';
import { graphemeWidth, splitGraphemes } from './vt.ts';

export type SerializedColor = string | null;

export type SerializedStyle = {
  fg: SerializedColor;
  bg: SerializedColor;
  ul: SerializedColor;
  underline: UnderlineStyle;
  /** bold / faint / italic / overline / strikethrough / inverse / hidden / blink / protected */
  flags: number;
  url: string | null;
};

export type SerializedRow = { runs: Array<[number, string]> };

export type ScreenModes = {
  altScreen: boolean;
  bracketedPaste: boolean;
  applicationCursor: boolean;
  mouseTracking: boolean;
  sgrMouse: boolean;
  focusTracking: boolean;
};

export type ScreenSnapshot = {
  cols: number;
  rows: number;
  /** 回滚区被截断的行数（截断时递增，用于检测结构变化）。 */
  first: number;
  /** 服务端保留的总行数（回滚 + 当前屏幕）。 */
  total: number;
  scrollback: number;
  lines: SerializedRow[];
  styles: SerializedStyle[];
  cursor: Cursor;
  cursorVisible: boolean;
  cursorShape: CursorShape;
  cursorBlinking: boolean;
  modes: ScreenModes;
  title: string;
  cwd: string;
};

export type SerializedDiffRow = SerializedRow & { row: number };

export type ScreenDiff = Omit<ScreenSnapshot, 'lines'> & { lines: SerializedDiffRow[] };

const FLAG_BOLD = 1 << 0;
const FLAG_FAINT = 1 << 1;
const FLAG_ITALIC = 1 << 2;
const FLAG_OVERLINE = 1 << 3;
const FLAG_STRIKE = 1 << 4;
const FLAG_INVERSE = 1 << 5;
const FLAG_HIDDEN = 1 << 6;
const FLAG_BLINK = 1 << 7;
const FLAG_PROTECTED = 1 << 8;

function colorToHex(color: RGB | null): SerializedColor {
  if (!color) return null;
  const hex = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
}

function colorFromHex(value: SerializedColor): RGB | null {
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) return null;
  return {
    r: parseInt(value.slice(1, 3), 16),
    g: parseInt(value.slice(3, 5), 16),
    b: parseInt(value.slice(5, 7), 16),
  };
}

function styleOf(cell: ScreenCell): SerializedStyle {
  let flags = 0;
  if (cell.bold) flags |= FLAG_BOLD;
  if (cell.faint) flags |= FLAG_FAINT;
  if (cell.italic) flags |= FLAG_ITALIC;
  if (cell.overline) flags |= FLAG_OVERLINE;
  if (cell.strikethrough) flags |= FLAG_STRIKE;
  if (cell.inverse) flags |= FLAG_INVERSE;
  if (cell.hidden) flags |= FLAG_HIDDEN;
  if (cell.blink) flags |= FLAG_BLINK;
  if (cell.protected) flags |= FLAG_PROTECTED;
  return {
    fg: colorToHex(cell.fg),
    bg: colorToHex(cell.bg),
    ul: colorToHex(cell.underlineColor),
    underline: cell.underline,
    flags,
    url: cell.url,
  };
}

function styleKey(style: SerializedStyle): string {
  return `${style.fg}|${style.bg}|${style.ul}|${style.underline}|${style.flags}|${style.url ?? ''}`;
}

function defaultStyle(): SerializedStyle {
  return { fg: null, bg: null, ul: null, underline: 'none', flags: 0, url: null };
}

function isPlainBlank(cell: ScreenCell): boolean {
  return cell.char === ' ' && !cell.fg && !cell.bg && cell.underline === 'none' &&
    !cell.underlineColor && !cell.bold && !cell.faint && !cell.italic && !cell.overline &&
    !cell.strikethrough && !cell.inverse && !cell.hidden && !cell.blink && !cell.protected && !cell.url;
}

function cellFromStyle(style: SerializedStyle, char: string, wide: boolean): ScreenCell {
  return {
    char,
    fg: colorFromHex(style.fg),
    bg: colorFromHex(style.bg),
    bold: (style.flags & FLAG_BOLD) !== 0,
    faint: (style.flags & FLAG_FAINT) !== 0,
    italic: (style.flags & FLAG_ITALIC) !== 0,
    underline: style.underline,
    underlineColor: colorFromHex(style.ul),
    overline: (style.flags & FLAG_OVERLINE) !== 0,
    strikethrough: (style.flags & FLAG_STRIKE) !== 0,
    inverse: (style.flags & FLAG_INVERSE) !== 0,
    hidden: (style.flags & FLAG_HIDDEN) !== 0,
    blink: (style.flags & FLAG_BLINK) !== 0,
    wide,
    protected: (style.flags & FLAG_PROTECTED) !== 0,
    url: style.url,
  };
}

function blankCell(): ScreenCell {
  return {
    char: ' ', fg: null, bg: null, bold: false, faint: false, italic: false,
    underline: 'none', underlineColor: null, overline: false, strikethrough: false,
    inverse: false, hidden: false, blink: false, wide: false, protected: false, url: null,
  };
}

/** 一行的最后一个非空白单元格之后都省略；带背景/下划线/链接的空白仍保留。 */
function rowEnd(cells: readonly ScreenCell[]): number {
  let end = cells.length;
  while (end > 0 && isPlainBlank(cells[end - 1])) end--;
  return end;
}

function serializeRow(
  cells: readonly ScreenCell[],
  styles: SerializedStyle[],
  styleIndex: Map<string, number>,
): SerializedRow {
  const runs: Array<[number, string]> = [];
  const end = rowEnd(cells);
  for (let index = 0; index < end; index++) {
    const cell = cells[index];
    if (cell.char === '') continue; // 宽字符占位格，浏览器按字素宽度重建
    const style = styleOf(cell);
    const key = styleKey(style);
    let indexInTable = styleIndex.get(key);
    if (indexInTable === undefined) {
      indexInTable = styles.length;
      styles.push(style);
      styleIndex.set(key, indexInTable);
    }
    const last = runs[runs.length - 1];
    if (last && last[0] === indexInTable) last[1] += cell.char;
    else runs.push([indexInTable, cell.char]);
  }
  return { runs };
}

/** 把服务端行还原成 render.ts 需要的单元格数组。 */
export function deserializeRow(row: SerializedRow, styles: SerializedStyle[], cols: number): ScreenCell[] {
  const cells: ScreenCell[] = [];
  for (const [styleIndex, text] of row.runs) {
    const style = styles[styleIndex] ?? defaultStyle();
    for (const grapheme of splitGraphemes(text)) {
      const width = graphemeWidth(grapheme);
      if (width === 0) {
        const previous = cells[cells.length - 1];
        if (previous) previous.char += grapheme;
        continue;
      }
      cells.push(cellFromStyle(style, grapheme, width === 2));
      if (width === 2) cells.push(cellFromStyle(style, '', false));
    }
  }
  while (cells.length < cols) cells.push(blankCell());
  if (cells.length > cols) cells.length = cols;
  return cells;
}

function modesOf(screen: TerminalScreen): ScreenModes {
  return {
    altScreen: screen.getMode('altScreen') === true,
    bracketedPaste: screen.getMode('bracketedPaste') === true,
    applicationCursor: screen.getMode('applicationCursor') === true,
    mouseTracking: screen.getMode('mouseTracking') === true,
    sgrMouse: screen.getMode('sgrMouse') === true,
    focusTracking: screen.getMode('focusTracking') === true,
  };
}

function metaOf(screen: TerminalScreen): Omit<ScreenSnapshot, 'lines' | 'styles'> {
  const cursor = screen.getCursor();
  return {
    cols: screen.cols,
    rows: screen.screenRows(),
    first: screen.firstRetainedRow(),
    total: screen.totalRows(),
    scrollback: screen.getScrollbackLength(),
    cursor,
    cursorVisible: screen.getCursorVisible(),
    cursorShape: screen.getCursorShape(),
    cursorBlinking: screen.getCursorBlinking(),
    modes: modesOf(screen),
    title: screen.getTitle(),
    cwd: screen.getCwd(),
  };
}

function serializeRows(
  screen: TerminalScreen,
  indices: Iterable<number>,
): { styles: SerializedStyle[]; lines: Array<SerializedDiffRow> } {
  const styles: SerializedStyle[] = [];
  const styleIndex = new Map<string, number>();
  const lines: SerializedDiffRow[] = [];
  for (const row of indices) {
    if (row < 0 || row >= screen.totalRows()) continue;
    lines.push({ row, ...serializeRow(screen.getRowAbsolute(row), styles, styleIndex) });
  }
  return { styles, lines };
}

/** 连接/重连时的完整屏幕（含回滚区）。 */
export function serializeScreen(screen: TerminalScreen): ScreenSnapshot {
  const total = screen.totalRows();
  const styles: SerializedStyle[] = [];
  const styleIndex = new Map<string, number>();
  const lines: SerializedRow[] = [];
  // getRowAbsolute 用 0 起的“保留行”编号；first 只是回滚截断计数器。
  for (let row = 0; row < total; row++) {
    lines.push(serializeRow(screen.getRowAbsolute(row), styles, styleIndex));
  }
  return { ...metaOf(screen), lines, styles };
}

/** 只发送脏行 + 因滚动新进入回滚区的行。 */
export function serializeDiff(
  screen: TerminalScreen,
  dirty: { rows: Set<number> | 'all'; scrolled: number },
): ScreenDiff {
  const rows = new Set<number>();
  if (dirty.rows !== 'all') for (const row of dirty.rows) rows.add(row);
  // 全屏滚动时新行进入回滚区，它们不在 dirty 集合里，需要补上。
  const scrollback = screen.getScrollbackLength();
  for (let i = Math.max(0, scrollback - dirty.scrolled); i < scrollback; i++) rows.add(i);
  const { styles, lines } = serializeRows(screen, rows);
  return { ...metaOf(screen), styles, lines };
}
