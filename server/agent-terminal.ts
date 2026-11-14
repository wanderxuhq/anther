// server/agent-terminal.ts
// ACP client terminal methods. Agents may run non-interactive commands inside
// the session root and read their output; this is separate from anther's
// interactive PTY terminals.
import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import path from 'node:path';
import { RequestError } from '@agentclientprotocol/sdk';

const DEFAULT_OUTPUT_LIMIT = 1024 * 1024;
const FLUSH_MS = 50;

export type AcpTerminalExit = {
  exitCode: number | null;
  signal: string | null;
};

export type AcpTerminalSnapshot = {
  output: string;
  truncated: boolean;
  exitStatus?: AcpTerminalExit;
};

export type AcpTerminalEvent = AcpTerminalSnapshot & {
  type: 'terminal_output';
  sessionID: string;
  terminalID: string;
};

export type AcpTerminalCreateParams = {
  sessionId: string;
  command: string;
  args?: readonly string[] | null;
  env?: ReadonlyArray<{ name: string; value: string }> | null;
  cwd?: string | null;
  outputByteLimit?: number | null;
};

class ManagedTerminal {
  readonly id: string;
  readonly spawned: Promise<void>;
  private child: ChildProcess;
  private output = '';
  private truncated = false;
  private exitStatus?: AcpTerminalExit;
  private exited = false;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private dirty = false;
  private readonly done: Promise<void>;
  private readonly stdoutDecoder = new StringDecoder('utf8');
  private readonly stderrDecoder = new StringDecoder('utf8');
  private finish!: () => void;

  constructor(
    readonly sessionID: string,
    command: string,
    args: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    private readonly limit: number,
    private readonly onUpdate: (snapshot: AcpTerminalSnapshot) => void,
  ) {
    this.id = `acp_term_${randomBytes(6).toString('hex')}`;
    this.done = new Promise<void>((resolve) => { this.finish = resolve; });
    this.child = spawn(command, [...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    this.spawned = new Promise<void>((resolve, reject) => {
      this.child.once('spawn', resolve);
      this.child.once('error', reject);
    });
    this.child.stdout?.on('data', (chunk: Buffer) => this.append(this.stdoutDecoder.write(chunk)));
    this.child.stderr?.on('data', (chunk: Buffer) => this.append(this.stderrDecoder.write(chunk)));
    this.child.on('error', (error) => {
      this.append(`${error.message}\n`);
      this.complete({ exitCode: null, signal: null });
    });
    this.child.on('close', (code, signal) => {
      this.append(this.stdoutDecoder.end());
      this.append(this.stderrDecoder.end());
      this.complete({ exitCode: code ?? null, signal: signal ?? null });
    });
  }

  snapshot(): AcpTerminalSnapshot {
    return {
      output: this.output,
      truncated: this.truncated,
      ...(this.exitStatus ? { exitStatus: this.exitStatus } : {}),
    };
  }

  async waitForExit(): Promise<AcpTerminalExit> {
    await this.done;
    return this.exitStatus ?? { exitCode: null, signal: null };
  }

  async kill(): Promise<void> {
    if (this.exited || this.child.pid === undefined) return;
    this.child.kill('SIGTERM');
    setTimeout(() => {
      if (!this.exited && this.child.pid !== undefined) this.child.kill('SIGKILL');
    }, 1000).unref();
  }

  async release(): Promise<void> {
    await this.kill();
    await this.done;
  }

  private append(chunk: string): void {
    if (!chunk) return;
    const next = truncateToBytes(this.output + chunk, this.limit);
    this.output = next.output;
    this.truncated ||= next.truncated;
    this.dirty = true;
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
      this.flushTimer.unref();
    }
  }

  private complete(status: AcpTerminalExit): void {
    if (this.exited) return;
    this.exited = true;
    this.exitStatus = status;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.flush();
    this.finish();
  }

  private flush(): void {
    this.flushTimer = undefined;
    if (!this.dirty && !this.exited) return;
    this.dirty = false;
    this.onUpdate(this.snapshot());
  }
}

export class AcpTerminalManager {
  private readonly terminals = new Map<string, ManagedTerminal>();
  private readonly dir: string;
  private readonly root: string;
  private closing = false;

  constructor(
    dir: string,
    private readonly onEvent?: (event: AcpTerminalEvent) => void,
  ) {
    this.dir = path.resolve(dir);
    try {
      this.root = realpathSync(this.dir);
    } catch {
      this.root = this.dir;
    }
  }

