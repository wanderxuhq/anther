// server/lsp-manager.ts
// 语言服务注册表（框架先行：加语言 = LSP_ENGINES 加一行）+ 会话懒启动/崩溃重建/空闲回收。
// 多 WS 连接的 open 状态与诊断缓存集中在这里（全局计数，跨连接共享同一 tsserver）。
import { createRequire } from 'node:module';
import path from 'node:path';
import { LspSession, type LspSessionOpts } from './lsp-session.ts';
import type { Diagnostic } from 'vscode-languageserver-protocol';

export type EngineSpec = {
  id: string; cmd: string; args: string[]; languageIds: string[];
  env?: NodeJS.ProcessEnv;
};

export const MAX_RESTARTS = 3;

/** typescript-language-server 的 cli 入口：node lib/cli.mjs --stdio。打包后也能从 package.json 定位。 */
export function typescriptEngineBin(): string {
  const require = createRequire(import.meta.url);
  const pkg = require.resolve('typescript-language-server/package.json');
  return path.join(path.dirname(pkg), 'lib', 'cli.mjs');
}

export function defaultEngines(): EngineSpec[] {
  return [{
    id: 'typescript',
    cmd: process.execPath,
    args: [typescriptEngineBin(), '--stdio'],
    languageIds: ['typescript'],
  }];
}

export class LspManager {
  onDiagnostics: (uri: string, diagnostics: Diagnostic[]) => void = () => {};
  onSessionExit: (engineId: string, restartCount: number) => void = () => {};

  readonly workspaceRoot: string;
  private engines: Map<string, EngineSpec>;
  private sessions = new Map<string, LspSession>();
  private restartCount = new Map<string, number>();
  private openCount = new Map<string, number>();          // engineId → 全局打开 uri 数
  private lastDiagnostics = new Map<string, Diagnostic[]>();
  private idleDisposeMs: number;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: { workspaceRoot: string; engines?: EngineSpec[]; idleDisposeMs?: number }) {
    this.workspaceRoot = opts.workspaceRoot;
    this.idleDisposeMs = opts.idleDisposeMs ?? 5 * 60 * 1000;
    this.engines = new Map((opts.engines ?? defaultEngines()).map((e) => [e.id, e]));
  }

  sessionFor(engineId: string): LspSession {
    const spec = this.engines.get(engineId);
    if (!spec) throw new Error(`no language server for engine: ${engineId}`);
    const existing = this.sessions.get(engineId);
    if (existing) {
      if (existing.alive) return existing;
      // 已退出：<=MAX_RESTARTS 次则重建；超限返回死会话（调用方 open/change 会抛 unavailable）
      if ((this.restartCount.get(engineId) ?? 0) <= MAX_RESTARTS) {
        const next = this.spawn(spec);
        this.sessions.set(engineId, next);
        return next;
      }
      return existing;
    }
    this.restartCount.set(engineId, 0);
    const next = this.spawn(spec);
    this.sessions.set(engineId, next);
    return next;
  }

  private spawn(spec: EngineSpec): LspSession {
    const opts: LspSessionOpts = {
      cmd: spec.cmd,
      args: spec.args,
      cwd: this.workspaceRoot,
      env: spec.env,
      onDiagnostics: (uri, diags) => {
        this.lastDiagnostics.set(uri, diags);
        this.onDiagnostics(uri, diags);
      },
      onExit: (code) => {
        const n = (this.restartCount.get(spec.id) ?? 0) + 1;
        this.restartCount.set(spec.id, n);
        this.onSessionExit(spec.id, n);
      },
    };
    const s = new LspSession(opts);
    // 崩溃后懒重建：exit 事件已统计，重建在下次 sessionFor 触发（start 失败由 open/change 的 ensureReady 抛出）
    void s.start().catch(() => {});
    return s;
  }

  markOpen(engineId: string, uri: string): void {
    this.openCount.set(engineId, (this.openCount.get(engineId) ?? 0) + 1);
    this.clearIdleTimer();
  }

  markClosed(engineId: string, uri: string): void {
    const n = (this.openCount.get(engineId) ?? 0) - 1;
    this.openCount.set(engineId, Math.max(0, n));
    if (n <= 0 && this.idleDisposeMs > 0) {
      this.clearIdleTimer();
      this.idleTimer = setTimeout(() => {
        if ((this.openCount.get(engineId) ?? 0) === 0) void this.disposeEngine(engineId);
      }, this.idleDisposeMs);
    }
  }

  lastDiagnosticsFor(uri: string): Diagnostic[] | null {
    return this.lastDiagnostics.get(uri) ?? null;
  }

  cacheDiagnostics(uri: string, diags: Diagnostic[]): void {
    this.lastDiagnostics.set(uri, diags);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
  }

  async disposeEngine(engineId: string): Promise<void> {
    const s = this.sessions.get(engineId);
    this.sessions.delete(engineId);
    this.openCount.delete(engineId);
    this.restartCount.delete(engineId);
    if (s) await s.dispose();
  }

  async dispose(): Promise<void> {
    this.clearIdleTimer();
    await Promise.all([...this.sessions.keys()].map((id) => this.disposeEngine(id)));
  }
}
