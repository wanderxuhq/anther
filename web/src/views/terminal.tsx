// web/src/views/terminal.tsx
// 主区域终端面板：xterm + fit 自适应；WS 重连时清屏等服务端历史重放（方案 B），
// 进程状态不中断，vim/Claude Code 画面无缝恢复。exit/4404 → 移除标签。
// 触屏/窄屏底部提供按键条：Esc/Tab/方向键/Ctrl 组合，弥补软键盘缺修饰键。
import { createEffect, createSignal, For, onCleanup, Show, untrack } from 'solid-js';
import { Terminal as Xterm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { connectTerminal } from '../api.ts';
import { removeTerminalTab, theme, fontScale } from '../stores.ts';
import { t } from '../i18n.ts';
import { CONTROL_LETTERS, TERMINAL_KEYS, controlChar, keySequence } from '../terminal-keys.ts';

function terminalTheme(t: 'auto' | 'light' | 'dark') {
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return dark
    ? { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#d4d4d4', selectionBackground: '#264f78' }
    : { background: '#ffffff', foreground: '#1e1e1e', cursor: '#1e1e1e', selectionBackground: '#cfe3ff' };
}

export function TerminalView(props: { id: string }) {
  let container: HTMLDivElement | undefined;
  let sendInput: ((data: string) => void) | undefined;
  let focusTerm: (() => void) | undefined;
  const [ctrlArmed, setCtrlArmed] = createSignal(false);

  const press = (data: string | null) => {
    if (data === null) return;
    sendInput?.(data);
    focusTerm?.();
  };

  const pressCtrl = (letter: string) => {
    press(controlChar(letter));
    setCtrlArmed(false);
  };

  // props.id 变化（切换终端标签）→ 整个 effect 重跑：旧 xterm/WS 先清，再重建
  createEffect(() => {
    const id = props.id;
    const el = container!;
    setCtrlArmed(false);
    const term = new Xterm({
      cursorBlink: true,
      theme: untrack(() => terminalTheme(theme())),
      fontSize: untrack(() => Math.round(fontScale() * 0.14)), // fs=100 → 14px
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    const socket = connectTerminal(id, {
      onOpen: () => term.reset(),        // 首次/重连：清屏，等服务端历史重放重建画面
      onOutput: (data) => term.write(data),
      onExit: () => removeTerminalTab(id),
    });
    sendInput = (data) => socket.input(data);
    focusTerm = () => term.focus();
    term.onData((data) => socket.input(data));

    // 粘滞 Ctrl：开启后用软键盘/物理键盘敲 A–Z 直接发控制码（\x01–\x1a）。
    // 捕获阶段拦截，避免 xterm 把字母原样写进 shell。
    const onKeyDown = (e: KeyboardEvent) => {
      if (!ctrlArmed() || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const data = controlChar(e.key);
      if (data === null) return;
      e.preventDefault();
      e.stopPropagation();
      sendInput?.(data);
      setCtrlArmed(false);
    };
    el.addEventListener('keydown', onKeyDown, true);

    const sendResize = () => {
      const dims = fit.proposeDimensions();
      if (dims) socket.resize(dims.cols, dims.rows);
    };
    sendResize();
    const ro = new ResizeObserver(() => { fit.fit(); sendResize(); });
    ro.observe(el);

    // 主题/字号实时跟随：外层 effect 仅订阅 props.id（untrack 构造读取），
    // 运行时 options 更新由下面两个嵌套 effect 承担（改后 refit 并回发新尺寸）
    const unTheme = createEffect(() => { term.options.theme = terminalTheme(theme()); });
    const unFont = createEffect(() => {
      term.options.fontSize = Math.round(fontScale() * 0.14);
      fit.fit();
      sendResize();
    });

    onCleanup(() => {
      el.removeEventListener('keydown', onKeyDown, true);
      sendInput = undefined;
      focusTerm = undefined;
      ro.disconnect();
      socket.dispose();
      term.dispose();
    });
  });

  return (
    <div class="terminal-pane">
      <div class="terminal-view" ref={container} />
      <div class="terminal-keys" role="toolbar" aria-label={t('terminal.keys')}>
        <div class="terminal-key-row">
          <button class="terminal-key" title="Escape" aria-label="Escape" onClick={() => press(keySequence('esc'))}>Esc</button>
          <button class="terminal-key" title="Tab" aria-label="Tab" onClick={() => press(keySequence('tab'))}>Tab</button>
          <button
            class="terminal-key terminal-key-ctrl"
            classList={{ active: ctrlArmed() }}
            aria-pressed={ctrlArmed()}
            title={t('terminal.armCtrl')}
            aria-label={t('terminal.armCtrl')}
            onClick={() => setCtrlArmed((armed) => !armed)}
          >Ctrl</button>
          <For each={TERMINAL_KEYS.slice(2)}>
            {(key) => (
              <button class="terminal-key" title={key.aria} aria-label={key.aria} onClick={() => press(keySequence(key.id))}>
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
