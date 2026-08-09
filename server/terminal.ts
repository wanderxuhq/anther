// server/terminal.ts
// 终端管理器：每用户私有列表（终端含密钥/路径隐私，不与共享 tab-store 混）。
// 输出 40ms 批处理减少 WS 帧数；2MB 环形历史缓冲供重连重放（方案 B）。
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { PtySession } from './pty.ts';

export type TerminalInfo = { id: string; name: string };

const HISTORY_LIMIT = 2 * 1024 * 1024;
const FLUSH_MS = 40;

export class Terminal extends EventEmitter {
  readonly id: string;
  readonly name: string;
  readonly pty: PtySession;
  private history: string[] = [];
  private historyBytes = 0;
  private live: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly historyLimit: number;

  constructor(id: string, name: string, pty: PtySession, historyLimit = HISTORY_LIMIT) {
    super();
    this.id = id;
    this.name = name;
    this.pty = pty;
    this.historyLimit = historyLimit;
    pty.on('data', (chunk: string) => this.feed(chunk));
  }

  private feed(chunk: string): void {
    this.history.push(chunk);
    this.historyBytes += chunk.length;
    while (this.historyBytes > this.historyLimit && this.history.length > 1) {
      this.historyBytes -= this.history.shift()!.length;
    }
    this.live.push(chunk);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  private flush(): void {
    this.flushTimer = null;
    if (this.live.length === 0) return;
    const batch = this.live.join('');
    this.live = [];
    this.emit('output', batch);
  }

  write(data: string): void { this.pty.write(data); }
  resize(cols: number, rows: number): Promise<void> { return this.pty.resize(cols, rows); }
  async close(): Promise<void> { await this.pty.kill(); }
  replay(): string { return this.history.join(''); }
}

export class TerminalManager {
  private byUser = new Map<string, Map<string, Terminal>>();

  constructor(private cwd = process.cwd()) {}

  // name 完全由前端本地生成（含本地化），服务端诚实接收、原样存储与返回，不做任何命名。
  async create(userId: string, name: string): Promise<TerminalInfo> {
    const pty = new PtySession(this.cwd);
    const id = `t_${randomBytes(6).toString('hex')}`;
    const term = new Terminal(id, name, pty);
    this.map(userId).set(id, term);
    pty.on('exit', (code) => {
      this.map(userId).delete(id); // 进程退出 → 自动移除
      term.emit('exit', code);
    });
    try {
      await pty.ready;
    } catch (e) {
      this.map(userId).delete(id);
      throw e;
    }
    return { id, name: term.name };
  }

  list(userId: string): TerminalInfo[] {
    return [...this.map(userId).values()].map((t) => ({ id: t.id, name: t.name }));
  }

  get(userId: string, id: string): Terminal | null {
    return this.map(userId).get(id) ?? null;
  }

  async close(userId: string, id: string): Promise<void> {
    const term = this.map(userId).get(id);
    if (!term) return;
    await term.close(); // kill → pty exit → 自动移除（幂等）
  }

  closeAll(): Promise<void> {
    const all = [...this.byUser.values()].flatMap((map) => [...map.values()]);
    return Promise.all(all.map((t) => t.close())).then(() => undefined);
  }

  private map(userId: string): Map<string, Terminal> {
    let map = this.byUser.get(userId);
    if (!map) { map = new Map(); this.byUser.set(userId, map); }
    return map;
  }
}
