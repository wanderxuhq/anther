// server/terminal-queries.ts
// 终端查询的“本地快速回应”：直接扫描 PTY 原始输出，命中 DA/DSR/OSC/窗口尺寸
// 就立刻写回 PTY。浏览器端回应要经过 40ms 批处理 + WebSocket 往返，readline
// 的查询窗口通常等不到，迟到的回应会被当成输入回显。
//
// 这里只处理不需要屏幕光标状态的查询：
// - DA1 / DA2
// - DSR 5（终端状态）
// - OSC 10/11/12（前景/背景/光标色，颜色由浏览器 meta 同步）
// - CSI 14/16/18/19 t（像素/单元格/窗口/屏幕尺寸）
// DSR 6（光标位置）需要屏幕状态，由 Terminal 里的服务端 TerminalScreen 跟踪器回应。

export type RGB = { r: number; g: number; b: number };

export type TerminalQueryMeta = {
  fg?: RGB;
  bg?: RGB;
  cursor?: RGB;
  pixelWidth?: number;
  pixelHeight?: number;
  cellWidth?: number;
  cellHeight?: number;
};

export type TerminalSize = { cols: number; rows: number };

const MAX_SEQUENCE = 4096;

function oscColor(color: RGB): string {
  const hex4 = (value: number) => Math.round((Math.max(0, Math.min(255, value)) / 255) * 65535).toString(16).padStart(4, '0');
  return `rgb:${hex4(color.r)}/${hex4(color.g)}/${hex4(color.b)}`;
}

export class TerminalQueryResponder {
  private state: 'ground' | 'escape' | 'csi' | 'osc' = 'ground';
  private params = '';
  private intermediates = '';
  private osc = '';
  private oscEsc = false;

  constructor(
    private readonly write: (data: string) => void,
    private readonly size: () => TerminalSize,
    private readonly meta: () => TerminalQueryMeta,
  ) {}

  feed(chunk: string): void {
    for (const ch of chunk) this.consume(ch);
  }

  private consume(ch: string): void {
    const cp = ch.codePointAt(0)!;
    switch (this.state) {
      case 'ground':
        if (ch === '\x1b') this.state = 'escape';
        else if (cp === 0x9b) { this.state = 'csi'; this.params = ''; this.intermediates = ''; }
        else if (cp === 0x9d) { this.state = 'osc'; this.osc = ''; this.oscEsc = false; }
        break;
      case 'escape':
        if (ch === '[') { this.state = 'csi'; this.params = ''; this.intermediates = ''; }
        else if (ch === ']') { this.state = 'osc'; this.osc = ''; this.oscEsc = false; }
        else this.state = 'ground';
        break;
      case 'csi': {
        if (ch === '\x1b') { this.state = 'escape'; break; }
        if (cp === 0x9c) { this.state = 'ground'; break; }
        if (cp >= 0x40 && cp <= 0x7e) {
          this.state = 'ground';
          this.dispatchCsi(ch);
        } else if (cp >= 0x30 && cp <= 0x3f) {
          if (this.params.length < MAX_SEQUENCE) this.params += ch;
        } else if (cp >= 0x20 && cp <= 0x2f) {
          if (this.intermediates.length < MAX_SEQUENCE) this.intermediates += ch;
        }
        break;
      }
      case 'osc': {
        if (this.oscEsc) {
          if (ch === '\\') { this.state = 'ground'; this.dispatchOsc(this.osc); }
          else {
            this.oscEsc = false;
            if (this.osc.length < MAX_SEQUENCE) this.osc += '\x1b' + ch;
          }
          break;
        }
        if (ch === '\x1b') { this.oscEsc = true; break; }
        if (cp === 0x07 || cp === 0x9c) { this.state = 'ground'; this.dispatchOsc(this.osc); break; }
        if (this.osc.length < MAX_SEQUENCE) this.osc += ch;
        break;
      }
    }
  }

  private dispatchCsi(final: string): void {
    // DECRQM 等带 intermediate 的查询暂不回应。
    if (this.intermediates) return;

    let prefix = '';
    let params = this.params;
    if (params && '?><='.includes(params[0])) {
      prefix = params[0];
      params = params.slice(1);
    }
    const values = params === '' ? [] : params.split(';');
    const p = (index: number): string => values[index] ?? '';

    if (final === 'c') {
      // DA1: CSI c / CSI 0 c；DA2: CSI > c / CSI > 0 c
      if (prefix === '' && (params === '' || params === '0')) this.write('\x1b[?62;22c');
      else if (prefix === '>' && (params === '' || params === '0')) this.write('\x1b[>0;1;0c');
      return;
    }

    if (final === 'n' && prefix === '') {
      if (p(0) === '5') this.write('\x1b[0n');
      // DSR 6 需要光标位置，服务端不知道；不回应，避免回错。
      return;
    }

    if (final === 't' && prefix === '') {
      const code = p(0);
      const { cols, rows } = this.size();
      const meta = this.meta();
      if (code === '18') {
        this.write(`\x1b[8;${rows};${cols}t`);
      } else if (code === '19') {
        this.write(`\x1b[9;${rows};${cols}t`);
      } else if (code === '14') {
        const pixelWidth = meta.pixelWidth ?? cols * (meta.cellWidth ?? 8);
        const pixelHeight = meta.pixelHeight ?? rows * (meta.cellHeight ?? 16);
        this.write(`\x1b[4;${pixelHeight};${pixelWidth}t`);
      } else if (code === '16') {
        this.write(`\x1b[6;${meta.cellHeight ?? 16};${meta.cellWidth ?? 8}t`);
      }
    }
  }

  private dispatchOsc(data: string): void {
    const semi = data.indexOf(';');
    const code = semi >= 0 ? data.slice(0, semi) : data;
    const rest = semi >= 0 ? data.slice(semi + 1) : '';
    if ((code === '10' || code === '11' || code === '12') && rest.trim() === '?') {
      const meta = this.meta();
      const color = code === '10' ? meta.fg : code === '11' ? meta.bg : meta.cursor;
      if (color) this.write(`\x1b]${code};${oscColor(color)}\x1b\\`);
    }
  }
}
