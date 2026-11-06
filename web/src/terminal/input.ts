// web/src/terminal/input.ts
// 键盘事件 → PTY 字节序列。纯函数（只依赖 KeyboardEvent 的字段子集），
// 方便 node:test 直接覆盖；文本输入/IME 由 textarea 的 input 事件负责。

export type KeyLike = {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
};

const CSI_ARROWS: Record<string, string> = {
  ArrowUp: 'A',
  ArrowDown: 'B',
  ArrowRight: 'C',
  ArrowLeft: 'D',
  Home: 'H',
  End: 'F',
};

const CSI_KEYS: Record<string, string> = {
  Insert: '\x1b[2~',
  Delete: '\x1b[3~',
  PageUp: '\x1b[5~',
  PageDown: '\x1b[6~',
  F1: '\x1bOP',
  F2: '\x1bOQ',
  F3: '\x1bOR',
  F4: '\x1bOS',
  F5: '\x1b[15~',
  F6: '\x1b[17~',
  F7: '\x1b[18~',
  F8: '\x1b[19~',
  F9: '\x1b[20~',
  F10: '\x1b[21~',
  F11: '\x1b[23~',
  F12: '\x1b[24~',
};

/** A–Z → 0x01–0x1A（Ctrl+C → \u0003）。 */
export function controlChar(letter: string): string | null {
  if (typeof letter !== 'string' || letter.length !== 1) return null;
  const code = letter.toUpperCase().charCodeAt(0);
  if (code < 65 || code > 90) return null;
  return String.fromCharCode(code - 64);
}

const CTRL_SYMBOLS: Record<string, string> = {
  '@': '\x00',
  ' ': '\x00',
  '[': '\x1b',
  '\\': '\x1c',
  ']': '\x1d',
  '^': '\x1e',
  '_': '\x1f',
  '?': '\x7f',
};

/** 特殊键/Ctrl/Alt 组合 → 输入序列；返回 null 表示交给 textarea 的 input 事件。 */
export function keyToSequence(e: KeyLike, applicationCursor = false): string | null {
  if (e.isComposing) return null;

  // 浏览器快捷键（复制/粘贴/剪切）不拦截。
  if (e.metaKey) return null;
  if (e.ctrlKey && e.shiftKey && /^[cvx]$/i.test(e.key)) return null;

  if (e.ctrlKey && !e.altKey) {
    const letter = controlChar(e.key);
    if (letter !== null) return letter;
    return CTRL_SYMBOLS[e.key] ?? null;
  }

  if (e.altKey && !e.ctrlKey) {
    if (e.key === 'Backspace') return '\x1b\x7f';
    if (e.key === 'Enter') return '\x1b\r';
    if (e.key.length === 1) return `\x1b${e.key}`;
    return null;
  }

  if (e.shiftKey && CSI_ARROWS[e.key]) {
    return `\x1b[1;2${CSI_ARROWS[e.key]}`;
  }
  if (CSI_ARROWS[e.key]) {
    return applicationCursor ? `\x1bO${CSI_ARROWS[e.key]}` : `\x1b[${CSI_ARROWS[e.key]}`;
  }
  if (CSI_KEYS[e.key]) return CSI_KEYS[e.key];

  switch (e.key) {
    case 'Enter': return '\r';
    case 'Backspace': return '\x7f';
    case 'Escape': return '\x1b';
    case 'Tab': return e.shiftKey ? '\x1b[Z' : '\t';
    default: return null;
  }
}

/** 粘贴：mode 2004 开启时用 bracketed paste 包裹，防止内容被 shell 提前结束。 */
export function pasteInput(text: string, bracketedPaste: boolean): string {
  if (!bracketedPaste) return text;
  const clean = text.replace(/\x1b\[200~/g, '').replace(/\x1b\[201~/g, '');
  return `\x1b[200~${clean}\x1b[201~`;
}
