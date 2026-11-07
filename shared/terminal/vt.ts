// shared/terminal/vt.ts
// 自研 VT/ANSI 解析器 + 屏幕缓冲区。只负责“终端状态”，不碰 DOM：
// 解析 CSI/OSC/ESC、维护主/备用屏幕、滚动区、光标、SGR、宽字符、超链接、
// 脏行追踪。方案 B 中由服务端运行（唯一模拟器），浏览器只消费序列化后的行。
//
// 设计取舍：
// - 输入是已解码的字符串（服务端用 StringDecoder 保证 UTF-8 完整）。
// - 不做 canvas/字体/像素，渲染完全由 render.ts 决定。
// - 对 TUI 必需的能力优先：alt screen、DEC Special Graphics、滚动区、SGR、
//   bracketed paste、application cursor、OSC 7/8、光标形状、鼠标模式状态。

export type RGB = { r: number; g: number; b: number };
export type Color = RGB | null;
export type UnderlineStyle = 'none' | 'single' | 'double' | 'curly' | 'dotted' | 'dashed';

export type ScreenCell = {
  char: string;
  fg: Color;
  bg: Color;
  bold: boolean;
  faint: boolean;
  italic: boolean;
  underline: UnderlineStyle;
  underlineColor: Color;
  overline: boolean;
  strikethrough: boolean;
  inverse: boolean;
  hidden: boolean;
  blink: boolean;
  wide: boolean;
  protected: boolean;
  url: string | null;
};

export type Cursor = { col: number; row: number };
export type DirtyRegion = { rows: Set<number> | 'all'; cursor: boolean; scrolled: number };
export type CursorShape = 'block' | 'underline' | 'bar';

export type TerminalScreenOptions = {
  cols?: number;
  rows?: number;
  scrollbackLimit?: number;
  /** DA/DSR/DECRQM 等查询的回应，写回 PTY。 */
  onResponse?: (data: string) => void;
};

type Pen = {
  fg: Color;
  bg: Color;
  bold: boolean;
  faint: boolean;
  italic: boolean;
  underline: UnderlineStyle;
  underlineColor: Color;
  overline: boolean;
  strikethrough: boolean;
  inverse: boolean;
  hidden: boolean;
  blink: boolean;
  protected: boolean;
  url: string | null;
};

type SavedCursor = {
  cursor: Cursor;
  pen: Pen;
  originMode: boolean;
  autoWrap: boolean;
  charsetG0: Charset;
  charsetG1: Charset;
  activeCharset: 0 | 1;
  scrollTop: number;
  scrollBottom: number;
};

type Charset = 'ascii' | 'dec';

type ParserState =
  | { kind: 'ground' }
  | { kind: 'escape' }
  | { kind: 'csi'; params: string; intermediates: string }
  | { kind: 'osc'; data: string; esc: boolean }
  | { kind: 'string'; esc: boolean }
  | { kind: 'charset'; target: 0 | 1 | 2 | 3 }
  | { kind: 'hash' }
  | { kind: 'skip' };

const MAX_STRING_SEQUENCE = 1024 * 1024;
export const DEFAULT_SCROLLBACK = 2000;

const ANSI_16: RGB[] = [
  { r: 0, g: 0, b: 0 }, { r: 128, g: 0, b: 0 }, { r: 0, g: 128, b: 0 }, { r: 128, g: 128, b: 0 },
  { r: 0, g: 0, b: 128 }, { r: 128, g: 0, b: 128 }, { r: 0, g: 128, b: 128 }, { r: 192, g: 192, b: 192 },
  { r: 128, g: 128, b: 128 }, { r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 255, g: 255, b: 0 },
  { r: 0, g: 0, b: 255 }, { r: 255, g: 0, b: 255 }, { r: 0, g: 255, b: 255 }, { r: 255, g: 255, b: 255 },
];

function buildPalette256(): RGB[] {
  const palette = ANSI_16.map((color) => ({ ...color }));
  const levels = [0, 95, 135, 175, 215, 255];
  for (const r of levels) for (const g of levels) for (const b of levels) palette.push({ r, g, b });
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    palette.push({ r: v, g: v, b: v });
  }
  return palette;
}

function clonePen(pen: Pen): Pen {
  return { ...pen };
}

function defaultPen(): Pen {
  return {
    fg: null, bg: null, bold: false, faint: false, italic: false,
    underline: 'none', underlineColor: null, overline: false, strikethrough: false,
    inverse: false, hidden: false, blink: false, protected: false, url: null,
  };
}

function blankCell(bg: Color = null): ScreenCell {
  return {
    char: ' ', fg: null, bg, bold: false, faint: false, italic: false,
    underline: 'none', underlineColor: null, overline: false, strikethrough: false,
    inverse: false, hidden: false, blink: false, wide: false, protected: false, url: null,
  };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function rowToString(row: readonly ScreenCell[]): string {
  let end = row.length;
  while (end > 0 && (row[end - 1].char === '' || row[end - 1].char === ' ')) end--;
  let text = '';
  for (let i = 0; i < end; i++) if (row[i].char !== '') text += row[i].char;
  return text;
}

function defaultTabStops(cols: number): Set<number> {
  const stops = new Set<number>();
  for (let col = 8; col < cols; col += 8) stops.add(col);
  return stops;
}

// ---- 字符宽度/字素 ----
type SegmenterLike = { segment(input: string): Iterable<{ segment: string }> };
type SegmenterCtor = new (locale?: string, options?: { granularity: 'grapheme' }) => SegmenterLike;
const Segmenter = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
const graphemeSegmenter = Segmenter ? new Segmenter(undefined, { granularity: 'grapheme' }) : null;

export function splitGraphemes(text: string): string[] {
  if (graphemeSegmenter) return [...graphemeSegmenter.segment(text)].map((part) => part.segment);
  return Array.from(text);
}

const WIDE_RANGES: Array<[number, number]> = [
  [0x1100, 0x115f], [0x2329, 0x232a], [0x2e80, 0xa4cf], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60],
  [0xffe0, 0xffe6], [0x1f000, 0x1faff], [0x1f1e6, 0x1f1ff], [0x20000, 0x3fffd],
];

function isCombining(cp: number): boolean {
  return /\p{Mark}/u.test(String.fromCodePoint(cp));
}

export function graphemeWidth(grapheme: string): number {
  if (!grapheme) return 0;
  const cp = grapheme.codePointAt(0)!;
  if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || isCombining(cp)) return 0;
  // keycap / emoji variation：占两格更稳。
  if (grapheme.includes('\ufe0f') || grapheme.includes('\u20e3')) return 2;
  for (const [start, end] of WIDE_RANGES) if (cp >= start && cp <= end) return 2;
  return 1;
}

