// server/terminal.ts
// 终端管理器：每用户私有列表（终端含密钥/路径隐私，不与共享 tab-store 混）。
// 方案 B：服务端是唯一的终端模拟器。PTY 输出只在这里解析成屏幕状态，
// 浏览器通过 WS 收快照/脏行 diff 并负责渲染；查询回应也全部在服务端完成。
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { PtySession } from './pty.ts';
import { TerminalQueryResponder, type TerminalQueryMeta } from './terminal-queries.ts';
import { DEFAULT_SCROLLBACK, TerminalScreen } from '../shared/terminal/vt.ts';
import { serializeDiff, serializeScreen, type ScreenDiff, type ScreenSnapshot } from '../shared/terminal/serialize.ts';

export type TerminalInfo = { id: string; name: string };

export type TerminalScreenMessage =
  | ({ type: 'screen' } & ScreenSnapshot)
  | ({ type: 'screen-diff' } & ScreenDiff);

const FLUSH_MS = 40;

export class Terminal extends EventEmitter {
  readonly id: string;
  readonly name: string;
  readonly pty: PtySession;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private cols = 80;
  private rows = 24;
  private resizeChain: Promise<void> = Promise.resolve();
  private meta: TerminalQueryMeta = {};
  private readonly queries: TerminalQueryResponder;
  private readonly tracker: TerminalScreen;

  constructor(id: string, name: string, pty: PtySession) {
    super();
    this.id = id;
    this.name = name;
    this.pty = pty;
    this.queries = new TerminalQueryResponder(
      (data) => this.pty.write(data),
      () => ({ cols: this.cols, rows: this.rows }),
      () => this.meta,
    );
    // 服务端保存完整屏幕 + 回滚区，DSR6 和浏览器画面都来自这一份状态。
    this.tracker = new TerminalScreen({
      cols: 80,
      rows: 24,
      scrollbackLimit: DEFAULT_SCROLLBACK,
      onResponse: (data) => {
        // 只回 DSR6（CSI row;col R / CSI ? row;col R），其余查询由上面的
        // TerminalQueryResponder 处理，避免重复。
        if (/^\x1b\[\??\d+;\d+R$/.test(data)) this.pty.write(data);
      },
    });
    pty.on('data', (chunk: string) => this.feed(chunk));
  }

  private feed(chunk: string): void {
    // 先更新服务端屏幕/光标状态，再处理查询：全部直接写回 PTY，
    // 不经过 40ms 批处理和 WebSocket。
    this.tracker.process(chunk);
    this.queries.feed(chunk);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  private flush(): void {
    this.flushTimer = null;
    // 没有浏览器订阅时不序列化屏幕；连接时会直接发当前快照。
    if (this.listenerCount('screen') === 0) {
      this.tracker.takeDirty();
      return;
    }
    const dirty = this.tracker.takeDirty();
    const message: TerminalScreenMessage = dirty.rows === 'all'
      ? { type: 'screen', ...serializeScreen(this.tracker) }
      : { type: 'screen-diff', ...serializeDiff(this.tracker, dirty) };
    this.emit('screen', message);
  }

  /** 连接/重连时发给浏览器的完整画面。 */
  snapshotMessage(): TerminalScreenMessage {
    return { type: 'screen', ...serializeScreen(this.tracker) };
  }

  write(data: string): void { this.pty.write(data); }
  resize(cols: number, rows: number): Promise<void> {
    // 串行化 resize：连续 stty 必须按请求顺序生效；tracker 在 stty 完成后才切尺寸，
    // 这样 stty 期间仍在途的旧尺寸输出不会被当成新尺寸处理。
    this.resizeChain = this.resizeChain
      .catch(() => { /* 上一次 stty 失败不应阻塞后续 resize */ })
      .then(async () => {
        await this.pty.resize(cols, rows);
        this.cols = cols;
        this.rows = rows;
        this.tracker.resize(cols, rows);
        // 尺寸变化后即使没有新输出，也要把新画面发给浏览器。
        this.scheduleFlush();
      });
    return this.resizeChain;
  }
  /** 浏览器同步过来的终端主题色/像素尺寸，用于 OSC/窗口查询的本地回应。 */
  setMeta(meta: TerminalQueryMeta): void {
    this.meta = { ...this.meta, ...meta };
  }
  async close(): Promise<void> {
    await this.resizeChain.catch(() => { /* 关闭时忽略 resize 失败 */ });
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    await this.pty.kill();
  }
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
