// web/src/terminal-keys.ts
// 移动端终端按键条的纯数据/纯函数：键名 → 转义序列，字母 → Ctrl 控制码。
// 不依赖 DOM，node:test 可直接导入。

export type TerminalKey = { id: string; label: string; aria: string };

/** 按键条第一行：特殊键、光标键、终端常用符号（可横向滚动）。 */
export const TERMINAL_KEYS: readonly TerminalKey[] = [
  { id: 'esc', label: 'Esc', aria: 'Escape' },
  { id: 'tab', label: 'Tab', aria: 'Tab' },
  { id: 'up', label: '↑', aria: 'Up arrow' },
  { id: 'down', label: '↓', aria: 'Down arrow' },
  { id: 'left', label: '←', aria: 'Left arrow' },
  { id: 'right', label: '→', aria: 'Right arrow' },
  { id: 'home', label: 'Home', aria: 'Home' },
  { id: 'end', label: 'End', aria: 'End' },
  { id: '|', label: '|', aria: 'Pipe' },
  { id: '~', label: '~', aria: 'Tilde' },
  { id: '/', label: '/', aria: 'Slash' },
  { id: '-', label: '-', aria: 'Hyphen' },
];

const SEQUENCES: Record<string, string> = {
  esc: '\u001b',
  tab: '\t',
  up: '\u001b[A',
  down: '\u001b[B',
  right: '\u001b[C',
  left: '\u001b[D',
  home: '\u001b[H',
  end: '\u001b[F',
  '|': '|',
  '~': '~',
  '/': '/',
  '-': '-',
};

/** Ctrl 组合键可选字母（C / D / Z / L 最常用，其余兼顾 shell 与编辑器）。 */
export const CONTROL_LETTERS = ['C', 'D', 'Z', 'L', 'A', 'E', 'K', 'R', 'U', 'W'] as const;

export function keySequence(id: string): string | null {
  return SEQUENCES[id] ?? null;
}

/** 粘性 Shift/Alt：把修饰符应用到下一次按键/输入。 */
export function applyTerminalModifiers(data: string, shift: boolean, alt: boolean): string {
  if (!shift && !alt) return data;
  const arrow = data.match(/^\x1b(?:\[|O)([ABCDHF])$/);
  if (alt) return arrow ? `\x1b[1;3${arrow[1]}` : `\x1b${data}`;
  if (data === '\t') return '\x1b[Z';
  if (arrow) return `\x1b[1;2${arrow[1]}`;
  if (/^[a-z]$/.test(data)) return data.toUpperCase();
  return data;
}

/** A–Z → 0x01–0x1A（Ctrl+C → \u0003）。其它输入返回 null。 */
export function controlChar(letter: string): string | null {
  if (typeof letter !== 'string' || letter.length !== 1) return null;
  const code = letter.toUpperCase().charCodeAt(0);
  if (code < 65 || code > 90) return null;
  return String.fromCharCode(code - 64);
}