function isIncompleteGrapheme(grapheme: string): boolean {
  if (!grapheme) return false;
  const codePoints = Array.from(grapheme);
  const last = codePoints[codePoints.length - 1].codePointAt(0)!;
  if (last === 0x200d) return true;
  // 组合字符不需要 hold：width=0 时会直接 append 到前一个单元格。
  // 单个 regional indicator 可能是国旗的一半，等下一块再配对。
  const first = codePoints[0].codePointAt(0)!;
  if (codePoints.length === 1 && first >= 0x1f1e6 && first <= 0x1f1ff) return true;
  const unit = grapheme.charCodeAt(grapheme.length - 1);
  return unit >= 0xd800 && unit <= 0xdbff;
}

const DEC_GRAPHICS: Record<string, string> = {
  '`': '◆', a: '▒', b: '␉', c: '␌', d: '␍', e: '␊', f: '°', g: '±',
  h: '␤', i: '␋', j: '┘', k: '┐', l: '┌', m: '└', n: '┼', o: '⎺',
  p: '⎻', q: '─', r: '⎼', s: '⎽', t: '├', u: '┤', v: '┴', w: '┬',
  x: '│', y: '≤', z: '≥', '{': 'π', '|': '≠', '}': '£', '~': '·',
};

function parseColorSpec(spec: string): RGB | null {
  const value = spec.trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    return { r: parseInt(value.slice(1, 3), 16), g: parseInt(value.slice(3, 5), 16), b: parseInt(value.slice(5, 7), 16) };
  }
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return {
      r: parseInt(value[1] + value[1], 16),
      g: parseInt(value[2] + value[2], 16),
      b: parseInt(value[3] + value[3], 16),
    };
  }
  const rgb = value.match(/^rgb:([0-9a-f]+)\/([0-9a-f]+)\/([0-9a-f]+)$/i);
  if (rgb) {
    const scale = (hex: string) => Math.round((parseInt(hex, 16) / (16 ** hex.length - 1)) * 255);
    return { r: scale(rgb[1]), g: scale(rgb[2]), b: scale(rgb[3]) };
  }
  return null;
}

export class TerminalScreen {
  cols: number;
  private mainBuffer: ScreenCell[][];
  private altBuffer: ScreenCell[][];
  private buffer: ScreenCell[][];
  private scrollback: ScreenCell[][] = [];
  private trimmed = 0;
  private readonly scrollbackLimit: number;
  private cursor: Cursor = { col: 0, row: 0 };
  private pendingWrap = false;
  private pen: Pen = defaultPen();
  private saved: SavedCursor | null = null;
  private savedMain: SavedCursor | null = null;
  private scrollTop = 0;
  private scrollBottom: number;
  private altActive = false;
  private cursorVisible = true;
  private cursorShape: CursorShape = 'block';
  private cursorBlinking = true;
  private applicationCursor = false;
  private applicationKeypad = false;
  private autoWrap = true;
  private originMode = false;
  private insertMode = false;
  private newLineMode = false;
  private reverseVideo = false;
  private bracketedPaste = false;
  private mouseTracking = false;
  private mouseTrackingMode = 0;
  private sgrMouse = false;
  private focusTracking = false;
  private syncOutput = false;
  private title = '';
  private cwd = '';
  private charsetG0: Charset = 'ascii';
  private charsetG1: Charset = 'ascii';
  private activeCharset: 0 | 1 = 0;
  private tabStops: Set<number>;
  private lastGrapheme = '';
  private pendingText = '';
  private pendingJoin = false;
  private state: ParserState = { kind: 'ground' };
  /** 由自动换行产生的续行（内容属于上一条逻辑行）。用行数组对象做键，随滚动/裁剪自然移动。 */
  private wrappedRows = new WeakSet<ScreenCell[]>();
  private dirtyRows: Set<number> | 'all' = 'all';
  private dirtyCursor = true;
  private scrolled = 0;
  private emptyRow: ScreenCell[];
  private palette: RGB[] = buildPalette256();
  private readonly onResponse?: (data: string) => void;

  constructor(options: TerminalScreenOptions = {}) {
    this.cols = Math.max(2, options.cols ?? 80);
    const rows = Math.max(1, options.rows ?? 24);
    this.scrollbackLimit = Math.max(0, options.scrollbackLimit ?? DEFAULT_SCROLLBACK);
    this.onResponse = options.onResponse;
    this.emptyRow = this.makeBlankRow();
    this.mainBuffer = this.makeRows(rows);
    this.altBuffer = this.makeRows(rows);
    this.buffer = this.mainBuffer;
    this.scrollBottom = rows - 1;
    this.tabStops = defaultTabStops(this.cols);
  }

  // ---- 只读查询 ----
  screenRows(): number { return this.buffer.length; }
  totalRows(): number { return this.scrollback.length + this.buffer.length; }
  firstRetainedRow(): number { return this.trimmed; }
  getScrollbackLength(): number { return this.scrollback.length; }
  viewportTop(): number { return Math.max(0, this.totalRows() - this.screenRows()); }
  getViewportOffset(): number { return 0; }
  scrollViewport(_delta: number): void { /* 由 DOM 滚动容器负责 */ }

  getRow(row: number): ScreenCell[] {
    return this.buffer[row] ?? this.emptyRow;
  }

  getCell(row: number, col: number): ScreenCell {
    return this.buffer[row]?.[col] ?? blankCell(null);
  }

  getRowAbsolute(row: number): ScreenCell[] {
    if (row < 0 || row >= this.totalRows()) return this.emptyRow;
    if (row < this.scrollback.length) return this.scrollback[row];
    return this.buffer[row - this.scrollback.length] ?? this.emptyRow;
  }

  /** 该屏幕行是否是上一行自动换行产生的续行。 */
  isRowWrapped(row: number): boolean {
    const line = this.buffer[row];
    return !!line && this.wrappedRows.has(line);
  }

  /** 保留行编号版本（含回滚区），供序列化使用。 */
  isRowAbsoluteWrapped(row: number): boolean {
    return this.wrappedRows.has(this.getRowAbsolute(row));
  }

  getText(): string {
    return [...this.scrollback, ...this.buffer].map(rowToString).join('\n');
  }

  getScrollbackText(): string {
    return this.scrollback.map(rowToString).join('\n');
  }

  getCursor(): Cursor { return { col: this.cursor.col, row: this.cursor.row }; }
  getCursorVisible(): boolean { return this.cursorVisible; }
  getCursorShape(): CursorShape { return this.cursorShape; }
  getCursorBlinking(): boolean { return this.cursorBlinking; }
  getTitle(): string { return this.title; }
  getCwd(): string { return this.cwd; }

