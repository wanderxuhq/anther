// web/src/views/terminal.tsx
// HTML 终端：terminal/vt.ts 负责解析 VT 序列/维护屏幕缓冲区，渲染完全由本组件控制。
// 同一份缓冲区可切换两种渲染：
//   html（默认）— 路径可点、Markdown 可视化、长行自动换行
//   text        — 经典等宽纯文字（保留 ANSI 颜色，不做链接/Markdown）
// 切换只重绘，不重置 PTY、屏幕缓冲区或输入状态。
import { createEffect, createSignal, For, on, onCleanup, Show } from 'solid-js';
import { createTerminalScreen, type TerminalScreen as Screen, type ScreenCell } from '../terminal/vt.ts';
import { api, connectTerminal, type TerminalSocket } from '../api.ts';
import { fontScale, openPreviewTab, removeTerminalTab } from '../stores.ts';
import { t } from '../i18n.ts';
import { CONTROL_LETTERS, TERMINAL_KEYS, controlChar, keySequence } from '../terminal-keys.ts';
import { setTerminalRenderMode, terminalRenderMode } from '../terminal/settings.ts';
import { classifyMarkdownRows, type MarkdownBlock } from '../terminal/markdown-blocks.ts';
import { renderRow, rowClass, rowText } from '../terminal/render.ts';
import { keyToSequence, pasteInput } from '../terminal/input.ts';
import { revealDirectory } from './filetree.tsx';

const MAX_SCROLLBACK_ROWS = 2000;
const FONT_SCALE_TO_PX = 0.14;

