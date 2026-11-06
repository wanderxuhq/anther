// web/src/views/terminal.tsx
// HTML 终端：vterm.js 只负责解析 VT 序列/维护屏幕缓冲区，渲染完全由本组件控制。
// 同一份缓冲区可切换两种渲染：
//   html（默认）— 路径可点、Markdown 可视化、长行自动换行
//   text        — 经典等宽纯文字（保留 ANSI 颜色，不做链接/Markdown）
// 切换只重绘，不重置 PTY、屏幕缓冲区或输入状态。
import { createEffect, createSignal, For, on, onCleanup, Show } from 'solid-js';
import { createVtermScreen, type VtermScreen as Screen, type ScreenCell } from 'vterm.js';
import { api, connectTerminal, type TerminalSocket } from '../api.ts';
import { fontScale, openPreviewTab, removeTerminalTab } from '../stores.ts';
import { t } from '../i18n.ts';
import { CONTROL_LETTERS, TERMINAL_KEYS, controlChar, keySequence } from '../terminal-keys.ts';
import { setTerminalRenderMode, terminalRenderMode } from '../terminal/settings.ts';
import { classifyMarkdownRows, type MarkdownBlock } from '../terminal/markdown-blocks.ts';
import { renderRow, rowClass, rowText } from '../terminal/render.ts';
import { keyToSequence, pasteInput } from '../terminal/input.ts';
import { revealDirectory } from './filetree.tsx';

const MAX_SCROLLBACK_ROWS = 5000;
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
  let renderFrame: number | undefined;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  let composing = false;
  let skipInput = false;
  let lastCols = 0;
  let lastRows = 0;
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
    const cellWidth = measure.getBoundingClientRect().width / 50;
    const cellHeight = measure.getBoundingClientRect().height;
    if (!cellWidth || !cellHeight) return;
    const style = getComputedStyle(scroller);
    const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const cols = Math.max(20, Math.floor((scroller.clientWidth - padX) / cellWidth));
    const rows = Math.max(5, Math.floor((scroller.clientHeight - padY) / cellHeight));
    if (cols === lastCols && rows === lastRows) return;
    lastCols = cols;
    lastRows = rows;
    screen.resize(cols, rows);
    socket?.resize(cols, rows);
    scheduleRender();
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
    // 单元格对象只在本次渲染内短暂保留，不长期缓存（否则会和 vterm 的网格重复占内存）。
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

  // 每个终端 id 一套 vterm 缓冲区 + WS；渲染模式变化不会进入这里。
  createEffect(on(() => props.id, (id) => {
    resetRendered();
    setCtrlArmed(false);
    lastCols = 0;
    lastRows = 0;
    lastMode = terminalRenderMode();
    lastAlt = false;

    const s = createVtermScreen({
      cols: 80,
      rows: 24,
      scrollbackLimit: MAX_SCROLLBACK_ROWS,
      onResponse: (data) => sendText(data),
    });
    screen = s;
    const encoder = new TextEncoder();

    const sock = connectTerminal(id, {
      // 首次/重连：清空本地缓冲区，等服务端历史重放重建画面（进程与信号不中断）。
      onOpen: () => { s.reset(); resetRendered(); scheduleRender(); },
      onOutput: (data) => { s.process(encoder.encode(data)); setTick((value) => value + 1); },
      onExit: () => removeTerminalTab(id),
    });
    socket = sock;
    send = (data) => { if (data) sock.input(data); };
    focusInput = () => inputEl?.focus({ preventScroll: true });
    // 桌面端自动聚焦，手机端不主动弹软键盘。
    if (window.matchMedia('(pointer: fine)').matches) queueMicrotask(() => focusInput?.());

    resizeObserver = new ResizeObserver(() => { updateSize(); scheduleRender(); });
    if (scrollEl) resizeObserver.observe(scrollEl);
    updateSize();
    scheduleRender();

    onCleanup(() => {
      if (renderFrame !== undefined) cancelAnimationFrame(renderFrame);
      renderFrame = undefined;
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
    });
  }));

  // 渲染模式/新输出 → 只重绘。
  createEffect(() => {
    terminalRenderMode();
    tick();
    if (screen) scheduleRender();
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