  getMode(mode: string): boolean | null {
    switch (mode) {
      case 'altScreen': return this.altActive;
      case 'cursorVisible': return this.cursorVisible;
      case 'cursorBlinking': return this.cursorBlinking;
      case 'bracketedPaste': return this.bracketedPaste;
      case 'applicationCursor': return this.applicationCursor;
      case 'applicationKeypad': return this.applicationKeypad;
      case 'autoWrap': return this.autoWrap;
      case 'mouseTracking': return this.mouseTracking;
      case 'mouseTrackingMode': return this.mouseTracking ? this.mouseTrackingMode !== 0 : false;
      case 'sgrMouse': return this.sgrMouse;
      case 'focusTracking': return this.focusTracking;
      case 'originMode': return this.originMode;
      case 'insertMode': return this.insertMode;
      case 'newLineMode': return this.newLineMode;
      case 'reverseVideo': return this.reverseVideo;
      case 'syncOutput': return this.syncOutput;
      case 'leftRightMargin': return false;
      case 'colorSchemeReporting': return false;
      case 'kittyKeyboard': return false;
      case 'kittyGraphics': return false;
      case 'sixel': return false;
      default: return null;
    }
  }

  takeDirty(): DirtyRegion {
    const result: DirtyRegion = { rows: this.dirtyRows, cursor: this.dirtyCursor, scrolled: this.scrolled };
    this.dirtyRows = new Set<number>();
    this.dirtyCursor = false;
    this.scrolled = 0;
    return result;
  }

  // ---- 生命周期 ----
  reset(): void {
    const rows = this.screenRows();
    this.mainBuffer = this.makeRows(rows);
    this.altBuffer = this.makeRows(rows);
    this.buffer = this.mainBuffer;
    this.scrollback = [];
    this.trimmed = 0;
    this.cursor = { col: 0, row: 0 };
    this.pendingWrap = false;
    this.pen = defaultPen();
    this.saved = null;
    this.savedMain = null;
    this.scrollTop = 0;
    this.scrollBottom = rows - 1;
    this.altActive = false;
    this.cursorVisible = true;
    this.cursorShape = 'block';
    this.cursorBlinking = true;
    this.applicationCursor = false;
    this.applicationKeypad = false;
    this.autoWrap = true;
    this.originMode = false;
    this.insertMode = false;
    this.newLineMode = false;
    this.reverseVideo = false;
    this.bracketedPaste = false;
    this.mouseTracking = false;
    this.mouseTrackingMode = 0;
    this.sgrMouse = false;
    this.focusTracking = false;
    this.syncOutput = false;
    this.title = '';
    this.cwd = '';
    this.charsetG0 = 'ascii';
    this.charsetG1 = 'ascii';
    this.activeCharset = 0;
    this.tabStops = defaultTabStops(this.cols);
    this.lastGrapheme = '';
    this.pendingText = '';
    this.pendingJoin = false;
    this.state = { kind: 'ground' };
    this.emptyRow = this.makeBlankRow();
    this.markAllDirty();
  }

  resize(cols: number, rows: number): void {
    cols = Math.max(2, Math.floor(cols));
    rows = Math.max(1, Math.floor(rows));
    if (cols === this.cols && rows === this.screenRows()) return;
    this.cols = cols;
    this.emptyRow = this.makeBlankRow();

    if (this.altActive) {
      const removedTop = this.resizeBuffer(this.altBuffer, cols, rows, false, this.cursor.row);
      this.buffer = this.altBuffer;
      this.cursor.row = Math.max(0, this.cursor.row - removedTop);
    } else {
      const removedTop = this.resizeBuffer(this.mainBuffer, cols, rows, true, this.cursor.row);
      this.buffer = this.mainBuffer;
      this.cursor.row = Math.max(0, this.cursor.row - removedTop);
    }
    this.cursor.col = Math.min(this.cursor.col, cols - 1);
    this.cursor.row = Math.min(this.cursor.row, rows - 1);
    this.pendingWrap = false;
    this.scrollTop = 0;
    this.scrollBottom = rows - 1;
    this.tabStops = defaultTabStops(cols);
    this.markAllDirty();
  }

  // ---- 输入 ----
  process(data: string): void {
    if (!data) return;
    let text = this.pendingText + data;
    this.pendingText = '';
    if (this.pendingJoin) {
      this.pendingJoin = false;
      const first = splitGraphemes(text)[0];
      const cp = first?.codePointAt(0) ?? 0;
      if (first && cp >= 0x20 && cp !== 0x7f && first !== '\x1b' && first !== '\x9b' && first !== '\x9d') {
        // ZWJ 序列跨 chunk：把下一段字素接回前一个单元格。
        this.appendToPrevious(first);
        text = text.slice(first.length);
      }
    }
    let run = '';
    const flush = () => {
      if (!run) return;
      const graphemes = splitGraphemes(run);
      run = '';
      if (graphemes.length === 0) return;
      const last = graphemes[graphemes.length - 1];
      if (isIncompleteGrapheme(last)) {
        if (last.endsWith('\u200d')) {
          this.appendToPrevious(last);
          this.pendingJoin = true;
        } else {
          this.pendingText = last;
        }
        graphemes.pop();
      }
      for (const grapheme of graphemes) {
        const mapped = this.applyCharset(grapheme);
        this.print(mapped, graphemeWidth(mapped));
      }
    };

    for (const ch of text) {
      if (this.state.kind !== 'ground') {
        this.consumeState(ch);
        continue;
      }
      if (ch === '\x1b') { flush(); this.state = { kind: 'escape' }; continue; }
      if (ch === '\x9b') { flush(); this.state = { kind: 'csi', params: '', intermediates: '' }; continue; }
      if (ch === '\x9d') { flush(); this.state = { kind: 'osc', data: '', esc: false }; continue; }
      const cp = ch.codePointAt(0)!;
      if (cp === 0x9c) { flush(); continue; }
      if (cp < 0x20 || cp === 0x7f) { flush(); this.executeControl(cp); continue; }
      run += ch;
    }
    flush();
  }

