// web/src/terminal/remote.ts
// 方案 B 的浏览器侧屏幕缓存：不再解析 ANSI，只消费服务端快照/脏行 diff。
// 对外暴露与 shared/terminal/vt.ts 的 TerminalScreen 相同的只读接口子集，
// 这样 views/terminal.tsx 的渲染、Markdown、链接、光标逻辑可以原样复用。
import type { Cursor, CursorShape, DirtyRegion, ScreenCell } from '../../../shared/terminal/vt.ts';
import {
  deserializeRow,
  type ScreenDiff,
  type ScreenModes,
  type ScreenSnapshot,
} from '../../../shared/terminal/serialize.ts';

const NO_MODES: ScreenModes = {
  altScreen: false,
  bracketedPaste: false,
  applicationCursor: false,
  mouseTracking: false,
  sgrMouse: false,
  focusTracking: false,
};

function emptyCell(): ScreenCell {
  return {
    char: ' ', fg: null, bg: null, bold: false, faint: false, italic: false,
    underline: 'none', underlineColor: null, overline: false, strikethrough: false,
    inverse: false, hidden: false, blink: false, wide: false, protected: false, url: null,
  };
}

export class RemoteTerminalScreen {
  cols = 80;
  private rows = 24;
  private first = 0;
  private total = 24;
  private scrollback = 0;
  private lines = new Map<number, ScreenCell[]>();
  private cursor: Cursor = { col: 0, row: 0 };
  private cursorVisible = true;
  private cursorShape: CursorShape = 'block';
  private cursorBlinking = true;
  private modes: ScreenModes = { ...NO_MODES };
  private title = '';
  private cwd = '';
  private dirtyRows: Set<number> | 'all' = 'all';
  private dirtyCursor = true;
  private cachedEmptyRow: ScreenCell[] = [];

  reset(): void {
    this.cols = 80;
    this.rows = 24;
    this.first = 0;
    this.total = 24;
    this.scrollback = 0;
    this.lines = new Map();
    this.cursor = { col: 0, row: 0 };
    this.cursorVisible = true;
    this.cursorShape = 'block';
    this.cursorBlinking = true;
    this.modes = { ...NO_MODES };
    this.title = '';
    this.cwd = '';
    this.dirtyRows = 'all';
    this.dirtyCursor = true;
    this.cachedEmptyRow = [];
  }

  applySnapshot(snapshot: ScreenSnapshot): void {
    this.cols = snapshot.cols;
    this.rows = snapshot.rows;
    this.first = snapshot.first;
    this.total = snapshot.total;
    this.scrollback = snapshot.scrollback;
    this.lines = new Map();
    for (let index = 0; index < snapshot.lines.length; index++) {
      this.lines.set(index, deserializeRow(snapshot.lines[index], snapshot.styles, snapshot.cols));
    }
    this.applyMeta(snapshot);
    this.dirtyRows = 'all';
    this.dirtyCursor = true;
    this.cachedEmptyRow = [];
  }

  applyDiff(diff: ScreenDiff): void {
    // 回滚区被截断时，服务端 first 增大；所有保留行的编号整体前移。
    const delta = diff.first - this.first;
    if (delta > 0) {
      const shifted = new Map<number, ScreenCell[]>();
      for (const [index, line] of this.lines) {
        const next = index - delta;
        if (next >= 0) shifted.set(next, line);
      }
      this.lines = shifted;
    }

    this.cols = diff.cols;
    this.rows = diff.rows;
    this.first = diff.first;
    this.total = diff.total;
    this.scrollback = diff.scrollback;
    for (const line of diff.lines) {
      this.lines.set(line.row, deserializeRow(line, diff.styles, diff.cols));
      this.markDirty(line.row);
    }
    // 尺寸收缩/回滚截断后，清掉窗口外的行，避免 getRowAbsolute 读到旧内容。
    for (const index of this.lines.keys()) {
      if (index >= diff.total) this.lines.delete(index);
    }
    this.applyMeta(diff);
    this.dirtyCursor = true;
    this.cachedEmptyRow = [];
  }

  private applyMeta(meta: Omit<ScreenSnapshot, 'lines' | 'styles'>): void {
    this.cursor = { col: meta.cursor.col, row: meta.cursor.row };
    this.cursorVisible = meta.cursorVisible;
    this.cursorShape = meta.cursorShape;
    this.cursorBlinking = meta.cursorBlinking;
    this.modes = { ...meta.modes };
    this.title = meta.title;
    this.cwd = meta.cwd;
  }

  private markDirty(row: number): void {
    if (this.dirtyRows === 'all') return;
    this.dirtyRows.add(row);
  }

  takeDirty(): DirtyRegion {
    const result: DirtyRegion = { rows: this.dirtyRows, cursor: this.dirtyCursor, scrolled: 0 };
    this.dirtyRows = new Set();
    this.dirtyCursor = false;
    return result;
  }

  screenRows(): number { return this.rows; }
  totalRows(): number { return this.total; }
  firstRetainedRow(): number { return this.first; }
  getScrollbackLength(): number { return this.scrollback; }

  private emptyRow(): ScreenCell[] {
    if (this.cachedEmptyRow.length !== this.cols) {
      this.cachedEmptyRow = Array.from({ length: this.cols }, emptyCell);
    }
    return this.cachedEmptyRow;
  }

  getRowAbsolute(row: number): ScreenCell[] {
    return this.lines.get(row) ?? this.emptyRow();
  }

  getRow(row: number): ScreenCell[] {
    return this.getRowAbsolute(this.total - this.rows + row);
  }

  getCursor(): Cursor { return { col: this.cursor.col, row: this.cursor.row }; }
  getCursorVisible(): boolean { return this.cursorVisible; }
  getCursorShape(): CursorShape { return this.cursorShape; }
  getCursorBlinking(): boolean { return this.cursorBlinking; }
  getTitle(): string { return this.title; }
  getCwd(): string { return this.cwd; }

  getMode(mode: string): boolean | null {
    if (mode in this.modes) return this.modes[mode as keyof ScreenModes];
    return null;
  }
}
