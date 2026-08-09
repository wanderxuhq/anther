// web/src/views/terminal.tsx
// 主区域终端面板：xterm + fit 自适应；WS 重连时清屏等服务端历史重放（方案 B），
// 进程状态不中断，vim/Claude Code 画面无缝恢复。exit/4404 → 移除标签。
import { createEffect, onCleanup, untrack } from 'solid-js';
import { Terminal as Xterm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { connectTerminal } from '../api.ts';
import { removeTerminalTab, theme, fontScale } from '../stores.ts';

function terminalTheme(t: 'auto' | 'light' | 'dark') {
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return dark
    ? { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#d4d4d4', selectionBackground: '#264f78' }
    : { background: '#ffffff', foreground: '#1e1e1e', cursor: '#1e1e1e', selectionBackground: '#cfe3ff' };
}

export function TerminalView(props: { id: string }) {
  let container: HTMLDivElement | undefined;

  // props.id 变化（切换终端标签）→ 整个 effect 重跑：旧 xterm/WS 先清，再重建
  createEffect(() => {
    const id = props.id;
    const el = container!;
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
    term.onData((data) => socket.input(data));

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
      ro.disconnect();
      socket.dispose();
      term.dispose();
    });
  });

  return <div class="terminal-view" ref={container} />;
}