  // ---- 内部：解析状态机 ----
  private consumeState(ch: string): void {
    const state = this.state;
    switch (state.kind) {
      case 'escape':
        this.state = { kind: 'ground' };
        this.dispatchEscape(ch);
        break;
      case 'csi': {
        const cp = ch.codePointAt(0)!;
        if (ch === '\x1b') { this.state = { kind: 'escape' }; break; }
        if (cp === 0x9c) { this.state = { kind: 'ground' }; break; }
        if (cp >= 0x40 && cp <= 0x7e) {
          this.state = { kind: 'ground' };
          this.dispatchCsi(ch, state.params, state.intermediates);
        } else if (cp >= 0x30 && cp <= 0x3f) {
          state.params += ch;
        } else if (cp >= 0x20 && cp <= 0x2f) {
          state.intermediates += ch;
        } else if (cp < 0x20) {
          this.executeControl(cp);
        }
        break;
      }
      case 'osc': {
        const cp = ch.codePointAt(0)!;
        if (state.esc) {
          if (ch === '\\') {
            this.state = { kind: 'ground' };
            this.dispatchOsc(state.data);
          } else {
            state.esc = false;
            if (state.data.length < MAX_STRING_SEQUENCE) state.data += '\x1b' + ch;
          }
          break;
        }
        if (ch === '\x1b') { state.esc = true; break; }
        if (cp === 0x07 || cp === 0x9c) {
          this.state = { kind: 'ground' };
          this.dispatchOsc(state.data);
          break;
        }
        if (state.data.length < MAX_STRING_SEQUENCE) state.data += ch;
        break;
      }
      case 'string': {
        const cp = ch.codePointAt(0)!;
        if (state.esc) {
          if (ch === '\\') this.state = { kind: 'ground' };
          else state.esc = false;
          break;
        }
        if (ch === '\x1b') { state.esc = true; break; }
        if (cp === 0x9c) { this.state = { kind: 'ground' }; break; }
        break;
      }
      case 'charset':
        this.setCharset(state.target, ch);
        this.state = { kind: 'ground' };
        break;
      case 'hash':
        this.dispatchHash(ch);
        this.state = { kind: 'ground' };
        break;
      case 'skip':
        this.state = { kind: 'ground' };
        break;
      default:
        this.state = { kind: 'ground' };
        break;
    }
  }

  private executeControl(code: number): void {
    switch (code) {
      case 0x07: break; // BEL
      case 0x08: this.backspace(); break;
      case 0x09: this.tab(); break;
      case 0x0a: case 0x0b: case 0x0c:
        if (this.newLineMode) this.carriageReturn();
        this.lineFeed();
        break;
      case 0x0d: this.carriageReturn(); break;
      case 0x0e: this.activeCharset = 1; break;
      case 0x0f: this.activeCharset = 0; break;
      default: break;
    }
  }

  private dispatchEscape(ch: string): void {
    switch (ch) {
      case '[': this.state = { kind: 'csi', params: '', intermediates: '' }; break;
      case ']': this.state = { kind: 'osc', data: '', esc: false }; break;
      case 'P': case '_': case '^': case 'X': this.state = { kind: 'string', esc: false }; break;
      case '7': this.saveCursor(); break;
      case '8': this.restoreCursor(); break;
      case 'D': this.lineFeed(); break;
      case 'E': this.carriageReturn(); this.lineFeed(); break;
      case 'M': this.reverseIndex(); break;
      case 'c': this.reset(); break;
      case '(': this.state = { kind: 'charset', target: 0 }; break;
      case ')': this.state = { kind: 'charset', target: 1 }; break;
      case '*': this.state = { kind: 'charset', target: 2 }; break;
      case '+': this.state = { kind: 'charset', target: 3 }; break;
      case '#': this.state = { kind: 'hash' }; break;
      case '%': this.state = { kind: 'skip' }; break;
      case '=': this.applicationKeypad = true; break;
      case '>': this.applicationKeypad = false; break;
      case 'H': this.tabStops.add(this.cursor.col); break;
      case 'Z': this.respond('\x1b[?62;22c'); break;
      case '\\': break;
      default: break;
    }
  }

  private dispatchHash(ch: string): void {
    if (ch !== '8') return;
    // DECALN：整屏填 E，常用于终端自检。
    const row = this.makeBlankRow();
    for (const cell of row) cell.char = 'E';
    for (let i = 0; i < this.buffer.length; i++) this.buffer[i] = row.map((cell) => ({ ...cell }));
    this.cursor = { col: 0, row: 0 };
    this.markAllDirty();
  }

  private dispatchOsc(data: string): void {
    const semi = data.indexOf(';');
    const code = semi >= 0 ? data.slice(0, semi) : data;
    const rest = semi >= 0 ? data.slice(semi + 1) : '';
    switch (code) {
      case '0': case '1': case '2': this.title = rest; break;
      case '7': this.cwd = rest; break;
      case '8': {
        const sep = rest.indexOf(';');
        const uri = sep >= 0 ? rest.slice(sep + 1) : '';
        this.pen.url = uri || null;
        break;
      }
      case '4': this.applyPalette(rest); break;
      case '104': this.resetPalette(rest); break;
      default: break;
    }
  }

