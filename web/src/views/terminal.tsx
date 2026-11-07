// web/src/views/terminal.tsx
// HTML 终端：服务端是唯一的终端模拟器（方案 B），浏览器只消费快照/脏行 diff。
// 同一份屏幕缓存可切换两种渲染：
//   html（默认）— 路径可点、Markdown 可视化、长行自动换行
//   text        — 经典等宽纯文字（保留 ANSI 颜色，不做链接/Markdown）
// 切换只重绘，不重置 PTY、屏幕缓存或输入状态。
import { createEffect, createSignal, For, on, onCleanup, Show } from 'solid-js';
import { DEFAULT_SCROLLBACK, type ScreenCell } from '../../../shared/terminal/vt.ts';
import { RemoteTerminalScreen } from '../terminal/remote.ts';
import { api, connectTerminal, type TerminalSocket } from '../api.ts';
import { fontScale, openPreviewTab, removeTerminalTab, theme } from '../stores.ts';
import { t } from '../i18n.ts';
import { CONTROL_LETTERS, TERMINAL_KEYS, controlChar, keySequence } from '../terminal-keys.ts';
import { setTerminalRenderMode, terminalRenderMode } from '../terminal/settings.ts';
import { classifyMarkdownRows, joinWrappedRows, type MarkdownBlock } from '../terminal/markdown-blocks.ts';
import { firstContentCell, joinLogicalCells } from '../terminal/logical.ts';
import { renderRow, rowClass, rowRawText, type CursorInfo } from '../terminal/render.ts';
import { keyToSequence, pasteInput } from '../terminal/input.ts';
import { revealDirectory } from './filetree.tsx';

