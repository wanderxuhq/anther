// web/src/terminal/settings.ts
// 终端渲染模式：html（默认，路径可点/Markdown 可视化）与 text（经典等宽纯文字）。
// 只影响渲染；PTY、屏幕缓冲区和输入状态完全共享，切换不重置会话。
import { createSignal } from 'solid-js';

export type TerminalRenderMode = 'html' | 'text';

const KEY = 'anther:terminalRenderMode';
const KEY_BAR_KEY = 'anther:terminalKeyBar';

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

type MediaMatcher = (query: string) => Pick<MediaQueryList, 'matches'>;

/** 移动端/窄屏默认展开按键条；桌面端默认收起。 */
export function defaultKeyBarOpen(media?: MediaMatcher): boolean {
  if (!media) {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    media = (query) => window.matchMedia(query);
  }
  return media('(pointer: coarse), (max-width: 599px)').matches;
}

function loadKeyBarOpen(): boolean {
  try {
    const value = localStorage.getItem(KEY_BAR_KEY);
    if (value === '1') return true;
    if (value === '0') return false;
  } catch { /* 隐私模式或存储不可用 → 使用设备默认值 */ }
  return defaultKeyBarOpen();
}

export const [terminalKeyBarOpen, setTerminalKeyBarOpenSignal] = createSignal<boolean>(loadKeyBarOpen());

export function setTerminalKeyBarOpen(open: boolean): void {
  setTerminalKeyBarOpenSignal(open);
  try { localStorage.setItem(KEY_BAR_KEY, open ? '1' : '0'); } catch { /* 隐私模式或存储已满 */ }
}