function blockKey(block: MarkdownBlock): string {
  switch (block.kind) {
    case 'heading': return `h${block.level}:${block.text}`;
    case 'list': return `l:${block.prefix}:${block.text}`;
    case 'quote': return `q:${block.text}`;
    case 'code': return `c:${block.text}`;
    default: return block.kind;
  }
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
  let scrollEl: HTMLDivElement | undefined;
  let rowsEl: HTMLDivElement | undefined;
  let measureEl: HTMLSpanElement | undefined;
  let inputEl: HTMLTextAreaElement | undefined;
  let screen: Screen | undefined;
  let socket: TerminalSocket | undefined;
  let send: ((data: string) => void) | undefined;
  let focusInput: (() => void) | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let renderFrame: number | undefined;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  let composing = false;
  let skipInput = false;
  let lastCols = 0;
  let lastRows = 0;
  let cellWidth = 0;
  let cellHeight = 0;
  // 键盘未弹出时的稳定尺寸。手机软键盘只遮挡可视区，不改变终端逻辑行列。
  let stableWidth = 0;
  let stableHeight = 0;
  let stableCols = 0;
  let stableRows = 0;
  let keyboardOpen = false;
  let lastAltMode = false;
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
  const [status, setStatus] = createSignal<string | null>(null);
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
    const scroller = scrollEl;
    const measure = measureEl;
    if (!scroller || !measure || !screen) return;
    measure.textContent = 'M'.repeat(50);
    const width = measure.getBoundingClientRect().width / 50;
    const height = measure.getBoundingClientRect().height;
    if (!width || !height) return;
    cellWidth = width;
    cellHeight = height;
    const paneWidth = scroller.clientWidth;
    const paneHeight = scroller.clientHeight;
    const style = getComputedStyle(scroller);
    const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const cols = Math.max(20, Math.floor((paneWidth - padX) / width));
    const rows = Math.max(5, Math.floor((paneHeight - padY) / height));

    // 手机普通 shell：高度变化（软键盘弹出/收起、地址栏伸缩）一律不改变终端尺寸，
    // 避免 stty/SIGWINCH 让 readline 重画提示符。只有宽度变化（旋转）或 alt screen
    // 才真正 resize；全屏 TUI 需要按可视高度重排。
    const coarse = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    const alt = screen.getMode('altScreen') === true;
    const widthChanged = Math.abs(paneWidth - stableWidth) > 40;

    if (coarse && !alt && !widthChanged && stableCols > 0) {
      if (paneHeight < stableHeight - 80 && !keyboardOpen) {
        keyboardOpen = true;
        requestAnimationFrame(() => {
          if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
        });
      } else if (paneHeight >= stableHeight - 20) {
        keyboardOpen = false;
      }
      // 如果刚退出 alt screen，恢复到稳定尺寸。
      if (screen.cols !== stableCols || screen.screenRows() !== stableRows) {
        screen.resize(stableCols, stableRows);
        socket?.resize(stableCols, stableRows);
        scheduleRender();
      }
      return;
    }

    keyboardOpen = false;
    stableWidth = paneWidth;
    stableHeight = paneHeight;
    stableCols = cols;
    stableRows = rows;
    if (cols === lastCols && rows === lastRows) return;
    lastCols = cols;
    lastRows = rows;
    screen.resize(cols, rows);
    socket?.resize(cols, rows);
    scheduleRender();
  };

  // 手机软键盘弹出/收起会连续触发 ResizeObserver；防抖避免反复 stty + SIGWINCH
  // 让 shell 重绘出多余行。
  const scheduleResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = undefined;
      updateSize();
      scheduleRender();
    }, 120);
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
        textCache[absolute] = rowText(s.getRowAbsolute(absolute));
      } else if (textCache[absolute] === undefined || dirtyRows.has(absolute)) {
        const line = s.getRowAbsolute(absolute);
        freshCells.set(absolute, line);
        textCache[absolute] = rowText(line);
      }
    }

    const texts: string[] = [];
    for (let absolute = start; absolute < end; absolute++) texts.push(textCache[absolute] ?? '');
    const blocks = classifyMarkdownRows(texts);

    for (let index = 0; index < count; index++) {
      const absolute = start + index;
      const active = alt || absolute >= cursorAbs;
      const markdown = mode === 'html' && !active;
      const block: MarkdownBlock = markdown ? blocks[index] : { kind: 'normal' };
      const cursorInfo = absolute === cursorAbs && cursorVisible
        ? { col: cursor.col, visible: true, shape: cursorShape, blinking: cursorBlinking }
        : undefined;
      const options = { mode, markdown, linkify: mode === 'html', cursor: cursorInfo, block };
      const className = rowClass(block, options);
      const key = blockKey(block);
      const el = rowEls[index];
      const needs = forceAll || dirtyRows.has(absolute) || rowHtml[index] === '\u0000' || rowBlockKeys[index] !== key || el.className !== className;
      if (!needs) continue;
      const html = renderRow(freshCells.get(absolute) ?? s.getRowAbsolute(absolute), options);
      if (el.className !== className) el.className = className;
      if (rowHtml[index] !== html) {
        el.innerHTML = html;
        rowHtml[index] = html;
      }
      rowBlockKeys[index] = key;
    }

    // 输出追加时保持用户当前位置；切换渲染/结构变化时按比例保持阅读位置。
    if (atBottom) scroller.scrollTop = scroller.scrollHeight;
    else if (structureChanged && oldScrollHeight > 0) scroller.scrollTop = oldScrollTop * (scroller.scrollHeight / oldScrollHeight);
    else scroller.scrollTop = oldScrollTop;
  };

  // 每个终端 id 一套 VT 缓冲区 + WS；渲染模式变化不会进入这里。
  createEffect(on(() => props.id, (id) => {
    resetRendered();
    setCtrlArmed(false);
    lastCols = 0;
    lastRows = 0;
    stableWidth = 0;
    stableHeight = 0;
    stableCols = 0;
    stableRows = 0;
    keyboardOpen = false;
    lastAltMode = false;
    lastMode = terminalRenderMode();
    lastAlt = false;

    const s = createTerminalScreen({
      cols: 80,
      rows: 24,
      scrollbackLimit: MAX_SCROLLBACK_ROWS,
      // 不主动回 DSR/DA1/DECRQM/窗口尺寸查询：浏览器→WS→PTY 的往返延迟会让
      // readline 在查询超时后才收到回应，把回应当成输入回显到命令行。终端不
      // 声明这些能力，readline/应用会走默认回退；需要时再由服务端低延迟回应。
    });
    screen = s;

    const sock = connectTerminal(id, {
      // 首次/重连：清空本地缓冲区，等服务端历史重放重建画面（进程与信号不中断）。
      onOpen: () => { s.reset(); resetRendered(); scheduleRender(); },
      onOutput: (data) => { s.process(data); setTick((value) => value + 1); },
      onExit: () => removeTerminalTab(id),
    });
    socket = sock;
    send = (data) => { if (data) sock.input(data); };
    focusInput = () => inputEl?.focus({ preventScroll: true });
    // 桌面端自动聚焦，手机端不主动弹软键盘。
    if (window.matchMedia('(pointer: fine)').matches) queueMicrotask(() => focusInput?.());

    resizeObserver = new ResizeObserver(scheduleResize);
    if (scrollEl) resizeObserver.observe(scrollEl);
    updateSize();
    scheduleRender();

    onCleanup(() => {
      if (renderFrame !== undefined) cancelAnimationFrame(renderFrame);
      renderFrame = undefined;
      clearTimeout(resizeTimer);
      resizeTimer = undefined;
      clearTimeout(statusTimer);
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
      stableWidth = 0;
      stableHeight = 0;
      stableCols = 0;
      stableRows = 0;
      keyboardOpen = false;
      lastAltMode = false;
    });
  }));

  // 渲染模式/新输出 → 只重绘。
  createEffect(() => {
    terminalRenderMode();
    tick();
    if (!screen) return;
    const alt = screen.getMode('altScreen') === true;
    if (alt !== lastAltMode) {
      lastAltMode = alt;
      // 进入/退出全屏 TUI 时重新按当前可视高度决定是否 resize。
      scheduleResize();
    }
    scheduleRender();
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
        setStatus(null);
      } catch {
        setStatus(t('terminal.fileNotFound', { path }));
        clearTimeout(statusTimer);
        statusTimer = setTimeout(() => setStatus(null), 3000);
      }
    })();
  };

  return (
    <div class="terminal-pane">
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
        <Show when={status()}>
          <span class="terminal-status" role="status">{status()}</span>
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
