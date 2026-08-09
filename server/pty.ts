// server/pty.ts
// 真 PTY 封装：script -qfc 'echo PTYMARKER $(tty); exec bash' /dev/null。
// 首行 marker 输出 pty 设备路径（/dev/pts/N），Node 解析后所有 resize 走
// `stty -F <dev>` 独立子进程（TIOCSWINSZ），绝不向 stdin 注入 stty（TUI raw
// 模式下注入会被当按键，污染 vim 缓冲区——实测）。
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

const MARKER_RE = /^PTYMARKER (\S+)\r?\n/;
const FIRST_BUF_LIMIT = 64 * 1024; // marker 解析的兜底上限（防异常 shell 无限攒）

export class PtySession extends EventEmitter {
  readonly pid: number;
  readonly ready: Promise<void>;
  private child: ChildProcess;
  private dev: string | null = null;
  private firstBuf = '';
  private readyResolve!: () => void;
  private readyReject!: (e: Error) => void;

  constructor(cwd: string) {
    super();
    this.child = spawn(
      'script',
      ['-qfc', 'echo PTYMARKER $(tty); exec bash', '/dev/null'],
      { cwd, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    this.pid = this.child.pid ?? 0;
    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.child.on('error', (e) => {
      // spawn 失败（ENOENT 等）：只 reject ready，不 emit 'error'（EventEmitter 无
      // 监听者时抛未捕获异常，会崩掉进程）
      this.readyReject(e);
    });
    this.child.stdout!.on('data', (d: Buffer) => this.onStdout(d));
    this.child.on('exit', (code) => this.emit('exit', code ?? 0));
  }

  get readyDevPath(): string | null { return this.dev; }

  private onStdout(d: Buffer): void {
    const s = d.toString('utf8');
    if (this.dev === null) {
      this.firstBuf += s;
      const m = this.firstBuf.match(MARKER_RE);
      if (m) {
        this.dev = m[1];
        const rest = this.firstBuf.slice(m[0].length);
        this.firstBuf = '';
        this.readyResolve();
        if (rest) this.emit('data', rest);
      } else if (this.firstBuf.length > FIRST_BUF_LIMIT) {
        // 异常 shell 没出 marker：兜底放行（resize 变 no-op），不吞输出
        this.dev = '';
        const rest = this.firstBuf;
        this.firstBuf = '';
        this.readyResolve();
        if (rest) this.emit('data', rest);
      }
      return; // marker 未齐，继续攒
    }
    this.emit('data', s);
  }

  write(data: string): void {
    if (this.child.stdin?.writable) this.child.stdin.write(data);
  }

  async resize(cols: number, rows: number): Promise<void> {
    await this.ready;
    if (!this.dev) return;
    await new Promise<void>((resolve) => {
      const s = spawn('stty', ['-F', this.dev!, 'cols', String(cols), 'rows', String(rows)]);
      s.on('exit', () => resolve());
      s.on('error', () => resolve());
    });
  }

  kill(): Promise<void> {
    return new Promise((resolve) => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) { resolve(); return; }
      if (!this.child.pid) { resolve(); return; } // spawn 未成功，无进程可杀
      const timer = setTimeout(() => this.child.kill('SIGKILL'), 1000);
      this.child.once('exit', () => { clearTimeout(timer); resolve(); });
      this.child.kill('SIGTERM');
    });
  }
}
