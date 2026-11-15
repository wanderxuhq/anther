// web/src/views/terminal.tsx
// HTML 终端：服务端是唯一的终端模拟器（方案 B），浏览器只消费快照/脏行 diff。
// 同一份屏幕缓存可切换两种渲染：
//   html（默认）— 路径可点、Markdown 可视化、长行自动换行
//   text        — 经典等宽纯文字（保留 ANSI 颜色，不做链接/Markdown）
// 切换只重绘，不重置 PTY、屏幕缓存或输入状态。
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import { DEFAULT_SCROLLBACK, type ScreenCell } from '../../../shared/terminal/vt.ts';
import { RemoteTerminalScreen } from '../terminal/remote.ts';
import { api, connectTerminal, type TerminalSocket } from '../api.ts';
import { fontScale, openPreviewTab, removeTerminalTab, theme } from '../stores.ts';
import { t } from '../i18n.ts';
import { CONTROL_LETTERS, TERMINAL_KEYS, applyTerminalModifiers, controlChar, keySequence, type TerminalKey } from '../terminal-keys.ts';
import { terminalKeyBarOpen, terminalRenderMode } from '../terminal/settings.ts';
import { createDebounce } from '../debounce.ts';
import {
  expireKeyBarFocus,
  initialKeyBarFocus,
  KEY_BAR_FOCUS_FALLBACK_MS,
  prepareKeyBarFocus as prepareFocusState,
  restoreKeyBarFocus as restoreFocusState,
  settleKeyBarFocus,
  type KeyBarFocusState,
} from '../terminal/key-bar-focus.ts';
import { classifyMarkdownRows, joinWrappedRows, type MarkdownBlock } from '../terminal/markdown-blocks.ts';
import { firstContentCell, joinLogicalCells } from '../terminal/logical.ts';
import { renderGridRow, renderRow, rowClass, rowRawText, type CursorInfo } from '../terminal/render.ts';
import { keyToSequence, pasteInput } from '../terminal/input.ts';
import {
  advanceTouchScroll,
  createTouchScrollState,
  startTouchScroll,
  takeTouchSteps,
} from '../terminal/touch-scroll.ts';
import { revealDirectory } from './filetree.tsx';

const MAX_SCROLLBACK_ROWS = DEFAULT_SCROLLBACK;
const FONT_SCALE_TO_PX = 0.14;
// ResizeObserver fires continuously during keyboard/address-bar animations.
const RESIZE_DEBOUNCE_MS = 120;

// 两排按键：第二排的第 6 个格子是 Down，第一排第 6 个格子是 Up，保持上下对齐。
const TOP_KEYS: TerminalKey[] = [TERMINAL_KEYS[2], TERMINAL_KEYS[6], TERMINAL_KEYS[7]];
const BOTTOM_KEYS: TerminalKey[] = [
  TERMINAL_KEYS[8], TERMINAL_KEYS[9], TERMINAL_KEYS[10], TERMINAL_KEYS[11],
  TERMINAL_KEYS[4], TERMINAL_KEYS[3], TERMINAL_KEYS[5], TERMINAL_KEYS[12],
];

function blockKey(block: MarkdownBlock): string {
  switch (block.kind) {
    case 'heading': return `h${block.level}:${block.text}`;
    case 'list': return `l:${block.prefix}:${block.text}`;
    case 'quote': return `q:${block.text}`;
    case 'code': return `c:${block.text}`;
    case 'table': return block.role === 'start' ? `t:${block.source}` : 't:body';
    default: return block.kind;
  }
}

/** Input method state: composing must not send partial text; settling skips the
 * input event that follows compositionend because that text was sent already. */
type TerminalImeState = 'idle' | 'composing' | 'settling';

/** Cell metrics plus the last PTY size sent to the server. */
type TerminalMeasurement = {
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
};

const createTerminalMeasurement = (): TerminalMeasurement => ({
  cols: 0, rows: 0, cellWidth: 0, cellHeight: 0,
});

/** Layout state shared by measurement and scrolling decisions. */
type TerminalLayout = {
  contentLarge: boolean;
  availableHeight: number;
  padY: number;
  keepBottom: boolean;
};

const createTerminalLayout = (): TerminalLayout => ({
  contentLarge: false, availableHeight: 0, padY: 0, keepBottom: false,
});

/** One object owns the rendered rows and the identity of the last frame. */
type RenderCache = {
  rows: HTMLDivElement[];
  html: string[];
  keys: string[];
  text: string[];
  start: number;
  first: number;
  cursor: number;
  mode: 'html' | 'text';
  alt: boolean;
};

const createRenderCache = (): RenderCache => ({
  rows: [], html: [], keys: [], text: [],
  start: -1, first: -1, cursor: -1, mode: 'html', alt: false,
});

/** 把一条逻辑行覆盖的多个终端物理行拼成一份单元格数组。 */
function joinedCells(screen: RemoteTerminalScreen, start: number, from: number, to: number): ScreenCell[] {
  const rows: ScreenCell[][] = [];
  for (let index = from; index < to; index++) rows.push(screen.getRowAbsolute(start + index));
  return joinLogicalCells(rows);
}

function parseCssColor(value: string): { r: number; g: number; b: number } | null {
  const v = value.trim();
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) };
    }
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  const rgb = v.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  return null;
}

/** OSC 7 是 file:// URL；预览接口需要普通绝对路径。 */
function cwdPath(value: string): string {
  if (!value) return '';
  if (value.startsWith('file://')) {
    try { return decodeURIComponent(new URL(value).pathname); } catch { return value; }
  }
  return value;
}

