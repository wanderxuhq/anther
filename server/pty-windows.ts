// server/pty-windows.ts
// Windows 原生 PTY（ConPTY）。只在 win32 上动态加载，Linux 不会 import 本文件。
//
// 依赖经可选包 @wanderxuhq/anther-node-pty 引入（它只 re-export node-pty，并用
// os:["win32"] 保证 Linux 不安装/编译原生模块）。开发环境下也接受直接安装的
// node-pty，便于在没有包装包的仓库里调试。
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import type { PtySession } from './pty.ts';
import type { ShellSpec } from './shell.ts';

const require = createRequire(import.meta.url);

type Disposable = { dispose(): void };

type NodePtyProcess = {
  readonly pid: number;
  onData(listener: (data: string) => void): Disposable;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): Disposable;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
};

type NodePtyModule = {
  spawn(file: string, args: string[], options: {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: Record<string, string | undefined>;
  }): NodePtyProcess;
};

function loadNodePty(): NodePtyModule {
  const failures: string[] = [];
  for (const name of ['@wanderxuhq/anther-node-pty', 'node-pty']) {
    try {
      return require(name) as NodePtyModule;
    } catch (e) {
      failures.push(`${name}: ${(e as Error).message}`);
    }
  }
  throw new Error(
    'Windows terminal requires @wanderxuhq/anther-node-pty (or node-pty). '
    + 'Reinstall without --omit=optional. '
    + failures.join(' | '),
  );
}

const KILL_TIMEOUT_MS = 1500;

type NodePtyAgentHandles = {
  _inSocket?: { destroy(): void };
  _conoutSocketWorker?: { dispose(): void };
};

/**
 * node-pty 1.1.0 在 ConPTY 退出后只销毁输出 socket：输入 socket（conin）的 fd
 * 和 ConoutConnection worker 线程会一直留着，长时间开关终端会累积句柄，测试
 * 进程也无法退出。这里通过 node-pty 的私有字段兜底清理；字段变化时静默跳过。
 * 自然退出时延迟清理，给 node-pty 自己的 1s 尾包 flush 留出时间。
 */
function releaseAgentHandles(proc: NodePtyProcess | null, workerDelayMs = 0): void {
  const agent = (proc as unknown as { _agent?: NodePtyAgentHandles } | null)?._agent;
  try {
    agent?._inSocket?.destroy();
  } catch {
    // 已退出/已被 node-pty 关闭
  }
  const disposeWorker = () => {
    try {
      agent?._conoutSocketWorker?.dispose();
    } catch {
      // worker 已退出
    }
  };
  if (workerDelayMs <= 0) {
    disposeWorker();
    return;
  }
  const timer = setTimeout(disposeWorker, workerDelayMs);
  timer.unref?.();
}

export class WindowsPtySession extends EventEmitter implements PtySession {
  readonly pid: number;
  readonly ready: Promise<void>;
  private proc: NodePtyProcess | null = null;
  private exited = false;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;

  constructor(cwd: string, spec: ShellSpec) {
    super();
    this.pid = 0;
    this.ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    try {
      this.proc = loadNodePty().spawn(spec.file, spec.args, {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd,
        env: spec.env,
      });
      this.pid = this.proc.pid;
      this.proc.onData((data) => this.emit('data', data));
      this.proc.onExit(({ exitCode }) => {
        this.exited = true;
        releaseAgentHandles(this.proc, 1200);
        this.emit('exit', exitCode ?? 0);
      });
      // ConPTY 没有 marker 握手：spawn 成功即 ready。
      this.readyResolve();
    } catch (e) {
      this.readyReject(e instanceof Error ? e : new Error(String(e)));
    }
  }

  write(data: string): void {
    try {
      // ConPTY 的控制台输入把 CR 当 Enter；裸 LF（粘贴、移动端输入法）会被
      // 当成 Ctrl+J，命令不会执行。bracketed paste 内部同样安全：粘贴模式下
      // CR 是内容而不是提交。
      this.proc?.write(data.replace(/\r?\n/g, '\r'));
    } catch {
      // 进程已退出：丢弃输入，不影响终端状态机
    }
  }

  async resize(cols: number, rows: number): Promise<void> {
    await this.ready;
    try {
      this.proc?.resize(cols, rows);
    } catch {
      // 退出竞态：resize 失败不应阻塞后续操作
    }
  }

  async kill(): Promise<void> {
    const proc = this.proc;
    if (!proc || this.exited) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        // ConPTY 关闭后，通过 shell 启动的子进程可能仍持有控制台；按进程树兜底。
        execFile('taskkill', ['/PID', String(this.pid), '/T', '/F'], () => resolve());
      }, KILL_TIMEOUT_MS);
      const done = () => {
        clearTimeout(timer);
        releaseAgentHandles(proc, 1200);
        resolve();
      };
      this.once('exit', done);
      try {
        // Windows 不支持信号参数；直接 kill 关闭 ConPTY。
        proc.kill();
      } catch {
        done();
      }
    });
  }
}