const MAX_SCROLLBACK_ROWS = DEFAULT_SCROLLBACK;
const FONT_SCALE_TO_PX = 0.14;

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
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let renderFrame: number | undefined;
  let composing = false;
  let skipInput = false;
  let lastCols = 0;
  let lastRows = 0;
  let cellWidth = 0;
  let cellHeight = 0;
  // 终端逻辑行数按“最大可用高度”算；视觉高度按内容行数收缩，超过上限再滚动。
  let logicalRows = 0;
  let lastContentLarge = false;
  let lastAvailableHeight = 0;
  let lastPadY = 0;
  let keepBottom = false;
  let lastMeta = '';
  let lastMode: 'html' | 'text' = 'html';
  let lastAlt = false;
  let renderedStart = -1;
  let rowEls: HTMLDivElement[] = [];
  let rowHtml: string[] = [];
  let rowBlockKeys: string[] = [];
  let textCache: string[] = [];
  let lastFirst = -1;
  let lastCursorAbs = -1;

  const [ctrlArmed, setCtrlArmed] = createSignal(false);
  const [cwd, setCwd] = createSignal('');
  const [tick, setTick] = createSignal(0);

  const sendText = (data: string) => {
    if (!data) return;
    send?.(data);
  };

  const scheduleRender = () => {
    if (renderFrame !== undefined) return;
    renderFrame = requestAnimationFrame(() => {
      renderFrame = undefined;
      renderNow();
    });
  };

  const resetRendered = () => {
    renderedStart = -1;
    rowEls = [];
    rowHtml = [];
    rowBlockKeys = [];
    textCache = [];
    lastFirst = -1;
    lastCursorAbs = -1;
    rowsEl?.replaceChildren();
  };

  const updateSize = () => {
    const pane = paneEl;
    const scroller = scrollEl;
    const measure = measureEl;
    if (!pane || !scroller || !measure || !screen) return;
    measure.textContent = 'M'.repeat(50);
    const cellW = measure.getBoundingClientRect().width / 50;
    const cellH = measure.getBoundingClientRect().height;
    if (!cellW || !cellH) return;
    cellWidth = cellW;
    cellHeight = cellH;

    const style = getComputedStyle(scroller);
    const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const paneWidth = scroller.clientWidth;
    const toolbar = pane.querySelector<HTMLElement>('.terminal-toolbar');
    const keys = pane.querySelector<HTMLElement>('.terminal-keys');
    const parent = pane.parentElement;
    const available = Math.max(1, (parent?.clientHeight ?? 0) - (toolbar?.offsetHeight ?? 0) - (keys?.offsetHeight ?? 0));
    const cols = Math.max(20, Math.floor((paneWidth - padX) / cellW));

    // 逻辑行列跟随当前可用高度；内容高度只影响视觉盒高度，不触发 PTY resize。
    const rows = Math.max(5, Math.floor((available - padY) / cellH));

    if (cols !== lastCols || rows !== lastRows) {
      lastCols = cols;
      lastRows = rows;
      // 浏览器不再本地 resize：服务端是唯一模拟器，resize 后由服务端 diff 带回新尺寸。
      socket?.resize(cols, rows);
    }

    logicalRows = rows;
    lastAvailableHeight = available;
    lastPadY = padY;
    const wasAtBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 8;
    if (wasAtBottom) keepBottom = true;
    scheduleRender();
    sendMeta();
  };

  // 软键盘动画/地址栏伸缩会连续触发 ResizeObserver；防抖合并成一次 resize，
  // 避免动画期间反复 stty + SIGWINCH。
  const scheduleResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = undefined;
      updateSize();
      scheduleRender();
    }, 120);
  };

  const sendMeta = () => {
    if (!socket) return;
    const root = getComputedStyle(document.documentElement);
    const scroller = scrollEl;
    const meta = {
      fg: parseCssColor(root.getPropertyValue('--term-fg')) ?? undefined,
      bg: parseCssColor(root.getPropertyValue('--term-bg')) ?? undefined,
      cursor: parseCssColor(root.getPropertyValue('--term-cursor-bg')) ?? undefined,
      pixelWidth: scroller?.clientWidth,
      pixelHeight: scroller?.clientHeight,
      cellWidth,
      cellHeight,
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
    setCwd(cwdPath(s.getCwd()));

    const dirty = s.takeDirty();
    const structureChanged = renderedStart !== start || lastMode !== mode || lastAlt !== alt || lastFirst !== first;
    const forceAll = structureChanged || dirty.rows === 'all';
    const dirtyRows = new Set<number>();
    if (!forceAll && dirty.rows !== 'all') for (const row of dirty.rows) dirtyRows.add(row);
    if (lastCursorAbs >= 0) dirtyRows.add(lastCursorAbs);
    dirtyRows.add(cursorAbs);
    lastFirst = first;
    lastCursorAbs = cursorAbs;

    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 8;
    const oldScrollTop = scroller.scrollTop;
    const oldScrollHeight = scroller.scrollHeight;

    if (structureChanged) {
      container.replaceChildren();
      renderedStart = start;
      rowEls = [];
      rowHtml = [];
      rowBlockKeys = [];
      textCache = [];
    }
    lastMode = mode;
    lastAlt = alt;

    const count = end - start;
    while (rowEls.length > count) {
      rowEls.pop()!.remove();
      rowHtml.pop();
      rowBlockKeys.pop();
    }
    while (rowEls.length < count) {
      const el = document.createElement('div');
      container.appendChild(el);
      rowEls.push(el);
      rowHtml.push('\u0000');
      rowBlockKeys.push('\u0000');
    }

    // 只物化脏行/新行的单元格；未变化的行复用文本缓存，避免每帧重建整个滚动缓冲区。
    // 单元格对象只在本次渲染内短暂保留，不长期缓存（否则会和 VT 屏幕网格重复占内存）。
    const freshCells = new Map<number, ScreenCell[]>();
    for (let index = 0; index < count; index++) {
      const absolute = start + index;
      if (forceAll) {
        // 全量重建只缓存文本；单元格在渲染循环里按行读取，避免同时持有整屏对象。
        textCache[absolute] = rowRawText(s.getRowAbsolute(absolute));
      } else if (textCache[absolute] === undefined || dirtyRows.has(absolute)) {
        const line = s.getRowAbsolute(absolute);
        freshCells.set(absolute, line);
        textCache[absolute] = rowRawText(line);
      }
    }

    const texts: string[] = [];
    for (let absolute = start; absolute < end; absolute++) texts.push(textCache[absolute] ?? '');
    const blocks = classifyMarkdownRows(texts);

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
        if (rowRawText(s.getRowAbsolute(start + index)).trim() !== '') last = index;
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
      const el = rowEls[index];

      if (index >= contentEnd) {
        const key = 'hidden';
        if (!forceAll && el.className === hiddenClass && rowBlockKeys[index] === key) continue;
        if (el.className !== hiddenClass) el.className = hiddenClass;
        if (rowHtml[index] !== '') {
          el.innerHTML = '';
          rowHtml[index] = '';
        }
        rowBlockKeys[index] = key;
        continue;
      }

      if (!useLogical) {
        // 纯文字/备用屏幕：一行一个物理行，保持经典终端网格。
        const active = alt || absolute >= cursorAbs;
        const markdown = mode === 'html' && !active;
        const block: MarkdownBlock = markdown ? blocks[index] : { kind: 'normal' };
        const cursorInfo = absolute === cursorAbs && cursorVisible
          ? { col: cursor.col, visible: true, shape: cursorShape, blinking: cursorBlinking }
          : undefined;
        const options = { mode, markdown, linkify: mode === 'html', cursor: cursorInfo, block };
        const className = rowClass(block, options);
        const key = blockKey(block);
        const needs = forceAll || dirtyRows.has(absolute) || rowHtml[index] === '\u0000' || rowBlockKeys[index] !== key || el.className !== className;
        if (!needs) continue;
        const html = renderRow(freshCells.get(absolute) ?? s.getRowAbsolute(absolute), options);
        if (el.className !== className) el.className = className;
        if (rowHtml[index] !== html) {
          el.innerHTML = html;
          rowHtml[index] = html;
        }
        rowBlockKeys[index] = key;
        continue;
      }

      const tableBlock = tableRowBlocks[index];
      if (tableBlock && tableBlock.kind === 'table' && tableBlock.role === 'body') {
        const key = 'hidden';
        if (!forceAll && el.className === hiddenClass && rowBlockKeys[index] === key) continue;
        if (el.className !== hiddenClass) el.className = hiddenClass;
        if (rowHtml[index] !== '') {
          el.innerHTML = '';
          rowHtml[index] = '';
        }
        rowBlockKeys[index] = key;
        continue;
      }

      if (tableBlock && tableBlock.kind === 'table') {
        const options = { mode, markdown: true, linkify: true, block: tableBlock };
        const className = rowClass(tableBlock, options);
        const key = blockKey(tableBlock);
        const logicalIndex = logicalOfPhysical[index];
        const needs = forceAll || logicalDirty[logicalIndex] || rowHtml[index] === '\u0000' || rowBlockKeys[index] !== key || el.className !== className;
        if (!needs) continue;
        const html = renderRow(s.getRowAbsolute(absolute), options);
        if (el.className !== className) el.className = className;
        if (rowHtml[index] !== html) {
          el.innerHTML = html;
          rowHtml[index] = html;
        }
        rowBlockKeys[index] = key;
        continue;
      }

      const logicalIndex = logicalOfPhysical[index];
      if (logicalStart[logicalIndex] !== index) {
        // 非表格逻辑行的续行：内容已经在首行渲染，这里隐藏。
        const key = 'hidden';
        if (!forceAll && el.className === hiddenClass && rowBlockKeys[index] === key) continue;
        if (el.className !== hiddenClass) el.className = hiddenClass;
        if (rowHtml[index] !== '') {
          el.innerHTML = '';
          rowHtml[index] = '';
        }
        rowBlockKeys[index] = key;
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
      const needs = forceAll || logicalDirty[logicalIndex] || rowHtml[index] === '\u0000' || rowBlockKeys[index] !== key || el.className !== className;
      if (!needs) continue;
      const cells = joinedCells(s, start, logicalStart[logicalIndex], logicalEnd[logicalIndex]);
      const html = renderRow(cells, options);
      if (el.className !== className) el.className = className;
      if (rowHtml[index] !== html) {
        el.innerHTML = html;
        rowHtml[index] = html;
      }
      rowBlockKeys[index] = key;
    }

    // 逻辑行由多行拼成，实际高度只能渲染后量；用真实 DOM 高度决定内容框和滚动位置。
    const measuredHeight = container.getBoundingClientRect().height;
    const contentHeight = measuredHeight + lastPadY;
    const available = lastAvailableHeight > 0 ? lastAvailableHeight : contentHeight;
    const contentLarge = contentHeight >= available - 1;
    const becameLarge = contentLarge && !lastContentLarge;
    const visualHeight = Math.max(cellHeight + lastPadY, Math.min(contentHeight, available));
    if (Math.abs(scroller.getBoundingClientRect().height - visualHeight) > 0.5) {
      scroller.style.height = `${visualHeight}px`;
    }
    if (!contentLarge) scroller.scrollTop = 0;
    else if (atBottom || keepBottom || becameLarge) scroller.scrollTop = scroller.scrollHeight;
    else if (structureChanged && oldScrollHeight > 0) scroller.scrollTop = oldScrollTop * (scroller.scrollHeight / oldScrollHeight);
    else scroller.scrollTop = oldScrollTop;
    keepBottom = false;
    lastContentLarge = contentLarge;
  };

  // 每个终端 id 一套 VT 缓冲区 + WS；渲染模式变化不会进入这里。
  createEffect(on(() => props.id, (id) => {
    resetRendered();
    setCtrlArmed(false);
    lastCols = 0;
    lastRows = 0;
    logicalRows = 0;
    lastContentLarge = false;
    keepBottom = false;
    lastMeta = '';
    lastMode = terminalRenderMode();
    lastAlt = false;

    const s = new RemoteTerminalScreen();
    screen = s;

    const sock = connectTerminal(id, {
      // 首次/重连：清空本地缓存，等服务端快照重建画面（进程与信号不中断）。
      onOpen: () => { s.reset(); resetRendered(); scheduleRender(); lastMeta = ''; sendMeta(); },
      onScreen: (snapshot) => { s.applySnapshot(snapshot); setTick((value) => value + 1); },
      onScreenDiff: (diff) => { s.applyDiff(diff); setTick((value) => value + 1); },
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
    scheduleRender();

    onCleanup(() => {
      if (renderFrame !== undefined) cancelAnimationFrame(renderFrame);
      renderFrame = undefined;
      clearTimeout(resizeTimer);
      resizeTimer = undefined;
      resizeObserver?.disconnect();
      resizeObserver = undefined;
      sock.dispose();
      socket = undefined;
      screen = undefined;
      send = undefined;
      focusInput = undefined;
      rowEls = [];
      rowHtml = [];
      rowBlockKeys = [];
      textCache = [];
      lastFirst = -1;
      lastCursorAbs = -1;
      logicalRows = 0;
      lastContentLarge = false;
      keepBottom = false;
      lastMeta = '';
    });
  }));

  // 渲染模式/新输出 → 只重绘。
  createEffect(() => {
    terminalRenderMode();
    tick();
    if (!screen) return;
    // 内容行数会随输出变化：重新计算视觉高度（逻辑行列不变时不会触发 PTY resize）。
    updateSize();
    scheduleRender();
  });

  // 主题色变化同步给服务端，供 OSC 10/11 本地回应。
  createEffect(() => {
    theme();
    sendMeta();
  });

  // 字号跟随全局设置；重新测量列宽/行高后回发 resize。
  createEffect(() => {
    const size = Math.round(fontScale() * FONT_SCALE_TO_PX);
    if (scrollEl) scrollEl.style.fontSize = `${size}px`;
    updateSize();
    scheduleRender();
  });

  const barSequence = (id: string): string | null => {
    if (screen?.getMode('applicationCursor') === true) {
      const arrows: Record<string, string> = { up: 'A', down: 'B', left: 'D', right: 'C', home: 'H', end: 'F' };
      if (arrows[id]) return `\x1bO${arrows[id]}`;
    }
    return keySequence(id);
  };

  const press = (data: string | null) => {
    if (data === null) return;
    sendText(data);
    focusInput?.();
  };

  const pressCtrl = (letter: string) => {
    press(controlChar(letter));
    setCtrlArmed(false);
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
      sendText(sequence);
    }
  };

  const handleInput = () => {
    if (composing || skipInput || !inputEl) return;
    const value = inputEl.value;
    inputEl.value = '';
    if (value) sendText(value.replace(/\n/g, '\r'));
  };

  const handleBeforeInput = (event: InputEvent) => {
    if (composing) return;
    if (event.inputType === 'deleteContentBackward') {
      event.preventDefault();
      sendText('\x7f');
    } else if (event.inputType === 'deleteContentForward') {
      event.preventDefault();
      sendText('\x1b[3~');
    } else if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') {
      event.preventDefault();
      sendText('\r');
    }
  };

  const handlePaste = (event: ClipboardEvent) => {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (text) sendText(pasteInput(text, screen?.getMode('bracketedPaste') === true));
  };

  const handleCompositionEnd = (event: CompositionEvent) => {
    composing = false;
    const text = event.data || inputEl?.value || '';
    if (inputEl) inputEl.value = '';
    if (text) sendText(text);
    skipInput = true;
    queueMicrotask(() => { skipInput = false; });
  };

  const reportMouse = (event: MouseEvent, button: number, release = false): boolean => {
    const rows = rowsEl;
    if (!rows || !cellWidth || !cellHeight) return false;
    const rect = rows.getBoundingClientRect();
    const col = Math.max(0, Math.min(lastCols - 1, Math.floor((event.clientX - rect.left) / cellWidth)));
    const row = Math.max(0, Math.min(lastRows - 1, Math.floor((event.clientY - rect.top) / cellHeight)));
    if (screen?.getMode('sgrMouse') === true) {
      sendText(`\x1b[<${button};${col + 1};${row + 1}${release ? 'm' : 'M'}`);
    } else {
      sendText(`\x1b[M${String.fromCharCode(32 + (release ? 3 : button), 32 + col + 1, 32 + row + 1)}`);
    }
    return true;
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement | null)?.closest('.term-link, .term-url')) return;
    if (screen?.getMode('mouseTracking') === true) reportMouse(event, 0);
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement | null)?.closest('.term-link, .term-url')) return;
    if (screen?.getMode('mouseTracking') === true) reportMouse(event, 0, true);
  };

  const handleWheel = (event: WheelEvent) => {
    // 只在全屏 TUI 里把滚轮交给应用；普通 shell 保留原生回滚。
    if (screen?.getMode('mouseTracking') !== true || screen?.getMode('altScreen') !== true) return;
    if (reportMouse(event, event.deltaY < 0 ? 64 : 65)) event.preventDefault();
  };

  const focusOnPaneClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, textarea, select, [role="button"]')) return;
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

  return (
    <div class="terminal-pane" ref={(el) => (paneEl = el)} onClick={focusOnPaneClick}>
      <div class="terminal-toolbar">
        <div class="terminal-mode" role="group" aria-label={t('terminal.renderMode')}>
          <button
            type="button"
            classList={{ active: terminalRenderMode() === 'html' }}
            aria-pressed={terminalRenderMode() === 'html'}
            onClick={() => { setTerminalRenderMode('html'); focusInput?.(); }}
          >{t('terminal.html')}</button>
          <button
            type="button"
            classList={{ active: terminalRenderMode() === 'text' }}
            aria-pressed={terminalRenderMode() === 'text'}
            onClick={() => { setTerminalRenderMode('text'); focusInput?.(); }}
          >{t('terminal.text')}</button>
        </div>
        <Show when={cwd()}>
          <span class="terminal-cwd" title={`${t('terminal.cwd')}: ${cwd()}`}>{cwd()}</span>
        </Show>
      </div>

      <div
        class="terminal-scroll"
        classList={{ 'terminal-html': terminalRenderMode() === 'html', 'terminal-text': terminalRenderMode() === 'text' }}
        ref={(el) => (scrollEl = el)}
        onClick={handleClick}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
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
        onCompositionStart={() => { composing = true; }}
        onCompositionEnd={handleCompositionEnd}
        onFocus={() => { if (screen?.getMode('focusTracking') === true) sendText('\x1b[I'); }}
        onBlur={() => { if (screen?.getMode('focusTracking') === true) sendText('\x1b[O'); }}
      />

      <div class="terminal-keys" role="toolbar" aria-label={t('terminal.keys')}>
        <div class="terminal-key-row">
          <button class="terminal-key" title="Escape" aria-label="Escape" onClick={() => press(barSequence('esc'))}>Esc</button>
          <button class="terminal-key" title="Tab" aria-label="Tab" onClick={() => press(barSequence('tab'))}>Tab</button>
          <button
            class="terminal-key terminal-key-ctrl"
            classList={{ active: ctrlArmed() }}
            aria-pressed={ctrlArmed()}
            title={t('terminal.armCtrl')}
            aria-label={t('terminal.armCtrl')}
            onClick={() => { setCtrlArmed((armed) => !armed); focusInput?.(); }}
          >Ctrl</button>
          <For each={TERMINAL_KEYS.slice(2)}>
            {(key) => (
              <button class="terminal-key" title={key.aria} aria-label={key.aria} onClick={() => press(barSequence(key.id))}>
                {key.label}
              </button>
            )}
          </For>
        </div>
        <Show when={ctrlArmed()}>
          <div class="terminal-key-row terminal-key-letters">
            <For each={CONTROL_LETTERS}>
              {(letter) => (
                <button class="terminal-key" title={`Ctrl+${letter}`} aria-label={`Ctrl+${letter}`} onClick={() => pressCtrl(letter)}>
                  ^{letter}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