export function TerminalView(props: { id: string }) {
  let paneEl: HTMLDivElement | undefined;
  let scrollEl: HTMLDivElement | undefined;
  let rowsEl: HTMLDivElement | undefined;
  let measureEl: HTMLSpanElement | undefined;
  let inputEl: HTMLTextAreaElement | undefined;
  let screen: RemoteTerminalScreen | undefined;
  let socket: TerminalSocket | undefined;
  let send: ((data: string) => void) | undefined;
  let focusInput: (() => void) | undefined;
  let resizeObserver: ResizeObserver | undefined;
  const resizeDebounce = createDebounce(RESIZE_DEBOUNCE_MS);
  let renderFrame: number | undefined;
  let imeState: TerminalImeState = 'idle';
  let keyBarFocus: KeyBarFocusState = initialKeyBarFocus();
  let keyBarFocusRestoreTimer: ReturnType<typeof setTimeout> | undefined;
  let measurement = createTerminalMeasurement();
  let layout = createTerminalLayout();
  let lastMeta = '';
  let renderCache = createRenderCache();

  // 触摸滚动：全屏 TUI（备用屏幕 + 鼠标跟踪，任何应用都适用）里
  // 原生回滚不生效，用手势模拟滚轮事件（SGR 64/65）交给应用自己滚动。
  // 用 Pointer Events + 指针捕获：重绘替换手指下的 DOM 节点时，触摸事件会
  // 停止派发，但 pointer 事件仍会继续送到稳定的滚动容器。
  let touchPointerId: number | null = null;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchLastX = 0;
  let touchLastY = 0;
  let touchPendingX = 0;
  let touchPendingY = 0;
  let touchActive = false;
  let touchScrolling = false;
  // 手指是否已经产生明显位移（用于区分轻点和大范围滑动）。
  let touchMoved = false;
  // 当前滚动方向/累计量（纯函数状态机，见 terminal/touch-scroll.ts）。
  let touchScroll = createTouchScrollState();

  const [ctrlArmed, setCtrlArmed] = createSignal(false);
  const [shiftArmed, setShiftArmed] = createSignal(false);
  const [altArmed, setAltArmed] = createSignal(false);
  // 是否处于 TUI 模式，用于给滚动容器切换 touch-action。
  const [tuiPointerMode, setTuiPointerMode] = createSignal(false);

  const [tick, setTick] = createSignal(0);

  const sendText = (data: string) => {
    if (!data) return;
    send?.(data);
  };

  const clearKeyBarFocusTimer = () => {
    clearTimeout(keyBarFocusRestoreTimer);
    keyBarFocusRestoreTimer = undefined;
  };

  /** 按键条点击前记录软键盘状态；某些移动端浏览器会无视 preventDefault 抢焦点。 */
  const prepareKeyBarFocus = () => {
    const step = prepareFocusState(keyBarFocus, document.activeElement === inputEl);
    keyBarFocus = step.state;
    if (!step.armFallback) return;
    // 兜底：即使 click 没走到，也不让 focus tracking 永久被抑制。
    clearKeyBarFocusTimer();
    keyBarFocusRestoreTimer = setTimeout(() => {
      keyBarFocus = expireKeyBarFocus();
      keyBarFocusRestoreTimer = undefined;
    }, KEY_BAR_FOCUS_FALLBACK_MS);
  };

  /** 按键动作完成后恢复原焦点；只恢复原本就聚焦的输入框，不主动弹出键盘。 */
  const restoreKeyBarFocus = () => {
    const step = restoreFocusState(keyBarFocus);
    keyBarFocus = step.state;
    if (step.refocusNow) inputEl?.focus({ preventScroll: true });
    if (!step.scheduleSettle) return;
    clearKeyBarFocusTimer();
    // 再补一次延迟聚焦：某些浏览器会在 click 的默认动作里才移走焦点。
    keyBarFocusRestoreTimer = setTimeout(() => {
      keyBarFocusRestoreTimer = undefined;
      const settled = settleKeyBarFocus(keyBarFocus);
      keyBarFocus = settled.state;
      if (settled.refocus) inputEl?.focus({ preventScroll: true });
    }, 0);
  };

  const scheduleRender = () => {
    if (renderFrame !== undefined) return;
    renderFrame = requestAnimationFrame(() => {
      renderFrame = undefined;
      renderNow();
    });
  };

  const resetRendered = () => {
    renderCache.start = -1;
    renderCache.rows = [];
    renderCache.html = [];
    renderCache.keys = [];
    renderCache.text = [];
    renderCache.first = -1;
    renderCache.cursor = -1;
    rowsEl?.replaceChildren();
  };

  /** Measure the pane and request one render; callers must not schedule a second one. */
  const updateSize = () => {
    const pane = paneEl;
    const scroller = scrollEl;
    const measure = measureEl;
    if (!pane || !scroller || !measure || !screen) return;
    measure.textContent = 'M'.repeat(50);
    const cellW = measure.getBoundingClientRect().width / 50;
    const cellH = measure.getBoundingClientRect().height;
    if (!cellW || !cellH) return;
    measurement.cellWidth = cellW;
    measurement.cellHeight = cellH;

    const style = getComputedStyle(scroller);
    const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const paneWidth = scroller.clientWidth;
    const keys = pane.querySelector<HTMLElement>('.terminal-keys');
    const parent = pane.parentElement;
    const available = Math.max(1, (parent?.clientHeight ?? 0) - (keys?.offsetHeight ?? 0));
    const cols = Math.max(20, Math.floor((paneWidth - padX) / cellW));

    // 逻辑行列跟随当前可用高度；内容高度只影响视觉盒高度，不触发 PTY resize。
    const rows = Math.max(5, Math.floor((available - padY) / cellH));

    if (cols !== measurement.cols || rows !== measurement.rows) {
      measurement.cols = cols;
      measurement.rows = rows;
      // 浏览器不再本地 resize：服务端是唯一模拟器，resize 后由服务端 diff 带回新尺寸。
      socket?.resize(cols, rows);
    }

    layout.availableHeight = available;
    layout.padY = padY;
    const wasAtBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 8;
    if (wasAtBottom) layout.keepBottom = true;
    scheduleRender();
    sendMeta();
  };

  // 软键盘动画/地址栏伸缩会连续触发 ResizeObserver；防抖合并成一次 resize，
  // 避免动画期间反复 stty + SIGWINCH。
  const scheduleResize = () => resizeDebounce.schedule(updateSize);

  const sendMeta = () => {
    if (!socket) return;
    const root = getComputedStyle(document.documentElement);
    const scroller = scrollEl;
    const meta = {
      fg: parseCssColor(root.getPropertyValue('--term-fg')) ?? undefined,
      bg: parseCssColor(root.getPropertyValue('--bg')) ?? undefined,
      cursor: parseCssColor(root.getPropertyValue('--term-cursor-bg')) ?? undefined,
      pixelWidth: scroller?.clientWidth,
      pixelHeight: scroller?.clientHeight,
      cellWidth: measurement.cellWidth,
      cellHeight: measurement.cellHeight,
    };
    const key = JSON.stringify(meta);
    if (key === lastMeta) return;
    lastMeta = key;
    socket.meta(meta);
  };

  const renderNow = () => {
    const s = screen;
    const scroller = scrollEl;
    const container = rowsEl;
    if (!s || !scroller || !container) return;

    const mode = terminalRenderMode();
    const alt = s.getMode('altScreen') === true;
    const total = s.totalRows();
    const screenRows = s.screenRows();
    const first = s.firstRetainedRow();
    const screenStart = total - screenRows;
    const start = alt ? screenStart : Math.max(0, screenStart - MAX_SCROLLBACK_ROWS);
    const end = total;
    if (end <= start) return;

    const cursor = s.getCursor();
    const cursorVisible = s.getCursorVisible();
    const cursorShape = s.getCursorShape();
    const cursorBlinking = s.getCursorBlinking();
    const cursorAbs = screenStart + Math.max(0, Math.min(cursor.row, screenRows - 1));

    const dirty = s.takeDirty();
    const structureChanged = renderCache.start !== start || renderCache.mode !== mode || renderCache.alt !== alt || renderCache.first !== first;
    const forceAll = structureChanged || dirty.rows === 'all';
    const dirtyRows = new Set<number>();
    if (!forceAll && dirty.rows !== 'all') for (const row of dirty.rows) dirtyRows.add(row);
    if (renderCache.cursor >= 0) dirtyRows.add(renderCache.cursor);
    dirtyRows.add(cursorAbs);
    renderCache.first = first;
    renderCache.cursor = cursorAbs;

    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 8;
    const oldScrollTop = scroller.scrollTop;
    const oldScrollHeight = scroller.scrollHeight;

    if (structureChanged) {
      container.replaceChildren();
      renderCache.start = start;
      renderCache.rows = [];
      renderCache.html = [];
      renderCache.keys = [];
      renderCache.text = [];
    }
    renderCache.mode = mode;
    renderCache.alt = alt;

    const count = end - start;
    while (renderCache.rows.length > count) {
      renderCache.rows.pop()!.remove();
      renderCache.html.pop();
      renderCache.keys.pop();
    }
    while (renderCache.rows.length < count) {
      const el = document.createElement('div');
      container.appendChild(el);
      renderCache.rows.push(el);
      renderCache.html.push('\u0000');
      renderCache.keys.push('\u0000');
    }

    // 只刷新脏行/新行的文本缓存；单元格按需从 VT 屏幕网格读取，不长期缓存。
    for (let index = 0; index < count; index++) {
      const absolute = start + index;
      if (forceAll || renderCache.text[absolute] === undefined || dirtyRows.has(absolute)) {
        renderCache.text[absolute] = rowRawText(s.getRowAbsolute(absolute));
      }
    }

    const texts: string[] = [];
    for (let absolute = start; absolute < end; absolute++) texts.push(renderCache.text[absolute] ?? '');

    // 自动换行会把一条逻辑行拆成多个终端物理行。HTML 模式下按服务端的 wrapped
    // 标记拼回逻辑行：整行只渲染一次、续行隐藏，行内 Markdown/链接就不会在
    // 换行处被截断。纯文字和备用屏幕仍保持经典终端网格。
    const useLogical = mode === 'html' && !alt;
    let logicalTexts: string[] = [];
    let logicalStart: number[] = [];
    let logicalEnd: number[] = [];
    let logicalOfPhysical: number[] = [];
    let logicalBlocks: MarkdownBlock[] = [];
    let logicalDirty: boolean[] = [];
    const tableRowBlocks = new Array<MarkdownBlock | undefined>(count);

    if (useLogical) {
      // 宽字符放不下时行尾会留下占位空格；拼逻辑行前先去掉。
      const logicalInput = texts.slice();
      for (let index = 0; index + 1 < count; index++) {
        const absolute = start + index;
        if (!s.isRowAbsoluteWrapped(absolute + 1)) continue;
        if (firstContentCell(s.getRowAbsolute(absolute + 1))?.wide) {
          logicalInput[index] = logicalInput[index].replace(/ +$/, '');
        }
      }
      const joined = joinWrappedRows(logicalInput, (index) => s.isRowAbsoluteWrapped(start + index));
      logicalTexts = joined.texts;
      logicalStart = joined.starts;
      logicalEnd = logicalStart.map((value, index) =>
        index + 1 < logicalStart.length ? logicalStart[index + 1] : count);
      logicalOfPhysical = new Array<number>(count).fill(0);
      for (let index = 0; index < logicalStart.length; index++) {
        for (let row = logicalStart[index]; row < logicalEnd[index]; row++) logicalOfPhysical[row] = index;
      }
      logicalBlocks = classifyMarkdownRows(logicalTexts);

      // 表格只有在完全位于光标上方时才渲染成表格；碰到输入区就按普通逻辑行显示。
      for (const block of logicalBlocks) {
        if (block.kind !== 'table' || block.role !== 'start') continue;
        const first = logicalStart[block.start];
        const tableEnd = block.end < logicalStart.length ? logicalStart[block.end] : count;
        if (cursorAbs < start + tableEnd) continue;
        for (let row = first; row < tableEnd; row++) {
          tableRowBlocks[row] = row === first
            ? { kind: 'table', role: 'start', source: block.source, start: first, end: tableEnd }
            : { kind: 'table', role: 'body', start: first, end: tableEnd };
        }
      }

      logicalDirty = new Array<boolean>(logicalStart.length).fill(forceAll);
      if (!forceAll) {
        for (const absolute of dirtyRows) {
          const row = absolute - start;
          if (row >= 0 && row < count) logicalDirty[logicalOfPhysical[row]] = true;
        }
        // 表格任一行变化都要重绘首行（整张表在首行输出）。
        for (let index = 0; index < count; index++) {
          const block = tableRowBlocks[index];
          if (!block || block.kind !== 'table' || block.role !== 'start') continue;
          for (let row = block.start; row < block.end; row++) {
            if (dirtyRows.has(start + row)) {
              logicalDirty[logicalOfPhysical[block.start]] = true;
              break;
            }
          }
        }
      }
    }

    const cursorPhysical = cursorAbs - start;
    const cursorLogical = useLogical && cursorPhysical >= 0 && cursorPhysical < count
      ? logicalOfPhysical[cursorPhysical]
      : -1;
    const hiddenClass = 'term-row term-row-hidden';

    // 没有回滚且不在备用屏幕时，只显示到最后一个有内容的逻辑行（含光标行），
    // 让内容框按实际内容收缩；有回滚/全屏 TUI 时显示全部行并滚动。
    let contentEnd = count;
    if (!alt && s.getScrollbackLength() === 0) {
      let last = 0;
      for (let index = 0; index < count; index++) {
        if (texts[index].trim() !== '') last = index;
      }
      const lastContent = Math.max(1, last + 1, cursorPhysical + 1);
      if (useLogical) {
        const logicalIndex = logicalOfPhysical[Math.min(lastContent - 1, count - 1)];
        contentEnd = Math.min(count, logicalEnd[logicalIndex]);
      } else {
        contentEnd = Math.min(count, lastContent);
      }
    }

    for (let index = 0; index < count; index++) {
      const absolute = start + index;
      const el = renderCache.rows[index];

      if (index >= contentEnd) {
        const key = 'hidden';
        if (!forceAll && el.className === hiddenClass && renderCache.keys[index] === key) continue;
        if (el.className !== hiddenClass) el.className = hiddenClass;
        if (renderCache.html[index] !== '') {
          el.innerHTML = '';
          renderCache.html[index] = '';
        }
        renderCache.keys[index] = key;
        continue;
      }

      if (!useLogical) {
        // 纯文字/备用屏幕：一行一个物理行，保持经典终端网格。
        const active = alt || absolute >= cursorAbs;
        const markdown = mode === 'html' && !active;
        // 纯文字/备用屏幕不走 Markdown 分类；此分支只用普通行背景与样式。
        const block: MarkdownBlock = { kind: 'normal' };
        const cursorInfo = absolute === cursorAbs && cursorVisible
          ? { col: cursor.col, visible: true, shape: cursorShape, blinking: cursorBlinking }
          : undefined;
        const options = { mode, markdown, linkify: mode === 'html', cursor: cursorInfo, block };
        const className = rowClass(block, options);
        const key = blockKey(block);
        const needs = forceAll || dirtyRows.has(absolute) || renderCache.html[index] === '\u0000' || renderCache.keys[index] !== key || el.className !== className;
        if (!needs) continue;
        const cells = s.getRowAbsolute(absolute);
        const rendered = renderGridRow(cells, options);
        const html = rendered.background
          ? `${rendered.background}<span class="term-row-content">${rendered.html}</span>` : rendered.html;
        if (el.className !== className) el.className = className;
        if (renderCache.html[index] !== html) {
          el.innerHTML = html;
          renderCache.html[index] = html;
        }
        renderCache.keys[index] = key;
        continue;
      }

      const tableBlock = tableRowBlocks[index];
      if (tableBlock && tableBlock.kind === 'table' && tableBlock.role === 'body') {
        const key = 'hidden';
        if (!forceAll && el.className === hiddenClass && renderCache.keys[index] === key) continue;
        if (el.className !== hiddenClass) el.className = hiddenClass;
        if (renderCache.html[index] !== '') {
          el.innerHTML = '';
          renderCache.html[index] = '';
        }
        renderCache.keys[index] = key;
        continue;
      }

      if (tableBlock && tableBlock.kind === 'table') {
        const options = { mode, markdown: true, linkify: true, block: tableBlock };
        const className = rowClass(tableBlock, options);
        const key = blockKey(tableBlock);
        const logicalIndex = logicalOfPhysical[index];
        const needs = forceAll || logicalDirty[logicalIndex] || renderCache.html[index] === '\u0000' || renderCache.keys[index] !== key || el.className !== className;
        if (!needs) continue;
        const html = renderRow(s.getRowAbsolute(absolute), options);
        if (el.className !== className) el.className = className;
        if (renderCache.html[index] !== html) {
          el.innerHTML = html;
          renderCache.html[index] = html;
        }
        renderCache.keys[index] = key;
        continue;
      }

      const logicalIndex = logicalOfPhysical[index];
      if (logicalStart[logicalIndex] !== index) {
        // 非表格逻辑行的续行：内容已经在首行渲染，这里隐藏。
        const key = 'hidden';
        if (!forceAll && el.className === hiddenClass && renderCache.keys[index] === key) continue;
        if (el.className !== hiddenClass) el.className = hiddenClass;
        if (renderCache.html[index] !== '') {
          el.innerHTML = '';
          renderCache.html[index] = '';
        }
        renderCache.keys[index] = key;
        continue;
      }

      // 一条逻辑行的首行：整行渲染一次。
      const logicalEndAbs = start + logicalEnd[logicalIndex];
      const active = logicalEndAbs > cursorAbs;
      const sourceBlock = logicalBlocks[logicalIndex];
      const markdown = !active;
      const block: MarkdownBlock = markdown && sourceBlock.kind !== 'table'
        ? sourceBlock
        : { kind: 'normal' };
      let cursorInfo: CursorInfo | undefined;
      if (logicalIndex === cursorLogical && cursorVisible) {
        const offset = cursorPhysical - logicalStart[logicalIndex];
        cursorInfo = {
          col: offset * s.cols + cursor.col,
          visible: true,
          shape: cursorShape,
          blinking: cursorBlinking,
        };
      }
      const options = { mode, markdown, linkify: true, cursor: cursorInfo, block };
      let className = rowClass(block, options);
      if (block.kind === 'normal') className = 'term-row term-row-html';
      else if (block.kind === 'code') className += ' term-row-logical';
      const key = block.kind === 'normal' ? `n:${logicalTexts[logicalIndex]}` : blockKey(block);
      const needs = forceAll || logicalDirty[logicalIndex] || renderCache.html[index] === '\u0000' || renderCache.keys[index] !== key || el.className !== className;
      if (!needs) continue;
      const cells = joinedCells(s, start, logicalStart[logicalIndex], logicalEnd[logicalIndex]);
      const html = renderRow(cells, options);
      if (el.className !== className) el.className = className;
      if (renderCache.html[index] !== html) {
        el.innerHTML = html;
        renderCache.html[index] = html;
      }
      renderCache.keys[index] = key;
    }

    // 逻辑行由多行拼成，实际高度只能渲染后量；用真实 DOM 高度决定内容框和滚动位置。
    const measuredHeight = container.getBoundingClientRect().height;
    const contentHeight = measuredHeight + layout.padY;
    const available = layout.availableHeight > 0 ? layout.availableHeight : contentHeight;
    const contentLarge = contentHeight >= available - 1;
    const becameLarge = contentLarge && !layout.contentLarge;
    const visualHeight = Math.max(measurement.cellHeight + layout.padY, Math.min(contentHeight, available));
    if (Math.abs(scroller.getBoundingClientRect().height - visualHeight) > 0.5) {
      scroller.style.height = `${visualHeight}px`;
    }
    if (!contentLarge) scroller.scrollTop = 0;
    else if (atBottom || layout.keepBottom || becameLarge) scroller.scrollTop = scroller.scrollHeight;
    else if (structureChanged && oldScrollHeight > 0) scroller.scrollTop = oldScrollTop * (scroller.scrollHeight / oldScrollHeight);
    else scroller.scrollTop = oldScrollTop;
    layout.keepBottom = false;
    layout.contentLarge = contentLarge;
  };

  // 每个终端 id 一套 VT 缓冲区 + WS；渲染模式变化不会进入这里。
  createEffect(on(() => props.id, (id) => {
    resetRendered();
    setCtrlArmed(false);
    measurement.cols = 0;
    measurement.rows = 0;
    layout.contentLarge = false;
    layout.keepBottom = false;
    lastMeta = '';
    renderCache.mode = terminalRenderMode();
    renderCache.alt = false;

    const s = new RemoteTerminalScreen();
    screen = s;

    const syncTuiPointerMode = () => {
      setTuiPointerMode(s.getMode('mouseTracking') === true && s.getMode('altScreen') === true);
    };

    const sock = connectTerminal(id, {
      // 首次/重连：清空本地缓存，等服务端快照重建画面（进程与信号不中断）。
      onOpen: () => {
        s.reset();
        resetRendered();
        scheduleRender();
        lastMeta = '';
        setTuiPointerMode(false);
        sendMeta();
      },
      onScreen: (snapshot) => {
        s.applySnapshot(snapshot);
        syncTuiPointerMode();
        setTick((value) => value + 1);
      },
      onScreenDiff: (diff) => {
        s.applyDiff(diff);
        syncTuiPointerMode();
        setTick((value) => value + 1);
      },
      onExit: () => removeTerminalTab(id),
    });
    socket = sock;
    send = (data) => { if (data) sock.input(data); };
    focusInput = () => inputEl?.focus({ preventScroll: true });
    // 桌面端自动聚焦，手机端不主动弹软键盘。
    if (window.matchMedia('(pointer: fine)').matches) queueMicrotask(() => focusInput?.());

    resizeObserver = new ResizeObserver(scheduleResize);
    if (scrollEl) resizeObserver.observe(scrollEl);
    // 内容盒高度是显式设置的，键盘/地址栏变化时 scrollEl 自身尺寸可能不变；
    // 观察外层编辑区，保证可用高度变化能触发重新布局。
    const area = paneEl?.parentElement;
    if (area) resizeObserver.observe(area);
    updateSize();

    onCleanup(() => {
      if (renderFrame !== undefined) cancelAnimationFrame(renderFrame);
      renderFrame = undefined;
      resizeDebounce.cancel();
      clearKeyBarFocusTimer();
      keyBarFocus = initialKeyBarFocus();
      resizeObserver?.disconnect();
      resizeObserver = undefined;
      sock.dispose();
      socket = undefined;
      screen = undefined;
      send = undefined;
      focusInput = undefined;
      resetRendered();
      layout.contentLarge = false;
      layout.keepBottom = false;
      lastMeta = '';
    });
  }));

  // 渲染模式/新输出 → 只重绘。
  createEffect(() => {
    terminalRenderMode();
    tick();
    if (!screen) return;
    // 尺寸/字号变化由 ResizeObserver、字号和按键条 effect 负责；
    // 每条 diff 都重新测量会强制同步布局，滚动时会造成掉帧。
    scheduleRender();
  });

  // 主工具栏切换渲染模式后，桌面端把焦点还给终端输入；手机端不主动弹软键盘。
  createEffect(on(terminalRenderMode, () => {
    if (window.matchMedia('(pointer: fine)').matches) focusInput?.();
  }, { defer: true }));

  // 主题色变化同步给服务端，供 OSC 10/11 本地回应。
  createEffect(() => {
    theme();
    sendMeta();
  });

  // 按键条开合会改变可用高度：等 DOM 更新后重新测量并触发 PTY resize。
  // 收起后修饰键按钮不可见，同时清掉待发的 Ctrl/Shift/Alt。
  createEffect(on(terminalKeyBarOpen, (open) => {
    if (!open) {
      setCtrlArmed(false);
      setShiftArmed(false);
      setAltArmed(false);
    }
    scheduleResize();
  }, { defer: true }));

  // 字号跟随全局设置；重新测量列宽/行高后回发 resize。
  createEffect(() => {
    const size = Math.round(fontScale() * FONT_SCALE_TO_PX);
    if (scrollEl) scrollEl.style.fontSize = `${size}px`;
    updateSize();
  });

  const barSequence = (id: string): string | null => {
    if (screen?.getMode('applicationCursor') === true) {
      const arrows: Record<string, string> = { up: 'A', down: 'B', left: 'D', right: 'C', home: 'H', end: 'F' };
      if (arrows[id]) return `\x1bO${arrows[id]}`;
    }
    return keySequence(id);
  };

  const toggleModifier = (mod: 'ctrl' | 'shift' | 'alt') => {
    if (mod === 'ctrl') {
      setCtrlArmed((value) => !value);
      setShiftArmed(false);
      setAltArmed(false);
    } else if (mod === 'shift') {
      setShiftArmed((value) => !value);
      setCtrlArmed(false);
      setAltArmed(false);
    } else {
      setAltArmed((value) => !value);
      setCtrlArmed(false);
      setShiftArmed(false);
    }
    inputEl?.blur();
  };

  // Shift/Alt 是粘性修饰键：只作用于下一次输入或按键，发送后自动取消。
  const applyModifiers = (data: string): string => {
    const shift = shiftArmed();
    const alt = altArmed();
    if (!shift && !alt) return data;
    setShiftArmed(false);
    setAltArmed(false);
    return applyTerminalModifiers(data, shift, alt);
  };

  const pressKey = (id: string) => {
    const data = barSequence(id);
    if (data === null) return;
    sendText(applyModifiers(data));
    inputEl?.blur();
  };

  const pressCtrl = (letter: string) => {
    const data = controlChar(letter);
    if (data !== null) sendText(data);
    setCtrlArmed(false);
    inputEl?.blur();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'c') {
      const text = window.getSelection()?.toString();
      if (text) {
        event.preventDefault();
        void navigator.clipboard?.writeText(text).catch(() => { /* 无剪贴板权限时忽略 */ });
        return;
      }
    }
    if (event.shiftKey && event.key === 'PageUp') {
      event.preventDefault();
      scrollEl?.scrollBy({ top: -scrollEl.clientHeight * 0.9 });
      return;
    }
    if (event.shiftKey && event.key === 'PageDown') {
      event.preventDefault();
      scrollEl?.scrollBy({ top: scrollEl.clientHeight * 0.9 });
      return;
    }
    if (ctrlArmed() && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing) {
      const data = controlChar(event.key);
      if (data !== null) {
        event.preventDefault();
        event.stopPropagation();
        sendText(data);
        setCtrlArmed(false);
        return;
      }
    }
    const sequence = keyToSequence(event, screen?.getMode('applicationCursor') === true);
    if (sequence !== null) {
      event.preventDefault();
      sendText(applyModifiers(sequence));
    }
  };

  const handleInput = () => {
    if (imeState !== 'idle' || !inputEl) return;
    const value = inputEl.value;
    inputEl.value = '';
    if (value) sendText(applyModifiers(value.replace(/\n/g, '\r')));
  };

  const handleBeforeInput = (event: InputEvent) => {
    if (imeState === 'composing') return;
    if (event.inputType === 'deleteContentBackward') {
      event.preventDefault();
      sendText(applyModifiers('\x7f'));
    } else if (event.inputType === 'deleteContentForward') {
      event.preventDefault();
      sendText(applyModifiers('\x1b[3~'));
    } else if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') {
      event.preventDefault();
      sendText(applyModifiers('\r'));
    }
  };

  const handlePaste = (event: ClipboardEvent) => {
    event.preventDefault();
    setCtrlArmed(false);
    setShiftArmed(false);
    setAltArmed(false);
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (text) sendText(pasteInput(text, screen?.getMode('bracketedPaste') === true));
  };

  const handleCompositionEnd = (event: CompositionEvent) => {
    imeState = 'settling';
    setCtrlArmed(false);
    setShiftArmed(false);
    setAltArmed(false);
    const text = event.data || inputEl?.value || '';
    if (inputEl) inputEl.value = '';
    if (text) sendText(text);
    queueMicrotask(() => { if (imeState === 'settling') imeState = 'idle'; });
  };

  const reportMouseAt = (clientX: number, clientY: number, button: number, release = false): boolean => {
    const rows = rowsEl;
    if (!rows || !measurement.cellWidth || !measurement.cellHeight) return false;
    const rect = rows.getBoundingClientRect();
    const col = Math.max(0, Math.min(measurement.cols - 1, Math.floor((clientX - rect.left) / measurement.cellWidth)));
    const row = Math.max(0, Math.min(measurement.rows - 1, Math.floor((clientY - rect.top) / measurement.cellHeight)));
    if (screen?.getMode('sgrMouse') === true) {
      sendText(`\x1b[<${button};${col + 1};${row + 1}${release ? 'm' : 'M'}`);
    } else {
      sendText(`\x1b[M${String.fromCharCode(32 + (release ? 3 : button), 32 + col + 1, 32 + row + 1)}`);
    }
    return true;
  };

  const reportMouse = (event: MouseEvent, button: number, release = false): boolean =>
    reportMouseAt(event.clientX, event.clientY, button, release);

  const inTuiMouseMode = () =>
    screen?.getMode('mouseTracking') === true && screen?.getMode('altScreen') === true;

  const handlePointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'touch') {
      if (!inTuiMouseMode() || touchActive) return;
      resetTouchScroll();
      touchPointerId = event.pointerId;
      touchActive = true;
      touchStartX = event.clientX;
      touchStartY = event.clientY;
      touchLastX = event.clientX;
      touchLastY = event.clientY;
      // 捕获到稳定的滚动容器：即使重绘把手指下的节点替换掉，move/up 仍会送来这里。
      try { scrollEl?.setPointerCapture(event.pointerId); } catch { /* ignore */ }
      // 接管手势，压掉兼容鼠标事件；轻点/链接在 pointerup 里按坐标手动处理。
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    if ((event.target as HTMLElement | null)?.closest('.term-link, .term-url')) return;
    if (screen?.getMode('mouseTracking') === true) reportMouse(event, 0);
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || !touchActive || event.pointerId !== touchPointerId) return;
    const dx = event.clientX - touchLastX;
    const dy = event.clientY - touchLastY;
    touchLastX = event.clientX;
    touchLastY = event.clientY;

    let justStarted = false;
    if (!touchScrolling) {
      touchPendingX += dx;
      touchPendingY += dy;
      if (Math.abs(touchPendingY) >= 10 && Math.abs(touchPendingY) > Math.abs(touchPendingX)) {
        touchMoved = true;
        touchScrolling = true;
        // 把阈值阶段累计的纵向位移也算进去。
        startTouchScroll(touchScroll, touchPendingY);
        touchPendingX = 0;
        touchPendingY = 0;
        justStarted = true;
      } else if (Math.abs(touchPendingX) >= 10 && Math.abs(touchPendingX) >= Math.abs(touchPendingY)) {
        // 横向阶段：不结束整个手势，清空累计后继续等纵向动作。
        touchMoved = true;
        touchPendingX = 0;
        touchPendingY = 0;
        return;
      } else {
        return;
      }
    }

    // 阻止原生滚动/overscroll，把纵向位移翻译成滚轮事件。
    event.preventDefault();
    if (!justStarted) {
      const switched = advanceTouchScroll(touchScroll, dy);
      // 方向刚切换的这一帧先不发：下一帧确认方向仍然一致，避免回弹/坐标跳变反向滚一下。
      if (switched) return;
    }

    const step = Math.max(32, measurement.cellHeight * 2);
    const steps = takeTouchSteps(touchScroll, step);
    if (steps === 0) return;
    // 固定用手势起点上报：一次滑动等价于“在该位置连续转动滚轮”。
    const button = steps > 0 ? 64 : 65;
    for (let index = 0; index < Math.abs(steps); index++) {
      reportMouseAt(touchStartX, touchStartY, button);
    }
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (event.pointerType === 'touch') {
      if (!touchActive || event.pointerId !== touchPointerId) return;
      const wasScrolling = touchScrolling;
      const moved = touchMoved;
      try { scrollEl?.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
      resetTouchScroll();
      // 滚动/滑动结束时不再补发点击；否则把轻点当成一次鼠标点击交给 TUI。
      if (wasScrolling || moved) return;
      const tui = inTuiMouseMode();
      // TUI 里原生 click 被 preventDefault 压掉了：链接按坐标手动触发。
      if (tui && activateTouchTarget(event.clientX, event.clientY)) return;
      if (screen?.getMode('mouseTracking') === true) {
        reportMouseAt(event.clientX, event.clientY, 0);
        reportMouseAt(event.clientX, event.clientY, 0, true);
      }
      if (tui) focusInput?.();
      return;
    }
    if (event.button !== 0) return;
    if ((event.target as HTMLElement | null)?.closest('.term-link, .term-url')) return;
    if (screen?.getMode('mouseTracking') === true) reportMouse(event, 0, true);
  };

  const handlePointerCancel = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || event.pointerId !== touchPointerId) return;
    resetTouchScroll();
  };

  const handleLostPointerCapture = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || event.pointerId !== touchPointerId || !touchActive) return;
    resetTouchScroll();
  };

  const handleWheel = (event: WheelEvent) => {
    // 只在全屏 TUI 里把滚轮交给应用；普通 shell 保留原生回滚。
    if (!inTuiMouseMode()) return;
    if (reportMouse(event, event.deltaY < 0 ? 64 : 65)) event.preventDefault();
  };

  /** 终端里的可点击路径：鼠标点击和触摸轻点共用同一套打开逻辑。 */
  const activateTermPath = (target: HTMLElement) => {
    const path = target.dataset.termPath;
    if (!path) return;
    const line = Number(target.dataset.termLine) || undefined;
    void (async () => {
      try {
        const located = await api.terminals.resolve(path, cwdPath(screen?.getCwd() || '') || undefined);
        if (located.kind === 'file') await openPreviewTab(located.path, line ? { start: line, end: line } : null);
        else await revealDirectory(located.path);
      } catch {
        // 路径识别是启发式的：文件不存在时静默忽略，不弹提示、不做任何事。
      }
    })();
  };

  /** touchstart 的 preventDefault 会压掉原生 click，轻点时按坐标找链接并手动触发。 */
  const activateTouchTarget = (clientX: number, clientY: number): boolean => {
    const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    if (!element) return false;
    const path = element.closest<HTMLElement>('[data-term-path]');
    if (path) {
      activateTermPath(path);
      return true;
    }
    const url = element.closest<HTMLAnchorElement>('a[href]');
    if (url) {
      url.click();
      return true;
    }
    return false;
  };

  const resetTouchScroll = () => {
    touchPointerId = null;
    touchActive = false;
    touchScrolling = false;
    touchMoved = false;
    touchPendingX = 0;
    touchPendingY = 0;
    touchScroll = createTouchScrollState();
  };

  // 用 pointer 事件而不是 touch：滚动重绘会替换手指下的节点，Chrome 会停止
  // 给被移除的节点派发 touchmove/touchend；pointer 事件仍按当前位置派发。
  // pointerdown/move 需要非 passive 才能 preventDefault 接管手势。
  onMount(() => {
    const el = scrollEl;
    if (!el) return;
    el.addEventListener('pointerdown', handlePointerDown, { passive: false });
    el.addEventListener('pointermove', handlePointerMove, { passive: false });
    el.addEventListener('pointerup', handlePointerUp);
    el.addEventListener('pointercancel', handlePointerCancel);
    el.addEventListener('lostpointercapture', handleLostPointerCapture);
    onCleanup(() => {
      el.removeEventListener('pointerdown', handlePointerDown);
      el.removeEventListener('pointermove', handlePointerMove);
      el.removeEventListener('pointerup', handlePointerUp);
      el.removeEventListener('pointercancel', handlePointerCancel);
      el.removeEventListener('lostpointercapture', handleLostPointerCapture);
      resetTouchScroll();
    });
  });

  const focusOnPaneClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, textarea, select, [role="button"], .terminal-keys')) return;
    // 在终端内容上拖选文本时不抢焦点；点空白/工具栏区域则总是聚焦。
    if (scrollEl?.contains(target) && window.getSelection()?.toString()) return;
    focusInput?.();
  };

  const handleClick = (event: MouseEvent) => {
    const element = event.target as HTMLElement | null;
    const target = element?.closest<HTMLElement>('[data-term-path]');
    if (!target) {
      if (element?.closest('.term-url')) return; // 外链交给浏览器
      // 拖动选择文本时不抢焦点，避免破坏原生选择。
      if (!window.getSelection()?.toString()) focusInput?.();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    activateTermPath(target);
  };

  const renderKey = (key: TerminalKey) => (
    <button class="terminal-key" title={key.aria} aria-label={key.aria} onClick={() => pressKey(key.id)}>
      {key.label}
    </button>
  );

  const topKeys = () => (
    <>
      <button class="terminal-key" title="Escape" aria-label="Escape" onClick={() => pressKey('esc')}>Esc</button>
      <button class="terminal-key" title="Tab" aria-label="Tab" onClick={() => pressKey('tab')}>Tab</button>
      <button
        class="terminal-key terminal-key-ctrl"
        classList={{ active: ctrlArmed() }}
        aria-pressed={ctrlArmed()}
        title={t('terminal.armCtrl')}
        aria-label={t('terminal.armCtrl')}
        onClick={() => toggleModifier('ctrl')}
      >Ctrl</button>
      <button
        class="terminal-key"
        classList={{ active: shiftArmed() }}
        aria-pressed={shiftArmed()}
        title={t('terminal.armShift')}
        aria-label={t('terminal.armShift')}
        onClick={() => toggleModifier('shift')}
      >Shift</button>
      <button
        class="terminal-key"
        classList={{ active: altArmed() }}
        aria-pressed={altArmed()}
        title={t('terminal.armAlt')}
        aria-label={t('terminal.armAlt')}
        onClick={() => toggleModifier('alt')}
      >Alt</button>
      <For each={TOP_KEYS}>{renderKey}</For>
    </>
  );

  const bottomKeys = () => <For each={BOTTOM_KEYS}>{renderKey}</For>;

  return (
    <div class="terminal-pane" ref={(el) => (paneEl = el)} onClick={focusOnPaneClick}>
      <div
        class="terminal-scroll"
        classList={{
          'terminal-html': terminalRenderMode() === 'html',
          'terminal-text': terminalRenderMode() === 'text',
          // TUI 里接管纵向手势，禁止浏览器把单指滑动当成页面/容器滚动。
          'terminal-tui': tuiPointerMode(),
        }}
        ref={(el) => (scrollEl = el)}
        onClick={handleClick}
        onWheel={handleWheel}
        onContextMenu={(event) => { if (tuiPointerMode()) event.preventDefault(); }}
        onDragStart={(event) => { if (tuiPointerMode()) event.preventDefault(); }}
      >
        <div class="terminal-rows" ref={(el) => (rowsEl = el)} />
        <span class="terminal-measure" ref={(el) => (measureEl = el)} aria-hidden="true" />
      </div>

      <textarea
        class="terminal-input"
        ref={(el) => (inputEl = el)}
        aria-label={t('terminal.input')}
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck={false}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        onBeforeInput={handleBeforeInput}
        onPaste={handlePaste}
        onCompositionStart={() => { imeState = 'composing'; }}
        onCompositionEnd={handleCompositionEnd}
        onFocus={() => {
          if (!keyBarFocus.suppressTracking && screen?.getMode('focusTracking') === true) sendText('\x1b[I');
        }}
        onBlur={() => {
          if (!keyBarFocus.suppressTracking && screen?.getMode('focusTracking') === true) sendText('\x1b[O');
        }}
      />

      <div
        class="terminal-keys"
        classList={{ open: terminalKeyBarOpen() }}
        role="toolbar"
        aria-label={t('terminal.keys')}
        onPointerDown={(event) => {
          // 按键条不抢焦点：手机键盘保持原来的打开/关闭状态。
          prepareKeyBarFocus();
          if ((event.target as HTMLElement | null)?.closest('.terminal-key')) event.preventDefault();
        }}
        onMouseDown={(event) => {
          prepareKeyBarFocus();
          if ((event.target as HTMLElement | null)?.closest('.terminal-key')) event.preventDefault();
        }}
        onClick={() => restoreKeyBarFocus()}
      >
        <Show when={!ctrlArmed()} fallback={
          <>
            <div class="terminal-key-scroll">
              <div class="terminal-key-grid">{topKeys()}</div>
            </div>
            <div class="terminal-key-scroll">
              <div class="terminal-key-grid terminal-key-grid-letters">
                <For each={CONTROL_LETTERS}>
                  {(letter) => (
                    <button class="terminal-key" title={`Ctrl+${letter}`} aria-label={`Ctrl+${letter}`} onClick={() => pressCtrl(letter)}>
                      ^{letter}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </>
        }>
          <div class="terminal-key-scroll">
            <div class="terminal-key-grid">
              {topKeys()}
              {bottomKeys()}
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