  async create(params: AcpTerminalCreateParams): Promise<{ terminalId: string }> {
    if (this.closing) throw RequestError.internalError(undefined, 'terminal manager is closing');
    if (typeof params.command !== 'string' || params.command === '') {
      throw RequestError.invalidParams(undefined, 'command is required');
    }
    const cwd = this.cwd(params.cwd);
    const env = this.env(params.env);
    const limit = outputLimit(params.outputByteLimit);
    const args = Array.isArray(params.args) ? params.args : [];
    const terminal = new ManagedTerminal(
      params.sessionId,
      params.command,
      args,
      cwd,
      env,
      limit,
      (snapshot) => this.emit(terminal, snapshot),
    );
    try {
      await terminal.spawned;
    } catch (error) {
      await terminal.release();
      throw RequestError.invalidParams(
        undefined,
        error instanceof Error ? error.message : 'failed to spawn command',
      );
    }
    this.terminals.set(this.key(params.sessionId, terminal.id), terminal);
    return { terminalId: terminal.id };
  }

  output(sessionID: string, terminalID: string): AcpTerminalSnapshot {
    return this.get(sessionID, terminalID).snapshot();
  }

  async waitForExit(sessionID: string, terminalID: string): Promise<AcpTerminalExit> {
    return this.get(sessionID, terminalID).waitForExit();
  }

  async kill(sessionID: string, terminalID: string): Promise<void> {
    await this.get(sessionID, terminalID).kill();
  }

  async release(sessionID: string, terminalID: string): Promise<void> {
    const key = this.key(sessionID, terminalID);
    const terminal = this.terminals.get(key);
    if (!terminal) return;
    this.terminals.delete(key);
    await terminal.release();
  }

  async closeSession(sessionID: string): Promise<void> {
    const entries = [...this.terminals.entries()]
      .filter(([, terminal]) => terminal.sessionID === sessionID);
    for (const [key] of entries) this.terminals.delete(key);
    await Promise.all(entries.map(([, terminal]) => terminal.release()));
  }

  async close(): Promise<void> {
    this.closing = true;
    const terminals = [...this.terminals.values()];
    this.terminals.clear();
    try {
      await Promise.all(terminals.map((terminal) => terminal.release()));
    } finally {
      this.closing = false;
    }
  }

  private emit(terminal: ManagedTerminal, snapshot: AcpTerminalSnapshot): void {
    this.onEvent?.({
      type: 'terminal_output',
      sessionID: terminal.sessionID,
      terminalID: terminal.id,
      ...snapshot,
    });
  }

  private get(sessionID: string, terminalID: string): ManagedTerminal {
    const terminal = this.terminals.get(this.key(sessionID, terminalID));
    if (!terminal) throw RequestError.resourceNotFound(terminalID);
    return terminal;
  }

  private key(sessionID: string, terminalID: string): string {
    return `${sessionID}\0${terminalID}`;
  }

  private cwd(requested?: string | null): string {
    if (!requested) return this.root;
    if (!path.isAbsolute(requested)) {
      throw RequestError.invalidParams(undefined, 'cwd must be absolute');
    }
    let real: string;
    try {
      real = realpathSync(requested);
    } catch {
      throw RequestError.invalidParams(undefined, 'cwd does not exist');
    }
    if (!inside(this.dir, real) && !inside(this.root, real)) {
      throw RequestError.invalidParams(undefined, 'cwd escapes the workspace');
    }
    return real;
  }

  private env(items?: ReadonlyArray<{ name: string; value: string }> | null): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const item of items ?? []) {
      if (item && typeof item.name === 'string' && typeof item.value === 'string') {
        env[item.name] = item.value;
      }
    }
    return env;
  }
}

function inside(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function outputLimit(value?: number | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_OUTPUT_LIMIT;
  return Math.max(0, Math.floor(value));
}

function truncateToBytes(text: string, limit: number): { output: string; truncated: boolean } {
  if (limit <= 0) return { output: '', truncated: text.length > 0 };
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= limit) return { output: text, truncated: false };

  let cut = bytes - limit;
  let index = 0;
  while (cut > 0 && index < text.length) {
    const code = text.codePointAt(index);
    if (code === undefined) break;
    const chars = code > 0xffff ? 2 : 1;
    const size = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    cut -= size;
    index += chars;
  }
  return { output: text.slice(index), truncated: true };
}
