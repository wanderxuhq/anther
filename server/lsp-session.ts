// server/lsp-session.ts
// 一个语言服务器进程的 LSP 客户端封装：stdio JSON-RPC + FIFO 队列保序 + 初始化握手 +
// 崩溃/超时状态机。协议层用官方 vscode-languageserver-protocol。
import { spawn, type ChildProcess } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  createMessageConnection, StreamMessageReader, StreamMessageWriter,
} from 'vscode-languageserver-protocol/node';
import {
  InitializeRequest, InitializedNotification, DidOpenTextDocumentNotification,
  DidChangeTextDocumentNotification, DidCloseTextDocumentNotification,
  CompletionRequest, PublishDiagnosticsNotification,
  type CompletionItem, type Diagnostic, type MessageConnection,
} from 'vscode-languageserver-protocol';

export type LspSessionOpts = {
  cmd: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  initializeTimeoutMs?: number;
  requestTimeoutMs?: number;
  onDiagnostics: (uri: string, diagnostics: Diagnostic[]) => void;
  onExit: (code: number | null) => void;
};

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`lsp ${label} timeout after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export class LspSession {
  private proc: ChildProcess | null = null;
  private conn: MessageConnection | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private status: 'new' | 'starting' | 'ready' | 'failed' | 'stopped' = 'new';
  private startPromise: Promise<void> | null = null;
  private version = 0;

  constructor(private opts: LspSessionOpts) {}

  get alive(): boolean {
    return this.status === 'ready' && this.proc !== null && this.proc.exitCode === null;
  }

  /** FIFO 队列：前序未完成则不执行。借 Promise 链保序，不依赖前序结果。 */
  private enqueue<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async ensureReady(): Promise<MessageConnection> {
    // 'new' 或 'starting' 都等到 start 完成：spawn 预先 void start() 预热，首个
    // open/change 必须等握手完成（否则 status='starting' 时误判 unavailable）。
    // start() 幂等且缓存 startPromise，并发等待共享同一个在途 promise。
    if (this.status === 'new' || this.status === 'starting') await this.start();
    if (this.status !== 'ready' || !this.conn) throw new Error('language server unavailable');
    return this.conn;
  }

  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.status !== 'new') return;
    this.status = 'starting';
    this.startPromise = this.doStart();
    return this.startPromise;
  }

  private async doStart(): Promise<void> {
    const proc = spawn(this.opts.cmd, this.opts.args, {
      cwd: this.opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.opts.env ? { ...process.env, ...this.opts.env } : undefined,
    });
    this.proc = proc;
    const conn = createMessageConnection(
      new StreamMessageReader(proc.stdout),
      new StreamMessageWriter(proc.stdin),
    );
    this.conn = conn;
    conn.onNotification(PublishDiagnosticsNotification.type, (params) => {
      this.opts.onDiagnostics(params.uri, params.diagnostics);
    });
    conn.listen();
    proc.on('exit', (code) => {
      this.status = this.status === 'ready' ? 'stopped' : 'failed';
      this.opts.onExit(code);
    });
    try {
      await withTimeout(
        conn.sendRequest(InitializeRequest.type, {
          processId: process.pid,
          rootUri: pathToFileURL(this.opts.cwd).href,
          capabilities: { textDocument: {}, workspace: {} },
        }),
        this.opts.initializeTimeoutMs ?? 8000,
        'initialize',
      );
      await conn.sendNotification(InitializedNotification.type, {});
      this.status = 'ready';
    } catch (e) {
      this.status = 'failed';
      proc.kill();
      throw e;
    }
  }

  async open(uri: string, text: string, languageId: string): Promise<void> {
    const conn = await this.ensureReady();
    await this.enqueue(() =>
      conn.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: { uri, languageId, version: ++this.version, text },
      }));
  }

  async change(uri: string, text: string): Promise<void> {
    const conn = await this.ensureReady();
    await this.enqueue(() =>
      conn.sendNotification(DidChangeTextDocumentNotification.type, {
        textDocument: { uri, version: ++this.version },
        contentChanges: [{ text }], // 全量同步：无 range 的 contentChange 即整文档替换
      }));
  }

  async close(uri: string): Promise<void> {
    const conn = await this.ensureReady();
    await this.enqueue(() =>
      conn.sendNotification(DidCloseTextDocumentNotification.type, { textDocument: { uri } }));
  }

  async completion(uri: string, line: number, character: number): Promise<CompletionItem[]> {
    const conn = await this.ensureReady();
    return this.enqueue(async () => {
      const result = await withTimeout(
        conn.sendRequest(CompletionRequest.type, {
          textDocument: { uri },
          position: { line, character },
          context: { triggerKind: 1 },
        }),
        this.opts.requestTimeoutMs ?? 5000,
        'completion',
      );
      if (!result) return [];
      const list = result as CompletionItem[] | { items?: CompletionItem[] };
      return Array.isArray(list) ? list : (list.items ?? []);
    });
  }

  async dispose(): Promise<void> {
    this.queue = this.queue.then(() => {
      if (this.proc && this.proc.exitCode === null) this.proc.kill();
      this.conn?.dispose();
      this.proc = null;
      this.conn = null;
      this.status = 'stopped';
    });
    await this.queue;
  }
}