  private applyPalette(data: string): void {
    const parts = data.split(';');
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const index = Number(parts[i]);
      const color = parseColorSpec(parts[i + 1]);
      if (color && Number.isInteger(index) && index >= 0 && index < 256) this.palette[index] = color;
    }
  }

  private resetPalette(data: string): void {
    const fresh = buildPalette256();
    if (!data) { this.palette = fresh; return; }
    for (const raw of data.split(';')) {
      const index = Number(raw);
      if (Number.isInteger(index) && index >= 0 && index < 256) this.palette[index] = fresh[index];
    }
  }

  private dispatchCsi(final: string, rawParams: string, intermediates: string): void {
    let prefix = '';
    let paramText = rawParams;
    if (paramText && '?><='.includes(paramText[0])) {
      prefix = paramText[0];
      paramText = paramText.slice(1);
    }
    const params = paramText === '' ? [] : paramText.split(';');
    const p = (index: number, fallback: number): number => {
      const raw = params[index];
      if (raw === undefined || raw === '') return fallback;
      const value = Number(raw);
      return Number.isFinite(value) ? value : fallback;
    };

    if (intermediates.includes(' ') && final === 'q') {
      this.setCursorStyle(p(0, 0));
      return;
    }
    if (intermediates.includes('!') && final === 'p') {
      this.softReset();
      return;
    }
    if (intermediates.includes('$') && final === 'p') {
      this.reportMode(prefix, p(0, 0));
      return;
    }
    if (intermediates.includes('"') && final === 'q') return;

    if (prefix === '?') {
      if (final === 'h' || final === 'l') this.setPrivateModes(params, final === 'h');
      else if (final === 'n') this.reportStatus(params, true);
      else if (final === 'c') this.respond('\x1b[?62;22c');
      else if (final === 'J') this.eraseInDisplay(p(0, 0));
      else if (final === 'K') this.eraseInLine(p(0, 0));
      return;
    }
    if (prefix === '>') {
      if (final === 'c') this.respond('\x1b[>0;1;0c');
      return;
    }
    if (prefix === '=') {
      if (final === 'c') this.respond('\x1b[>0;1;0c');
      return;
    }

    switch (final) {
      case '@': this.insertChars(p(0, 1)); break;
      case 'A': this.moveCursor(-p(0, 1), 0); break;
      case 'B': this.moveCursor(p(0, 1), 0); break;
      case 'C': this.moveCursor(0, p(0, 1)); break;
      case 'D': this.moveCursor(0, -p(0, 1)); break;
      case 'E': this.moveCursor(p(0, 1), -this.cursor.col); break;
      case 'F': this.moveCursor(-p(0, 1), -this.cursor.col); break;
      case 'G': this.setCursor(this.cursor.row, p(0, 1) - 1); break;
      case 'H': case 'f': {
        const base = this.originMode ? this.scrollTop : 0;
        this.setCursor(base + p(0, 1) - 1, p(1, 1) - 1);
        break;
      }
      case 'I': this.moveTabs(p(0, 1)); break;
      case 'J': this.eraseInDisplay(p(0, 0)); break;
      case 'K': this.eraseInLine(p(0, 0)); break;
      case 'L': this.insertLines(p(0, 1)); break;
      case 'M': this.deleteLines(p(0, 1)); break;
      case 'P': this.deleteChars(p(0, 1)); break;
      case 'S': this.scrollUp(p(0, 1)); break;
      case 'T': this.scrollDown(p(0, 1)); break;
      case 'X': this.eraseChars(p(0, 1)); break;
      case 'Z': this.moveTabs(-p(0, 1)); break;
      case 'a': this.moveCursor(0, p(0, 1)); break;
      case 'b': this.repeatLast(p(0, 1)); break;
      case 'c': this.respond('\x1b[?62;22c'); break;
      case 'd': this.setCursor(p(0, 1) - 1, this.cursor.col); break;
      case 'e': this.moveCursor(p(0, 1), 0); break;
      case 'g': this.clearTab(p(0, 0)); break;
      case 'h': this.setAnsiModes(params, true); break;
      case 'l': this.setAnsiModes(params, false); break;
      case 'm': this.setSgr(params); break;
      case 'n': this.reportStatus(params, false); break;
      case 'r': this.setScrollRegion(p(0, 1), p(1, this.buffer.length)); break;
      case 's': this.saveCursor(); break;
      case 'u': this.restoreCursor(); break;
      case 't': this.windowOp(params); break;
      case '`': this.setCursor(this.cursor.row, p(0, 1) - 1); break;
      default: break;
    }
  }

  private setPrivateModes(params: string[], value: boolean): void {
    for (const raw of params) {
      const mode = Number(raw);
      if (!Number.isFinite(mode)) continue;
      switch (mode) {
        case 1: this.applicationCursor = value; break;
        case 5: this.reverseVideo = value; this.markAllDirty(); break;
        case 6:
          this.originMode = value;
          this.setCursor(value ? this.scrollTop : 0, 0);
          break;
        case 7: this.autoWrap = value; break;
        case 12: this.cursorBlinking = value; this.markCursor(); break;
        case 25: this.cursorVisible = value; this.markCursor(); break;
        case 47: case 1047: case 1049:
          if (value) this.enterAlt(mode !== 47);
          else this.exitAlt();
          break;
        case 1048:
          if (value) this.saveCursor(); else this.restoreCursor();
          break;
        case 9: case 1000: case 1002: case 1003:
          this.mouseTracking = value;
          this.mouseTrackingMode = value ? mode : 0;
          break;
        case 1006: this.sgrMouse = value; break;
        case 1004: this.focusTracking = value; break;
        case 2004: this.bracketedPaste = value; break;
        case 2026: this.syncOutput = value; break;
        case 3: case 1005: case 1015: case 1034: case 1039:
        default: break;
      }
    }
  }

  private setAnsiModes(params: string[], value: boolean): void {
    for (const raw of params) {
      const mode = Number(raw);
      if (mode === 4) this.insertMode = value;
      else if (mode === 20) this.newLineMode = value;
    }
  }

  private setCursorStyle(value: number): void {
    switch (value) {
      case 0: case 1: this.cursorShape = 'block'; this.cursorBlinking = true; break;
      case 2: this.cursorShape = 'block'; this.cursorBlinking = false; break;
      case 3: this.cursorShape = 'underline'; this.cursorBlinking = true; break;
      case 4: this.cursorShape = 'underline'; this.cursorBlinking = false; break;
      case 5: this.cursorShape = 'bar'; this.cursorBlinking = true; break;
      case 6: this.cursorShape = 'bar'; this.cursorBlinking = false; break;
      default: break;
    }
    this.markCursor();
  }

  private softReset(): void {
    this.cursorVisible = true;
    this.cursorShape = 'block';
    this.cursorBlinking = true;
    this.applicationCursor = false;
    this.applicationKeypad = false;
    this.autoWrap = true;
    this.originMode = false;
    this.insertMode = false;
    this.newLineMode = false;
    this.scrollTop = 0;
    this.scrollBottom = this.buffer.length - 1;
    this.pen = defaultPen();
    this.charsetG0 = 'ascii';
    this.charsetG1 = 'ascii';
    this.activeCharset = 0;
    this.markAllDirty();
  }

  private reportStatus(params: string[], privateMode: boolean): void {
    const code = Number(params[0] ?? '0');
    if (code === 5) this.respond('\x1b[0n');
    else if (code === 6) {
      const row = this.cursor.row + 1;
      const col = this.cursor.col + 1;
      this.respond(`${privateMode ? '\x1b[?' : '\x1b['}${row};${col}R`);
    }
  }

  private reportMode(prefix: string, mode: number): void {
    let value = 0;
    const name = this.privateModeName(mode);
    if (name) {
      const state = this.getMode(name);
      if (state !== null) value = state ? 1 : 2;
    } else if (mode === 4) value = this.insertMode ? 1 : 2;
    else if (mode === 20) value = this.newLineMode ? 1 : 2;
    this.respond(`\x1b[${prefix}${mode};${value}$y`);
  }

  private privateModeName(mode: number): string | null {
    switch (mode) {
      case 1: return 'applicationCursor';
      case 5: return 'reverseVideo';
      case 6: return 'originMode';
      case 7: return 'autoWrap';
      case 12: return 'cursorBlinking';
      case 25: return 'cursorVisible';
      case 47: case 1047: case 1049: return 'altScreen';
      case 1000: case 1002: case 1003: return 'mouseTracking';
      case 1006: return 'sgrMouse';
      case 1004: return 'focusTracking';
      case 2004: return 'bracketedPaste';
      case 2026: return 'syncOutput';
      default: return null;
    }
  }

  private windowOp(params: string[]): void {
    const code = Number(params[0] ?? '0');
    if (code === 18) this.respond(`\x1b[8;${this.buffer.length};${this.cols}t`);
    else if (code === 14) this.respond(`\x1b[4;${this.buffer.length * 16};${this.cols * 8}t`);
  }

  // ---- 屏幕操作 ----
  private makeRows(count: number): ScreenCell[][] {
    return Array.from({ length: count }, () => this.makeBlankRow());
  }

  private makeBlankRow(bg: Color = null): ScreenCell[] {
    return Array.from({ length: this.cols }, () => blankCell(bg));
  }

  private makeCell(char: string, wide: boolean): ScreenCell {
    const pen = this.pen;
    return {
      char, fg: pen.fg, bg: pen.bg, bold: pen.bold, faint: pen.faint, italic: pen.italic,
      underline: pen.underline, underlineColor: pen.underlineColor, overline: pen.overline,
      strikethrough: pen.strikethrough, inverse: pen.inverse, hidden: pen.hidden,
      blink: pen.blink, wide, protected: pen.protected, url: pen.url,
    };
  }

  private continuationCell(): ScreenCell {
    const cell = blankCell(this.pen.bg);
    cell.char = '';
    return cell;
  }

  private markRow(row: number): void {
    if (this.dirtyRows === 'all') return;
    this.dirtyRows.add(this.scrollback.length + row);
  }

  private markCursor(): void { this.dirtyCursor = true; }

  private markAllDirty(): void {
    this.dirtyRows = 'all';
    this.dirtyCursor = true;
  }

  private print(grapheme: string, width: number): void {
    if (!grapheme) return;
    if (width === 0) { this.appendToPrevious(grapheme); return; }
    if (this.pendingWrap && this.autoWrap) {
      this.carriageReturn();
      this.lineFeed(true);
    }
    if (width === 2 && this.cursor.col >= this.cols - 1) {
      if (this.autoWrap) { this.carriageReturn(); this.lineFeed(true); }
      else this.cursor.col = this.cols - 1;
    }
    const row = this.cursor.row;
    const col = this.cursor.col;
    if (this.insertMode) this.insertChars(width);
    this.clearWideAt(row, col);
    if (width === 2) this.clearWideAt(row, col + 1);
    const target = this.buffer[row];
    if (!target) return;
    target[col] = this.makeCell(grapheme, width === 2);
    if (width === 2 && col + 1 < this.cols) target[col + 1] = this.continuationCell();
    this.markRow(row);
    this.cursor.col += width;
    if (this.cursor.col >= this.cols) {
      if (this.autoWrap) {
        this.cursor.col = this.cols - 1;
        this.pendingWrap = true;
      } else this.cursor.col = this.cols - 1;
    }
    this.lastGrapheme = grapheme;
    this.markCursor();
  }

  private appendToPrevious(grapheme: string): void {
    const row = this.buffer[this.cursor.row];
    if (!row) return;
    let col = this.pendingWrap ? this.cols - 1 : this.cursor.col;
    if (col <= 0) return;
    let previous = row[col - 1];
    if (previous.char === '' && col >= 2) previous = row[col - 2];
    if (previous && previous.char !== '') {
      previous.char += grapheme;
      this.markRow(this.cursor.row);
      this.markCursor();
    }
  }

  private clearWideAt(row: number, col: number): void {
    if (row < 0 || row >= this.buffer.length || col < 0 || col >= this.cols) return;
    const line = this.buffer[row];
    const cell = line[col];
    if (!cell) return;
    if (cell.wide && col + 1 < this.cols) line[col + 1] = blankCell(this.pen.bg);
    if (cell.char === '' && col > 0) line[col - 1] = blankCell(this.pen.bg);
  }

  private carriageReturn(): void {
    this.cursor.col = 0;
    this.pendingWrap = false;
    this.markCursor();
  }

  private lineFeed(wrap = false): void {
    if (this.cursor.row === this.scrollBottom) this.scrollUp(1);
    else this.cursor.row = Math.min(this.cursor.row + 1, this.buffer.length - 1);
    const line = this.buffer[this.cursor.row];
    if (line) {
      if (wrap) this.wrappedRows.add(line);
      else this.wrappedRows.delete(line);
    }
    this.pendingWrap = false;
    this.markCursor();
  }

  private backspace(): void {
    if (this.cursor.col > 0) this.cursor.col--;
    else this.pendingWrap = false;
    this.markCursor();
  }

  private tab(): void {
    let col = this.cursor.col + 1;
    while (col < this.cols && !this.tabStops.has(col)) col++;
    this.cursor.col = Math.min(col, this.cols - 1);
    this.pendingWrap = false;
    this.markCursor();
  }

  private reverseIndex(): void {
    if (this.cursor.row === this.scrollTop) this.scrollDown(1);
    else this.cursor.row = Math.max(0, this.cursor.row - 1);
    this.pendingWrap = false;
    this.markCursor();
  }

  private moveTabs(count: number): void {
    if (count === 0) return;
    const direction = count > 0 ? 1 : -1;
    for (let i = 0; i < Math.abs(count); i++) {
      let col = this.cursor.col + direction;
      while (col > 0 && col < this.cols - 1 && !this.tabStops.has(col)) col += direction;
      this.cursor.col = clamp(col, 0, this.cols - 1);
    }
    this.pendingWrap = false;
    this.markCursor();
  }

  private clearTab(mode: number): void {
    if (mode === 0) this.tabStops.delete(this.cursor.col);
    else if (mode === 3) this.tabStops.clear();
  }

  private moveCursor(rowDelta: number, colDelta: number): void {
    const minRow = this.originMode ? this.scrollTop : 0;
    const maxRow = this.originMode ? this.scrollBottom : this.buffer.length - 1;
    this.cursor.row = clamp(this.cursor.row + rowDelta, minRow, maxRow);
    this.cursor.col = clamp(this.cursor.col + colDelta, 0, this.cols - 1);
    this.pendingWrap = false;
    this.markCursor();
  }

  private setCursor(row: number, col: number): void {
    const minRow = this.originMode ? this.scrollTop : 0;
    const maxRow = this.originMode ? this.scrollBottom : this.buffer.length - 1;
    this.cursor.row = clamp(row, minRow, maxRow);
    this.cursor.col = clamp(col, 0, this.cols - 1);
    this.pendingWrap = false;
    this.markCursor();
  }

  private repeatLast(count: number): void {
    if (!this.lastGrapheme) return;
    for (let i = 0; i < Math.max(0, count); i++) this.print(this.lastGrapheme, graphemeWidth(this.lastGrapheme));
  }

  private scrollUp(count: number): void {
    count = Math.max(1, count);
    const top = this.scrollTop;
    const bottom = this.scrollBottom;
    const full = top === 0 && bottom === this.buffer.length - 1;
    if (full && !this.altActive) {
      for (let i = 0; i < count; i++) {
        const removed = this.buffer.shift()!;
        this.buffer.push(this.makeBlankRow(this.pen.bg));
        this.pushScrollback(removed);
      }
      for (let i = Math.max(0, this.buffer.length - count); i < this.buffer.length; i++) this.markRow(i);
      this.scrolled += count;
    } else {
      for (let i = 0; i < count; i++) {
        this.buffer.splice(top, 1);
        this.buffer.splice(bottom, 0, this.makeBlankRow(this.pen.bg));
      }
      this.markAllDirty();
    }
    this.markCursor();
  }

  private scrollDown(count: number): void {
    count = Math.max(1, count);
    const top = this.scrollTop;
    const bottom = this.scrollBottom;
    for (let i = 0; i < count; i++) {
      this.buffer.splice(bottom, 1);
      this.buffer.splice(top, 0, this.makeBlankRow(this.pen.bg));
    }
    this.markAllDirty();
    this.markCursor();
  }

  private pushScrollback(row: ScreenCell[]): void {
    if (this.altActive) return;
    this.scrollback.push(row);
    if (this.scrollback.length > this.scrollbackLimit) {
      this.scrollback.shift();
      this.trimmed++;
      this.dirtyRows = 'all';
    }
  }

  private insertLines(count: number): void {
    if (this.cursor.row < this.scrollTop || this.cursor.row > this.scrollBottom) return;
    for (let i = 0; i < count; i++) {
      this.buffer.splice(this.scrollBottom, 1);
      this.buffer.splice(this.cursor.row, 0, this.makeBlankRow(this.pen.bg));
    }
    this.markAllDirty();
  }

  private deleteLines(count: number): void {
    if (this.cursor.row < this.scrollTop || this.cursor.row > this.scrollBottom) return;
    for (let i = 0; i < count; i++) {
      this.buffer.splice(this.cursor.row, 1);
      this.buffer.splice(this.scrollBottom, 0, this.makeBlankRow(this.pen.bg));
    }
    this.markAllDirty();
  }

  private insertChars(count: number): void {
    const line = this.buffer[this.cursor.row];
    if (!line) return;
    const blanks = Array.from({ length: count }, () => blankCell(this.pen.bg));
    line.splice(this.cursor.col, 0, ...blanks);
    if (line.length > this.cols) line.length = this.cols;
    this.markRow(this.cursor.row);
  }

  private deleteChars(count: number): void {
    const line = this.buffer[this.cursor.row];
    if (!line) return;
    line.splice(this.cursor.col, count);
    while (line.length < this.cols) line.push(blankCell(this.pen.bg));
    this.markRow(this.cursor.row);
  }

  private eraseChars(count: number): void {
    const line = this.buffer[this.cursor.row];
    if (!line) return;
    const end = Math.min(this.cursor.col + count, this.cols);
    for (let i = this.cursor.col; i < end; i++) line[i] = blankCell(this.pen.bg);
    this.markRow(this.cursor.row);
  }

  private eraseInLine(mode: number): void {
    const line = this.buffer[this.cursor.row];
    if (!line) return;
    let start = 0;
    let end = this.cols;
    if (mode === 0) start = this.cursor.col;
    else if (mode === 1) end = this.cursor.col + 1;
    for (let i = start; i < end; i++) line[i] = blankCell(this.pen.bg);
    this.markRow(this.cursor.row);
  }

  private eraseInDisplay(mode: number): void {
    if (mode === 3) {
      this.scrollback = [];
      this.trimmed = 0;
      this.markAllDirty();
      return;
    }
    if (mode === 2) {
      for (let i = 0; i < this.buffer.length; i++) this.buffer[i] = this.makeBlankRow(this.pen.bg);
      this.markAllDirty();
      return;
    }
    if (mode === 0) {
      this.eraseInLine(0);
      for (let i = this.cursor.row + 1; i < this.buffer.length; i++) this.buffer[i] = this.makeBlankRow(this.pen.bg);
    } else if (mode === 1) {
      for (let i = 0; i < this.cursor.row; i++) this.buffer[i] = this.makeBlankRow(this.pen.bg);
      this.eraseInLine(1);
    }
    this.markAllDirty();
  }

  private setScrollRegion(top: number, bottom: number): void {
    const rows = this.buffer.length;
    let start = top - 1;
    let end = bottom - 1;
    if (!Number.isFinite(start) || start < 0) start = 0;
    if (!Number.isFinite(end) || end < 0 || end >= rows) end = rows - 1;
    if (start >= end) { start = 0; end = rows - 1; }
    this.scrollTop = start;
    this.scrollBottom = end;
    this.setCursor(this.originMode ? start : 0, 0);
  }

  private saveCursor(): void {
    this.saved = {
      cursor: { ...this.cursor },
      pen: clonePen(this.pen),
      originMode: this.originMode,
      autoWrap: this.autoWrap,
      charsetG0: this.charsetG0,
      charsetG1: this.charsetG1,
      activeCharset: this.activeCharset,
      scrollTop: this.scrollTop,
      scrollBottom: this.scrollBottom,
    };
  }

  private restoreCursor(): void {
    const saved = this.saved;
    if (!saved) return;
    this.cursor = { ...saved.cursor };
    this.cursor.col = clamp(this.cursor.col, 0, this.cols - 1);
    this.cursor.row = clamp(this.cursor.row, 0, this.buffer.length - 1);
    this.pen = clonePen(saved.pen);
    this.originMode = saved.originMode;
    this.autoWrap = saved.autoWrap;
    this.charsetG0 = saved.charsetG0;
    this.charsetG1 = saved.charsetG1;
    this.activeCharset = saved.activeCharset;
    this.scrollTop = clamp(saved.scrollTop, 0, this.buffer.length - 1);
    this.scrollBottom = clamp(saved.scrollBottom, this.scrollTop, this.buffer.length - 1);
    this.pendingWrap = false;
    this.markCursor();
  }

  private setSgr(params: string[]): void {
    if (params.length === 0 || (params.length === 1 && params[0] === '')) {
      const url = this.pen.url;
      this.pen = defaultPen();
      this.pen.url = url;
      return;
    }
    let i = 0;
    while (i < params.length) {
      const raw = params[i];
      const parts = raw.split(':').map((part) => (part === '' ? NaN : Number(part)));
      const code = parts[0];
      if (!Number.isFinite(code)) { i++; continue; }

      if (code === 38 || code === 48 || code === 58) {
        const color = this.extendedColor(parts, params, i);
        if (color) {
          if (code === 38) this.pen.fg = color.color;
          else if (code === 48) this.pen.bg = color.color;
          else this.pen.underlineColor = color.color;
        }
        i += color?.consumed ?? 1;
        continue;
      }

      switch (code) {
        case 0: {
          const url = this.pen.url;
          this.pen = defaultPen();
          this.pen.url = url;
          break;
        }
        case 1: this.pen.bold = true; break;
        case 2: this.pen.faint = true; break;
        case 3: this.pen.italic = true; break;
        case 4:
          this.pen.underline = underlineFrom(parts[1]);
          break;
        case 5: this.pen.blink = true; break;
        case 7: this.pen.inverse = true; break;
        case 8: this.pen.hidden = true; break;
        case 9: this.pen.strikethrough = true; break;
        case 21: this.pen.underline = 'double'; break;
        case 22: this.pen.bold = false; this.pen.faint = false; break;
        case 23: this.pen.italic = false; break;
        case 24: this.pen.underline = 'none'; break;
        case 25: this.pen.blink = false; break;
        case 27: this.pen.inverse = false; break;
        case 28: this.pen.hidden = false; break;
        case 29: this.pen.strikethrough = false; break;
        case 39: this.pen.fg = null; break;
        case 49: this.pen.bg = null; break;
        case 53: this.pen.overline = true; break;
        case 55: this.pen.overline = false; break;
        case 59: this.pen.underlineColor = null; break;
        default:
          if (code >= 30 && code <= 37) this.pen.fg = this.palette[code - 30] ?? null;
          else if (code >= 40 && code <= 47) this.pen.bg = this.palette[code - 40] ?? null;
          else if (code >= 90 && code <= 97) this.pen.fg = this.palette[code - 90 + 8] ?? null;
          else if (code >= 100 && code <= 107) this.pen.bg = this.palette[code - 100 + 8] ?? null;
          break;
      }
      i++;
    }
  }

  private extendedColor(parts: number[], params: string[], index: number): { color: Color; consumed: number } | null {
    // 冒号语法：38:5:n / 38:2:r:g:b / 38:2::r:g:b
    if (parts.length > 1) {
      if (parts[1] === 5 && Number.isFinite(parts[2])) return { color: this.palette[parts[2]] ?? null, consumed: 1 };
      if (parts[1] === 2) {
        const rgb = parts.slice(-3);
        if (rgb.every((value) => Number.isFinite(value))) return { color: { r: rgb[0], g: rgb[1], b: rgb[2] }, consumed: 1 };
      }
      return null;
    }
    // 分号语法：38;5;n / 38;2;r;g;b
    const mode = Number(params[index + 1]);
    if (mode === 5) {
      const n = Number(params[index + 2]);
      return { color: this.palette[n] ?? null, consumed: 3 };
    }
    if (mode === 2) {
      const r = Number(params[index + 2]);
      const g = Number(params[index + 3]);
      const b = Number(params[index + 4]);
      if ([r, g, b].every((value) => Number.isFinite(value))) return { color: { r, g, b }, consumed: 5 };
    }
    return null;
  }

  private setCharset(target: 0 | 1 | 2 | 3, ch: string): void {
    const charset: Charset = ch === '0' ? 'dec' : 'ascii';
    if (target === 0) this.charsetG0 = charset;
    else if (target === 1) this.charsetG1 = charset;
  }

  private applyCharset(grapheme: string): string {
    const charset = this.activeCharset === 1 ? this.charsetG1 : this.charsetG0;
    if (charset !== 'dec' || grapheme.length !== 1) return grapheme;
    return DEC_GRAPHICS[grapheme] ?? grapheme;
  }

  private enterAlt(clear: boolean): void {
    if (this.altActive) return;
    this.savedMain = {
      cursor: { ...this.cursor },
      pen: clonePen(this.pen),
      originMode: this.originMode,
      autoWrap: this.autoWrap,
      charsetG0: this.charsetG0,
      charsetG1: this.charsetG1,
      activeCharset: this.activeCharset,
      scrollTop: this.scrollTop,
      scrollBottom: this.scrollBottom,
    };
    this.altActive = true;
    const rows = this.buffer.length;
    this.resizeBuffer(this.altBuffer, this.cols, rows, false, 0);
    if (clear) this.altBuffer = this.makeRows(rows);
    this.buffer = this.altBuffer;
    this.cursor = { col: 0, row: 0 };
    this.pendingWrap = false;
    this.scrollTop = 0;
    this.scrollBottom = rows - 1;
    this.markAllDirty();
  }

  private exitAlt(): void {
    if (!this.altActive) return;
    const saved = this.savedMain;
    const rows = this.altBuffer.length;
    this.altActive = false;
    const savedRow = saved?.cursor.row ?? 0;
    const removedTop = this.resizeBuffer(this.mainBuffer, this.cols, rows, true, savedRow);
    this.buffer = this.mainBuffer;
    if (saved) {
      this.cursor = { col: clamp(saved.cursor.col, 0, this.cols - 1), row: clamp(savedRow - removedTop, 0, rows - 1) };
      this.pen = clonePen(saved.pen);
      this.originMode = saved.originMode;
      this.autoWrap = saved.autoWrap;
      this.charsetG0 = saved.charsetG0;
      this.charsetG1 = saved.charsetG1;
      this.activeCharset = saved.activeCharset;
      this.scrollTop = clamp(saved.scrollTop, 0, rows - 1);
      this.scrollBottom = clamp(saved.scrollBottom, this.scrollTop, rows - 1);
    } else {
      this.cursor = { col: 0, row: 0 };
      this.scrollTop = 0;
      this.scrollBottom = rows - 1;
    }
    this.savedMain = null;
    this.pendingWrap = false;
    this.markAllDirty();
  }

  /**
   * 行数变化时优先保住光标所在行：
   * - 光标在底部区域（cursorRow >= remove）：从顶部移入回滚，光标随之上移；
   * - 光标在顶部区域（cursorRow < remove）：裁掉底部行，光标/提示符原地不动。
   * 旧实现无条件裁顶部，会把靠近顶部的提示符推进回滚区，shell 随后重画提示符，
   * 造成“旧提示符在回滚里 + 新提示符在屏幕上”的重复行。
   */
  private resizeBuffer(
    buffer: ScreenCell[][],
    cols: number,
    rows: number,
    pushScrollback: boolean,
    cursorRow: number,
  ): number {
    for (const line of buffer) this.resizeLine(line, cols);
    if (buffer.length > rows) {
      const remove = buffer.length - rows;
      if (cursorRow >= remove) {
        for (let i = 0; i < remove; i++) {
          const line = buffer.shift()!;
          if (pushScrollback) this.pushScrollback(line);
        }
        return remove;
      }
      // 光标在顶部：保留顶部内容和光标行，裁掉底部。
      buffer.length = rows;
      return 0;
    }
    while (buffer.length < rows) buffer.push(this.makeBlankRow());
    return 0;
  }

  private resizeLine(line: ScreenCell[], cols: number): void {
    if (line.length > cols) {
      line.length = cols;
      const last = line[cols - 1];
      if (last?.wide) line[cols - 1] = blankCell(null);
    }
    while (line.length < cols) line.push(blankCell(null));
  }

  private respond(data: string): void {
    this.onResponse?.(data);
  }
}

function underlineFrom(value: number): UnderlineStyle {
  switch (value) {
    case 0: return 'none';
    case 2: return 'double';
    case 3: return 'curly';
    case 4: return 'dotted';
    case 5: return 'dashed';
    default: return 'single';
  }
}

export function createTerminalScreen(options: TerminalScreenOptions = {}): TerminalScreen {
  return new TerminalScreen(options);
}
