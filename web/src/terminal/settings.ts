// web/src/terminal/settings.ts
// 终端渲染模式：html（默认，路径可点/Markdown 可视化）与 text（经典等宽纯文字）。
// 只影响渲染；PTY、屏幕缓冲区和输入状态完全共享，切换不重置会话。
import { createSignal } from 'solid-js';

export type TerminalRenderMode = 'html' | 'text';

const KEY = 'anther:terminalRenderMode';

function load(): TerminalRenderMode {
  try {
    return localStorage.getItem(KEY) === 'text' ? 'text' : 'html';
  } catch {
    return 'html';
  }
}

export const [terminalRenderMode, setTerminalRenderModeSignal] = createSignal<TerminalRenderMode>(load());

export function setTerminalRenderMode(mode: TerminalRenderMode): void {
  setTerminalRenderModeSignal(mode);
  try { localStorage.setItem(KEY, mode); } catch { /* 隐私模式或存储已满 */ }
}
